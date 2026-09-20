/**
 * Night Channel Allocation — the client's single read/write path.
 *
 * Everything goes through /api/night-allocation rather than straight to
 * Supabase, because the server re-runs the hard-rule validation and owns the
 * optimistic lock. Writing to the tables directly would skip both, so RLS does
 * not grant it.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  GenerateResult,
  NightAllocationState,
  ValidationResult,
} from "@/domain/night-allocation";

/**
 * Why the crew list looks the way it does, when it was seeded from the shift
 * roster. `null` means the night came from a save, so the roster explains
 * nothing about what is on screen.
 */
export type RosterStatus = "missing" | "empty" | "filled";

export interface NightAllocationResponse {
  state: NightAllocationState;
  /** False when nothing has been saved for this night yet. */
  exists: boolean;
  rosterStatus: RosterStatus | null;
  /** Teams on the shift roster for this night, for the exports' sub-header. */
  teams: string[];
  validation: ValidationResult;
}

/** Raised when someone else saved the night first. Carries their version. */
export class NightAllocationConflict extends Error {
  readonly current: NightAllocationResponse;

  constructor(message: string, current: NightAllocationResponse) {
    super(message);
    this.name = "NightAllocationConflict";
    this.current = current;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("You have been signed out. Sign in again to continue.");
  return { Authorization: `Bearer ${session.access_token}` };
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return (body as { error?: string } | null)?.error ?? fallback;
}

function url(nightDate: string, action?: string, query?: Record<string, string>) {
  const path = `/api/night-allocation/${nightDate}${action ? `/${action}` : ""}`;
  if (!query) return path;
  return `${path}?${new URLSearchParams(query).toString()}`;
}

/** The saved night, or a state seeded from tonight's roster. */
export async function fetchNightAllocation(nightDate: string): Promise<NightAllocationResponse> {
  const response = await fetch(url(nightDate), { headers: await authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Could not load this night."));
  return (await response.json()) as NightAllocationResponse;
}

/**
 * Save the whole night. Throws `NightAllocationConflict` when the version has
 * moved on, so the page can offer the newer version rather than overwrite it.
 */
export async function saveNightAllocation(state: NightAllocationState): Promise<NightAllocationResponse> {
  const response = await fetch(url(state.nightDate), {
    method: "PUT",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });

  if (response.status === 409) {
    const body = (await response.json()) as NightAllocationResponse & { error: string };
    throw new NightAllocationConflict(body.error, body);
  }
  if (response.status === 422) {
    const body = (await response.json()) as { error: string };
    throw new Error(body.error);
  }
  if (!response.ok) throw new Error(await readError(response, "Could not save this night."));
  return (await response.json()) as NightAllocationResponse;
}

/**
 * Run the solver on the server, so a long search never blocks the board. The
 * result is not persisted: a refusal leaves the current board untouched.
 */
export async function generateNightAllocation(state: NightAllocationState): Promise<GenerateResult> {
  const response = await fetch(url(state.nightDate, "generate"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) throw new Error(await readError(response, "The generator could not be reached."));
  return (await response.json()) as GenerateResult;
}

/** Ask the server what it makes of a candidate state — the parity check. */
export async function validateNightAllocation(state: NightAllocationState): Promise<ValidationResult> {
  const response = await fetch(url(state.nightDate, "validate"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) throw new Error(await readError(response, "Could not check this night."));
  return (await response.json()) as ValidationResult;
}

/** One person who can be added to the night by hand. */
export interface ShiftCandidate {
  key: string;
  userId: string | null;
  name: string;
  code: string;
  role: string;
  canTakeTso: boolean;
}

/**
 * Everyone on the night shift roster for this date. The night is seeded from
 * the tower units only, so this wider list is what the "add someone from the
 * shift" picker offers.
 */
export async function fetchShiftCandidates(nightDate: string): Promise<ShiftCandidate[]> {
  const response = await fetch(url(nightDate, "shift"), { headers: await authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Could not load tonight's shift."));
  const body = (await response.json()) as { candidates: ShiftCandidate[] };
  return body.candidates ?? [];
}

/** A working state seeded afresh from the roster. The saved version stands. */
export async function resetNightAllocation(nightDate: string): Promise<NightAllocationResponse> {
  const response = await fetch(url(nightDate, "reset"), { method: "POST", headers: await authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Could not reset this night."));
  return (await response.json()) as NightAllocationResponse;
}

/** The saved roster as plain text, rendered server-side from the saved night. */
export async function fetchRosterText(nightDate: string, pageUrl?: string): Promise<string> {
  const response = await fetch(url(nightDate, "export.txt", pageUrl ? { pageUrl } : undefined), {
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error(await readError(response, "Could not build the roster text."));
  return await response.text();
}

export interface EmailRosterRequest {
  nightDate: string;
  recipients: string[];
  subject: string;
  note?: string;
  attachments?: Array<{ filename: string; content: string }>;
}

export async function emailNightAllocation(request: EmailRosterRequest): Promise<{ sent: number; provider: string }> {
  const { nightDate, ...body } = request;
  const response = await fetch(url(nightDate, "email"), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response, "The roster could not be emailed."));
  return (await response.json()) as { sent: number; provider: string };
}
