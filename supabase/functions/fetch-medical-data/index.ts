import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type MedicalRecord = {
    emp_id?: string;
    name?: string;
    last_medical?: string | null;
    endorsed_upto?: string | null;
    status?: string | null;
    history?: Record<string, string>;
};

function parseDate(raw: string | null | undefined): string | null {
    if (!raw || typeof raw !== "string") return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    // Return YYYY-MM-DD for DATE columns
    return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const requestBody = await req.clone().json().catch(() => ({}));
    const jobName =
        req.headers.get("x-cron-job-name") ||
        (typeof requestBody?.__cron_job_name === "string" ? requestBody.__cron_job_name : "fetch-medical-data");

    async function logApiCall(status: string, message: string, durationMs?: number, triggeredBy?: string, recordsAffected = 0) {
        try {
            await adminClient
                .from("api_call_logs")
                .insert({
                    endpoint: "fetch-medical-data",
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
        // --- Auth ---
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            await logApiCall("error", "Missing authorization header", 0, "unknown");
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const token = authHeader.replace("Bearer ", "");
        let triggeredBy = "service_role";

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

        // --- Read configured URL ---
        let medicalUrl = "";
        try {
            const { data: setting } = await adminClient
                .from("app_settings")
                .select("value")
                .eq("key", "medical_data_webapp_url")
                .maybeSingle();
            if (setting?.value) {
                medicalUrl = setting.value;
            }
        } catch {
            // no fallback
        }

        if (!medicalUrl) {
            const errMsg = "Medical webapp URL not configured in System Settings";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // --- Fetch from external API ---
        const response = await fetch(medicalUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            const errMsg = `Medical webapp returned ${response.status}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const json = await response.json();
        const rawRecords: MedicalRecord[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
                ? json.data
                : [];

        if (!Array.isArray(rawRecords)) {
            const errMsg = "Unexpected response format from medical webapp";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        // --- Transform & upsert ---
        const batchId = `medical-sync-${Date.now()}`;
        const now = new Date().toISOString();
        const records = rawRecords
            .filter((r) => String(r.emp_id || "").trim())
            .map((r) => ({
                emp_id: String(r.emp_id || "").trim(),
                employee_name: String(r.name || "").trim() || "Unknown",
                med_last_date: parseDate(r.last_medical),
                med_endorsed_upto: parseDate(r.endorsed_upto),
                med_status: r.status ? String(r.status).trim() : null,
                med_history: r.history || {},
                med_synced_at: now,
                sync_batch_id: batchId,
            }));

        let upserted = 0;
        if (records.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
                const batch = records.slice(i, i + BATCH_SIZE);
                const { error: upsertError } = await adminClient
                    .from("employee_training_records")
                    .upsert(batch, { onConflict: "emp_id" });

                if (upsertError) {
                    console.error("Medical data upsert error:", upsertError);
                    throw upsertError;
                }

                upserted += batch.length;
            }
        }

        const durationMs = Date.now() - startTime;
        const successMsg = `Fetched ${rawRecords.length} medical records, upserted ${upserted}`;
        await logApiCall("success", successMsg, durationMs, triggeredBy, upserted);

        return new Response(
            JSON.stringify({
                success: true,
                records: rawRecords.length,
                upserted,
            }),
            {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
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
            },
        );
    }
});
