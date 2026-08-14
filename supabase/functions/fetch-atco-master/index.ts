/**
 * fetch-atco-master
 *
 * Pulls the CAP Kolkata Master "ATCO LIST" (see atco-master-scraper.gs) and
 * lands the two joining dates where they belong:
 *
 *   DOJ     (column K) -> employee_training_records.kolkata_joining_date
 *   DOJ_AAI (column J) -> profiles.date_of_joining
 *
 * The Kolkata date goes on employee_training_records because that table is
 * keyed by emp_id TEXT and covers the whole roster; profiles exists only for
 * employees with an app account. SARC needs all of them.
 *
 * Scheduled weekly on Sunday — the master changes on posting orders, not daily.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Only what nothing else supplies. Designation, licence number, email and the
 * rest already arrive from their own syncs, and duplicating them here would
 * give two writers to one column.
 */
type MasterRecord = {
    emp_id?: string;
    name?: string;
    doj_aai?: string | null;
    doj_kolkata?: string | null;
    transferred_out?: boolean;
};

/** The scraper already emits ISO; this is the belt-and-braces pass. */
function toIsoDate(raw: unknown): string | null {
    if (raw == null) return null;
    const value = String(raw).trim();
    if (!value) return null;

    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    const dayFirst = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value);

    let year: number, month: number, day: number;
    if (iso) {
        year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
    } else if (dayFirst) {
        day = Number(dayFirst[1]); month = Number(dayFirst[2]); year = Number(dayFirst[3]);
    } else {
        return null;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCDate() !== day) return null;

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Match the normalisation the rest of the sync layer uses. */
const normaliseEmpId = (raw: unknown) =>
    String(raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

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
        (typeof requestBody?.__cron_job_name === "string"
            ? requestBody.__cron_job_name
            : "fetch-atco-master");

    const startTime = Date.now();

    async function logApiCall(
        status: string,
        message: string,
        triggeredBy = "unknown",
        recordsAffected = 0,
    ) {
        try {
            await adminClient.from("api_call_logs").insert({
                endpoint: "fetch-atco-master",
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
        } catch (e) {
            console.error("Failed to update sync_jobs:", e);
        }
    }

    const fail = async (message: string, status: number, triggeredBy = "unknown") => {
        await logApiCall("error", message, triggeredBy);
        return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    };

    try {
        // ── Auth ─────────────────────────────────────────────────────────────
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
            return await fail("Missing authorization header", 401);
        }

        const token = authHeader.replace("Bearer ", "");
        let triggeredBy = "cron_job";

        if (token !== serviceRoleKey) {
            const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
                global: { headers: { Authorization: authHeader } },
            });
            const { data: userData, error: userError } = await userClient.auth.getUser(token);
            if (userError || !userData?.user) {
                return await fail("Invalid auth token", 401);
            }
            triggeredBy = userData.user.email || userData.user.id;
        }

        // ── Configured URL ───────────────────────────────────────────────────
        const { data: setting } = await adminClient
            .from("app_settings")
            .select("value")
            .eq("key", "atco_master_webapp_url")
            .maybeSingle();

        const masterUrl = setting?.value ?? "";
        if (!masterUrl) {
            return await fail(
                "ATCO Master webapp URL not configured in System Settings",
                400,
                triggeredBy,
            );
        }

        // ── Fetch ────────────────────────────────────────────────────────────
        const response = await fetch(masterUrl, {
            method: "GET",
            redirect: "follow",
            headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        });
        if (!response.ok) {
            return await fail(`ATCO Master webapp returned ${response.status}`, 502, triggeredBy);
        }

        const json = await response.json();
        const raw: MasterRecord[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
              ? json.data
              : [];
        if (!Array.isArray(raw) || raw.length === 0) {
            return await fail("ATCO Master webapp returned no rows", 502, triggeredBy);
        }

        const now = new Date().toISOString();
        const records = raw
            .map((r) => ({
                emp_id: normaliseEmpId(r.emp_id),
                employee_name: String(r.name ?? "").trim() || "Unknown",
                kolkata_joining_date: toIsoDate(r.doj_kolkata),
                doj_aai: toIsoDate(r.doj_aai),
                transferred_out: r.transferred_out === true,
            }))
            .filter((r) => r.emp_id);

        // ── Kolkata joining date -> employee_training_records ────────────────
        const BATCH = 200;

        // employee_name is NOT NULL, so an upsert has to carry it or the insert
        // path fails — but this sync does not own that column, fetch-rating-data
        // does. Existing names are read first and written back unchanged, so a
        // row already in the table keeps the name it had, and only genuinely new
        // employees are named from the master.
        const existingNames = new Map<string, string>();
        const ids = records.map((r) => r.emp_id);
        for (let i = 0; i < ids.length; i += BATCH) {
            const { data, error } = await adminClient
                .from("employee_training_records")
                .select("emp_id, employee_name")
                .in("emp_id", ids.slice(i, i + BATCH));

            if (error) {
                return await fail(`Reading existing rows failed: ${error.message}`, 500, triggeredBy);
            }
            for (const row of data ?? []) {
                if (row.employee_name) existingNames.set(row.emp_id, row.employee_name);
            }
        }

        let upserted = 0;
        let created = 0;
        for (let i = 0; i < records.length; i += BATCH) {
            const batch = records.slice(i, i + BATCH).map((r) => {
                const known = existingNames.get(r.emp_id);
                if (!known) created += 1;
                return {
                    emp_id: r.emp_id,
                    employee_name: known ?? r.employee_name,
                    kolkata_joining_date: r.kolkata_joining_date,
                    transferred_out: r.transferred_out,
                    atco_master_synced_at: now,
                };
            });

            const { error } = await adminClient
                .from("employee_training_records")
                .upsert(batch, { onConflict: "emp_id" });

            if (error) {
                return await fail(
                    `Upsert failed at row ${i}: ${error.message}`,
                    500,
                    triggeredBy,
                );
            }
            upserted += batch.length;
        }

        // ── AAI joining date -> profiles ─────────────────────────────────────
        //
        // Only for employees who have an account, and only where the master
        // actually has a date — a blank must not wipe a value someone entered.
        let profilesUpdated = 0;
        for (const record of records) {
            if (!record.doj_aai) continue;
            const { data, error } = await adminClient
                .from("profiles")
                .update({ date_of_joining: record.doj_aai })
                .eq("employee_id", record.emp_id)
                .select("id");
            if (!error && data && data.length > 0) profilesUpdated += data.length;
        }

        const withKolkataDate = records.filter((r) => r.kolkata_joining_date).length;
        const transferredOut = records.filter((r) => r.transferred_out).length;
        const message =
            `Synced ${upserted} ATCO master rows, ${created} new ` +
            `(${withKolkataDate} with a Kolkata joining date, ${transferredOut} transferred out); ` +
            `${profilesUpdated} profiles given an AAI joining date.`;

        await logApiCall("success", message, triggeredBy, upserted);

        return new Response(
            JSON.stringify({
                success: true,
                total: records.length,
                upserted,
                created,
                with_kolkata_joining_date: withKolkataDate,
                transferred_out: transferredOut,
                profiles_updated: profilesUpdated,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("fetch-atco-master failed:", message);
        return await fail(message, 500);
    }
});
