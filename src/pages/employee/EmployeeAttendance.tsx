import { useMemo, useState } from "react";
import { addMonths, endOfMonth, format, isToday, eachDayOfInterval, parseISO, startOfMonth, subMonths } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ClipboardList, Clock, TrendingUp } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useAttendanceRange, type Attendance } from "@/hooks/useAttendance";
import { DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";

type AttendanceEntry = Attendance & {
  attendanceCode: string;
};

const ATTENDANCE_DESCRIPTIONS: Record<string, string> = {
  ...DUTY_DESCRIPTIONS,
  OFF: "Off Duty",
  ABS: "Absent",
};

const attendanceCodeColor = (code: string, status: Attendance["status"]): string => {
  if (status === "absent") return "bg-red-100 text-red-700";
  if (status === "on_leave") return "bg-slate-100 text-slate-700";

  const normalized = code.toUpperCase();
  if (normalized === "M" || normalized === "M+A" || normalized === "CO+M" || normalized === "SUN+M") return "bg-yellow-100 text-yellow-700";
  if (normalized === "A" || normalized === "A+M" || normalized === "CO+A" || normalized === "SUN+A") return "bg-orange-100 text-orange-700";
  if (normalized === "N" || normalized === "CO+N" || normalized === "SUN+N" || normalized === "SAT+N") return "bg-blue-100 text-blue-700";
  if (normalized === "NO" || normalized === "SAT+NO" || normalized === "SUN+NO") return "bg-indigo-100 text-indigo-700";
  if (normalized === "CO") return "bg-teal-100 text-teal-700";
  if (normalized === "LEAVE" || normalized === "SL") return "bg-red-100 text-red-700";
  if (normalized === "CH" || normalized === "GO") return "bg-lime-100 text-lime-700";
  if (normalized === "NH") return "bg-green-100 text-green-700";
  if (normalized === "G") return "bg-neutral-100 text-neutral-700";
  if (normalized === "OFF") return "bg-slate-100 text-slate-700";
  if (normalized === "NA") return "bg-gray-100 text-gray-700";
  if (normalized.startsWith("SAT")) return "bg-cyan-100 text-cyan-700";
  if (normalized.startsWith("SUN")) return "bg-purple-100 text-purple-700";
  if (normalized === "T" || normalized === "TR") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
};

const statusBadgeClass = (status: Attendance["status"]) => {
  if (status === "present") return "bg-emerald-100 text-emerald-700";
  if (status === "absent") return "bg-red-100 text-red-700";
  if (status === "late") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
};

const statusLabel = (status: Attendance["status"]) => {
  if (status === "on_leave") return "Off";
  return status.replace("_", " ");
};

const dutyTime = (code: string): string | null => {
  const normalized = code.toUpperCase();
  const timings: Record<string, string> = {
    M: "07:00 AM - 01:00 PM IST",
    A: "01:00 PM - 07:00 PM IST",
    N: "07:00 PM - 07:00 AM IST",
    G: "08:30 AM - 06:00 PM IST",
    "M+A": "07:00 AM - 07:00 PM IST",
    "A+M": "07:00 AM - 07:00 PM IST",
    "NO+N": "07:00 PM - 07:00 AM IST",
    "CO+N": "07:00 PM - 07:00 AM IST",
    "CO+A": "01:00 PM - 07:00 PM IST",
    "CO+M": "07:00 AM - 01:00 PM IST",
    "SUN+N": "07:00 PM - 07:00 AM IST",
    "SUN+A": "01:00 PM - 07:00 PM IST",
    "SUN+M": "07:00 AM - 01:00 PM IST",
    "SAT+N": "07:00 PM - 07:00 AM IST",
  };

  return timings[normalized] || null;
};

const resolveAttendanceCode = (record: Attendance) => {
  const code = String(record.comments || "").trim().toUpperCase();
  if (code) return code;
  if (record.status === "on_leave") return "OFF";
  if (record.status === "absent") return "ABS";
  if (record.status === "late") return "LATE";
  return "P";
};

export default function EmployeeAttendance() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);

  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { attendance, isLoading: attendanceLoading } = useAttendanceRange(user?.id, monthStart, monthEnd);
  const isLoading = profileLoading || attendanceLoading;

  const attendanceEntries = useMemo<AttendanceEntry[]>(() => {
    return attendance.map((record) => ({
      ...record,
      attendanceCode: resolveAttendanceCode(record),
    }));
  }, [attendance]);

  const attendanceMap = useMemo(() => {
    const map = new Map<string, AttendanceEntry>();
    attendanceEntries.forEach((entry) => {
      map.set(entry.attendance_date, entry);
    });
    return map;
  }, [attendanceEntries]);

  const calendarDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfMonth(currentMonth),
        end: endOfMonth(currentMonth),
      }),
    [currentMonth]
  );

  const summaryStats = useMemo(() => {
    const counts: Record<string, number> = {};
    attendanceEntries.forEach((entry) => {
      counts[entry.attendanceCode] = (counts[entry.attendanceCode] || 0) + 1;
    });
    return Object.entries(counts).sort((left, right) => right[1] - left[1]);
  }, [attendanceEntries]);

  const maxStatValue = summaryStats.length > 0 ? Math.max(...summaryStats.map(([, count]) => count)) : 1;

  const latestAttendance = useMemo(() => {
    return [...attendanceEntries].sort((left, right) => right.attendance_date.localeCompare(left.attendance_date))[0] || null;
  }, [attendanceEntries]);

  const recentAttendance = useMemo(() => {
    return [...attendanceEntries]
      .sort((left, right) => right.attendance_date.localeCompare(left.attendance_date))
      .slice(0, 7);
  }, [attendanceEntries]);

  return (
    <DashboardLayout role="employee">
      <div className="mx-auto max-w-[1380px] space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
              My Attendance
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {profile?.full_name || "—"} · {profile?.employee_id || ""}
            </p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] xl:items-stretch">
          <div className="bg-gradient-to-r from-emerald-50/40 via-slate-50 to-sky-50/30 dark:from-emerald-950/30 dark:via-gray-900 dark:to-sky-950/20 rounded-lg px-3 py-2.5 sm:px-4 sm:py-3 shadow-sm border border-slate-200/60 dark:border-slate-700/60">
            {isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : latestAttendance ? (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Clock className="text-slate-600 dark:text-slate-400" size={16} />
                      <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 sm:text-sm">Latest Marked Duty</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                      <CalendarIcon size={14} className="shrink-0" />
                      <span className="font-medium">{format(parseISO(latestAttendance.attendance_date), "EEE, MMM d")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("shrink-0 text-xs font-bold px-2.5 py-1 rounded-md", attendanceCodeColor(latestAttendance.attendanceCode, latestAttendance.status))}>
                      {latestAttendance.attendanceCode}
                    </span>
                    <Badge className={cn("capitalize", statusBadgeClass(latestAttendance.status))}>
                      {statusLabel(latestAttendance.status)}
                    </Badge>
                  </div>
                </div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 sm:text-sm">
                  {ATTENDANCE_DESCRIPTIONS[latestAttendance.attendanceCode] || latestAttendance.attendanceCode}
                  {dutyTime(latestAttendance.attendanceCode) ? ` · ${dutyTime(latestAttendance.attendanceCode)}` : ""}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <ClipboardList className="text-slate-500" size={16} />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">My Attendance</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">— No attendance records in this month</span>
              </div>
            )}
          </div>

          <div className="hidden xl:block bg-gradient-to-br from-slate-50 to-emerald-50/30 dark:from-gray-900 dark:to-emerald-950/20 rounded-lg p-4 md:p-5 shadow-sm border border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="text-emerald-600 dark:text-emerald-400" size={18} />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base">
                {format(currentMonth, "MMMM")} Attendance Summary
              </h2>
            </div>

            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : summaryStats.length > 0 ? (
              <div className="space-y-2">
                {summaryStats.map(([code, count]) => (
                  <div key={code} className="flex items-center gap-3">
                    <span className="text-xs font-semibold w-14 text-slate-700 dark:text-slate-300">{code}</span>
                    <div className="flex-1 relative">
                      <div className="h-2 bg-gray-200/50 dark:bg-gray-700/50 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-300", attendanceCodeColor(code, "present"))}
                          style={{ width: `${(count / maxStatValue) * 100}%` }}
                        />
                      </div>
                      <span
                        className="absolute top-1/2 -translate-y-1/2 text-xs font-bold text-gray-700 dark:text-gray-300"
                        style={{ left: `${(count / maxStatValue) * 100}%`, marginLeft: "8px" }}
                      >
                        {count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">No attendance data for this month</p>
            )}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)] xl:items-start">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-slate-200/50 dark:border-slate-700/50 p-4 md:p-5">
            <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between sm:mb-6">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">Attendance Calendar</h2>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-700 shadow-sm transition-all hover:bg-emerald-100 hover:text-emerald-700 active:scale-95 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-300 sm:px-3 sm:py-1.5 sm:text-xs"
                >
                  <ChevronLeft size={14} />
                  <span className="hidden sm:inline">Prev</span>
                </button>
                <div className="min-w-[90px] text-center sm:min-w-[140px]">
                  <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 sm:text-base">
                    {format(currentMonth, "MMMM yyyy")}
                  </span>
                </div>
                <button
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-700 shadow-sm transition-all hover:bg-emerald-100 hover:text-emerald-700 active:scale-95 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-300 sm:px-3 sm:py-1.5 sm:text-xs"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setCurrentMonth(new Date())}
                  className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-95 dark:bg-emerald-500 dark:hover:bg-emerald-600 sm:px-3 sm:py-1.5 sm:text-xs"
                >
                  Today
                </button>
              </div>
            </div>

            {isLoading ? (
              <Skeleton className="w-full aspect-[7/5]" />
            ) : (
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <div key={day} className="text-center text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 pb-2">
                    {day}
                  </div>
                ))}

                {Array.from({ length: calendarDays[0]?.getDay() || 0 }).map((_, index) => (
                  <div key={`pad-${index}`} />
                ))}

                {calendarDays.map((day) => {
                  const dateKey = format(day, "yyyy-MM-dd");
                  const record = attendanceMap.get(dateKey);

                  return (
                    <div
                      key={dateKey}
                      className={cn(
                        "min-h-[60px] sm:min-h-[80px] md:min-h-[100px] p-1 sm:p-2 border rounded-lg transition-colors",
                        isToday(day)
                          ? "border-emerald-500 border-2 bg-emerald-50/30 dark:bg-emerald-950/20"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900",
                        "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      )}
                    >
                      <div className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {format(day, "d")}
                      </div>
                      {record ? (
                        <div className="space-y-1">
                          <div className={cn("text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded inline-block", attendanceCodeColor(record.attendanceCode, record.status))}>
                            {record.attendanceCode}
                          </div>
                          <div className="hidden sm:block text-[10px] text-slate-500 dark:text-slate-400 capitalize leading-tight">
                            {statusLabel(record.status)}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="xl:hidden bg-gradient-to-br from-slate-50 to-emerald-50/30 dark:from-gray-900 dark:to-emerald-950/20 rounded-lg p-4 md:p-5 shadow-sm border border-slate-200/50 dark:border-slate-700/50">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="text-emerald-600 dark:text-emerald-400" size={18} />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm sm:text-base">
                {format(currentMonth, "MMMM")} Attendance Summary
              </h2>
            </div>

            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : summaryStats.length > 0 ? (
              <div className="space-y-2">
                {summaryStats.map(([code, count]) => (
                  <div key={code} className="flex items-center gap-3">
                    <span className="text-xs font-semibold w-14 text-slate-700 dark:text-slate-300">{code}</span>
                    <div className="flex-1 relative">
                      <div className="h-2 bg-gray-200/50 dark:bg-gray-700/50 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-300", attendanceCodeColor(code, "present"))}
                          style={{ width: `${(count / maxStatValue) * 100}%` }}
                        />
                      </div>
                      <span
                        className="absolute top-1/2 -translate-y-1/2 text-xs font-bold text-gray-700 dark:text-gray-300"
                        style={{ left: `${(count / maxStatValue) * 100}%`, marginLeft: "8px" }}
                      >
                        {count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">No attendance data for this month</p>
            )}
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-slate-200/50 dark:border-slate-700/50 p-4 md:p-5 xl:sticky xl:top-6">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3 sm:text-lg sm:mb-4">Recent Attendance</h2>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : recentAttendance.length > 0 ? (
              <div className="space-y-3">
                {recentAttendance.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950 dark:text-white">{format(parseISO(entry.attendance_date), "dd MMM yyyy")}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {ATTENDANCE_DESCRIPTIONS[entry.attendanceCode] || entry.attendanceCode}
                        </p>
                        {dutyTime(entry.attendanceCode) ? (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{dutyTime(entry.attendanceCode)}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={cn("text-[10px] sm:text-xs font-semibold px-2 py-1 rounded-md", attendanceCodeColor(entry.attendanceCode, entry.status))}>
                          {entry.attendanceCode}
                        </span>
                        <Badge className={cn("capitalize", statusBadgeClass(entry.status))}>
                          {statusLabel(entry.status)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">No attendance records found for this month</p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}