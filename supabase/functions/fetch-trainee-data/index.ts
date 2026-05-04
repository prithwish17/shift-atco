import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type TraineeApiRecord = {
    emp_id?: string;
    EMP_ID?: string;
    employee_id?: string;
    EMPLOYEE_ID?: string;
    name?: string;
    NAME?: string;
    designation?: string;
    DESIGNATION?: string;
    unit?: string;
    UNIT?: string;
    hours?: number | string | null;
    HOURS?: number | string | null;
    required_hours?: number | string | null;
    REQUIRED_HOURS?: number | string | null;
    training_hours?: number | string | null;
    TRAINING_HOURS?: number | string | null;
    // PRB (Pre-Board) and SAB (Selection Advisory Board) schedule dates
    "PRB SCHEDULE"?: string | null;
    PRB_SCHEDULE?: string | null;
    prb_schedule?: string | null;
    "SAB SCHEDULE"?: string | null;
    SAB_SCHEDULE?: string | null;
    sab_schedule?: string | null;
};

type Candidate = {
    emp_id: string;
    name: string;
    designation: string | null;
    source: "profile" | "training";
};

const DESIGNATION_SUFFIXES = ["SM", "DGM", "MGR", "JE", "AM", "AGM", "JGM", "GM"];
const trailingDesignationPattern = new RegExp(
    `\\s*-\\s*(?:${DESIGNATION_SUFFIXES.join("|")})\\s*$`,
    "i",
);

function normalizeText(value: unknown) {
    return String(value || "")
        .toUpperCase()
        .split("/")[0]
        .replace(/\([^)]*\)/g, " ")
        .replace(trailingDesignationPattern, " ")
        .replace(/[.,]+/g, " ")
        .replace(/[-]+$/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getStringField(record: TraineeApiRecord, keys: Array<keyof TraineeApiRecord>) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
}

function getHoursField(record: TraineeApiRecord) {
    const raw = record.hours ?? record.HOURS ?? record.required_hours ?? record.REQUIRED_HOURS ?? record.training_hours ?? record.TRAINING_HOURS;
    if (raw === null || raw === undefined || raw === "") return null;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return null;

    return Math.round(parsed);
}

/**
 * Month abbreviation → zero-padded number map for DD-Mon-YYYY parsing.
 */
const MONTH_ABBR: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Parse a date string in multiple formats to ISO "YYYY-MM-DD".
 * Handles:
 *   - "DD-MM-YYYY" / "DD/MM/YYYY"     e.g. "16-04-2026"
 *   - "DD-Mon-YYYY" / "DD/Mon/YYYY"   e.g. "23-Feb-2026", "12-Mar-2026"
 *   - "YYYY-MM-DD"                    standard ISO
 *   - Native JS-parseable strings as fallback
 */
