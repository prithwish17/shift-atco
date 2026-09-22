import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbyj6zFzcEh16H07ZKj7NAMOndgNeUWG_Hgk8zopLnSDduLzjBFIDWmLvzqqCthPtcF2/exec";

// ─── Tunables ────────────────────────────────────────────────────────────────
// A run's wall time is dominated by two things: how long Apps Script takes to
// hand over the whole roster, and how many sequential PostgREST round trips the
// push costs.  The second used to be ~170 of them (84k rows / 500, one after
// another); batching wider and running a few in flight collapses that.
//
// Every tunable is overridable from the request payload so a slow run can be
// bisected against production data without a redeploy:
//   { "batchSize": 500, "concurrency": 1, "skipArchived": false }
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_CONCURRENCY = 5;
// Guard against a hung Apps Script holding the function (and the caller, whose
// pg_net / Vercel timeouts are both 60s) open for the whole invocation budget.
const APPS_SCRIPT_TIMEOUT_MS = 120_000;
// MUST match MONTHS_KEPT_IN_DB in src/hooks/useEmployeeSchedules.ts and the
// monthsToKeep the archive-schedules cron passes (migration 20260802010000).
const DEFAULT_MONTHS_KEPT = 6;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * First day of the oldest month Postgres still holds.  archive-schedules ships
 * everything before this to the audit-log sheet on the 1st of each month, and
 * useEmployeeSchedules reads those months back from there — so re-pushing them
 * every run only re-creates rows the next archive run has to ship and delete
 * again.  Each re-created row is a genuine INSERT into all of the table's
 * indexes, which the changed-rows-only RPC cannot suppress.
 */
