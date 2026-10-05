import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const requestBody = await req.clone().json().catch(() => ({}));
    const explicitJobName =
        req.headers.get("x-cron-job-name") ||
        (typeof requestBody?.__cron_job_name === "string" ? requestBody.__cron_job_name : "");

    // Derive the sync_jobs job_name from current IST hour (matches registered cron job names)
    function deriveLeaveJobName(): string {
        const nowUTC = new Date();
        const istHour = Math.floor((nowUTC.getUTCHours() * 60 + nowUTC.getUTCMinutes() + 330) / 60) % 24;
        return `leave-sync-${String(istHour).padStart(2, "0")}h`;
    }

    // Helper to log API calls and update sync_jobs status
    async function logApiCall(status: string, message: string, durationMs?: number, triggeredBy?: string, recordsAffected = 0) {
        const jobName = explicitJobName || deriveLeaveJobName();
        try {
            await adminClient
                .from("api_call_logs")
                .insert({
                    endpoint: "fetch-leave-data",
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

        // The workbook currently feeding the register. When the last one has been
        // closed and no successor registered, there is nothing to read — the
        // register keeps everything it has, so this is a quiet no-op, not an error.
        // See docs/leave/RUNBOOK.md.
        const { data: source, error: sourceError } = await adminClient
            .from("leave_sheet_sources")
            .select("source_key, leave_year, read_url")
            .eq("status", "active")
            .maybeSingle();

        if (sourceError) {
            const errMsg = `Could not read leave_sheet_sources: ${sourceError.message}`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (!source) {
            const msg = "Skipped: no active leave sheet source (the sheet has been closed). The register is unchanged.";
            await logApiCall("success", msg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ success: true, skipped: true, message: msg }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // The source's own read URL, else the app-wide setting.
        let appsScriptUrl = typeof source.read_url === "string" ? source.read_url.trim() : "";
        if (!appsScriptUrl) {
            try {
                const { data: setting } = await adminClient
                    .from("app_settings")
                    .select("value")
                    .eq("key", "leave_data_webapp_url")
                    .single();
                if (setting?.value) {
                    appsScriptUrl = setting.value;
                }
            } catch {
                // Table or key may not exist yet
            }
        }

        if (!appsScriptUrl) {
            const errMsg = `No read URL for ${source.source_key}: set leave_sheet_sources.read_url or app_settings.leave_data_webapp_url`;
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            return new Response(JSON.stringify({ error: errMsg }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Fetch from Google Apps Script
        console.log(`Fetching leave data from: ${appsScriptUrl}`);
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

        // Accept both legacy sheet payloads and the newer { employee, events } format.
        const employees: any[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
                ? json.data
                : json?.employee && Array.isArray(json?.events)
                    ? [json]
                    : null;

        if (!employees) {
            const errMsg = "Unexpected response format from Apps Script";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        function formatUtcDate(date: Date): string {
            const y = date.getUTCFullYear();
            const m = String(date.getUTCMonth() + 1).padStart(2, "0");
            const d = String(date.getUTCDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
        }

        // Parse helper: extract a YYYY-MM-DD date from ISO strings, dd-MMM-yyyy, dd-MM-yyyy,
        // and JS Date.toString() values.
        function toDate(val: any): string | null {
            if (!val || typeof val !== "string") return null;
            const trimmed = val.trim();
            if (!trimmed) return null;

            const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

            const dashMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
            if (dashMatch) return `${dashMatch[3]}-${dashMatch[2]}-${dashMatch[1]}`;

            const monthMap: Record<string, string> = {
                JAN: "01",
                FEB: "02",
                MAR: "03",
                APR: "04",
                MAY: "05",
                JUN: "06",
                JUL: "07",
                AUG: "08",
                SEP: "09",
                OCT: "10",
                NOV: "11",
                DEC: "12",
            };
            const mmmMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
            if (mmmMatch) {
                const month = monthMap[mmmMatch[2].toUpperCase()];
                if (!month) return null;
                return `${mmmMatch[3]}-${month}-${String(mmmMatch[1]).padStart(2, "0")}`;
            }

            const jsDateMatch = trimmed.match(/\b([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\b/);
            if (jsDateMatch) {
                const month = monthMap[jsDateMatch[1].toUpperCase()];
                if (month) {
                    return `${jsDateMatch[3]}-${month}-${String(jsDateMatch[2]).padStart(2, "0")}`;
                }
            }

            try {
                const d = new Date(trimmed);
                if (isNaN(d.getTime())) return null;
                return formatUtcDate(d);
            } catch {
                return null;
            }
        }

        const VALID_COMP_OFF_DUTY_SHIFTS = new Set([
            "M",
            "A",
            "N",
            "NO",
            "M+A",
            "NO+N",
            "G",
            "SAT+NO",
            "SUN+N",
            "SUN+M",
            "SUN+A",
            "SUN+NO",
            "SAT+N",
        ]);

        function normalizeShift(val: any): string {
            if (typeof val !== "string") return "";
            return val.trim().toUpperCase();
        }

        function addMonthsToDateString(dateStr: string, months: number): string | null {
            try {
                const [year, month, day] = dateStr.split("-").map(Number);
                const date = new Date(Date.UTC(year, month - 1, day));
                if (isNaN(date.getTime())) return null;
                date.setUTCMonth(date.getUTCMonth() + months);
                date.setUTCDate(date.getUTCDate() - 1);
                return formatUtcDate(date);
            } catch {
                return null;
            }
        }

        // Flatten all employees into rows
        type LeaveRow = {
            emp_id: string;
            employee_name: string;
            sl_no: number | null;
            status: string | null;
            leave_category: string;
            source_event_type: string;
            event_kind: string;
            leave_date: string;
            leave_used_on: string | null;
            duty_code: string;
            raw_date_value: string | null;
            raw_shift_value: string | null;
            raw_leave_used_value: string | null;
            raw_event: Record<string, any>;
            metadata: Record<string, any>;
        };

        function createLeaveRow(
            base: {
                empId: string;
                empName: string;
                slNo: number | null;
                empStatus: string | null;
            },
            overrides: {
                leaveCategory: string;
                sourceEventType: string;
                eventKind: string;
                leaveDate: string;
                leaveUsedOn?: string | null;
                dutyCode?: string;
                rawDateValue?: string | null;
                rawShiftValue?: string | null;
                rawLeaveUsedValue?: string | null;
                rawEvent?: Record<string, any>;
                metadata?: Record<string, any>;
            },
        ): LeaveRow {
            return {
                emp_id: base.empId,
                employee_name: base.empName,
                sl_no: base.slNo,
                status: base.empStatus,
                leave_category: overrides.leaveCategory,
                source_event_type: overrides.sourceEventType,
                event_kind: overrides.eventKind,
                leave_date: overrides.leaveDate,
                leave_used_on: overrides.leaveUsedOn ?? null,
                duty_code: overrides.dutyCode || "",
                raw_date_value: overrides.rawDateValue ?? null,
                raw_shift_value: overrides.rawShiftValue ?? null,
                raw_leave_used_value: overrides.rawLeaveUsedValue ?? null,
                raw_event: overrides.rawEvent || {},
                metadata: overrides.metadata || {},
            };
        }

        function getRowConflictKey(row: LeaveRow): string {
            return [
                row.emp_id,
                row.leave_category,
                row.source_event_type,
                row.leave_date,
                row.duty_code,
            ].join("|");
        }

        function getCanonicalCompOffKey(row: LeaveRow): string | null {
            if (!["comp_off_earned", "comp_off_unavailable", "comp_off_used"].includes(row.event_kind)) {
                return null;
            }

            const meta = row.metadata || {};
            const dutyDate =
                toDate(meta.duty_date) ||
                toDate(meta.ope_duty_date) ||
                toDate(meta.duty_performed) ||
                row.leave_date;
            const leaveUsedOn =
                row.leave_used_on ||
                toDate(meta.leave_used_on) ||
                toDate(meta.leave_applied) ||
                toDate(row.raw_leave_used_value) ||
                "";

            return [
                row.emp_id,
                row.event_kind,
                dutyDate,
                leaveUsedOn,
            ].join("|");
        }

        const rows: LeaveRow[] = [];

        function getTrimmedString(value: any): string | null {
            if (typeof value !== "string") return null;
            const trimmed = value.trim();
            return trimmed || null;
        }

        function parseLeaveUsedOn(rawEvent: Record<string, any>): {
            leaveUsedOn: string | null;
            rawLeaveUsedValue: string | null;
        } {
            const rawLeaveUsedValue = getTrimmedString(rawEvent.leaveUsedOn);
            return {
                leaveUsedOn: toDate(rawLeaveUsedValue),
                rawLeaveUsedValue,
            };
        }

        function getCompOffSourceLabel(type: string): string {
            switch (type) {
                case "FROM_LAST_YEAR":
                    return "From Last Year";
                case "OPE_DUTY":
                    return "OPE Duty";
                default:
                    return "Comp-Off Duty";
            }
        }

        function buildCompOffLedgerRows(
            base: {
                empId: string;
                empName: string;
                slNo: number | null;
                empStatus: string | null;
            },
            rawEvent: Record<string, any>,
            options: {
                sourceType: "COMP_OFF_DUTY" | "FROM_LAST_YEAR" | "OPE_DUTY";
                leaveCategory: "COMP_OFF_EARNED" | "LAST_YEAR_CH_DUTY" | "OPE";
                sourceEventType: string;
                dutyDate: string | null;
                dutyCode: string;
                eligible: boolean;
            },
        ): LeaveRow[] {
            if (!options.dutyDate) return [];

            const { leaveUsedOn, rawLeaveUsedValue } = parseLeaveUsedOn(rawEvent);
            const expiryDate = options.eligible ? addMonthsToDateString(options.dutyDate, 3) : null;

            return [createLeaveRow(base, {
                leaveCategory: options.leaveCategory,
                sourceEventType: options.sourceEventType,
                eventKind: options.eligible ? "comp_off_earned" : "comp_off_unavailable",
                leaveDate: options.dutyDate,
                leaveUsedOn,
                dutyCode: options.dutyCode,
                rawDateValue: getTrimmedString(rawEvent.date),
                rawShiftValue: getTrimmedString(rawEvent.shift),
                rawLeaveUsedValue,
                rawEvent,
                metadata: {
                    duty_date: options.dutyDate,
                    duty_performed: options.dutyCode || (options.sourceType === "OPE_DUTY" ? "OPE" : ""),
                    leave_used_on: leaveUsedOn,
                    leave_applied: leaveUsedOn || "",
                    comp_off_eligible: options.eligible,
                    expiry_date: expiryDate,
                    remark: options.eligible ? "" : "Comp Off Not Available",
                    source_type: options.sourceType,
                    source_label: getCompOffSourceLabel(options.sourceType),
                },
            })];
        }

        function parseEventRows(
            base: {
                empId: string;
                empName: string;
                slNo: number | null;
                empStatus: string | null;
            },
            rawEvent: Record<string, any>,
        ): LeaveRow[] {
            const type = String(rawEvent.type || "").trim().toUpperCase();
            if (!type) return [];

            const eventDate = toDate(rawEvent.date);
            const shift = normalizeShift(rawEvent.shift);

            switch (type) {
                case "CASUAL_LEAVE":
                    return eventDate
                        ? [createLeaveRow(base, {
                            leaveCategory: "CL",
                            sourceEventType: type,
                            eventKind: "leave",
                            leaveDate: eventDate,
                            rawDateValue: typeof rawEvent.date === "string" ? rawEvent.date : null,
                            rawShiftValue: typeof rawEvent.shift === "string" ? rawEvent.shift : null,
                            rawEvent,
                        })]
                        : [];

                case "COMP_OFF_DUTY":
                    return buildCompOffLedgerRows(base, rawEvent, {
                        sourceType: "COMP_OFF_DUTY",
                        leaveCategory: "COMP_OFF_EARNED",
                        sourceEventType: "COMP_OFF_DUTY",
                        dutyDate: eventDate,
                        dutyCode: shift,
                        eligible: VALID_COMP_OFF_DUTY_SHIFTS.has(shift),
                    });

                case "FROM_LAST_YEAR":
                    return buildCompOffLedgerRows(base, rawEvent, {
                        sourceType: "FROM_LAST_YEAR",
                        leaveCategory: "LAST_YEAR_CH_DUTY",
                        sourceEventType: "LAST_YEAR_CH_DUTY",
                        dutyDate: eventDate,
                        dutyCode: shift,
                        eligible: VALID_COMP_OFF_DUTY_SHIFTS.has(shift),
                    });

                case "LAST_YEAR_CH_DUTY":
                    return buildCompOffLedgerRows(base, rawEvent, {
                        sourceType: "FROM_LAST_YEAR",
                        leaveCategory: "LAST_YEAR_CH_DUTY",
                        sourceEventType: "LAST_YEAR_CH_DUTY",
                        dutyDate: eventDate,
                        dutyCode: shift,
                        eligible: VALID_COMP_OFF_DUTY_SHIFTS.has(shift),
                    });

                case "LAST_YEAR_COMP_OFF":
                case "OPE_COMP_OFF":
                    if (!eventDate) return [];
                    return [createLeaveRow(base, {
                        leaveCategory: type,
                        sourceEventType: type,
                        eventKind: "comp_off_used",
                        leaveDate: eventDate,
                        leaveUsedOn: eventDate,
                        rawDateValue: typeof rawEvent.date === "string" ? rawEvent.date : null,
                        rawShiftValue: typeof rawEvent.shift === "string" ? rawEvent.shift : null,
                        rawLeaveUsedValue: typeof rawEvent.date === "string" ? rawEvent.date : null,
                        rawEvent,
                        metadata: {
                            leave_applied: eventDate,
                            leave_used_on: eventDate,
                            source_type: type,
                        },
                    })];

                case "OPE_DUTY": {
                    const opeDutyDate = toDate(rawEvent.shift) || eventDate;
                    return buildCompOffLedgerRows(base, rawEvent, {
                        sourceType: "OPE_DUTY",
                        leaveCategory: "OPE",
                        sourceEventType: "OPE",
                        dutyDate: opeDutyDate,
                        dutyCode: "",
                        eligible: true,
                    });
                }

                default:
                    return [];
            }
        }

        for (const emp of employees) {
            const employeeInfo = (emp && typeof emp === "object" && emp.employee && typeof emp.employee === "object")
                ? emp.employee
                : emp;

            const empId = String(employeeInfo?.empId || employeeInfo?.employee_id || "").trim();
            const empName = String(employeeInfo?.name || employeeInfo?.employee_name || "").trim();
            if (!empId) continue;

            // sl_no is an integer column; a stray "12A" must not fail the whole run.
            const rawSlNo = Number.parseInt(String(employeeInfo?.slNo ?? ""), 10);
            const slNo = Number.isFinite(rawSlNo) ? rawSlNo : null;
            const empStatus = employeeInfo?.status || emp.status || null;
            const rowBase = { empId, empName, slNo, empStatus };

            if (Array.isArray(emp.events)) {
                for (const event of emp.events) {
                    if (!event || typeof event !== "object") continue;
                    rows.push(...parseEventRows(rowBase, event));
                }

                continue;
            }

            // 1. Casual Leave — array of date strings
            if (Array.isArray(emp.casualLeave)) {
                for (const dateStr of emp.casualLeave) {
                    const d = toDate(dateStr);
                    if (!d) continue;
                    rows.push(createLeaveRow(rowBase, {
                        leaveCategory: "CL",
                        sourceEventType: "CL",
                        eventKind: "leave",
                        leaveDate: d,
                        rawDateValue: typeof dateStr === "string" ? dateStr : null,
                    }));
                }
            }

            // 2. Restricted Holidays — {date, leaveApplied}
            if (Array.isArray(emp.restrictedHolidays)) {
                for (const rh of emp.restrictedHolidays) {
                    const rhDate = toDate(rh.date);
                    if (!rhDate) continue;
                    const leaveApplied = toDate(rh.leaveApplied);
                    rows.push(createLeaveRow(rowBase, {
                        leaveCategory: "RH",
                        sourceEventType: "RH",
                        eventKind: "leave",
                        leaveDate: rhDate,
                        rawDateValue: typeof rh.date === "string" ? rh.date : null,
                        rawEvent: rh,
                        metadata: {
                            rh_date: rhDate,
                            leave_applied: leaveApplied || rh.leaveApplied || "",
                        },
                    }));
                }
            }

            // 3. National Holidays — array of date strings
            if (Array.isArray(emp.nationalHolidays)) {
                for (const dateStr of emp.nationalHolidays) {
                    const d = toDate(dateStr);
                    if (!d) continue;
                    rows.push(createLeaveRow(rowBase, {
                        leaveCategory: "NH",
                        sourceEventType: "NH",
                        eventKind: "leave",
                        leaveDate: d,
                        rawDateValue: typeof dateStr === "string" ? dateStr : null,
                    }));
                }
            }

            // 4. Closed Holidays — {leaveApplied, dateOrDutyPerformed}
            if (Array.isArray(emp.closedHolidays)) {
                for (const ch of emp.closedHolidays) {
                    const leaveDate = toDate(ch.leaveApplied);
                    if (!leaveDate) continue; // Skip non-date entries
                    rows.push(createLeaveRow(rowBase, {
                        leaveCategory: "CH",
                        sourceEventType: "CH",
                        eventKind: "leave",
                        leaveDate,
                        rawDateValue: typeof ch.leaveApplied === "string" ? ch.leaveApplied : null,
                        rawEvent: ch,
                        metadata: {
                            leave_applied: ch.leaveApplied || "",
                            duty_performed: ch.dateOrDutyPerformed || "",
                        },
                    }));
                }
            }

            // 5. Last Year Comp Off — {leaveApplied, dutyPerformed}
            if (Array.isArray(emp.lastYearCompOff)) {
                for (const co of emp.lastYearCompOff) {
                    const leaveUsedOn = toDate(co.leaveApplied);
                    const rawDutyPerformed = typeof co.dutyPerformed === "string" ? co.dutyPerformed.trim() : "";
                    const derivedDutyDate = toDate(rawDutyPerformed);
                    const isDateBasedDuty = !!derivedDutyDate;
                    const leaveDate = derivedDutyDate || leaveUsedOn;
                    if (!leaveDate) continue; // Skip non-date entries
                    const dutyCode = isDateBasedDuty ? "" : normalizeShift(co.dutyPerformed);
                    const sourceType = isDateBasedDuty ? "OPE_DUTY" : "COMP_OFF_DUTY";
                    const sourceLabel = isDateBasedDuty ? "OPE Duty" : "Comp-Off Duty";
                    const expiryDate = addMonthsToDateString(leaveDate, 3);

                    rows.push(createLeaveRow(rowBase, {
                        leaveCategory: isDateBasedDuty ? "OPE" : "COMP_OFF",
                        sourceEventType: isDateBasedDuty ? "OPE" : "COMP_OFF",
                        eventKind: "comp_off_earned",
                        leaveDate,
                        leaveUsedOn,
                        dutyCode,
                        rawDateValue: typeof co.leaveApplied === "string" ? co.leaveApplied : null,
                        rawLeaveUsedValue: typeof co.leaveApplied === "string" ? co.leaveApplied : null,
                        rawEvent: co,
                        metadata: {
                            leave_applied: co.leaveApplied || "",
                            leave_used_on: leaveUsedOn,
                            duty_date: leaveDate,
                            duty_performed: isDateBasedDuty ? "OPE" : (co.dutyPerformed || ""),
                            comp_off_eligible: true,
                            expiry_date: expiryDate,
                            source_type: sourceType,
                            source_label: sourceLabel,
                        },
                    }));
                }
            }

            // 6. OPE Duty — {opeDutyDate, leaveApplied}
            if (Array.isArray(emp.opeDuty)) {
                for (const ope of emp.opeDuty) {
                    const opeDate = toDate(ope.opeDutyDate);
                    if (!opeDate) continue;
                    const leaveUsedOn = toDate(ope.leaveApplied);
                    rows.push(createLeaveRow(rowBase, {
                        leaveCategory: "OPE",
                        sourceEventType: "OPE",
                        eventKind: "comp_off_earned",
                        leaveDate: opeDate,
                        rawDateValue: typeof ope.opeDutyDate === "string" ? ope.opeDutyDate : null,
                        rawLeaveUsedValue: typeof ope.leaveApplied === "string" ? ope.leaveApplied : null,
                        rawEvent: ope,
                        metadata: {
                            ope_duty_date: opeDate,
                            duty_date: opeDate,
                            duty_performed: "OPE",
                            comp_off_eligible: true,
                            expiry_date: addMonthsToDateString(opeDate, 3),
                            leave_used_on: leaveUsedOn,
                            leave_applied: leaveUsedOn || ope.leaveApplied || "",
                            source_type: "OPE_DUTY",
                            source_label: "OPE Duty",
                        },
                    }));
                }
            }
        }

        console.log(`Parsed ${rows.length} leave records from ${employees.length} employees`);

        // Two-pass deduplication:
        // Pass 1: deduplicate by canonical comp-off key (merges semantically identical comp-off rows)
        const canonicalMap = new Map<string, LeaveRow>();
        for (const row of rows) {
            const canonKey = getCanonicalCompOffKey(row);
            if (canonKey) {
                canonicalMap.set(canonKey, row);
            } else {
                // Non-comp-off rows get a unique placeholder key so they pass through
                canonicalMap.set(`__row__${canonicalMap.size}`, row);
            }
        }
        const afterCanonical = Array.from(canonicalMap.values());

        // Pass 2: deduplicate by DB conflict key (emp_id, leave_category, source_event_type, leave_date, duty_code)
        // This is CRITICAL — the DB upsert uses this exact constraint, so any two rows with the same
        // conflict key in one batch will cause "ON CONFLICT DO UPDATE cannot affect row a second time".
        const dbConflictMap = new Map<string, LeaveRow>();
        for (const row of afterCanonical) {
            dbConflictMap.set(getRowConflictKey(row), row);
        }
        const dedupedRows = Array.from(dbConflictMap.values());
        const duplicateCount = rows.length - dedupedRows.length;

        if (duplicateCount > 0) {
            console.log(`Dropped ${duplicateCount} duplicate leave rows before upsert (canonical: ${rows.length - afterCanonical.length}, db-key: ${afterCanonical.length - dedupedRows.length})`);
        }

        // Stage the feed, then let commit_leave_sheet_sync() apply it in one
        // transaction. Nothing here writes the register or deletes anything:
        // what a sync may change on each row, and which rows the sheet no longer
        // carries may be retired (archived, behind circuit breakers), is decided
        // in SQL — see supabase/migrations/20261005100000_leave_sheet_sources_and_safe_sync.sql.
        const { data: run, error: runError } = await adminClient
            .from("leave_sheet_sync_runs")
            .insert({
                source_key: source.source_key,
                triggered_by: triggeredBy,
                employees_count: employees.length,
                rows_parsed: rows.length,
                stats: { duplicates_dropped: duplicateCount, read_url_from: source.read_url ? "source" : "app_settings" },
            })
            .select("id")
            .single();

        if (runError || !run) {
            throw new Error(`Could not open a sync run: ${runError?.message ?? "no row returned"}`);
        }

        const BATCH_SIZE = 500;
        for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
            const batch = dedupedRows.slice(i, i + BATCH_SIZE).map((row) => ({ run_id: run.id, ...row }));
            const { error: stageError } = await adminClient.from("leave_sheet_sync_staging").insert(batch);

            if (stageError) {
                await adminClient
                    .from("leave_sheet_sync_runs")
                    .update({ status: "failed", finished_at: new Date().toISOString(), error: `Staging failed: ${stageError.message}` })
                    .eq("id", run.id);
                throw new Error(
                    `Staging failed for batch ${Math.floor(i / BATCH_SIZE) + 1}: ${stageError.message} — the register is unchanged`,
                );
            }
        }

        const { data: commit, error: commitError } = await adminClient.rpc("commit_leave_sheet_sync", {
            p_run_id: run.id,
        });

        if (commitError) {
            throw new Error(`Commit failed: ${commitError.message} — the register is unchanged`);
        }

        const result = (commit ?? {}) as Record<string, any>;
        const durationMs = Date.now() - startTime;

        if (!result.ok) {
            // Rejected (closed source, wrong-year workbook) or an empty feed:
            // nothing was written. Logged as an error so cron health shows it.
            const errMsg = `Sync ${result.status ?? "failed"}: ${result.error ?? "unknown"}`;
            await logApiCall("error", errMsg, durationMs, triggeredBy);
            return new Response(JSON.stringify({ success: false, runId: run.id, ...result }), {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const changed = Number(result.inserted ?? 0) + Number(result.updated ?? 0);
        const retirement = result.retire_status === "blocked"
            ? ` ATTENTION: ${result.retire_candidates} row(s) missing from the sheet were NOT retired — ${result.blocked_reason} An admin must review this run.`
            : result.retired
                ? `, retired ${result.retired} to the archive`
                : "";
        const successMsg =
            `${source.source_key}: ${employees.length} employees, ${dedupedRows.length} rows staged, ` +
            `${result.inserted} inserted, ${result.updated} updated${retirement}`;
        await logApiCall("success", successMsg, durationMs, triggeredBy, changed);

        return new Response(
            JSON.stringify({
                ...result,
                success: true,
                runId: run.id,
                source: source.source_key,
                employees: employees.length,
                records: rows.length,
                uniqueRecords: dedupedRows.length,
                droppedDuplicates: duplicateCount,
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
