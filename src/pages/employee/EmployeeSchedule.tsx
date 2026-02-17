import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Calendar as CalendarIcon, Clock, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isToday, isBefore, addMonths, subMonths, parseISO } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import {
  useMySchedule,
  useFetchSchedule,
  useUpdateSchedule,
  DUTY_CODES,
  DUTY_DESCRIPTIONS,
} from "@/hooks/useEmployeeSchedules";
import type { EmployeeSchedule as ScheduleType } from "@/hooks/useEmployeeSchedules";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/* ── Duty-code → color token map ── */
const dutyColor = (code: string): string => {
  if (!code) return "bg-muted/50 text-muted-foreground";
  const c = code.toUpperCase();
  if (c === "M" || c.endsWith("+M") || c.startsWith("M+"))
    return "bg-amber-200 text-amber-950 dark:bg-amber-700/60 dark:text-amber-100 ring-1 ring-amber-400 dark:ring-amber-500";
  if (c === "A" || c.endsWith("+A") || c.startsWith("A+"))
    return "bg-orange-200 text-orange-950 dark:bg-orange-700/60 dark:text-orange-100 ring-1 ring-orange-400 dark:ring-orange-500";
  if (c === "N" || c.endsWith("+N") || c.startsWith("N+"))
    return "bg-indigo-200 text-indigo-950 dark:bg-indigo-700/60 dark:text-indigo-100 ring-1 ring-indigo-400 dark:ring-indigo-500";
  if (c === "NO" || c.endsWith("+NO") || c.startsWith("NO+"))
    return "bg-sky-200 text-sky-950 dark:bg-sky-700/60 dark:text-sky-100 ring-1 ring-sky-400 dark:ring-sky-500";
  if (c === "CO" || c.endsWith("+CO") || c.startsWith("CO+"))
    return "bg-teal-200 text-teal-950 dark:bg-teal-700/60 dark:text-teal-100 ring-1 ring-teal-400 dark:ring-teal-500";
  if (c === "LEAVE" || c === "SL")
    return "bg-red-200 text-red-950 dark:bg-red-700/60 dark:text-red-100 ring-1 ring-red-400 dark:ring-red-500";
  if (c.startsWith("SAT"))
    return "bg-violet-200 text-violet-950 dark:bg-violet-700/60 dark:text-violet-100 ring-1 ring-violet-400 dark:ring-violet-500";
  if (c.startsWith("SUN"))
    return "bg-pink-200 text-pink-950 dark:bg-pink-700/60 dark:text-pink-100 ring-1 ring-pink-400 dark:ring-pink-500";
  if (c === "G" || c === "GO")
    return "bg-emerald-200 text-emerald-950 dark:bg-emerald-700/60 dark:text-emerald-100 ring-1 ring-emerald-400 dark:ring-emerald-500";
  if (c === "T" || c === "Tr")
    return "bg-cyan-200 text-cyan-950 dark:bg-cyan-700/60 dark:text-cyan-100 ring-1 ring-cyan-400 dark:ring-cyan-500";
  if (c === "CH" || c === "NH")
    return "bg-lime-200 text-lime-950 dark:bg-lime-700/60 dark:text-lime-100 ring-1 ring-lime-400 dark:ring-lime-500";
  if (c === "NA")
    return "bg-gray-200 text-gray-700 dark:bg-gray-600/50 dark:text-gray-200 ring-1 ring-gray-400 dark:ring-gray-500";
  return "bg-slate-200 text-slate-900 dark:bg-slate-600/50 dark:text-slate-100 ring-1 ring-slate-400 dark:ring-slate-500";
};

/* ── Shift time display ── */
const shiftTime = (code: string): string | null => {
  const map: Record<string, string> = {
    M: "06:00 – 14:00",
    A: "14:00 – 22:00",
    N: "22:00 – 06:00",
    CO: "Comp Off",
    NO: "Night Off",
    LEAVE: "On Leave",
    SL: "Sick Leave",
    G: "General Duty",
    T: "Training",
    GO: "Gazette Off",
  };
  return map[code.toUpperCase()] || null;
};

