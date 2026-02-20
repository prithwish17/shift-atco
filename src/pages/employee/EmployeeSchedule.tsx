import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isToday, isBefore, addMonths, subMonths, parseISO } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import {
  useMySchedule,
  DUTY_CODES,
  DUTY_DESCRIPTIONS,
} from "@/hooks/useEmployeeSchedules";
import type { EmployeeSchedule as ScheduleType } from "@/hooks/useEmployeeSchedules";
import { cn } from "@/lib/utils";

/* ── Figma-matched duty color map ── */
const dutyColor = (code: string): string => {
  if (!code) return "bg-gray-100 text-gray-600";
  const c = code.toUpperCase();
  if (c === "M" || c === "M+A" || c === "CO+M" || c === "SUN+M") return "bg-yellow-100 text-yellow-700";
  if (c === "A" || c === "A+M" || c === "CO+A" || c === "SUN+A") return "bg-orange-100 text-orange-700";
  if (c === "N" || c === "CO+N" || c === "SUN+N" || c === "SAT+N") return "bg-blue-100 text-blue-700";
  if (c === "NO" || c === "SAT+NO" || c === "SUN+NO") return "bg-indigo-100 text-indigo-700";
  if (c === "CO") return "bg-teal-100 text-teal-700";
  if (c === "LEAVE" || c === "SL") return "bg-red-100 text-red-700";
  if (c === "CH") return "bg-lime-100 text-lime-700";
  if (c === "NH") return "bg-green-100 text-green-700";
  if (c === "GO") return "bg-lime-100 text-lime-700";
  if (c === "G") return "bg-neutral-100 text-neutral-700";
  if (c === "NA") return "bg-gray-100 text-gray-700";
  if (c.startsWith("SAT")) return "bg-cyan-100 text-cyan-700";
  if (c.startsWith("SUN")) return "bg-purple-100 text-purple-700";
  if (c === "T" || c === "Tr") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
};

/* ── Bar chart color (slightly more saturated) ── */
const barColor = (code: string): string => {
  if (!code) return "bg-gray-300/60";
  const c = code.toUpperCase();
  if (c === "CO") return "bg-teal-300/60";
  if (c === "LEAVE" || c === "SL") return "bg-rose-300/60";
  if (c === "M") return "bg-amber-300/60";
  if (c === "A") return "bg-orange-300/60";
  if (c === "N") return "bg-blue-300/60";
  if (c === "NO") return "bg-indigo-300/60";
  if (c === "G" || c === "GO") return "bg-emerald-300/60";
  return "bg-slate-300/60";
};

const barTextColor = (code: string): string => {
  if (!code) return "text-gray-700";
  const c = code.toUpperCase();
  if (c === "CO") return "text-teal-700";
  if (c === "LEAVE" || c === "SL") return "text-rose-700";
  if (c === "M") return "text-amber-700";
  if (c === "A") return "text-orange-700";
  if (c === "N") return "text-blue-700";
  if (c === "NO") return "text-indigo-700";
  return "text-slate-700";
};

/* ── Shift time display (IST) ── */
const DUTY_TIMINGS_IST: Record<string, string> = {
  M: "07:00 AM - 01:00 PM",
  A: "01:00 PM - 07:00 PM",
  N: "07:00 PM - 07:00 AM",
  NO: "Night Off",
  CO: "Comp Off",
  "M+A": "07:00 AM - 07:00 PM",
  "NO+N": "07:00 PM - 07:00 AM",
  LEAVE: "Leave",
  SAT: "Saturday",
  SUN: "Sunday",
  G: "08:30 AM - 06:00 PM",
  T: "Tour",
  CH: "Closed Holiday",
  NH: "National Holiday",
  "SAT+NO": "Night Off",
  NA: "Not Available",
  "SUN+N": "07:00 PM - 07:00 AM",
  "SUN+M": "07:00 AM - 01:00 PM",
  "SUN+A": "01:00 PM - 07:00 PM",
  "SUN+NO": "Night Off",
  "SAT+N": "07:00 PM - 07:00 AM",
  "CO+N": "07:00 PM - 07:00 AM",
  SL: "Clear Off",
  TR: "Training",
  "CO+A": "01:00 PM - 07:00 PM",
  "CO+M": "07:00 AM - 01:00 PM",
  GO: "General Off",
  "A+M": "07:00 AM - 07:00 PM",
};