function archiveCutoff(monthsToKeep: number): string {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsToKeep - 1), 1))
        .toISOString()
        .slice(0, 10);
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const requestBody = await req.clone().json().catch(() => ({}));
    const explicitJobName =
        req.headers.get("x-cron-job-name") ||
        (typeof requestBody?.__cron_job_name === "string" ? requestBody.__cron_job_name : "");

    const batchSize = Number(requestBody?.batchSize) > 0 ? Number(requestBody.batchSize) : DEFAULT_BATCH_SIZE;
    const concurrency = Number(requestBody?.concurrency) > 0 ? Number(requestBody.concurrency) : DEFAULT_CONCURRENCY;
    const monthsToKeep = Number(requestBody?.monthsToKeep) > 0 ? Number(requestBody.monthsToKeep) : DEFAULT_MONTHS_KEPT;
    const skipArchived = requestBody?.skipArchived !== false;
    const cutoff = archiveCutoff(monthsToKeep);

    // Derive the sync_jobs job_name from current IST hour (matches registered cron job names)
    function deriveScheduleJobName(): string {
        const nowUTC = new Date();
        const istHour = Math.floor((nowUTC.getUTCHours() * 60 + nowUTC.getUTCMinutes() + 330) / 60) % 24;
        return `schedule-sync-${String(istHour).padStart(2, "0")}h`;
    }

    // Helper to log API calls and update sync_jobs status
    async function logApiCall(status: string, message: string, durationMs?: number, triggeredBy?: string, recordsAffected = 0) {
        const jobName = explicitJobName || deriveScheduleJobName();
        try {
            await adminClient
                .from("api_call_logs")
                .insert({
                    endpoint: "fetch-schedule",
                    method: "POST",
                    status,
                    message,
                    duration_ms: durationMs || null,
                    triggered_by: triggeredBy || "unknown",
                    job_name: jobName,
                    records_affected: recordsAffected,
                });
        } catch (e) {
            console.error("Failed to insert api_call_logs:", e);
        }
        // Update sync_jobs last_run status so the admin UI shows accurate cron run info
        try {
            await adminClient
                .from("sync_jobs")
                .update({
                    last_run_at: new Date().toISOString(),
                    last_run_status: status,
                    updated_at: new Date().toISOString(),
                })
                .eq("job_name", jobName);
        } catch (e) {
            console.error("Failed to update sync_jobs:", e);
        }
    }

    const startTime = Date.now();
    // Split so a slow run can be attributed from api_call_logs alone: a long
    // ttfb is Apps Script computing, a long read is payload size, a long push
    // is the database round trips.
    const timings = { ttfbMs: 0, readMs: 0, flattenMs: 0, pushMs: 0 };

    try {
        // Validate auth
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            await logApiCall("error", "Missing authorization header", 0, "unknown");
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

        // Verify caller token (allow authenticated user tokens and service-role tokens)
        const token = authHeader.replace("Bearer ", "");
        let triggeredBy = "service_role";

        // Check if token is service role or user token
        if (token !== serviceRoleKey) {
            const userClient = createClient(supabaseUrl, supabaseAnonKey, {
                global: { headers: { Authorization: authHeader } },
            });
            const { data: userData, error: userError } = await userClient.auth.getUser(token);
            if (userError || !userData?.user) {
                await logApiCall("error", "Invalid auth token", Date.now() - startTime, "unknown");
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            triggeredBy = userData.user.email || userData.user.id;
        } else {
            triggeredBy = "cron_job";
        }

        // Try to read the webapp URL from app_settings table (admin-configurable)
        let appsScriptUrl = DEFAULT_APPS_SCRIPT_URL;
        try {
            const { data: setting } = await adminClient
                .from("app_settings")
                .select("value")
                .eq("key", "schedule_webapp_url")
                .single();
            if (setting?.value) {
                appsScriptUrl = setting.value;
            }
        } catch {
            // Table may not exist yet — use default
        }

        // Fetch from Google Apps Script
        console.log(`Fetching schedules from: ${appsScriptUrl}`);
        const fetchStart = Date.now();
        const abort = new AbortController();
        const abortTimer = setTimeout(() => abort.abort(), APPS_SCRIPT_TIMEOUT_MS);
        const response = await fetch(appsScriptUrl, {
            method: "GET",
            redirect: "follow",
            signal: abort.signal,
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        }).catch(async (fetchErr) => {
            clearTimeout(abortTimer);
            const timedOut = fetchErr instanceof Error && fetchErr.name === "AbortError";
            const errMsg = timedOut
                ? `Apps Script did not respond within ${APPS_SCRIPT_TIMEOUT_MS / 1000}s`
                : `Apps Script request failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        });
        timings.ttfbMs = Date.now() - fetchStart;

        if (!response.ok) {
            clearTimeout(abortTimer);
            const errMsg = `Apps Script returned ${response.status}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const readStart = Date.now();
        const json = await response.json().finally(() => clearTimeout(abortTimer));
        timings.readMs = Date.now() - readStart;

        if (json.status !== "success" || !Array.isArray(json.data)) {
            const errMsg = "Unexpected response format from Apps Script";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const employees = json.data;

        // Flatten employees + duties into rows for upsert.  The first row for
        // each (employee, date) wins, as it does inside the RPC and in
        // fetch-roster — deduped here as well as in SQL because the RPC sees one
        // batch at a time, so a repeat in a later batch would overwrite the first.
        const flattenStart = Date.now();
        const rows: Array<{
            employee_code: string;
            employee_name: string;
            duty_date: string;
            duty_code: string;
            duty_description: string;
        }> = [];
        const seen = new Set<string>();
        let duplicates = 0;
        let skippedArchived = 0;
        let minDate = "";
        let maxDate = "";

        for (const emp of employees) {
            const empCode = String(emp.id || "").trim();
            const empName = String(emp.name || "").trim();
            if (!empCode || !empName) continue;

            for (const duty of emp.duties || []) {
                const date = String(duty.date || "").trim();
                if (!date) continue;

                // Only an ISO date can be compared as a string.  Anything else is
                // passed through untouched, so a change in the sheet's date format
                // can never silently drop rows — it just stops the skip.
                if (skipArchived && ISO_DATE.test(date) && date < cutoff) {
                    skippedArchived++;
                    continue;
                }

                const key = `${empCode}|${date}`;
                if (seen.has(key)) {
                    duplicates++;
                    continue;
                }
                seen.add(key);
                if (ISO_DATE.test(date)) {
                    if (!minDate || date < minDate) minDate = date;
                    if (!maxDate || date > maxDate) maxDate = date;
                }

                rows.push({
                    employee_code: empCode,
                    employee_name: empName,
                    duty_date: date,
                    duty_code: String(duty.code || "").trim(),
                    duty_description: String(duty.description || "").trim(),
                });
            }
        }
        timings.flattenMs = Date.now() - flattenStart;

        console.log(
            `Flattened ${rows.length} schedule rows from ${employees.length} employees ` +
            `(${duplicates} duplicates, ${skippedArchived} before archive cutoff ${cutoff})`
        );

        // Via RPC rather than .upsert() so unchanged rows are skipped instead of
        // rewritten — PostgREST cannot put a WHERE on ON CONFLICT DO UPDATE.
        //
        // Batches run a few at a time.  They are disjoint by construction: the
        // dedupe above puts each (employee_code, duty_date) in exactly one batch,
        // so concurrent ON CONFLICT statements never contend for the same row and
        // cannot deadlock against each other.
        const pushStart = Date.now();
        let changed = 0;
        let failedBatches = 0;
        const batches: Array<typeof rows> = [];
        for (let i = 0; i < rows.length; i += batchSize) {
            batches.push(rows.slice(i, i + batchSize));
        }

        let nextBatch = 0;
        const workers = Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
            for (;;) {
                const index = nextBatch++;
                if (index >= batches.length) return;
                const { data: batchChanged, error: syncError } = await adminClient
                    .rpc("sync_employee_schedules", { p_rows: batches[index] });

                if (syncError) {
                    console.error(`Schedule sync error (batch ${index + 1}/${batches.length}):`, syncError);
                    failedBatches++;
                } else {
                    changed += batchChanged ?? 0;
                }
            }
        });
        await Promise.all(workers);
        timings.pushMs = Date.now() - pushStart;

        if (rows.length > 0) {
            console.log(`Processed ${rows.length} schedule rows in ${batches.length} batches, ${changed} changed`);
        }

        // An upsert never deletes, so a duty the sheet has stopped returning
        // stays in the table and keeps rendering.  The full key set is too big
        // to diff here, but a count over the window this run just covered is
        // one round trip and says how far the two have drifted: anything above
        // the number of rows pushed is a row the sheet did not send.  (Rows the
        // leave sync writes for dates the sheet omits count here too, so read
        // it as "not covered by this run", not strictly "stale".)
        let uncoveredRows: number | null = null;
        if (!failedBatches && minDate && maxDate) {
            const { count, error: countError } = await adminClient
                .from("employee_schedules")
                .select("id", { count: "exact", head: true })
                .gte("duty_date", minDate)
                .lte("duty_date", maxDate);
            if (countError) {
                console.error("Drift count failed:", countError);
            } else {
                uncoveredRows = Math.max(0, (count ?? 0) - rows.length);
            }
        }

        // A run whose batches failed is not a success, even though it finished.
        // The admin dashboard judges sync health from these log rows, and the
        // RPC missing (function deployed before its migration) fails every batch.
        const durationMs = Date.now() - startTime;
        const status = failedBatches ? "error" : "success";
        const summary =
            `Fetched ${employees.length} employees, ${rows.length} rows, ${changed} changed` +
            (skippedArchived ? `, ${skippedArchived} pre-${cutoff} skipped` : "") +
            (uncoveredRows ? `, ${uncoveredRows} rows in ${minDate}..${maxDate} not in the sheet` : "") +
            (failedBatches ? `, ${failedBatches} of ${batches.length} batches failed` : "") +
            ` [ttfb ${timings.ttfbMs}ms, read ${timings.readMs}ms, push ${timings.pushMs}ms` +
            ` over ${batches.length} batches x${concurrency}]`;
        await logApiCall(status, summary, durationMs, triggeredBy, changed);

        return new Response(
            JSON.stringify({
                success: failedBatches === 0,
                employees: employees.length,
                rows: rows.length,
                changed,
                duplicates,
                skippedArchived,
                uncoveredRows,
                cutoff,
                batches: batches.length,
                failedBatches,
                timings: { ...timings, totalMs: durationMs },
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error) {
        const durationMs = Date.now() - startTime;
        console.error("Error:", error);
        await logApiCall("error", error.message || "Internal server error", durationMs, "unknown");
        return new Response(
            JSON.stringify({ error: error.message || "Internal server error" }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
