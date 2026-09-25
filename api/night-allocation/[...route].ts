/**
 * Night Channel Allocation API.
 *
 *   GET  /api/night-allocation/:date            the full state for a night
 *   PUT  /api/night-allocation/:date            save it (optimistic lock)
 *   POST /api/night-allocation/:date/generate   run the solver, persist nothing
 *   POST /api/night-allocation/:date/validate   errors and warnings for a candidate
 *   POST /api/night-allocation/:date/reset      a freshly seeded working state
 *   GET  /api/night-allocation/:date/shift      everyone the roster puts on nights
 *   GET  /api/night-allocation/:date/export.txt the saved roster as plain text
 *   POST /api/night-allocation/:date/email      send the saved roster
 *
 * Any approved account, whatever its role: the WSO and any employee on that
 * night's shift have identical rights, and there is no request/approve step.
 * The one gate is the app's own account approval — a token from a
 * self-registered account that nobody has approved yet is refused. Past that,
 * the signed-in user is used to stamp who saved, nothing more.
 *
 * Every write re-runs the shared hard-rule validation server-side. The client's
 * own checks are a convenience; this is the one that counts.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest, handleCorsPreflight, setCorsHeaders } from "../../lib/apiAuth.js";
import {
  NIGHT_DATE_PATTERN,
  accountEmails,
  actorName,
  approvedRole,
  loadState,
  missingServiceEnv,
  nightRosterRows,
  parseIncomingState,
  recordAudit,
  saveState,
  seedState,
  serviceClient,
  shiftCandidates,
  validate,
} from "../../lib/nightAllocation/service.js";
import { rateLimit } from "../../lib/nightAllocation/rateLimit.js";
import { parseRecipients, vetAttachments, vetRecipients } from "../../lib/nightAllocation/emailPayload.js";
import { sendRosterEmail, transportConfigured } from "../../lib/nightAllocation/email.js";
import { renderRosterHtml } from "../../lib/nightAllocation/render.js";
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  buildRosterText,
  defaultEmailSubject,
  generateAllocation,
  isNightDate,
  isPlanned,
} from "../../src/domain/night-allocation/index.js";

const MAX_RECIPIENTS = 40;

/**
 * The path segments after `/api/night-allocation/`.
 *
 * Deliberately does not trust one source. A catch-all's `route` param arrives
 * as an array when the platform routes to the file directly, as a slash-joined
 * string when a rewrite passes it through, and not at all if neither happens —
 * which is exactly how this endpoint failed in production while working in dev.
 * The URL is the one thing always present, so it is the fallback.
 */