const shiftTime = (code: string): string | null => {
  const raw = code?.trim() || "";
  const value = DUTY_TIMINGS_IST[raw] || DUTY_TIMINGS_IST[raw.toUpperCase()];
  if (!value) return null;
  if (value.includes("AM") || value.includes("PM")) return `${value} IST`;
  return value;
};

export default function EmployeeSchedule() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);

  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { data: schedules = [], isLoading: schedulesLoading } = useMySchedule(
    profile?.employee_id,
    monthStart,
    monthEnd
  );

  const isLoading = profileLoading || schedulesLoading;

  const scheduleMap = useMemo(() => {
    const map = new Map<string, ScheduleType>();
    for (const s of schedules) map.set(s.duty_date, s);
    return map;
  }, [schedules]);

  const calendarDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfMonth(currentMonth),
        end: endOfMonth(currentMonth),
      }),
    [currentMonth]
  );

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const upcomingDuties = useMemo(() => {
    const weekEndStr = format(addDays(new Date(), 7), "yyyy-MM-dd");
    return schedules.filter((s) => s.duty_date >= todayStr && s.duty_date <= weekEndStr);
  }, [schedules, todayStr]);

  const nextDuty = schedules.find((s) => s.duty_date >= todayStr);

  /* ── Duty stats for monthly summary bar chart ── */
  const dutyStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of schedules) {
      counts[s.duty_code] = (counts[s.duty_code] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [schedules]);

  const maxStatValue = dutyStats.length > 0 ? Math.max(...dutyStats.map(([, v]) => v)) : 1;

  return (
    <DashboardLayout role="employee">
      <div className="space-y-6">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
              My Schedule
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {profile?.full_name || "—"} · {profile?.employee_id || ""}
            </p>
          </div>
        </div>

        {/* ── Top Row: Next Duty + Monthly Summary ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Next Duty Card — Figma gradient */}
          <div className="bg-gradient-to-br from-blue-50/40 via-slate-50 to-indigo-50/30 dark:from-blue-950/30 dark:via-gray-900 dark:to-indigo-950/20 rounded-lg p-5 shadow-sm border border-slate-200/60 dark:border-slate-700/60">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="text-slate-700 dark:text-slate-300" size={20} />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-base">Next Duty</h2>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : nextDuty ? (
              <div className="space-y-3">
                {/* Date row */}
                <div className="flex items-center gap-3 p-3 bg-white/80 dark:bg-gray-800/60 rounded-lg border border-slate-200/60 dark:border-slate-700/60 shadow-sm">
                  <CalendarIcon className="text-slate-600 dark:text-slate-400" size={24} />
                  <div>
                    <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                      {format(parseISO(nextDuty.duty_date), "EEEE")}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {format(parseISO(nextDuty.duty_date), "MMMM d, yyyy")}
                    </p>
                  </div>
                </div>

                {/* Duty status row */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gradient-to-r from-rose-50/60 to-red-50/50 dark:from-rose-950/30 dark:to-red-950/20 rounded-lg border border-rose-200/50 dark:border-rose-800/50 shadow-sm">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Duty Status</p>
                    <p className="text-lg font-bold text-rose-700 dark:text-rose-400">{nextDuty.duty_code}</p>
                  </div>
                  <span className="text-sm text-slate-600 dark:text-slate-400 break-words whitespace-normal leading-snug sm:text-right">
                    {shiftTime(nextDuty.duty_code) || nextDuty.duty_description || "—"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No upcoming duties</p>
            )}
          </div>

          {/* Monthly Summary — Figma horizontal bar chart */}
          <div className="bg-gradient-to-br from-slate-50 to-purple-50/30 dark:from-gray-900 dark:to-purple-950/20 rounded-lg p-5 shadow-sm border border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="text-purple-600 dark:text-purple-400" size={20} />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-base">
                {format(currentMonth, "MMMM")} Summary
              </h2>
            </div>

            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : dutyStats.length > 0 ? (
              <div className="space-y-3">
                {dutyStats.map(([code, count]) => (
                  <div key={code} className="flex items-center gap-3">
                    <span className={`text-xs font-semibold w-14 ${barTextColor(code)}`}>{code}</span>
                    <div className="flex-1 relative">
                      <div className="h-2 bg-gray-200/50 dark:bg-gray-700/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${barColor(code)} rounded-full transition-all duration-300`}
                          style={{ width: `${(count / maxStatValue) * 100}%` }}
                        />
                      </div>
                      <span
                        className="absolute top-1/2 -translate-y-1/2 text-xs font-bold text-gray-700 dark:text-gray-300"
                        style={{ left: `${(count / maxStatValue) * 100}%`, marginLeft: '8px' }}
                      >
                        {count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No data for this month</p>
            )}
          </div>
        </div>

        {/* ── Schedule Calendar ── */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-slate-200/50 dark:border-slate-700/50 p-4 md:p-6">
          {/* Calendar Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Schedule Calendar</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <ChevronLeft size={20} className="text-gray-600 dark:text-gray-400" />
              </button>
              <div className="min-w-[140px] text-center">
                <span className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {format(currentMonth, "MMMM yyyy")}
                </span>
              </div>
              <button
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <ChevronRight size={20} className="text-gray-600 dark:text-gray-400" />
              </button>
              <button
                onClick={() => setCurrentMonth(new Date())}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Today
              </button>
            </div>
          </div>

          {/* Calendar Grid */}
          {isLoading ? (
            <Skeleton className="w-full aspect-[7/5]" />
          ) : (
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {/* Day headers */}
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="text-center text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 pb-2">
                  {d}
                </div>
              ))}

              {/* Leading empty cells */}
              {Array.from({ length: calendarDays[0]?.getDay() || 0 }).map((_, i) => (
                <div key={`pad-${i}`} />
              ))}

              {/* Calendar cells */}
              {calendarDays.map((day) => {
                const dateKey = format(day, "yyyy-MM-dd");
                const schedule = scheduleMap.get(dateKey);
                const today = isToday(day);
                const past = isBefore(day, new Date()) && !today;

                return (
                  <div
                    key={dateKey}
                    className={cn(
                      "min-h-[60px] sm:min-h-[80px] md:min-h-[100px] p-1 sm:p-2 border rounded-lg transition-colors cursor-pointer",
                      today
                        ? "border-blue-500 border-2 bg-blue-50/30 dark:bg-blue-950/20"
                        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900",
                      past && "opacity-50",
                      "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    )}
                  >
                    <div className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {format(day, "d")}
                    </div>
                    {schedule ? (
                      <div className={`text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded ${dutyColor(schedule.duty_code)} inline-block`}>
                        {schedule.duty_code}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Duty Legend ── */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-slate-200/50 dark:border-slate-700/50 p-4 md:p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Duty Legend</h2>
          <div className="flex flex-wrap gap-2">
            {DUTY_CODES.map((code) => (
              <span
                key={code}
                className={`text-xs font-medium px-3 py-1.5 rounded-md ${dutyColor(code)}`}
              >
                {code} {DUTY_DESCRIPTIONS[code] || ""}
              </span>
            ))}
          </div>
        </div>

        {/* ── Upcoming 7 Days ── */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-slate-200/50 dark:border-slate-700/50 p-4 md:p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Upcoming 7 Days</h2>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : upcomingDuties.length > 0 ? (
            <div className="space-y-3">
              {upcomingDuties.map((duty) => (
                <div
                  key={duty.id}
                  className="flex items-start gap-3 sm:gap-4 p-4 bg-gradient-to-r from-slate-50 to-white dark:from-gray-800/50 dark:to-gray-900 rounded-lg border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow"
                >
                  {/* Date column */}
                  <div className="flex flex-col items-center min-w-[60px]">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {format(parseISO(duty.duty_date), "EEE")}
                    </span>
                    <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {format(parseISO(duty.duty_date), "d")}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {format(parseISO(duty.duty_date), "MMM")}
                    </span>
                  </div>

                  {/* Duty info */}
                  <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <span className={`text-xs font-semibold px-3 py-1.5 rounded-md w-fit ${dutyColor(duty.duty_code)}`}>
                      {duty.duty_code}
                    </span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 break-words whitespace-normal leading-snug">
                      {duty.duty_description || DUTY_DESCRIPTIONS[duty.duty_code] || ""}
                    </span>
                  </div>

                  {/* Time/Status */}
                  <div className="text-right min-w-[100px] sm:min-w-[140px]">
                    <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 break-words whitespace-normal leading-snug">
                      {shiftTime(duty.duty_code) || ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
              No duties in the next 7 days
            </p>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
