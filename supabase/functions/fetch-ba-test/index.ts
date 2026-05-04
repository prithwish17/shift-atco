import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Shift expiry helpers (IST = UTC + 5:30) ───────────────────────────────────
// Morning shift list visible until 07:30 IST → 02:00 UTC
// Afternoon shift list visible until 13:30 IST → 08:00 UTC
// Night shift list visible until 19:30 IST → 14:00 UTC

function shiftExpiresAt(shift: string, istDateStr: string): string {
    const s = shift.toUpperCase();
    let cutoffHourIST: number;
    let cutoffMinIST: number;

    if (s.includes("MORNING")) { cutoffHourIST = 7;  cutoffMinIST = 30; }
    else if (s.includes("AFTERNOON")) { cutoffHourIST = 13; cutoffMinIST = 30; }
    else if (s.includes("NIGHT")) { cutoffHourIST = 19; cutoffMinIST = 30; }
    else {
        // Unknown shift — expire in 2 days
        return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    }

    // IST → UTC: subtract 5h30m
    let utcHour = cutoffHourIST - 5;
    let utcMin  = cutoffMinIST - 30;
    if (utcMin < 0) { utcMin += 60; utcHour -= 1; }
    if (utcHour < 0) { utcHour += 24; }

    return `${istDateStr}T${String(utcHour).padStart(2, "0")}:${String(utcMin).padStart(2, "0")}:00.000Z`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient     = createClient(supabaseUrl, serviceRoleKey);

    const requestBody = await req.clone().json().catch(() => ({}));
    const explicitJobName =
        req.headers.get("x-cron-job-name") ||
        (typeof requestBody?.__cron_job_name === "string" ? requestBody.__cron_job_name : "");

    function deriveJobName(): string {
        const nowUTC = new Date();
        const istMin = (nowUTC.getUTCHours() * 60 + nowUTC.getUTCMinutes() + 330) % (24 * 60);
        const h = Math.floor(istMin / 60);
        const m = istMin % 60;
        return `ba-test-fetch-${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
    }

    async function logApiCall(
        status: string,
        message: string,
        durationMs?: number,
        triggeredBy?: string,
        recordsAffected = 0,
    ) {
        const jobName = explicitJobName || deriveJobName();
        try {
            await adminClient.from("api_call_logs").insert({
                endpoint:         "fetch-ba-test",
                method:           "POST",
                status,
                message,
                duration_ms:      durationMs ?? null,
                triggered_by:     triggeredBy ?? "unknown",
                job_name:         jobName,
                records_affected: recordsAffected,
            });
        } catch (e) { console.error("Failed to insert api_call_logs:", e); }

        try {
            await adminClient
                .from("sync_jobs")
                .update({ last_run_at: new Date().toISOString(), last_run_status: status, updated_at: new Date().toISOString() })
                .eq("job_name", jobName);
        } catch (e) { console.error("Failed to update sync_jobs:", e); }
    }

    const startTime = Date.now();

    try {
        // ── Auth ──────────────────────────────────────────────────────────────
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            await logApiCall("error", "Missing authorization header", 0, "unknown");
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const token = authHeader.replace("Bearer ", "");
        let triggeredBy = "cron_job";
        if (token !== serviceRoleKey) {
            const userClient = createClient(supabaseUrl, supabaseAnonKey, {
                global: { headers: { Authorization: authHeader } },
            });
            const { data: userData, error: userError } = await userClient.auth.getUser(token);
            if (userError || !userData?.user) {
                await logApiCall("error", "Invalid auth token", Date.now() - startTime, "unknown");
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            triggeredBy = userData.user.email || userData.user.id;
        }

        // ── Read configured URL ───────────────────────────────────────────────
        const { data: setting } = await adminClient
            .from("app_settings")
            .select("value")
            .eq("key", "ba_test_sheet_url")
            .single();

        const sheetUrl = setting?.value?.trim();
        if (!sheetUrl) {
            await logApiCall("error", "BA Test sheet URL not configured in app_settings", Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: "BA Test sheet URL not configured" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // ── Fetch from Google Sheet / Apps Script ─────────────────────────────
        const response = await fetch(sheetUrl, {
            method: "GET",
            redirect: "follow",
            headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        });

        if (!response.ok) {
            const msg = `Sheet URL returned HTTP ${response.status}`;
            await logApiCall("error", msg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: msg }), {
                status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const json = await response.json();

        // ── Parse the new format: { team, shift, employees: [{employee_number, name}] }
        // Also support legacy flat arrays for backwards compatibility.
        const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

        type Row = {
            sl_no: number | null;
            employee_name: string;
            employee_code: string | null;
            test_time: string | null;
            remarks: string | null;
            shift: string | null;
            test_date: string;
            fetched_at: string;
            expires_at: string;
        };

        let rows: Row[] = [];

        // Helper: normalise a shift name to canonical form
        const normaliseShift = (s: string) =>
            s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

        // ── New format: { team, shift, employees: [{employee_number, name}] }
        if (json && typeof json === "object" && !Array.isArray(json) && Array.isArray(json.employees)) {
            const shift    = String(json.shift ?? "").trim();
            const expiresAt = shiftExpiresAt(shift, todayIST);
            const now      = new Date().toISOString();

            rows = json.employees
                .filter((e: unknown) => e && typeof e === "object")
                .map((e: Record<string, unknown>, idx: number) => {
                    const name = String(e["name"] ?? e["employee_name"] ?? e["Name"] ?? "").trim();
                    if (!name) return null;
                    const empNum = e["employee_number"] ?? e["employee_code"] ?? e["emp_code"] ?? null;
                    return {
                        sl_no:         idx + 1,
                        employee_name: name,
                        employee_code: empNum !== null ? String(empNum).trim() : null,
                        test_time:     String(e["test_time"] ?? e["time"] ?? "").trim() || null,
                        remarks:       String(e["remarks"] ?? e["Remarks"] ?? "").trim() || null,
                        shift:         normaliseShift(shift) || null,
                        test_date:     todayIST,
                        fetched_at:    now,
                        expires_at:    expiresAt,
                    } as Row;
                })
                .filter(Boolean) as Row[];
        }
        // ── Legacy format: bare array or { status, data: [...] }
        else {
            const rawRows: unknown[] = Array.isArray(json)
                ? json
                : Array.isArray(json?.data) ? json.data : [];

            const now = new Date().toISOString();

            rows = rawRows
                .map((raw: unknown, idx: number) => {
                    if (!raw || typeof raw !== "object") return null;
                    const r = raw as Record<string, unknown>;
                    const name = String(r["employee_name"] ?? r["name"] ?? r["Name"] ?? r["Employee Name"] ?? "").trim();
                    if (!name) return null;
                    const shift = String(r["shift"] ?? "").trim();
                    const expiresAt = shift
                        ? shiftExpiresAt(shift, todayIST)
                        : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
                    return {
                        sl_no:         Number(r["sl_no"] ?? r["sl"] ?? r["Sr"] ?? r["sr_no"] ?? idx + 1) || idx + 1,
                        employee_name: name,
                        employee_code: String(r["employee_code"] ?? r["employee_number"] ?? r["code"] ?? r["emp_code"] ?? "").trim() || null,
                        test_time:     String(r["test_time"] ?? r["time"] ?? "").trim() || null,
                        remarks:       String(r["remarks"] ?? r["Remarks"] ?? "").trim() || null,
                        shift:         normaliseShift(shift) || null,
                        test_date:     todayIST,
                        fetched_at:    now,
                        expires_at:    expiresAt,
                    } as Row;
                })
                .filter(Boolean) as Row[];
        }

        const seenNames = new Set<string>();
        rows = rows.filter((row) => {
            const key = row.employee_name.trim().toLowerCase();
            if (!key || seenNames.has(key)) return false;
            seenNames.add(key);
            return true;
        });

        if (rows.length === 0) {
            await logApiCall("success", "Sheet returned 0 employees — nothing to insert", Date.now() - startTime, triggeredBy, 0);
            return new Response(JSON.stringify({ success: true, rows: 0, inserted: 0 }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // ── Determine the shift of this fetch to replace only that shift's rows ─
        const fetchedShift = rows[0]?.shift?.toUpperCase() ?? null;

        // Cleanup expired rows
        await adminClient.from("ba_test_list").delete().lt("expires_at", new Date().toISOString());

        // Replace today's rows for this shift (so each cron run is idempotent)
        if (fetchedShift) {
            await adminClient
                .from("ba_test_list")
                .delete()
                .eq("test_date", todayIST)
                .ilike("shift", fetchedShift);
        } else {
            await adminClient.from("ba_test_list").delete().eq("test_date", todayIST);
        }

        const incomingNames = [...new Set(rows.map((row) => row.employee_name).filter(Boolean))];
        for (let i = 0; i < incomingNames.length; i += 100) {
            await adminClient
                .from("ba_test_list")
                .delete()
                .eq("test_date", todayIST)
                .in("employee_name", incomingNames.slice(i, i + 100));
        }

        // Insert fresh rows
        let inserted = 0;
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
            const { error } = await adminClient.from("ba_test_list").insert(rows.slice(i, i + BATCH));
            if (error) console.error("Insert error:", error);
            else inserted += rows.slice(i, i + BATCH).length;
        }

        const msg = `Fetched ${rows.length} employees (shift: ${fetchedShift ?? "unknown"}), inserted ${inserted} for ${todayIST}`;
        await logApiCall("success", msg, Date.now() - startTime, triggeredBy, inserted);

        return new Response(
            JSON.stringify({ success: true, shift: fetchedShift, rows: rows.length, inserted }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (error) {
        const msg = (error as Error).message || "Internal server error";
        await logApiCall("error", msg, Date.now() - startTime, "unknown");
        console.error("fetch-ba-test error:", error);
        return new Response(JSON.stringify({ error: msg }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
