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

    // Helper to log API calls persistently
    async function logApiCall(status: string, message: string, durationMs?: number, triggeredBy?: string) {
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
                });
        } catch (e) {
            console.error("Failed to insert api_call_logs:", e);
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

        // Read the webapp URL from app_settings
        let appsScriptUrl = "";
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

        if (!appsScriptUrl) {
            const errMsg = "leave_data_webapp_url not configured in app_settings";
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

        const batchId = `leave-sync-${Date.now()}`;

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
            source: string;
            sync_batch_id: string;
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
                source: "google_sheets",
                sync_batch_id: batchId,
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

            const slNo = employeeInfo?.slNo ?? null;
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

        const dedupedRowMap = new Map<string, LeaveRow>();
        for (const row of rows) {
            dedupedRowMap.set(getCanonicalCompOffKey(row) || getRowConflictKey(row), row);
        }
        const dedupedRows = Array.from(dedupedRowMap.values());
        const duplicateCount = rows.length - dedupedRows.length;

        if (duplicateCount > 0) {
            console.log(`Dropped ${duplicateCount} duplicate leave rows before upsert`);
        }

        // Batch upsert into employee_leave_records
        let upserted = 0;
        if (dedupedRows.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
                const batch = dedupedRows.slice(i, i + BATCH_SIZE);
                const { error: upsertError } = await adminClient
                    .from("employee_leave_records")
                    .upsert(batch, {
                        onConflict: "emp_id,leave_category,source_event_type,leave_date,duty_code",
                    });

                if (upsertError) {
                    console.error("Upsert error:", upsertError);
                    throw new Error(
                        `Upsert failed for batch ${Math.floor(i / BATCH_SIZE) + 1}: ${upsertError.message}`
                    );
                }
                upserted += batch.length;
            }

            // Remove sync-owned rows that were not refreshed in this batch.
            // This keeps the sync authoritative without deleting data before a successful import.
            const { error: staleCleanupError } = await adminClient
                .from("employee_leave_records")
                .delete()
                .eq("source", "google_sheets")
                .neq("sync_batch_id", batchId);

            if (staleCleanupError) {
                console.error("Stale cleanup error:", staleCleanupError);
                throw new Error(`Failed to prune stale synced rows: ${staleCleanupError.message}`);
            }

            console.log(`Upserted ${upserted} leave records`);
        }

        const durationMs = Date.now() - startTime;
        const successMsg = `Fetched ${employees.length} employees, ${rows.length} records, deduped ${dedupedRows.length}, upserted ${upserted}`;
        await logApiCall("success", successMsg, durationMs, triggeredBy);

        return new Response(
            JSON.stringify({
                success: true,
                employees: employees.length,
                records: rows.length,
                uniqueRecords: dedupedRows.length,
                droppedDuplicates: duplicateCount,
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
