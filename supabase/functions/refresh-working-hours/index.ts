import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


/**
 * refresh-working-hours
 *
 * Called by the cron queue (6x daily) or manually via Admin UI.
 * 1. Refreshes working_hours_cache for current month + previous month
 * 2. Optionally exports to Google Sheet if the webapp URL is configured
 * 3. Logs results to api_call_logs
 */
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const t0 = Date.now();
    const jobName =
        req.headers.get("x-cron-job-name") || "refresh-working-hours";

    try {
        // ── Determine months to refresh ──────────────────────────────────────
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

        const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const previousMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

        const months = [currentMonth, previousMonth];
        const results: Array<{
            month: string;
            rows_refreshed: number;
            computed_at: string;
        }> = [];

        // ── Refresh cache for each month ─────────────────────────────────────
        for (const month of months) {
            const { data, error } = await adminClient.rpc(
                "refresh_working_hours_cache",
                { p_month: month },
            );

            if (error) {
                console.error(
                    `[refresh-working-hours] Failed to refresh ${month}:`,
                    error.message,
                );
                // Continue with the next month instead of failing entirely
                results.push({
                    month,
                    rows_refreshed: 0,
                    computed_at: new Date().toISOString(),
                });
                continue;
            }

            const result = data as {
                month: string;
                rows_refreshed: number;
                computed_at: string;
            };
            results.push(result);
            console.log(
                `[refresh-working-hours] Refreshed ${month}: ${result.rows_refreshed} employees`,
            );
        }

        // ── Optional: Export to Google Sheet ──────────────────────────────────
        let sheetExported = false;
        try {
            const { data: settingData } = await adminClient
                .from("app_settings")
                .select("value")
                .eq("key", "working_hours_export_webapp_url")
                .maybeSingle();

            const exportUrl = (settingData as { value?: string } | null)?.value;

            if (exportUrl) {
                // Fetch the current month's cached data for the sheet export
                const { data: cacheData } = await adminClient
                    .from("working_hours_cache")
                    .select("*")
                    .eq("month", currentMonth)
                    .order("employee_name");

                if (cacheData && cacheData.length > 0) {
                    const totalHours = cacheData.reduce(
                        (s: number, r: { total_hours: number }) =>
                            s + (r.total_hours || 0),
                        0,
                    );
                    const violations = cacheData.filter(
                        (r: {
                            peak_7d_breached: boolean;
                            peak_30d_breached: boolean;
                            streak_violation: boolean;
                        }) =>
                            r.peak_7d_breached ||
                            r.peak_30d_breached ||
                            r.streak_violation,
                    ).length;

                    const payload = {
                        month: currentMonth,
                        exportedAt: new Date().toISOString(),
                        exportedBy: "cron_job",
                        summary: {
                            employeeCount: cacheData.length,
                            totalHours,
                            avgPerPerson:
                                cacheData.length > 0
                                    ? Math.round(
                                          (totalHours / cacheData.length) * 10,
                                      ) / 10
                                    : 0,
                            violations,
                        },
                        limits: {
                            singleDuty: 12,
                            minGap: 12,
                            sevenDay: 48,
                            thirtyDay: 190,
                            maxConsecutiveDays: 6,
                            minRestAfterConsecutive: 48,
                        },
                        employees: cacheData.map(
                            (row: {
                                employee_code: string;
                                employee_name: string;
                                current_shift: string;
                                total_hours: number;
                                days_worked: number;
                                avg_per_day: number;
                                peak_7d_hours: number;
                                peak_30d_hours: number;
                                peak_7d_breached: boolean;
                                peak_30d_breached: boolean;
                                max_streak: number;
                                streak_violation: boolean;
                                rest_violations: Array<{
                                    startDate: string;
                                    endDate: string;
                                    streakLength: number;
                                }>;
                                daily_schedule: Array<{
                                    date: string;
                                    duty_code: string;
                                    hours: number;
                                }>;
                            }) => ({
                                employeeCode: row.employee_code,
                                employeeName: row.employee_name,
                                shift: row.current_shift,
                                totalHours: row.total_hours,
                                daysWorked: row.days_worked,
                                avgHoursPerDay: row.avg_per_day,
                                peak7Day: row.peak_7d_hours,
                                peak30Day: row.peak_30d_hours,
                                peak7DayBreached: row.peak_7d_breached,
                                peak30DayBreached: row.peak_30d_breached,
                                maxConsecutiveStreak: row.max_streak,
                                consecutiveStreakViolation: row.streak_violation,
                                restViolations: row.rest_violations || [],
                                dailySchedule: (
                                    row.daily_schedule || []
                                ).map(
                                    (s: {
                                        date: string;
                                        duty_code: string;
                                        hours: number;
                                    }) => ({
                                        date: s.date,
                                        dutyCode: s.duty_code,
                                        hours: s.hours,
                                    }),
                                ),
                            }),
                        ),
                    };

                    // Fire-and-forget POST to Google Sheet (no-cors equivalent)
                    await fetch(exportUrl, {
                        method: "POST",
                        headers: { "Content-Type": "text/plain" },
                        body: JSON.stringify(payload),
                    }).catch((e: Error) =>
                        console.warn(
                            "[refresh-working-hours] Sheet export fetch failed:",
                            e.message,
                        ),
                    );

                    sheetExported = true;
                    console.log(
                        `[refresh-working-hours] Exported ${cacheData.length} rows to Google Sheet`,
                    );
                }
            }
        } catch (sheetErr) {
            // Sheet export is non-critical — log and continue
            console.warn(
                "[refresh-working-hours] Sheet export error (non-fatal):",
                (sheetErr as Error).message,
            );
        }

        // ── Log to api_call_logs ─────────────────────────────────────────────
        const elapsed = Date.now() - t0;
        const totalRows = results.reduce((s, r) => s + r.rows_refreshed, 0);

        const { error: logError } = await adminClient
            .from("api_call_logs")
            .insert({
                endpoint: "/functions/v1/refresh-working-hours",
                method: "POST",
                status: "success",
                message: `Refreshed ${totalRows} rows across ${months.length} months${sheetExported ? " + exported to Sheet" : ""}`,
                duration_ms: elapsed,
                triggered_by: jobName.includes("manual") ? "manual" : "cron_job",
                job_name: jobName,
                records_affected: totalRows,
            });
            
        if (logError) {
            console.error("[refresh-working-hours] Failed to log:", logError.message);
        }

        return new Response(
            JSON.stringify({
                ok: true,
                months: results,
                sheet_exported: sheetExported,
                elapsed_ms: elapsed,
            }),
            {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
        );
    } catch (err) {
        const elapsed = Date.now() - t0;
        const errorMsg = (err as Error).message || String(err);

        // Log the failure
        await adminClient
            .from("api_call_logs")
            .insert({
                endpoint: "/functions/v1/refresh-working-hours",
                method: "POST",
                status: "error",
                message: errorMsg,
                duration_ms: elapsed,
                triggered_by: "cron_job",
                job_name: jobName,
            });

        console.error("[refresh-working-hours] Fatal error:", errorMsg);

        return new Response(
            JSON.stringify({ ok: false, error: errorMsg, elapsed_ms: elapsed }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
        );
    }
});
