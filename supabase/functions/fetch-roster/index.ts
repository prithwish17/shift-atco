import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycby0ZL9nspDkRuln1JRpr8llBRaNxvaO9Zo1X6zMg89i_inQSeDBJd6EyQE9Wj6dhQ-S1Q/exec";

// ── Date canonicalisation ─────────────────────────────────────────────────────
// The sheet emits "2-Aug-2026" | "2-August-26" | "9-May-26" | "07-30-2026"
// depending on the team/shift tab.  Everything is stored as "yyyy-MM-dd" so the
// frontend's date filters can actually find it.
// Mirrors src/lib/rosterDate.ts and sync-roster (no shared import available).
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

const expandYear = (raw: string) => (raw.length <= 2 ? 2000 + Number(raw) : Number(raw));

function toIsoRosterDate(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  let m = raw.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const day = Number(m[1]);
    if (month && day >= 1 && day <= 31) {
      return `${expandYear(m[3])}-${pad(month)}-${pad(day)}`;
    }
    return null;
  }

  m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = Number(m[3]);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return `${year}-${pad(a)}-${pad(b)}`;
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return `${year}-${pad(b)}-${pad(a)}`;
    return null;
  }

  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = Number(m[3]);
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return `${year}-${pad(b)}-${pad(a)}`;
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return `${year}-${pad(a)}-${pad(b)}`;
    return null;
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");

    // Accept service_role tokens directly; validate user tokens via getUser
    if (token !== serviceRoleKey) {
      const { data: userData, error: userError } =
        await userClient.auth.getUser(token);
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Parse params from either query string or JSON body so both direct invoke
    // and proxy-based fetch paths can call the same function reliably.
    const url = new URL(req.url);
    let requestBody: Record<string, unknown> = {};
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        requestBody = await req.json();
      } catch {
        requestBody = {};
      }
    }

    const team = String(url.searchParams.get("team") || requestBody.team || "");
    const shift = String(url.searchParams.get("shift") || requestBody.shift || "");
    const date = String(url.searchParams.get("date") || requestBody.date || "");

    // Try to read the webapp URL from app_settings table (admin-configurable)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    let appsScriptUrl = DEFAULT_APPS_SCRIPT_URL;
    try {
      const { data: setting } = await adminClient
        .from("app_settings")
        .select("value")
        .eq("key", "roster_webapp_url")
        .single();
      if (setting?.value) {
        appsScriptUrl = setting.value;
      }
    } catch {
      // Table may not exist yet — use default
    }

    // Fetch from Google Apps Script
    const scriptUrl = new URL(appsScriptUrl);
    if (team) scriptUrl.searchParams.set("team", team);
    if (shift) scriptUrl.searchParams.set("shift", shift);
    if (date) scriptUrl.searchParams.set("date", date); // ← forward selected date

    console.log(`Fetching roster from: ${scriptUrl.toString()}`);

    const response = await fetch(scriptUrl.toString(), {
      method: "GET",
      redirect: "follow",
    });

    if (!response.ok) {
      // Redeploying an Apps Script project mints a NEW /exec URL; the old one
      // starts answering 404.  Naming that here saves a long hunt, because the
      // symptom is simply that the roster stops updating.
      const hint = response.status === 404
        ? ` — this deployment URL is dead. A new Apps Script deployment gets a new /exec URL, so update app_settings.roster_webapp_url (currently ${appsScriptUrl === DEFAULT_APPS_SCRIPT_URL ? "unset, using the built-in default" : "set"}).`
        : "";
      throw new Error(`Apps Script returned ${response.status}${hint}`);
    }

    const body = await response.text();

    // Apps Script signals failures (e.g. a spreadsheet the deployment owner can
    // no longer open) with an HTML error page and HTTP 200.  Report the real
    // cause rather than a confusing "Unexpected token '<'" JSON error.
    if (body.trim().startsWith("<")) {
      const detail = /do not have permission/i.test(body)
        ? "permission denied on the source spreadsheet"
        : "an HTML error page";
      throw new Error(
        `Apps Script returned ${detail}${team ? ` for team ${team}` : ""}`,
      );
    }

    // deno-lint-ignore no-explicit-any
    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`Apps Script returned a non-JSON response: ${body.slice(0, 120)}`);
    }

    // Ensure data is an array. Some Apps Script deployments return { data: [...] }.
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);

    // Normalise shift values to title-case ("NIGHT" → "Night") so queries
    // and the frontend work consistently regardless of the API's casing.
    const normaliseShift = (s: string) =>
      s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

    const normaliseTeam = (value: string) => {
      const normalized = String(value || "").trim().toUpperCase().replace(/^TEAM\s+/, "");
      if (normalized === "ALPHA") return "A";
      if (normalized === "BRAVO") return "B";
      if (normalized === "CHARLIE") return "C";
      if (normalized === "DELTA") return "D";
      if (normalized === "ECHO") return "E";
      if (normalized === "GENERAL") return "G";
      return normalized;
    };

    // Delete old entries + insert fresh data using service role
    if (rows.length > 0) {
      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      // Log the first row to identify field names from the webapp
      if (rows.length > 0) {
        console.log("[fetch-roster] Sample row keys:", Object.keys(rows[0]));
        console.log("[fetch-roster] Sample row:", JSON.stringify(rows[0]));
      }

      let skippedDates = 0;

      const toInsert = rows.reduce((acc: Record<string, string>[], row: Record<string, string>) => {
        // The sheet writes each cell as "NAME/ GRADE - RATING-[SAR]", e.g.
        // "BIBHAS SARKAR/ JGM - RSR+UBN-".  This used to be cut down to the bare
        // name, which threw away the grade and the rating — the two things
        // printed under every name on the published roster, and what the grid
        // view renders beneath each person.  The full cell is stored instead;
        // `parsePersonCell` in src/lib/rosterGrid.ts splits it for display and
        // tolerates the bare names that older rows still hold.
        const empName = (row.employee_name || "").trim().replace(/\s+/g, " ");

        // The webapp may return the position/half info under different field names
        // Check: position, mark, remark, half (in order of priority)
        const positionValue = row.position || row.mark || row.remark || row.half || "";

        // Store one canonical date format so the frontend filters can match it.
        const isoDate = toIsoRosterDate(row.date) ?? toIsoRosterDate(date);
        if (!isoDate) {
          skippedDates++;
          return acc;
        }

        acc.push({
          date: isoDate,
          shift: normaliseShift(row.shift || ""),
          team: normaliseTeam(row.team || team),
          unit: (row.unit || "").toUpperCase().trim() === "HQ" ? "WSO" : (row.unit || ""),
          employee_name: empName,
          position: positionValue,
          // Absent from supervision and special rows, and from any deployment
          // older than the merge-aware scraper — stored as NULL, never guessed.
          row_index: Number.isInteger(row.row_index) ? row.row_index : null,
        });
        return acc;
      }, []);

      if (skippedDates > 0) {
        console.warn(`[fetch-roster] Skipped ${skippedDates} row(s) with unparseable dates`);
      }

      // Deduplicate by unique constraint columns (date, shift, employee_name, unit, position)
      const seen = new Set<string>();
      const dedupedInsert = toInsert.filter((r: any) => {
        const key = `${r.date}|${r.shift}|${r.team}|${r.employee_name}|${r.unit}|${r.position}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Build unique (date, shift, team) combos from incoming data
      const combos = new Set<string>();
      dedupedInsert.forEach((r: any) => combos.add(`${r.date}|${r.shift}|${r.team}`));

      const rowKey = (r: Record<string, string>) =>
        `${r.date}|${r.shift}|${r.team}|${r.employee_name}|${r.unit}|${r.position}`;

      // Write-then-clean, never delete-then-write: deleting first meant an upsert
      // failure wiped the slice entirely with no way back. Snapshot first, insert,
      // and only then remove what the new roster no longer contains.
      const existing: Array<{ id: string; key: string }> = [];
      for (const combo of combos) {
        const [d, s, t] = combo.split("|");
        const { data: current, error: selError } = await adminClient
          .from("rosters")
          .select("id, date, shift, team, employee_name, unit, position")
          .eq("date", d)
          .eq("shift", s)
          .eq("team", t);
        if (selError) {
          throw new Error(`Failed to read existing roster: ${selError.message}`);
        }
        for (const r of current ?? []) {
          existing.push({ id: (r as any).id, key: rowKey(r as any) });
        }
      }

      const { error: insertError } = await adminClient
        .from("rosters")
        .upsert(dedupedInsert, {
          onConflict: "date,shift,team,employee_name,unit,position",
        });

      // Must not be swallowed: reporting success when nothing persisted would
      // leave the UI showing stale data with no indication anything went wrong.
      if (insertError) {
        console.error("Insert error:", insertError);
        throw new Error(`Failed to save roster: ${insertError.message}`);
      }

      // Fresh data is committed — safe to drop rows it no longer contains.
      const freshKeys = new Set(dedupedInsert.map((r: any) => rowKey(r)));
      const staleIds = existing.filter((r) => !freshKeys.has(r.key)).map((r) => r.id);

      for (let i = 0; i < staleIds.length; i += 100) {
        const { error: delError } = await adminClient
          .from("rosters")
          .delete()
          .in("id", staleIds.slice(i, i + 100));
        if (delError) console.error("Stale row cleanup failed:", delError);
      }
    }

    return new Response(JSON.stringify({ data: rows, count: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
