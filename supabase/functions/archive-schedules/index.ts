import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// archive-schedules
//
// Keeps employee_schedules to a rolling window in Postgres (default: current +
// previous calendar month + all future dates) and ships everything older to the
// existing audit-log Google Sheet web app (app_settings key
// 'supervisor_audit_log_webapp_url') as type "schedule_archive".
//
// Flow (confirm-before-delete, batched & resumable):
//   1. Page through rows with duty_date < cutoff (500 at a time).
//   2. POST the batch to the audit-log webapp; require {status:"success"}.
//   3. Only then DELETE those exact ids from the DB.
//   4. Repeat until no rows remain older than the cutoff.
//
// Invoked monthly by the cron queue (process-cron-queue) or manually by an admin.
// Retrieval of archived months is handled by the /api/schedule-archive route,
// which calls the same webapp's doGet.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-cron-job-name",
};

const BATCH_SIZE = 500;

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const requestBody = await req.clone().json().catch(() => ({} as any));
    const jobName =
        req.headers.get("x-cron-job-name") ||
        (typeof requestBody?.__cron_job_name === "string" ? requestBody.__cron_job_name : "archive-schedules-monthly");

    const startTime = Date.now();

    async function logApiCall(status: string, message: string, recordsAffected = 0, triggeredBy = "cron_job") {
        try {
            await adminClient.from("api_call_logs").insert({
                endpoint: "archive-schedules",
                method: "POST",
                status,
                message,
                duration_ms: Date.now() - startTime,
                triggered_by: triggeredBy,
                job_name: jobName,
                records_affected: recordsAffected,
            });
        } catch (e) {
            console.error("Failed to insert api_call_logs:", e);
        }
        try {
            await adminClient
                .from("sync_jobs")
                .update({
                    last_run_at: new Date().toISOString(),
                    last_run_status: status,
                    updated_at: new Date().toISOString(),
                })
                .eq("job_name", jobName);
        } catch { /* sync_jobs row may not exist yet */ }
    }

    try {
        // ── Auth: allow service-role (cron) and authenticated users ──────────────
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
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
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            triggeredBy = userData.user.email || userData.user.id;
        }

        // ── Cutoff: keep current + (monthsToKeep - 1) prior months + future ──────
        // Default must match MONTHS_KEPT_IN_DB in src/hooks/useEmployeeSchedules.ts,
        // so a manual invocation without a payload cannot archive away months the
        // frontend still expects to find in the database.
        const monthsToKeep = Number(requestBody?.monthsToKeep) > 0 ? Number(requestBody.monthsToKeep) : 6;
        const now = new Date();
        // First day of (current month - (monthsToKeep - 1)) in UTC.
        const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsToKeep - 1), 1));
        const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

        // ── Resolve the audit-log webapp URL ─────────────────────────────────────
        const { data: setting } = await adminClient
            .from("app_settings")
            .select("value")
            .eq("key", "supervisor_audit_log_webapp_url")
            .maybeSingle();
        const webappUrl = (setting as any)?.value || "";
        if (!webappUrl) {
            await logApiCall("error", "supervisor_audit_log_webapp_url not configured", 0, triggeredBy);
            return new Response(JSON.stringify({ error: "Audit-log webapp URL not configured" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // ── Page → POST → delete loop ────────────────────────────────────────────
        let totalArchived = 0;
        let batches = 0;

        while (true) {
            const { data: rows, error: selErr } = await adminClient
                .from("employee_schedules")
                .select("id, employee_code, employee_name, duty_date, duty_code, duty_description")
                .lt("duty_date", cutoffStr)
                .order("duty_date", { ascending: true })
                .limit(BATCH_SIZE);

            if (selErr) throw selErr;
            if (!rows || rows.length === 0) break;

            // POST batch to the audit-log sheet (server-side: we CAN read the response)
            const resp = await fetch(webappUrl, {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: JSON.stringify({
                    type: "schedule_archive",
                    archivedAt: new Date().toISOString(),
                    cutoff: cutoffStr,
                    rows: rows.map((r) => ({
                        employee_code: r.employee_code,
                        employee_name: r.employee_name,
                        duty_date: r.duty_date,
                        duty_code: r.duty_code,
                        duty_description: r.duty_description,
                    })),
                }),
            });

            const text = await resp.text();
            let ok = resp.ok;
            try { ok = ok && JSON.parse(text)?.status === "success"; } catch { /* tolerate plain-text OK */ }
            if (!ok) {
                throw new Error(`Audit-log webapp rejected batch (${resp.status}): ${text.slice(0, 200)}`);
            }

            // Confirmed in the sheet → safe to delete from DB
            const ids = rows.map((r) => r.id);
            const { error: delErr } = await adminClient
                .from("employee_schedules")
                .delete()
                .in("id", ids);
            if (delErr) throw delErr;

            totalArchived += rows.length;
            batches += 1;
            if (rows.length < BATCH_SIZE) break;
        }

        const msg = `Archived ${totalArchived} rows (<${cutoffStr}) to audit-log sheet in ${batches} batch(es)`;
        await logApiCall("success", msg, totalArchived, triggeredBy);
        return new Response(
            JSON.stringify({ status: "success", archived: totalArchived, cutoff: cutoffStr, batches }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logApiCall("error", message);
        return new Response(JSON.stringify({ status: "error", error: message }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
