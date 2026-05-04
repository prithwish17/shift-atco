import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type RatingEntry = {
    status: string | null;
    rating_date: string | null;
    endorsement_date: string | null;
    last_proficiency: {
        date: string | null;
        instructor: string | null;
    };
    proficiency_history: Record<string, { date: string | null; instructor: string | null }>;
};

type RatingRecord = {
    emp_id?: string;
    name?: string;
    designation?: string;
    ratings?: Record<string, RatingEntry>;
};

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
        (typeof requestBody?.__cron_job_name === "string" ? requestBody.__cron_job_name : "fetch-rating-data");

    async function logApiCall(status: string, message: string, durationMs?: number, triggeredBy?: string, recordsAffected = 0) {
        try {
            await adminClient
                .from("api_call_logs")
                .insert({
                    endpoint: "fetch-rating-data",
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
        let ratingUrl = "";
        try {
            const { data: setting } = await adminClient
                .from("app_settings")
                .select("value")
                .eq("key", "rating_data_webapp_url")
                .maybeSingle();
            if (setting?.value) {
                ratingUrl = setting.value;
            }
        } catch {
            // no fallback
        }

        if (!ratingUrl) {
            const errMsg = "Rating webapp URL not configured in System Settings";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // --- Fetch from external API ---
        const response = await fetch(ratingUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            const errMsg = `Rating webapp returned ${response.status}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const json = await response.json();
        const rawRecords: RatingRecord[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
                ? json.data
                : [];

        if (!Array.isArray(rawRecords)) {
            const errMsg = "Unexpected response format from rating webapp";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        // --- Transform & upsert ---
        const batchId = `rating-sync-${Date.now()}`;
        const now = new Date().toISOString();
        const records = rawRecords
            .filter((r) => String(r.emp_id || "").trim())
            .map((r) => ({
                emp_id: String(r.emp_id || "").trim(),
                employee_name: String(r.name || "").trim() || "Unknown",
                rating_data: r.ratings || {},
                rating_designation: r.designation ? String(r.designation).trim() : null,
                rating_synced_at: now,
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
                    .select("emp_id, rating_data")
                    .in("emp_id", batch);
                for (const row of existingRows || []) {
                    if (row.rating_data && typeof row.rating_data === "object" && Object.keys(row.rating_data).length > 0) {
                        existingMap.set(row.emp_id, row.rating_data);
                    }
                }
            }

            // Merge incoming data with existing, preserving manual proficiency_history edits
            const mergedRecords = records.map((record) => {
                const existingRatings = existingMap.get(record.emp_id);
                if (!existingRatings) return record;

                const incomingRatings = record.rating_data as Record<string, any>;
                const merged: Record<string, any> = {};

                // Get all rating keys from both sources
                const allKeys = new Set([
                    ...Object.keys(existingRatings),
                    ...Object.keys(incomingRatings),
                ]);

                for (const key of allKeys) {
                    const existing = existingRatings[key];
                    const incoming = incomingRatings[key];

                    if (!existing) {
                        merged[key] = incoming;
                    } else if (!incoming) {
                        merged[key] = existing;
                    } else {
                        // Merge: latest API values should replace older synced values,
                        // while still retaining DB-only history keys not present in the feed.
                        merged[key] = {
                            status: incoming.status ?? existing.status,
                            rating_date: incoming.rating_date ?? existing.rating_date,
                            endorsement_date: incoming.endorsement_date ?? existing.endorsement_date,
                            last_proficiency: incoming.last_proficiency || existing.last_proficiency,
                            proficiency_history: {
                                ...(existing.proficiency_history || {}),
                                ...(incoming.proficiency_history || {}),
                            },
                        };
                    }
                }

                return { ...record, rating_data: merged };
            });

            const BATCH_SIZE = 500;
            for (let i = 0; i < mergedRecords.length; i += BATCH_SIZE) {
                const batch = mergedRecords.slice(i, i + BATCH_SIZE);
                const { error: upsertError } = await adminClient
                    .from("employee_training_records")
                    .upsert(batch, { onConflict: "emp_id" });

                if (upsertError) {
                    console.error("Rating data upsert error:", upsertError);
                    throw upsertError;
                }

                upserted += batch.length;
            }
        }

        const durationMs = Date.now() - startTime;
        const successMsg = `Fetched ${rawRecords.length} rating records, upserted ${upserted}`;
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
