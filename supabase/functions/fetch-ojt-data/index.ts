// ─────────────────────────────────────────────────────────────────────────────
// fetch-ojt-data
//
// Pulls both tabs of the "Training status check" sheet in one request and joins
// them on (emp_id, unit) — never on name, because names are not unique
// (MANISH KUMAR is two different employees) and an employee can hold two
// concurrent OJT cycles in different units (emp 10003134: APP+APP(S) and ADC).
//
// Writes ONLY the sheet_* landing columns. The override_* columns are owned by
// update-ojt-progress and are never present in this function's upsert payload,
// which is what makes this sync safe to re-run at any time.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
    extractArray,
    ojtKey,
    parseExtractedRow,
    parseOjtRow,
} from "./parse.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const startTime = Date.now();
    let jobName: string | null = null;

    async function logApiCall(status: string, message: string, triggeredBy = "unknown") {
        try {
            await adminClient.from("api_call_logs").insert({
                endpoint: "fetch-ojt-data",
                method: "POST",
                status,
                message,
                duration_ms: Date.now() - startTime,
                triggered_by: triggeredBy,
                job_name: jobName,
            });
        } catch (error) {
            console.error("Failed to insert api_call_logs:", error);
        }
    }

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            await logApiCall("error", "Missing authorization header");
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const token = authHeader.replace("Bearer ", "");
        let triggeredBy = "service_role";

        if (token !== serviceRoleKey) {
            const userClient = createClient(supabaseUrl, supabaseAnonKey, {
                global: { headers: { Authorization: authHeader } },
            });
            const { data: userData, error: userError } = await userClient.auth.getUser(token);
            if (userError || !userData?.user) {
                await logApiCall("error", "Invalid auth token");
                return new Response(JSON.stringify({ error: "Unauthorized" }), {
                    status: 401,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }

            const { data: roles } = await adminClient
                .from("user_roles")
                .select("role")
                .eq("user_id", userData.user.id)
                .eq("approved", true);

            const allowed = (roles || []).some((r: { role: string }) =>
                ["supervisor", "admin", "wso"].includes(r.role));

            if (!allowed) {
                await logApiCall("error", "Forbidden: requires supervisor, admin, or wso role");
                return new Response(
                    JSON.stringify({ error: "Forbidden: requires supervisor, admin, or wso role" }),
                    { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
            }

            triggeredBy = userData.user.email || userData.user.id;
        } else {
            triggeredBy = "cron_job";
        }

        try {
            const body = await req.json();
            if (body && typeof body.__cron_job_name === "string") jobName = body.__cron_job_name;
        } catch {
            // no body — manual invoke
        }

        // ── Source URL ──────────────────────────────────────────────────────
        const { data: setting } = await adminClient
            .from("app_settings")
            .select("value")
            .eq("key", "ojt_data_webapp_url")
            .maybeSingle();

        const ojtUrl = setting?.value || "";
        if (!ojtUrl) {
            const errMsg = "OJT webapp URL not configured in System Settings";
            await logApiCall("error", errMsg, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const response = await fetch(ojtUrl, {
            method: "GET",
            redirect: "follow",
            headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        });

        if (!response.ok) {
            const errMsg = `OJT webapp returned ${response.status}`;
            await logApiCall("error", errMsg, triggeredBy);
            throw new Error(errMsg);
        }

        // Apps Script answers 200 even when it is refusing us — a bad shared
        // secret, a broken deployment, or a Google sign-in page. Read the body
        // rather than trusting the status.
        const bodyText = await response.text();

        let json: unknown;
        try {
            json = JSON.parse(bodyText);
        } catch {
            const looksLikeLogin = /<html/i.test(bodyText);
            const errMsg = looksLikeLogin
                ? "OJT webapp returned an HTML page, not JSON — check the deployment is set to 'Anyone with the link'"
                : `OJT webapp returned unparseable JSON: ${bodyText.slice(0, 200)}`;
            await logApiCall("error", errMsg, triggeredBy);
            throw new Error(errMsg);
        }

        // The script reports its own failures in an `error` field; surface that
        // verbatim instead of the misleading "no 'extracted' array" below.
        const scriptError = (json && typeof json === "object")
            ? (json as Record<string, unknown>).error
            : null;

        if (typeof scriptError === "string" && scriptError) {
            const errMsg = scriptError === "Unauthorized"
                ? "OJT webapp rejected the request: token missing or wrong. Check the ?token= on the saved URL matches ACCESS_TOKEN in the Apps Script."
                : `OJT webapp error: ${scriptError}`;
            await logApiCall("error", errMsg, triggeredBy);
            throw new Error(errMsg);
        }

        const extractedRows = extractArray(json, ["extracted", "extracted_data", "extractedData"]);
        const ojtRows = extractArray(json, ["ojt", "ojt_data", "ojtData"]);

        // Both tabs must arrive together — a partial payload would land fresh
        // performed hours against stale start dates.
        if (!extractedRows) {
            const errMsg = "OJT webapp payload has no 'extracted' array";
            await logApiCall("error", errMsg, triggeredBy);
            throw new Error(errMsg);
        }
        if (!ojtRows) {
            const errMsg = "OJT webapp payload has no 'ojt' array";
            await logApiCall("error", errMsg, triggeredBy);
            throw new Error(errMsg);
        }

        // ── Start dates, keyed (emp_id, unit) ───────────────────────────────
        const startDates = new Map<string, string>();
        let ojtSkipped = 0;

        for (const row of ojtRows) {
            const parsed = parseOjtRow(row);
            if (!parsed) {
                ojtSkipped += 1;
                continue;
            }
            startDates.set(ojtKey(parsed.empId, parsed.unit), parsed.startDate);
        }

        // ── Existing rows: needed for archive detection and start-date carry-forward ──
        const { data: existingRows, error: existingError } = await adminClient
            .from("employee_ojt_progress")
            .select("emp_id, unit, sheet_start_date, is_archived");

        if (existingError) throw existingError;

        const existingByKey = new Map<string, { sheet_start_date: string | null; is_archived: boolean }>();
        for (const row of (existingRows || []) as Array<{ emp_id: string; unit: string; sheet_start_date: string | null; is_archived: boolean }>) {
            existingByKey.set(`${row.emp_id}|${row.unit}`, {
                sheet_start_date: row.sheet_start_date,
                is_archived: row.is_archived,
            });
        }

        const { data: profiles } = await adminClient
            .from("profiles")
            .select("employee_id")
            .not("employee_id", "is", null);

        const linkedEmpIds = new Set(
            ((profiles || []) as Array<{ employee_id: string | null }>)
                .map((p) => p.employee_id)
                .filter((id): id is string => Boolean(id)),
        );

        // ── Join and build the upsert payload ───────────────────────────────
        const batchId = `ojt-sync-${Date.now()}`;
        const now = new Date().toISOString();
        const records = new Map<string, Record<string, unknown>>();
        let extractedSkipped = 0;
        let missingStartDate = 0;
        let unlinked = 0;

        for (const row of extractedRows) {
            const parsed = parseExtractedRow(row);
            if (!parsed) {
                extractedSkipped += 1;
                continue;
            }

            const key = ojtKey(parsed.empId, parsed.unit);

            // Only overwrite the start date when this run actually supplies one;
            // otherwise carry forward what we already hold rather than blanking it.
            const startDate = startDates.get(key) ?? existingByKey.get(key)?.sheet_start_date ?? null;
            if (!startDates.has(key)) missingStartDate += 1;

            const profileLinked = linkedEmpIds.has(parsed.empId);
            if (!profileLinked) unlinked += 1;

            records.set(key, {
                emp_id: parsed.empId,
                unit: parsed.unit,
                employee_name: parsed.employeeName,
                designation: parsed.designation,
                sheet_required_hours: parsed.requiredHours,
                sheet_required_days: parsed.requiredDays,
                sheet_performed_hours: parsed.performedHours,
                sheet_performed_days: parsed.performedDays,
                sheet_start_date: startDate,
                sheet_marking_date: parsed.markingDate,
                sheet_synced_at: now,
                sync_batch_id: batchId,
                profile_linked: profileLinked,
                is_archived: false,
            });
        }

        // A row in the OJT tab with no counterpart in Extracted Data has a start
        // date but no hours requirement, so there is nothing to track and it is
        // not synced. That is the right call, but it must not be silent — it
        // usually means someone deleted or blanked a row on one tab only, and the
        // trainee would otherwise disappear from the app without explanation.
        const ojtOnlyKeys = Array.from(startDates.keys()).filter((key) => !records.has(key));

        let upserted = 0;
        const rows = Array.from(records.values());
        const batchSize = 500;

        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const { error: upsertError } = await adminClient
                .from("employee_ojt_progress")
                .upsert(batch, { onConflict: "emp_id,unit" });

            if (upsertError) {
                console.error("OJT upsert error:", upsertError);
                throw upsertError;
            }
            upserted += batch.length;
        }

        // ── Archive cycles that dropped out of the sheet (soft — overrides survive) ──
        const staleKeys = Array.from(existingByKey.entries())
            .filter(([key, value]) => !records.has(key) && !value.is_archived)
            .map(([key]) => key);

        let archived = 0;
        for (const key of staleKeys) {
            const [empId, unit] = key.split("|");
            const { error: archiveError } = await adminClient
                .from("employee_ojt_progress")
                .update({ is_archived: true, sheet_synced_at: now })
                .eq("emp_id", empId)
                .eq("unit", unit);

            if (archiveError) {
                console.error("OJT archive error:", archiveError);
                throw archiveError;
            }
            archived += 1;
        }

        const successMsg =
            `Fetched ${extractedRows.length} extracted / ${ojtRows.length} ojt rows, ` +
            `upserted ${upserted}, archived ${archived}, unlinked ${unlinked}, ` +
            `missing start date ${missingStartDate}, ojt-only ${ojtOnlyKeys.length}` +
            (ojtOnlyKeys.length ? ` (${ojtOnlyKeys.slice(0, 10).join(", ")})` : "") +
            `, skipped ${extractedSkipped + ojtSkipped}`;

        await logApiCall("success", successMsg, triggeredBy);

        return new Response(JSON.stringify({
            success: true,
            extracted_rows: extractedRows.length,
            ojt_rows: ojtRows.length,
            upserted,
            archived,
            unlinked,
            missing_start_date: missingStartDate,
            ojt_only: ojtOnlyKeys.length,
            ojt_only_keys: ojtOnlyKeys.slice(0, 20),
            skipped: extractedSkipped + ojtSkipped,
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("fetch-ojt-data error:", error);
        await logApiCall("error", (error as Error).message || "Internal server error");
        return new Response(
            JSON.stringify({ error: (error as Error).message || "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
});
