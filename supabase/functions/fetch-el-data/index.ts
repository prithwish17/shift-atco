import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type LeaveDetail = {
    from: string;
    to: string;
};

type ElRecord = {
    empId: string;
    name: string;
    leaveDetails: LeaveDetail[];
};

type ElDetailRow = {
    emp_id: string;
    employee_name: string;
    leave_from: string;
    leave_to: string;
    sync_batch_id: string;
    updated_at: string;
};

function normalizeDateString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed.toISOString().slice(0, 10);
}

function getDetailConflictKey(row: Pick<ElDetailRow, "emp_id" | "leave_from" | "leave_to">): string {
    return [row.emp_id, row.leave_from, row.leave_to].join("::");
}

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
                    endpoint: "fetch-el-data",
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
        let elUrl = "";
        try {
            const { data: setting } = await adminClient
                .from("app_settings")
                .select("value")
                .eq("key", "el_data_webapp_url")
                .maybeSingle();
            if (setting?.value) {
                elUrl = setting.value;
            }
        } catch {
            // no fallback
        }

        if (!elUrl) {
            const errMsg = "EL webapp URL not configured in System Settings";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // --- Fetch from external API ---
        console.log(`Fetching EL data from: ${elUrl}`);
        const response = await fetch(elUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            const errMsg = `EL webapp returned ${response.status}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        // Guard: if the webapp returned HTML (login page / error page) instead of JSON, bail early
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
            const errMsg = "EL webapp returned HTML instead of JSON — check if the URL requires authentication or is a redirect/login page";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 502,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const json = await response.json();
        const rawRecords: ElRecord[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
                ? json.data
                : [];

        // --- Transform & upsert ---
        const batchId = `el-sync-${Date.now()}`;
        const now = new Date().toISOString();

        const detailRows: ElDetailRow[] = [];

        for (const record of rawRecords) {
            const empId = String(record.empId || "").trim();
            const empName = String(record.name || "").trim();
            if (!empId) continue;

            if (Array.isArray(record.leaveDetails)) {
                for (const detail of record.leaveDetails) {
                    const from = normalizeDateString(detail.from);
                    const to = normalizeDateString(detail.to);
                    if (!from || !to) continue;

                    detailRows.push({
                        emp_id: empId,
                        employee_name: empName || "Unknown",
                        leave_from: from,
                        leave_to: to,
                        sync_batch_id: batchId,
                        updated_at: now,
                    });
                }
            }
        }

        const dedupedDetailRows = Array.from(
            new Map(detailRows.map((row) => [getDetailConflictKey(row), row])).values(),
        );
        const droppedDuplicateDetails = detailRows.length - dedupedDetailRows.length;

        let upsertedDetails = 0;

        if (dedupedDetailRows.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < dedupedDetailRows.length; i += BATCH_SIZE) {
                const batch = dedupedDetailRows.slice(i, i + BATCH_SIZE);
                const { error: upsertError } = await adminClient
                    .from("employee_el_records")
                    .upsert(batch, { onConflict: "emp_id,leave_from,leave_to" });

                if (upsertError) {
                    console.error("EL detail upsert error:", upsertError);
                    throw upsertError;
                }
                upsertedDetails += batch.length;
            }

        }

        const durationMs = Date.now() - startTime;
        const successMsg = `Fetched ${rawRecords.length} employees, upserted ${upsertedDetails} leave periods, dropped ${droppedDuplicateDetails} duplicate periods`;
        await logApiCall("success", successMsg, durationMs, triggeredBy);

        return new Response(
            JSON.stringify({
                success: true,
                employees: rawRecords.length,
                details: upsertedDetails,
                uniqueDetails: dedupedDetailRows.length,
                droppedDuplicateDetails,
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