export default function EmployeeSchedule() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { user, userRole } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const canEdit = userRole === "admin" || userRole === "supervisor";

  const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { data: schedules = [], isLoading: schedulesLoading } = useMySchedule(
    profile?.employee_id,
    monthStart,
    monthEnd
  );
  const fetchSchedule = useFetchSchedule();
  const updateSchedule = useUpdateSchedule();

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

  const handleCodeChange = (id: string, newCode: string) => {
    updateSchedule.mutate(
      { id, duty_code: newCode, duty_description: DUTY_DESCRIPTIONS[newCode] || newCode },
      {
        onSuccess: () => toast.success("Duty updated"),
        onError: (err: any) => toast.error(err.message || "Update failed"),
      }
    );
  };

  /* ── Duty stats for current month ── */
  const dutyStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of schedules) {
      counts[s.duty_code] = (counts[s.duty_code] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [schedules]);

  return (
    <DashboardLayout role="employee">
      <div className="space-y-[var(--space-5)]">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-[var(--space-3)]">
          <div>
            <h1 className="font-bold tracking-tight" style={{ fontSize: "var(--text-2xl)" }}>
              My Schedule
            </h1>
            <p className="text-muted-foreground" style={{ fontSize: "var(--text-sm)" }}>
              {profile?.full_name || "—"} · {profile?.employee_id || ""}
            </p>
          </div>
          <div className="flex gap-[var(--space-2)]">
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  fetchSchedule.mutate(undefined, {
                    onSuccess: (data: any) =>
                      toast.success(`Fetched ${data.rows} entries for ${data.employees} employees`),
                    onError: (err: any) => toast.error(err.message || "Fetch failed"),
                  })
                }
                disabled={fetchSchedule.isPending}
              >
                <RefreshCw className={cn("h-4 w-4 mr-1.5", fetchSchedule.isPending && "animate-spin")} />
                Fetch Latest
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => toast.info("Export coming soon")}>
              <Download className="h-4 w-4 mr-1.5" />
              Export
            </Button>
          </div>
        </div>

        {/* ── Top row: Next Duty + Monthly Stats ── */}
        <div className="grid gap-[var(--space-4)] md:grid-cols-2">
          {/* Next Duty */}
          <Card className="overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-primary/80 via-primary/40 to-transparent" />
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2" style={{ fontSize: "var(--text-lg)" }}>
                <Clock className="h-4 w-4 text-primary" />
                Next Duty
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              ) : nextDuty ? (
                <div className="space-y-[var(--space-3)]">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground" style={{ fontSize: "var(--text-sm)" }}>
                      Date
                    </span>
                    <span className="font-medium" style={{ fontSize: "var(--text-base)" }}>
                      {format(parseISO(nextDuty.duty_date), "EEEE, MMM d")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground" style={{ fontSize: "var(--text-sm)" }}>
                      Duty
                    </span>
                    <Badge className={cn("font-mono", dutyColor(nextDuty.duty_code))}>
                      {nextDuty.duty_code}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground" style={{ fontSize: "var(--text-sm)" }}>
                      {shiftTime(nextDuty.duty_code) || nextDuty.duty_description || "—"}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4" style={{ fontSize: "var(--text-sm)" }}>
                  No upcoming duties
                </p>
              )}
            </CardContent>
          </Card>

          {/* Monthly Stats */}
          <Card className="overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-accent/60 via-accent/30 to-transparent" />
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2" style={{ fontSize: "var(--text-lg)" }}>
                <CalendarIcon className="h-4 w-4 text-accent" />
                {format(currentMonth, "MMMM")} Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : dutyStats.length > 0 ? (
                <div className="flex flex-wrap gap-[var(--space-2)]">
                  {dutyStats.map(([code, count]) => (
                    <div
                      key={code}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2.5 py-1",
                        dutyColor(code)
                      )}
                    >
                      <span className="font-semibold" style={{ fontSize: "var(--text-xs)" }}>
                        {code}
                      </span>
                      <span
                        className="font-mono opacity-70"
                        style={{ fontSize: "var(--text-xs)" }}
                      >
                        ×{count}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4" style={{ fontSize: "var(--text-sm)" }}>
                  No data for this month
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Calendar Grid ── */}
        <Card className="overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-primary/50 via-primary/20 to-transparent" />
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <CardTitle style={{ fontSize: "var(--text-xl)" }}>
                {format(currentMonth, "MMMM yyyy")}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3"
                  style={{ fontSize: "var(--text-sm)" }}
                  onClick={() => setCurrentMonth(new Date())}
                >
                  Today
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent style={{ padding: "var(--space-4)" }}>
            {isLoading ? (
              <Skeleton className="w-full" style={{ aspectRatio: "7/5" }} />
            ) : (
              <div
                className="grid grid-cols-7"
                style={{ gap: "var(--cal-cell-gap)" }}
              >
                {/* Weekday headers */}
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div
                    key={d}
                    className="text-center font-medium text-muted-foreground select-none"
                    style={{
                      fontSize: "var(--text-xs)",
                      padding: "var(--space-2) 0",
                    }}
                  >
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
                        "relative flex flex-col items-center justify-start rounded-[var(--cal-cell-radius)] border border-border/50 transition-all duration-150",
                        today && "ring-2 ring-primary/70 bg-primary/5 border-primary/30",
                        past && "opacity-50",
                        !schedule && !today && "bg-muted/20",
                        schedule && "hover:shadow-sm"
                      )}
                      style={{
                        aspectRatio: "1 / 1",
                        padding: "var(--cal-cell-pad)",
                      }}
                    >
                      {/* Date number */}
                      <span
                        className={cn(
                          "font-medium leading-none",
                          today ? "text-primary font-bold" : "text-foreground/80"
                        )}
                        style={{ fontSize: "var(--text-sm)" }}
                      >
                        {format(day, "d")}
                      </span>

                      {/* Duty pill */}
                      {schedule ? (
                        canEdit ? (
                          <Select
                            value={schedule.duty_code}
                            onValueChange={(val) => handleCodeChange(schedule.id, val)}
                          >
                            <SelectTrigger
                              className={cn(
                                "mt-auto h-auto border-0 px-1.5 py-0.5 shadow-none justify-center",
                                dutyColor(schedule.duty_code)
                              )}
                              style={{ fontSize: "var(--text-xs)", borderRadius: "var(--cal-cell-radius)" }}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DUTY_CODES.map((code) => (
                                <SelectItem key={code} value={code}>
                                  <span className="flex items-center gap-2">
                                    <span
                                      className={cn("inline-block rounded px-1.5 py-0.5 font-mono", dutyColor(code))}
                                      style={{ fontSize: "var(--text-xs)" }}
                                    >
                                      {code}
                                    </span>
                                    <span style={{ fontSize: "var(--text-xs)" }} className="text-muted-foreground">
                                      {DUTY_DESCRIPTIONS[code] || ""}
                                    </span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span
                            className={cn(
                              "mt-auto inline-flex items-center justify-center rounded-full px-1.5 py-0.5 font-mono font-semibold leading-none",
                              dutyColor(schedule.duty_code)
                            )}
                            style={{ fontSize: "var(--text-xs)" }}
                          >
                            {schedule.duty_code}
                          </span>
                        )
                      ) : (
                        <span className="mt-auto text-muted-foreground/40" style={{ fontSize: "var(--text-xs)" }}>
                          ·
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Legend ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle style={{ fontSize: "var(--text-base)" }}>Duty Legend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-[var(--space-2)]">
              {DUTY_CODES.map((code) => (
                <div
                  key={code}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
                    dutyColor(code)
                  )}
                >
                  <span className="font-mono font-semibold" style={{ fontSize: "var(--text-xs)" }}>
                    {code}
                  </span>
                  <span className="opacity-70" style={{ fontSize: "var(--text-xs)" }}>
                    {DUTY_DESCRIPTIONS[code] || ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Upcoming 7 Days ── */}
        <Card className="overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-secondary/40 via-secondary/15 to-transparent" />
          <CardHeader className="pb-2">
            <CardTitle style={{ fontSize: "var(--text-lg)" }}>Upcoming 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : upcomingDuties.length > 0 ? (
              <div className="space-y-[var(--space-2)]">
                {upcomingDuties.map((duty) => (
                  <div
                    key={duty.id}
                    className="flex items-center justify-between rounded-lg border border-border/50 p-[var(--space-3)] hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-center gap-[var(--space-4)]">
                      {/* Date block */}
                      <div className="text-center" style={{ minWidth: "3rem" }}>
                        <p className="font-medium leading-none" style={{ fontSize: "var(--text-xs)" }}>
                          {format(parseISO(duty.duty_date), "EEE")}
                        </p>
                        <p className="font-bold leading-tight" style={{ fontSize: "var(--text-xl)" }}>
                          {format(parseISO(duty.duty_date), "d")}
                        </p>
                        <p className="text-muted-foreground leading-none" style={{ fontSize: "var(--text-xs)" }}>
                          {format(parseISO(duty.duty_date), "MMM")}
                        </p>
                      </div>
                      {/* Duty info */}
                      <div>
                        <Badge className={cn("font-mono mb-0.5", dutyColor(duty.duty_code))}>
                          {duty.duty_code}
                        </Badge>
                        <p className="text-muted-foreground" style={{ fontSize: "var(--text-xs)" }}>
                          {duty.duty_description || DUTY_DESCRIPTIONS[duty.duty_code] || ""}
                        </p>
                      </div>
                    </div>
                    {/* Shift time or edit */}
                    {canEdit ? (
                      <Select value={duty.duty_code} onValueChange={(val) => handleCodeChange(duty.id, val)}>
                        <SelectTrigger className="h-7 w-[90px]" style={{ fontSize: "var(--text-xs)" }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DUTY_CODES.map((code) => (
                            <SelectItem key={code} value={code}>
                              {code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground" style={{ fontSize: "var(--text-sm)" }}>
                        {shiftTime(duty.duty_code) || ""}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-6" style={{ fontSize: "var(--text-sm)" }}>
                No duties in the next 7 days
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