export function readRouteSegments(routeParam: unknown, url?: string): string[] {
  const raw = Array.isArray(routeParam)
    ? routeParam
    : typeof routeParam === "string"
      ? routeParam.split("/")
      : [];
  const fromQuery = raw.map(segment => String(segment).trim()).filter(Boolean);
  if (fromQuery.length) return fromQuery;

  const path = (url ?? "").split("?")[0];
  const marker = "/api/night-allocation/";
  const index = path.indexOf(marker);
  if (index < 0) return [];
  return path
    .slice(index + marker.length)
    .split("/")
    .map(segment => {
      try {
        return decodeURIComponent(segment).trim();
      } catch {
        return segment.trim();
      }
    })
    .filter(Boolean);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, "GET, PUT, POST, OPTIONS")) return;
  setCorsHeaders(req, res);

  const segments = readRouteSegments(req.query.route, req.url);
  const [nightDate, action] = segments;

  if (!nightDate || !NIGHT_DATE_PATTERN.test(nightDate)) {
    return res.status(400).json({ error: "Expected a night date as YYYY-MM-DD." });
  }
  // `Date.parse` rolls 2026-02-31 over to 3 March rather than refusing it, and
  // the database then fails with a raw error instead of a 400.
  if (!isNightDate(nightDate)) {
    return res.status(400).json({ error: "That is not a real date." });
  }

  const user = await authenticateRequest(req, res);
  if (!user) return;

  // Checked once, up front: every route needs the service role, and a missing
  // variable should name itself rather than surface as a library crash.
  const missing = missingServiceEnv();
  if (missing.length) {
    console.error("[night-allocation] missing server env", missing);
    return res.status(500).json({
      error: `Server misconfigured: ${missing.join(" and ")} not set on this deployment.`,
    });
  }

  try {
    const supabase = serviceClient();

    // Every route, reads included: an account still waiting for approval has
    // no more business here than anywhere else in the app.
    if (!(await approvedRole(supabase, user.id))) {
      return res.status(403).json({
        error: "Your account hasn't been approved yet, so it can't use Night Channel Allocation.",
      });
    }

    if (!action) {
      if (req.method === "GET") return await handleGet(supabase, res, nightDate);
      if (req.method === "PUT") return await handleSave(supabase, req, res, nightDate, user);
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (req.method === "POST" && action === "generate") return await handleGenerate(supabase, req, res, nightDate, user);
    if (req.method === "POST" && action === "validate") return handleValidate(req, res, nightDate);
    if (req.method === "POST" && action === "reset") return await handleReset(supabase, res, nightDate, user);
    if (req.method === "GET" && action === "shift") return await handleShift(supabase, res, nightDate);
    if (req.method === "GET" && action === "export.txt") return await handleExportText(supabase, req, res, nightDate, user);
    if (req.method === "POST" && action === "email") return await handleEmail(supabase, req, res, nightDate, user);

    return res.status(404).json({ error: `Unknown route: ${segments.join("/")}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[night-allocation] request failed", { nightDate, action, message });
    return res.status(500).json({ error: message || "Unexpected error" });
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleGet(supabase: ReturnType<typeof serviceClient>, res: VercelResponse, nightDate: string) {
  const { state, exists, rosterStatus, teams } = await loadState(supabase, nightDate);
  // A night is edited live by several people; a cached copy would be worse than
  // a round trip.
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ state, exists, rosterStatus, teams, validation: validate(state) });
}

async function handleSave(
  supabase: ReturnType<typeof serviceClient>,
  req: VercelRequest,
  res: VercelResponse,
  nightDate: string,
  user: { id: string; email?: string },
) {
  const incoming = parseIncomingState(nightDate, req.body);
  const validation = validate(incoming);
  if (validation.errors.length) {
    return res.status(422).json({
      error: "This night breaks rules that have to be fixed before it can be saved.",
      validation,
    });
  }

  const name = await actorName(supabase, user.id, user.email);
  const outcome = await saveState(supabase, incoming, { id: user.id, name });

  if (outcome.conflict) {
    const current = await loadState(supabase, nightDate);
    return res.status(409).json({
      error: "Someone else saved this night while you were editing. Reload to see their version.",
      state: current.state,
      exists: current.exists,
      rosterStatus: current.rosterStatus,
      teams: current.teams,
      validation: validate(current.state),
    });
  }
  if (!outcome.ok) return res.status(500).json({ error: "The night could not be saved." });

  const saved = await loadState(supabase, nightDate);
  return res.status(200).json({
    state: saved.state,
    exists: true,
    rosterStatus: null,
    teams: saved.teams,
    validation: validate(saved.state),
  });
}

async function handleGenerate(
  supabase: ReturnType<typeof serviceClient>,
  req: VercelRequest,
  res: VercelResponse,
  nightDate: string,
  user: { id: string; email?: string },
) {
  const limit = await rateLimit("generate", user.id, 30, 60);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many generate requests. Try again in a moment." });
  }

  const incoming = parseIncomingState(nightDate, req.body);
  const result = generateAllocation(incoming);

  const name = await actorName(supabase, user.id, user.email);
  await recordAudit(supabase, nightDate, { id: user.id, name }, "generate", {
    ok: result.ok,
    duties: result.ok ? result.state.duties.length : 0,
  });

  // A refusal is an answer, not a failure: 200 with `ok: false` and reasons.
  return res.status(200).json(result);
}

function handleValidate(req: VercelRequest, res: VercelResponse, nightDate: string) {
  const incoming = parseIncomingState(nightDate, req.body);
  return res.status(200).json(validate(incoming));
}

async function handleReset(
  supabase: ReturnType<typeof serviceClient>,
  res: VercelResponse,
  nightDate: string,
  user: { id: string; email?: string },
) {
  // Reset clears the working state only. The last saved version stands until
  // the user saves again, which is what the two-step confirm promises.
  const roster = await nightRosterRows(supabase, nightDate);
  const seeded = await seedState(supabase, nightDate, roster);
  const saved = await loadState(supabase, nightDate, roster);
  const name = await actorName(supabase, user.id, user.email);
  await recordAudit(supabase, nightDate, { id: user.id, name }, "reset", {});

  const state = {
    ...seeded.state,
    version: saved.state.version,
    savedAt: saved.state.savedAt,
    savedByName: saved.state.savedByName,
  };
  return res.status(200).json({
    state,
    exists: saved.exists,
    rosterStatus: seeded.rosterStatus,
    teams: saved.teams,
    validation: validate(state),
  });
}

/**
 * The pool behind "add someone from the shift". Separate from the seed on
 * purpose: the seed is the tower crew marked on the night grid, this is
 * everyone the roster puts on nights, which is the whole unit.
 */
async function handleShift(
  supabase: ReturnType<typeof serviceClient>,
  res: VercelResponse,
  nightDate: string,
) {
  const candidates = await shiftCandidates(supabase, nightDate);
  res.setHeader("Cache-Control", "private, max-age=60");
  return res.status(200).json({ candidates });
}

async function handleExportText(
  supabase: ReturnType<typeof serviceClient>,
  req: VercelRequest,
  res: VercelResponse,
  nightDate: string,
  user: { id: string; email?: string },
) {
  const limit = await rateLimit("export", user.id, 60, 3600);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many exports. Try again later." });
  }

  const { state, exists, teams } = await loadState(supabase, nightDate);
  if (!exists) return res.status(404).json({ error: "Nothing has been saved for this night yet." });

  const pageUrl = typeof req.query.pageUrl === "string" ? req.query.pageUrl : undefined;
  const text = buildRosterText(state, state.savedByName, {
    preparedAt: formatPreparedAt(state.savedAt),
    pageUrl,
    teams,
  });

  const name = await actorName(supabase, user.id, user.email);
  await recordAudit(supabase, nightDate, { id: user.id, name }, "share", { format: "txt" });

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(text);
}

async function handleEmail(
  supabase: ReturnType<typeof serviceClient>,
  req: VercelRequest,
  res: VercelResponse,
  nightDate: string,
  user: { id: string; email?: string },
) {
  const limit = await rateLimit("email", user.id, 10, 3600);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many emails sent from this account. Try again later." });
  }

  const { state, exists, teams } = await loadState(supabase, nightDate);
  if (!exists) return res.status(404).json({ error: "Save the night before emailing it." });
  // An empty board breaks no rule — it is how a night is cleared — but a
  // roster with nobody on it is not something to send the shift. Nor is one
  // holding only the DB slots entered ahead of the plan.
  if (!isPlanned(state)) {
    return res.status(422).json({ error: "Nothing is allocated for this night yet, so there is no roster to send." });
  }

  const validation = validate(state);
  if (validation.errors.length) {
    return res.status(422).json({ error: "This night still has problems to fix, so it can't be shared.", validation });
  }
  if (!transportConfigured()) {
    return res.status(503).json({ error: "No mail transport is configured.", fallback: "mailto" });
  }

  const body = (req.body ?? {}) as {
    recipients?: unknown;
    subject?: unknown;
    note?: unknown;
    attachments?: unknown;
  };

  const recipients = parseRecipients(body.recipients);
  if (!recipients.length) return res.status(400).json({ error: "Add at least one valid email address." });
  if (recipients.length > MAX_RECIPIENTS) {
    return res.status(400).json({ error: `That is more than ${MAX_RECIPIENTS} recipients.` });
  }

  // The mail goes out from the station's address, so it goes only to people
  // with an account — never to whatever address a request names.
  const { rejected } = vetRecipients(recipients, await accountEmails(supabase));
  if (rejected.length) {
    return res.status(400).json({
      error: `The roster can only be emailed to people with an Atcora account. Not recognised: ${rejected.join(", ")}.`,
    });
  }

  const vetted = vetAttachments(body.attachments, nightDate);
  if (vetted.error) return res.status(400).json({ error: vetted.error });
  const { attachments } = vetted;

  const attachmentBytes = attachments.reduce((sum, file) => sum + Math.ceil((file.content.length * 3) / 4), 0);
  if (attachmentBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
    return res.status(413).json({ error: "The attachments are too large to email. Send a link instead." });
  }

  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
  const subject =
    typeof body.subject === "string" && body.subject.trim()
      ? body.subject.trim().slice(0, 200)
      : defaultEmailSubject(nightDate);

  // The body is rendered here, from the saved night — not from anything the
  // client supplied — so everyone receives the same roster.
  const text = buildRosterText(state, state.savedByName, {
    preparedAt: formatPreparedAt(state.savedAt),
    teams,
  });
  const html = renderRosterHtml(state, note, teams);

  const result = await sendRosterEmail({ to: recipients, subject, html, text, attachments });
  const name = await actorName(supabase, user.id, user.email);

  await recordAudit(supabase, nightDate, { id: user.id, name }, "email", {
    recipients,
    attachments: attachments.map(file => file.filename),
    provider: result.provider,
    success: result.success,
  });
  await logEmail(supabase, user.id, recipients, subject, result);

  if (!result.success) return res.status(502).json({ error: result.error ?? "The email could not be sent." });
  return res.status(200).json({ sent: recipients.length, provider: result.provider });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatPreparedAt(savedAt: string | null): string | undefined {
  if (!savedAt) return undefined;
  const when = new Date(savedAt);
  if (Number.isNaN(when.getTime())) return undefined;
  // The station runs on IST; the roster is read there and nowhere else.
  return when.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Same email_logs table the rest of the app's mail is recorded in. */
async function logEmail(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  recipients: string[],
  subject: string,
  result: { success: boolean; provider: string; messageId?: string; error?: string },
) {
  const { error } = await supabase.from("email_logs").insert(
    recipients.map(recipient => ({
      user_id: userId,
      email_to: recipient,
      event_type: "night_allocation_share",
      provider: result.provider,
      provider_id: result.messageId ?? null,
      status: result.success ? "sent" : "failed",
      subject,
      error_message: result.error ?? null,
    })),
  );
  if (error) console.error("[night-allocation] email log write failed", error);
}