function parseISODate(raw: string): string | null {
    const s = raw.trim();
    if (!s) return null;

    const sep = s.includes("/") ? "/" : "-";
    const parts = s.split(sep);

    if (parts.length === 3) {
        const [p1, p2, p3] = parts;
        let day: string, monthRaw: string, year: string;

        if (p3.length === 4) {
            // DD-MM-YYYY or DD-Mon-YYYY
            day = p1; monthRaw = p2; year = p3;
        } else if (p1.length === 4 && /^\d+$/.test(p1)) {
            // YYYY-MM-DD
            year = p1; monthRaw = p2; day = p3;
        } else {
            // Unknown order — fall through to native parse
            day = ""; monthRaw = ""; year = "";
        }

        if (year && monthRaw && day) {
            let monthNum: string;
            if (/^\d+$/.test(monthRaw)) {
                monthNum = monthRaw.padStart(2, "0");
            } else {
                monthNum = MONTH_ABBR[monthRaw.toLowerCase().slice(0, 3)] || "";
            }
            const dayNum = day.padStart(2, "0");
            const mon = Number(monthNum);
            const dy = Number(dayNum);
            if (monthNum && mon >= 1 && mon <= 12 && dy >= 1 && dy <= 31) {
                return `${year}-${monthNum}-${dayNum}`;
            }
        }
    }

    // Fallback to native Date (e.g. "23-Feb-2026" which V8 parses natively)
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getUTCFullYear();
        const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
        const d = String(parsed.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    return null;
}

function getDateField(record: TraineeApiRecord, keys: string[]): string | null {
    for (const key of keys) {
        const value = (record as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim()) {
            const result = parseISODate(value);
            if (result) return result;
        }
    }
    return null;
}

function getResolvedCandidate(candidates: Candidate[], designation: string) {
    if (candidates.length === 0) return null;

    const designationKey = normalizeText(designation);
    const uniqueByEmpId = Array.from(new Map(candidates.map((candidate) => [candidate.emp_id, candidate])).values());

    if (designationKey) {
        const exactMatches = uniqueByEmpId.filter((candidate) => normalizeText(candidate.designation) === designationKey);
        if (exactMatches.length === 1) return exactMatches[0];
        const exactProfileMatches = exactMatches.filter((candidate) => candidate.source === "profile");
        if (exactProfileMatches.length === 1) return exactProfileMatches[0];
    }

    if (uniqueByEmpId.length === 1) return uniqueByEmpId[0];

    const profileMatches = uniqueByEmpId.filter((candidate) => candidate.source === "profile");
    if (profileMatches.length === 1) return profileMatches[0];

    return null;
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
                    endpoint: "fetch-trainee-data",
                    method: "POST",
                    status,
                    message,
                    duration_ms: durationMs || null,
                    triggered_by: triggeredBy || "unknown",
                });
        } catch (error) {
            console.error("Failed to insert api_call_logs:", error);
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

        let traineeUrl = "";
        try {
            const { data: setting } = await adminClient
                .from("app_settings")
                .select("value")
                .eq("key", "trainee_data_webapp_url")
                .maybeSingle();
            if (setting?.value) {
                traineeUrl = setting.value;
            }
        } catch {
            // no fallback
        }

        if (!traineeUrl) {
            const errMsg = "Trainee webapp URL not configured in System Settings";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const response = await fetch(traineeUrl, {
            method: "GET",
            redirect: "follow",
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            const errMsg = `Trainee webapp returned ${response.status}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const json = await response.json();
        const rawRecords: TraineeApiRecord[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
                ? json.data
                : [];

        if (!Array.isArray(rawRecords)) {
            const errMsg = "Unexpected response format from trainee webapp";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const [{ data: profiles }, { data: trainingRows }, { data: existingTrainees }] = await Promise.all([
            adminClient.from("profiles").select("employee_id, full_name, designation").not("employee_id", "is", null),
            adminClient.from("employee_training_records").select("emp_id, employee_name, rating_designation"),
            adminClient
                .from("employee_training_records")
                .select("emp_id")
                .or("trainee_unit.not.is.null,trainee_hours_required.not.is.null"),
        ]);

        const candidatesByName = new Map<string, Candidate[]>();
        const pushCandidate = (candidate: Candidate) => {
            const key = normalizeText(candidate.name);
            if (!key) return;
            const existing = candidatesByName.get(key) || [];
            existing.push(candidate);
            candidatesByName.set(key, existing);
        };

        for (const profile of (profiles || []) as Array<{ employee_id: string | null; full_name: string | null; designation: string | null }>) {
            if (!profile.employee_id || !profile.full_name) continue;
            pushCandidate({
                emp_id: profile.employee_id,
                name: profile.full_name,
                designation: profile.designation,
                source: "profile",
            });
        }

        for (const row of (trainingRows || []) as Array<{ emp_id: string | null; employee_name: string | null; rating_designation: string | null }>) {
            if (!row.emp_id || !row.employee_name) continue;
            pushCandidate({
                emp_id: row.emp_id,
                name: row.employee_name,
                designation: row.rating_designation,
                source: "training",
            });
        }

        const batchId = `trainee-sync-${Date.now()}`;
        const now = new Date().toISOString();
        const unmatchedNames: string[] = [];
        const matchedMap = new Map<string, {
            emp_id: string;
            employee_name: string;
            trainee_designation: string | null;
            trainee_unit: string | null;
            trainee_hours_required: number | null;
            trainee_synced_at: string;
            sync_batch_id: string;
        }>();
        // Separate map to hold schedule-derived data (not stored directly on matchedMap rows)
        const matchedSchedules = new Map<string, {
            preboard_scheduled_on: string | null;
            board_scheduled_on: string | null;
            inferred_status: string | null;
        }>();

        for (const record of rawRecords) {
            const explicitEmpId = getStringField(record, ["emp_id", "EMP_ID", "employee_id", "EMPLOYEE_ID"]);
            const rawName = getStringField(record, ["name", "NAME"]);
            const rawDesignation = getStringField(record, ["designation", "DESIGNATION"]);
            const rawUnit = getStringField(record, ["unit", "UNIT"]);
            const hoursRequired = getHoursField(record);

            // PRB = Pre-Board review; SAB = Selection Advisory Board ("Board" in-app)
            const prbSchedule = getDateField(record, ["PRB SCHEDULE", "PRB_SCHEDULE", "prb_schedule"]);
            const sabSchedule = getDateField(record, ["SAB SCHEDULE", "SAB_SCHEDULE", "sab_schedule"]);

            let empId = explicitEmpId;
            let employeeName = rawName;

            if (!empId) {
                const candidates = candidatesByName.get(normalizeText(rawName)) || [];
                const resolved = getResolvedCandidate(candidates, rawDesignation);
                if (!resolved) {
                    if (rawName) unmatchedNames.push(rawName);
                    continue;
                }
                empId = resolved.emp_id;
                employeeName = resolved.name || rawName;
            }

            if (!empId) continue;

            matchedMap.set(empId, {
                emp_id: empId,
                employee_name: employeeName || rawName || "Unknown",
                trainee_designation: rawDesignation || null,
                trainee_unit: rawUnit || null,
                trainee_hours_required: hoursRequired,
                trainee_synced_at: now,
                sync_batch_id: batchId,
            });

            // Infer status from schedule dates.
            // SAB (board) always takes top priority.
            // For PRB: if the scheduled date has already passed, auto-advance to preboard_complete.
            //          If it is in the future, set preboard_date_fixed.
            const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" UTC
            let inferredStatus: string | null = null;
            if (sabSchedule) {
                inferredStatus = "board_date_fixed";
            } else if (prbSchedule) {
                inferredStatus = prbSchedule < todayStr ? "preboard_complete" : "preboard_date_fixed";
            }

            matchedSchedules.set(empId, {
                preboard_scheduled_on: prbSchedule,
                board_scheduled_on: sabSchedule,
                inferred_status: inferredStatus,
            });
        }

        // Fetch existing raw_payload for all matched emp_ids so we can safely merge schedule data
        // without overwriting supervisor-set status values.
        const matchedEmpIds = Array.from(matchedMap.keys());
        const existingPayloadMap = new Map<string, Record<string, unknown>>();

        if (matchedEmpIds.length > 0) {
            const batchFetchSize = 500;
            for (let i = 0; i < matchedEmpIds.length; i += batchFetchSize) {
                const idBatch = matchedEmpIds.slice(i, i + batchFetchSize);
                const { data: payloadRows } = await adminClient
                    .from("employee_training_records")
                    .select("emp_id, raw_payload")
                    .in("emp_id", idBatch);

                for (const row of (payloadRows || []) as Array<{ emp_id: string; raw_payload: unknown }>) {
                    if (row.emp_id) {
                        existingPayloadMap.set(
                            row.emp_id,
                            row.raw_payload && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
                                ? { ...(row.raw_payload as Record<string, unknown>) }
                                : {},
                        );
                    }
                }
            }
        }

        // Build final records with merged raw_payload
        const records = Array.from(matchedMap.values()).map((matched) => {
            const schedule = matchedSchedules.get(matched.emp_id) ?? {
                preboard_scheduled_on: null,
                board_scheduled_on: null,
                inferred_status: null,
            };
            const existingPayload = existingPayloadMap.get(matched.emp_id) ?? {};
            const existingStatus = existingPayload.trainee_status as string | null | undefined;

            const mergedPayload: Record<string, unknown> = { ...existingPayload };

            // Allow sync to update status if:
            //   1. Status is unset / generic (null, empty, status_pending, training_continue)
            //   2. Forward progression: preboard_date_fixed → preboard_complete (PRB passed)
            //   3. Forward progression: preboard_* → board_date_fixed (SAB date now present)
            const isForwardProgression =
                (schedule.inferred_status === "preboard_complete" && existingStatus === "preboard_date_fixed") ||
                (schedule.inferred_status === "board_date_fixed" &&
                    (existingStatus === "preboard_date_fixed" || existingStatus === "preboard_complete"));

            const statusIsUpdatable = !existingStatus ||
                existingStatus === "" ||
                existingStatus === "status_pending" ||
                existingStatus === "training_continue" ||
                isForwardProgression;

            const finalStatus = (schedule.inferred_status && statusIsUpdatable)
                ? schedule.inferred_status
                : (existingStatus ?? null);

            // Update raw_payload with schedule dates and resolved status
            if (schedule.preboard_scheduled_on !== null) {
                mergedPayload.trainee_preboard_scheduled_on = schedule.preboard_scheduled_on;
            }
            if (schedule.board_scheduled_on !== null) {
                mergedPayload.trainee_board_scheduled_on = schedule.board_scheduled_on;
            }
            if (finalStatus) {
                mergedPayload.trainee_status = finalStatus;
            }

            return {
                ...matched,
                raw_payload: mergedPayload,
            };
        });

        let upserted = 0;
        if (records.length > 0) {
            const batchSize = 500;
            for (let i = 0; i < records.length; i += batchSize) {
                const batch = records.slice(i, i + batchSize);
                const { error: upsertError } = await adminClient
                    .from("employee_training_records")
                    .upsert(batch, { onConflict: "emp_id" });

                if (upsertError) {
                    console.error("Trainee data upsert error:", upsertError);
                    throw upsertError;
                }

                upserted += batch.length;
            }
        }

        const currentEmpIds = new Set(records.map((record) => record.emp_id));
        const staleEmpIds = ((existingTrainees || []) as Array<{ emp_id: string | null }>)
            .map((record) => record.emp_id)
            .filter((empId): empId is string => Boolean(empId) && !currentEmpIds.has(empId));

        if (staleEmpIds.length > 0) {
            const batchSize = 500;
            for (let i = 0; i < staleEmpIds.length; i += batchSize) {
                const batch = staleEmpIds.slice(i, i + batchSize);
                const { error: clearError } = await adminClient
                    .from("employee_training_records")
                    .update({
                        trainee_designation: null,
                        trainee_unit: null,
                        trainee_hours_required: null,
                        trainee_synced_at: now,
                    })
                    .in("emp_id", batch);

                if (clearError) {
                    console.error("Trainee data clear error:", clearError);
                    throw clearError;
                }
            }
        }

        const durationMs = Date.now() - startTime;
        const successMsg = `Fetched ${rawRecords.length} trainee rows, matched ${records.length}, unmatched ${unmatchedNames.length}`;
        await logApiCall("success", successMsg, durationMs, triggeredBy);

        return new Response(JSON.stringify({
            success: true,
            records: rawRecords.length,
            upserted,
            unmatched: unmatchedNames.length,
            unmatched_names: unmatchedNames.slice(0, 20),
            cleared: staleEmpIds.length,
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        const durationMs = Date.now() - startTime;
        console.error("Error:", error);
        await logApiCall("error", error.message || "Internal server error", durationMs, "unknown");
        return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});