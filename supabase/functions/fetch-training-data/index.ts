import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_TRAINING_DATA_URL =
    "https://script.google.com/macros/s/AKfycbzkGpqGjRkvOPAOOsDsjnjPz1FIU0ceRLAv2xsogsKkozKClZTL1WsPnRPvdduaIouS/exec";

type TrainingRecord = {
    emp_id?: string;
    name?: string;
    license_number?: string;
    ojti?: Record<string, boolean>;
    examiner?: Record<string, boolean>;
    completion_dates?: Record<string, string>;
    instructor_validity?: Record<string, string>;
    examiner_validity?: Record<string, string>;
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    async function logApiCall(status: string, message: string, durationMs?: number, triggeredBy?: string) {
        try {
            await adminClient
                .from("api_call_logs")
                .insert({
                    endpoint: "fetch-training-data",
                    method: "POST",
                    status,
                    message,
                    duration_ms: durationMs || null,
                    triggered_by: triggeredBy || "unknown",
                });
        } catch (e) {
            console.error("Failed to insert api_call_logs:", e);
        }
    }

    const startTime = Date.now();

    try {
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

        let trainingUrl = DEFAULT_TRAINING_DATA_URL;
        try {
            const { data: setting } = await adminClient
                .from("app_settings")
                .select("value")
                .eq("key", "training_data_webapp_url")
                .maybeSingle();
            if (setting?.value) {
                trainingUrl = setting.value;
            }
        } catch {
            // fall back to default URL
        }

        const response = await fetch(trainingUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            const errMsg = `Training data webapp returned ${response.status}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const json = await response.json();
        const rawRecords: TrainingRecord[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
                ? json.data
                : [];

        if (!Array.isArray(rawRecords)) {
            const errMsg = "Unexpected response format from training data webapp";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const batchId = `training-sync-${Date.now()}`;
        const records = rawRecords
            .filter((record) => String(record.emp_id || "").trim() && String(record.name || "").trim())
            .map((record) => ({
                emp_id: String(record.emp_id || "").trim(),
                employee_name: String(record.name || "").trim(),
                license_number: String(record.license_number || "").trim() || null,
                ojti: record.ojti || {},
                examiner: record.examiner || {},
                completion_dates: record.completion_dates || {},
                instructor_validity: record.instructor_validity || {},
                examiner_validity: record.examiner_validity || {},
                raw_payload: record,
                source: "training_webapp",
                sync_batch_id: batchId,
            }));

        let upserted = 0;
        if (records.length > 0) {
            // Fetch existing records to merge (preserve manual edits)
            const empIds = records.map((r) => r.emp_id);
            const existingMap = new Map<string, Record<string, any>>();
            const FETCH_BATCH = 500;
            for (let i = 0; i < empIds.length; i += FETCH_BATCH) {
                const batch = empIds.slice(i, i + FETCH_BATCH);
                const { data: existingRows } = await adminClient
                    .from("employee_training_records")
                    .select("emp_id, ojti, examiner, completion_dates, instructor_validity, examiner_validity")
                    .in("emp_id", batch);
                for (const row of existingRows || []) {
                    existingMap.set(row.emp_id, row);
                }
            }

            // Merge incoming data with existing, preserving manual edits
            // For each JSONB field: existing (manual) values take precedence over incoming API values
            const mergedRecords = records.map((record) => {
                const existing = existingMap.get(record.emp_id);
                if (!existing) return record;

                return {
                    ...record,
                    ojti: { ...(record.ojti as Record<string, any>), ...(existing.ojti || {}) },
                    examiner: { ...(record.examiner as Record<string, any>), ...(existing.examiner || {}) },
                    completion_dates: { ...(record.completion_dates as Record<string, any>), ...(existing.completion_dates || {}) },
                    instructor_validity: { ...(record.instructor_validity as Record<string, any>), ...(existing.instructor_validity || {}) },
                    examiner_validity: { ...(record.examiner_validity as Record<string, any>), ...(existing.examiner_validity || {}) },
                };
            });

            const BATCH_SIZE = 500;
            for (let i = 0; i < mergedRecords.length; i += BATCH_SIZE) {
                const batch = mergedRecords.slice(i, i + BATCH_SIZE);
                const { error: upsertError } = await adminClient
                    .from("employee_training_records")
                    .upsert(batch, { onConflict: "emp_id" });

                if (upsertError) {
                    console.error("Training data upsert error:", upsertError);
                    throw upsertError;
                }

                upserted += batch.length;
            }
        }

        const durationMs = Date.now() - startTime;
        const successMsg = `Fetched ${rawRecords.length} training records, upserted ${upserted}`;
        await logApiCall("success", successMsg, durationMs, triggeredBy);

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