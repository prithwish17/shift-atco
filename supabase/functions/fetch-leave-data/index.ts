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

        // Accept both {status: "success", data: [...]} and plain array
        const employees: any[] = Array.isArray(json)
            ? json
            : json.status === "success" && Array.isArray(json.data)
                ? json.data
                : null;

        if (!employees) {
            const errMsg = "Unexpected response format from Apps Script";
            await logApiCall("error", errMsg, Date.now() - startTime, triggeredBy);
            throw new Error(errMsg);
        }

        const batchId = `leave-sync-${Date.now()}`;

        // Parse helper: try to extract a YYYY-MM-DD date from an ISO string or date-like value
        function toDate(val: any): string | null {
            if (!val || typeof val !== "string" || val.trim() === "") return null;
            try {
                const d = new Date(val);
                if (isNaN(d.getTime())) return null;
                // Format to YYYY-MM-DD
                return d.toISOString().split("T")[0];
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
            leave_date: string;
            metadata: Record<string, any>;
            source: string;
            sync_batch_id: string;
        };

        const rows: LeaveRow[] = [];

        for (const emp of employees) {
            const empId = String(emp.empId || "").trim();
            const empName = String(emp.name || "").trim();
            if (!empId) continue;

            const slNo = emp.slNo ?? null;
            const empStatus = emp.status || null;

            // 1. Casual Leave — array of date strings
            if (Array.isArray(emp.casualLeave)) {
                for (const dateStr of emp.casualLeave) {
                    const d = toDate(dateStr);
                    if (!d) continue;
                    rows.push({
                        emp_id: empId,
                        employee_name: empName,
                        sl_no: slNo,
                        status: empStatus,
                        leave_category: "CL",
                        leave_date: d,
                        metadata: {},
                        source: "google_sheets",
                        sync_batch_id: batchId,
                    });
                }
            }

            // 2. Restricted Holidays — {date, leaveApplied}
            if (Array.isArray(emp.restrictedHolidays)) {
                for (const rh of emp.restrictedHolidays) {
                    const rhDate = toDate(rh.date);
                    if (!rhDate) continue;
                    const leaveApplied = toDate(rh.leaveApplied);
                    rows.push({
                        emp_id: empId,
                        employee_name: empName,
                        sl_no: slNo,
                        status: empStatus,
                        leave_category: "RH",
                        leave_date: rhDate,
                        metadata: {
                            rh_date: rhDate,
                            leave_applied: leaveApplied || rh.leaveApplied || "",
                        },
                        source: "google_sheets",
                        sync_batch_id: batchId,
                    });
                }
            }

            // 3. National Holidays — array of date strings
            if (Array.isArray(emp.nationalHolidays)) {
                for (const dateStr of emp.nationalHolidays) {
                    const d = toDate(dateStr);
                    if (!d) continue;
                    rows.push({
                        emp_id: empId,
                        employee_name: empName,
                        sl_no: slNo,
                        status: empStatus,
                        leave_category: "NH",
                        leave_date: d,
                        metadata: {},
                        source: "google_sheets",
                        sync_batch_id: batchId,
                    });
                }
            }

            // 4. Closed Holidays — {leaveApplied, dateOrDutyPerformed}
            if (Array.isArray(emp.closedHolidays)) {
                for (const ch of emp.closedHolidays) {
                    const leaveDate = toDate(ch.leaveApplied);
                    if (!leaveDate) continue; // Skip non-date entries
                    rows.push({
                        emp_id: empId,
                        employee_name: empName,
                        sl_no: slNo,
                        status: empStatus,
                        leave_category: "CH",
                        leave_date: leaveDate,
                        metadata: {
                            leave_applied: ch.leaveApplied || "",
                            duty_performed: ch.dateOrDutyPerformed || "",
                        },
                        source: "google_sheets",
                        sync_batch_id: batchId,
                    });
                }
            }

            // 5. Last Year Comp Off — {leaveApplied, dutyPerformed}
            if (Array.isArray(emp.lastYearCompOff)) {
                for (const co of emp.lastYearCompOff) {
                    const leaveDate = toDate(co.leaveApplied);
                    if (!leaveDate) continue; // Skip non-date entries
                    rows.push({
                        emp_id: empId,
                        employee_name: empName,
                        sl_no: slNo,
                        status: empStatus,
                        leave_category: "COMP_OFF",
                        leave_date: leaveDate,
                        metadata: {
                            leave_applied: co.leaveApplied || "",
                            duty_performed: co.dutyPerformed || "",
                        },
                        source: "google_sheets",
                        sync_batch_id: batchId,
                    });
                }
            }

            // 6. OPE Duty — {opeDutyDate, leaveApplied}
            if (Array.isArray(emp.opeDuty)) {
                for (const ope of emp.opeDuty) {
                    const opeDate = toDate(ope.opeDutyDate);
                    if (!opeDate) continue;
                    rows.push({
                        emp_id: empId,
                        employee_name: empName,
                        sl_no: slNo,
                        status: empStatus,
                        leave_category: "OPE",
                        leave_date: opeDate,
                        metadata: {
                            ope_duty_date: opeDate,
                            leave_applied: toDate(ope.leaveApplied) || ope.leaveApplied || "",
                        },
                        source: "google_sheets",
                        sync_batch_id: batchId,
                    });
                }
            }
        }

        console.log(`Parsed ${rows.length} leave records from ${employees.length} employees`);

        // Batch upsert into employee_leave_records
        let upserted = 0;
        if (rows.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);
                const { error: upsertError } = await adminClient
                    .from("employee_leave_records")
                    .upsert(batch, {
                        onConflict: "emp_id,leave_category,leave_date",
                    });

                if (upsertError) {
                    console.error("Upsert error:", upsertError);
                } else {
                    upserted += batch.length;
                }
            }
            console.log(`Upserted ${upserted} leave records`);
        }

        const durationMs = Date.now() - startTime;
        const successMsg = `Fetched ${employees.length} employees, ${rows.length} records, upserted ${upserted}`;
        await logApiCall("success", successMsg, durationMs, triggeredBy);

        return new Response(
            JSON.stringify({
                success: true,
                employees: employees.length,
                records: rows.length,
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
