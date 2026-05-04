import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = (Deno.env.get("ALLOWED_ORIGIN") || "*").replace(/\/+$/, "");
const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type TeamCodeRecord = {
    team_code: string;
    emp_id: string;
    name: string;
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
                    endpoint: "fetch-team-code",
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
        let teamCodeUrl = "";
        try {
            const { data: setting } = await adminClient
                .from("app_settings")
                .select("value")
                .eq("key", "team_code_webapp_url")
                .maybeSingle();
            if (setting?.value) {
                teamCodeUrl = setting.value;
            }
        } catch {
            // no fallback
        }

        if (!teamCodeUrl) {
            const errMsg = "Team Code webapp URL not configured in System Settings";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // --- Fetch from external API ---
        console.log(`Fetching team code data from: ${teamCodeUrl}`);
        const response = await fetch(teamCodeUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            const errMsg = `Team Code webapp returned ${response.status}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        // Guard: if the webapp returned HTML instead of JSON, bail early
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
            const errMsg = "Team Code webapp returned HTML instead of JSON — check if the URL requires authentication or is a redirect/login page";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 502,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const json = await response.json();
        const rawRecords: TeamCodeRecord[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
                ? json.data
                : [];

        // --- Update profiles.current_shift ---
        let updated = 0;
        let skipped = 0;
        let notFound = 0;

        for (const record of rawRecords) {
            // Normalise emp_id the same way the DB does (UPPER, alphanum only)
            const empId = String(record.emp_id || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
            const rawTeam = String(record.team_code || "").trim().toUpperCase();
            if (!empId || !rawTeam) {
                skipped++;
                continue;
            }

            // Map to shift_type enum values: 'general', 'a', 'b', 'c', 'd', 'e'
            const teamCode = (rawTeam === "G" || rawTeam === "GENERAL")
                ? "general"
                : rawTeam.toLowerCase();

            const validValues = ["general", "a", "b", "c", "d", "e"];
            if (!validValues.includes(teamCode)) {
                console.warn(`Unknown team_code "${rawTeam}" for ${empId}, skipping`);
                skipped++;
                continue;
            }

            const { data: updateData, error: updateError } = await adminClient
                .from("profiles")
                .update({ current_shift: teamCode })
                .eq("employee_id", empId)
                .select("id");

            if (updateError) {
                console.error(`Failed to update team code for ${empId}:`, updateError);
                skipped++;
            } else if (!updateData || updateData.length === 0) {
                notFound++;
            } else {
                updated++;
            }
        }

        const durationMs = Date.now() - startTime;
        const successMsg = `Fetched ${rawRecords.length} records, updated ${updated} profiles, skipped ${skipped}, not found ${notFound}`;
        await logApiCall("success", successMsg, durationMs, triggeredBy);

        return new Response(
            JSON.stringify({
                success: true,
                total: rawRecords.length,
                updated,
                skipped,
                notFound,
            }),
            {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
        );
    } catch (error) {
        const durationMs = Date.now() - startTime;
        console.error("Error:", error);
        await logApiCall("error", (error as Error).message || "Internal server error", durationMs, "unknown");
        return new Response(
            JSON.stringify({ error: (error as Error).message || "Internal server error" }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
        );
    }
});
