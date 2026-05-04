import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbyj6zFzcEh16H07ZKj7NAMOndgNeUWG_Hgk8zopLnSDduLzjBFIDWmLvzqqCthPtcF2/exec";

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
        const response = await fetch(appsScriptUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            const errMsg = `Apps Script returned ${response.status}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const json = await response.json();

        if (json.status !== "success" || !Array.isArray(json.data)) {
            const errMsg = "Unexpected response format from Apps Script";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const employees = json.data;

        // Flatten employees + duties into rows for upsert
        const rows: Array<{
            employee_code: string;
            employee_name: string;
            duty_date: string;
            duty_code: string;
            duty_description: string;
        }> = [];

        for (const emp of employees) {
            const empCode = String(emp.id || "").trim();
            const empName = String(emp.name || "").trim();
            if (!empCode || !empName) continue;

            for (const duty of emp.duties || []) {
                const date = String(duty.date || "").trim();
                const code = String(duty.code || "").trim();
                const desc = String(duty.description || "").trim();
                if (!date) continue;

                rows.push({
                    employee_code: empCode,
                    employee_name: empName,
                    duty_date: date,
                    duty_code: code,
                    duty_description: desc,
                });
            }
        }

        console.log(`Flattened ${rows.length} schedule rows from ${employees.length} employees`);

        // Upsert into employee_schedules using service role
        let upserted = 0;
        if (rows.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);
                const { error: upsertError } = await adminClient
                    .from("employee_schedules")
                    .upsert(batch, { onConflict: "employee_code,duty_date" });

                if (upsertError) {
                    console.error("Upsert error:", upsertError);
                } else {
                    upserted += batch.length;
                }
            }
            console.log(`Upserted ${upserted} schedule rows`);
        }

        const durationMs = Date.now() - startTime;
        const successMsg = `Fetched ${employees.length} employees, ${rows.length} rows, upserted ${upserted}`;
        await logApiCall("success", successMsg, durationMs, triggeredBy, upserted);

        return new Response(
            JSON.stringify({
                success: true,
                employees: employees.length,
                rows: rows.length,
                upserted,
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
