import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

import { useToast } from "@/hooks/use-toast";
import { useFetchSchedule } from "@/hooks/useEmployeeSchedules";

import { Users, FileText, Calendar as CalendarIcon, ClipboardList, Clock, Search, Loader2, Sun, Sunrise, Moon, Briefcase, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { useDutyExchanges } from "@/hooks/useDutyExchanges";
import { useAttendance } from "@/hooks/useAttendance";
import { format, differenceInCalendarDays, parseISO } from "date-fns";
import { useAllLeaveRequests } from "@/hooks/useLeaveRequests";
import { getLeaveTypeLabel } from "@/lib/leaveConstants";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLeaveApiUrl, useLeaveRefresh } from "@/hooks/useLeaveData";
import { useHideMissingEmployeesBoard, useMissingEmployees, useMissingEmployeesHidden } from "@/hooks/useEmployeeDataSync";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";

/* ── Duty-cycle constants (mirrors WSOAttendance.tsx) ── */
const DUTY_CYCLE: Array<"M" | "A" | "N" | "NO" | "CO"> = ["M", "A", "N", "NO", "CO"];
const TODAY_TEAM_DUTY_BASE: Record<string, "M" | "A" | "N" | "NO" | "CO"> = {
  // Seeded to match current roster rule for "today":
  // C=M, B=A, A=N, E=NO, D=CO
  A: "N",
  B: "A",
  C: "M",
  D: "CO",
  E: "NO",
};
const DUTY_ROTATION_ANCHOR_DATE_IST = "2026-03-09"; // IST seed date for the mapping above
const SHIFT_LABELS: Record<string, string> = {
  M: "Morning",
  A: "Afternoon",
  N: "Night",
  NO: "Night Off",
  CO: "Clear Off",
};

function getISTDateKey(now = new Date()): string {
  const istDate = new Date(now.getTime() + 330 * 60 * 1000);
  const y = istDate.getUTCFullYear();
  const m = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(istDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function msUntilNextISTMidnight(now = new Date()): number {
  const istNow = new Date(now.getTime() + 330 * 60 * 1000);
  const nextIstMidnightUtcMs =
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + 1, 0, 0, 0) -
    330 * 60 * 1000;
  return Math.max(1000, nextIstMidnightUtcMs - now.getTime());
}

function getISTDayOfWeek(istDateKey: string): number {
  return parseISO(istDateKey).getDay(); // 0=Sun .. 6=Sat
}

function getTeamDutyForISTDate(teamKey: string, istDateKey: string) {
  const base = TODAY_TEAM_DUTY_BASE[teamKey] || "M";
  const baseIndex = DUTY_CYCLE.indexOf(base);
  const offset = differenceInCalendarDays(parseISO(istDateKey), parseISO(DUTY_ROTATION_ANCHOR_DATE_IST));
  const idx = (baseIndex + (offset % DUTY_CYCLE.length) + DUTY_CYCLE.length) % DUTY_CYCLE.length;
  return DUTY_CYCLE[idx];
}

/* Off-duty codes — employee is NOT on active duty if ALL tokens match this set */
const OFF_DUTY_CODES = new Set(["NO", "CO", "SAT", "SUN", "CH", "NH", "NA", "SL", "GO", "TR", "LEAVE"]);

function isOnDuty(dutyCode: string | null | undefined): boolean {
  if (!dutyCode) return false;
  const tokens = dutyCode.toUpperCase().split("+").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some((t) => !OFF_DUTY_CODES.has(t));
}

/* OPE / Extra duty codes (compound codes) */
const OPE_CODES = new Set([
  "M+A", "NO+N", "SAT+NO", "SUN+N", "SUN+M", "SUN+A", "SUN+NO",
  "SAT+N", "CO+N", "CO+A", "CO+M", "A+M",
]);

export default function SupervisorDashboard() {

  const [istToday, setIstToday] = useState(() => getISTDateKey());
  const today = istToday;
  const [rosterSearch, setRosterSearch] = useState("");
  const { toast } = useToast();

  const { data: allLeaveRequests = [], isLoading: leavesLoading } = useAllLeaveRequests();
  const { data: allExchanges, isLoading: exchangesLoading } = useDutyExchanges();
  const { attendance, isLoading: attendanceLoading } = useAttendance(today);
  const fetchSchedule = useFetchSchedule();
  const { data: leaveApiUrl = "" } = useLeaveApiUrl();
  const fetchLeave = useLeaveRefresh();
  const { data: missingEmployees = [] } = useMissingEmployees();
  const { data: missingEmployeesHidden = false } = useMissingEmployeesHidden();
  const hideMissingEmployeesBoard = useHideMissingEmployeesBoard();

  const { data: rosterResults = [] } = useQuery({
    queryKey: scheduleKeys.lookup(rosterSearch),
    enabled: rosterSearch.trim().length >= 2,
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      const search = rosterSearch.trim();
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("id, duty_date, employee_code, employee_name, duty_code, duty_description")
        .or(
          `employee_name.ilike.%${search}%,employee_code.ilike.%${search}%`
        )
        .order("duty_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        duty_date: string;
        employee_code: string;
        employee_name: string;
        duty_code: string;
        duty_description: string;
      }>;
    },
  });

  // Fetch today's employee schedules to compute on-duty count
  const { data: todaySchedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: scheduleKeys.today(today),
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("employee_code, duty_code")
        .eq("duty_date", today);
      if (error) throw error;
      return (data || []) as unknown as Array<{ employee_code: string; duty_code: string }>;
    },
  });

  const onDutyCount = useMemo(
    () => todaySchedules.filter((s) => isOnDuty(s.duty_code)).length,
    [todaySchedules]
  );

  const opeCount = useMemo(
    () => todaySchedules.filter((s) => s.duty_code && OPE_CODES.has(s.duty_code.toUpperCase().trim())).length,
    [todaySchedules]
  );

  // Count employees per shift from schedule data
  const shiftCounts = useMemo(() => {
    const counts: Record<string, number> = { M: 0, A: 0, N: 0, NO: 0, CO: 0 };
    todaySchedules.forEach((s) => {
      if (!s.duty_code) return;
      const tokens = s.duty_code.toUpperCase().split("+").map((t) => t.trim());
      tokens.forEach((t) => {
        if (t in counts) counts[t]++;
      });
    });
    return counts;
  }, [todaySchedules]);

  // Count General shift employees (duty code "G" or employees on team G)
  const generalCount = useMemo(
    () => todaySchedules.filter((s) => s.duty_code?.toUpperCase().trim() === "G").length,
    [todaySchedules]
  );

  // Auto-refresh date context at 00:00 IST every day.
  useEffect(() => {
    const timer = setTimeout(() => setIstToday(getISTDateKey()), msUntilNextISTMidnight());
    return () => clearTimeout(timer);
  }, [istToday]);

  // Derive today's shift ↔ team mapping from duty cycle logic (IST).
  const shiftTeams: Record<string, string[]> = { M: [], A: [], N: [], NO: [], CO: [] };
  Object.keys(TODAY_TEAM_DUTY_BASE).forEach((teamKey) => {
    const duty = getTeamDutyForISTDate(teamKey, istToday);
    shiftTeams[duty].push(`Team ${teamKey}`);
  });

  // Team G (General) works Mon–Fri, except CH/NH holidays (IST calendar).
  const dayOfWeek = getISTDayOfWeek(istToday); // 0=Sun, 6=Sat
  const isGeneralOnDuty = dayOfWeek >= 1 && dayOfWeek <= 5; // Mon–Fri

  // Supervisors can final-approve Pending Supervisor and direct-approve Pending WSO.
  const pendingLeaves = allLeaveRequests.filter(
    (l) => l.status === "Pending Supervisor" || l.status === "Pending WSO"
  );
  const pendingExchanges = allExchanges?.filter(e => e.status === "pending_supervisor") || [];

  const isLoading = leavesLoading || exchangesLoading || schedulesLoading;

  const handleFetchSchedule = () => {
    fetchSchedule.mutate(undefined, {
      onSuccess: (result: any) => {
        toast({
          title: "Schedule synced",
          description: `Fetched ${result?.rows ?? 0} duty rows for ${result?.employees ?? 0} employees.`,
        });
      },
      onError: (error: any) => {
        toast({
          title: "Schedule sync failed",
          description: error?.message || "Unable to fetch schedule right now.",
          variant: "destructive",
        });
      },
    });
  };

  const handleFetchLeave = () => {
    if (!leaveApiUrl) {
      toast({
        title: "Leave API not configured",
        description: "Set leave_webapp_url in Admin Settings first.",
        variant: "destructive",
      });
      return;
    }

    fetchLeave.mutate(undefined, {
      onSuccess: (result: any) => {
        toast({
          title: "Leave data fetched",
          description: `Fetched ${result?.count ?? result?.data?.length ?? 0} leave records.`,
        });
      },
      onError: (error: any) => {
        toast({
          title: "Leave fetch failed",
          description: error?.message || "Unable to fetch leave data right now.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Supervisor Dashboard</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {format(parseISO(istToday), "EEEE, MMMM d, yyyy")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:grid-cols-4 sm:gap-4">
          <StatCard title="On Duty Today" value={isLoading ? "..." : onDutyCount} icon={Users} description="Employees currently on duty" compactMobile titleValueInline className="bg-blue-50/70 border-blue-100 dark:bg-blue-950/30 dark:border-blue-900/40" />
          <StatCard title="Leave Requests" value={isLoading ? "..." : pendingLeaves.length} icon={FileText} description="Pending approval" compactMobile titleValueInline className="bg-amber-50/70 border-amber-100 dark:bg-amber-950/30 dark:border-amber-900/40" />
          <StatCard title="Duty Exchanges" value={isLoading ? "..." : pendingExchanges.length} icon={Clock} description="Awaiting final approval" compactMobile titleValueInline className="bg-emerald-50/70 border-emerald-100 dark:bg-emerald-950/30 dark:border-emerald-900/40" />
          <Link to="/supervisor/ope-assignments" className="block h-full">
            <StatCard title="OPE Assignments" value={isLoading ? "..." : opeCount} icon={ClipboardList} description="Extra duties today" compactMobile titleValueInline className="bg-violet-50/70 border-violet-100 dark:bg-violet-950/30 dark:border-violet-900/40 cursor-pointer hover:shadow-md transition-shadow" />
          </Link>
        </div>

        {/* Roster Lookup */}
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="flex items-center gap-1.5 text-lg sm:gap-2 sm:text-2xl">
              <Search className="h-4 w-4 sm:h-5 sm:w-5" />
              Employee Roster Lookup
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">Search by employee name to view their roster assignments</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
            <Input
              placeholder="Type employee name..."
              value={rosterSearch}
              onChange={(e) => setRosterSearch(e.target.value)}
              className="mb-3 text-sm sm:mb-4"
            />
            {rosterSearch.length >= 2 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {rosterResults.length > 0 ? rosterResults.slice(0, 10).map((r, i) => (
                  <div key={i} className="flex flex-col gap-2 border-b pb-2 text-xs last:border-0 sm:flex-row sm:items-center sm:justify-between sm:text-sm">
                    <div>
                      <p className="font-medium text-foreground">{r.employee_name}</p>
                      <p className="text-muted-foreground">{r.duty_date} — {r.employee_code}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-[11px] sm:text-xs">{r.duty_code}</Badge>
                      <Badge className="text-[11px] sm:text-xs">{r.duty_description || "-"}</Badge>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No schedule records found</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 sm:gap-4">
          <Card className="lg:col-span-2 bg-amber-50/40 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/30">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center justify-between text-lg sm:text-2xl">
                Pending Leave Requests
                <Badge variant="secondary" className="text-[11px] sm:text-xs">{pendingLeaves.length}</Badge>
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">Review and approve employee leave applications</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
              <div className="space-y-3 sm:space-y-4">
                {pendingLeaves.slice(0, 5).map((leaveReq) => (
                  <div key={leaveReq.id} className="flex flex-col gap-3 border-b pb-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium sm:text-base">{leaveReq.employee_name || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground sm:text-sm">
                        {getLeaveTypeLabel(leaveReq.leave_type)} - {leaveReq.start_date} to {leaveReq.end_date}
                      </p>
                      <Badge variant={leaveReq.status === "Pending WSO" ? "outline" : "secondary"} className="mt-1 text-[11px] sm:text-xs">
                        {leaveReq.status}
                      </Badge>
                    </div>
                    <Link to="/supervisor/leaves">
                      <Button size="sm" variant="outline" className="text-xs sm:text-sm">Review</Button>
                    </Link>
                  </div>
                ))}
                {pendingLeaves.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No pending leave requests</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-lg sm:text-2xl">Today's Shifts</CardTitle>
              <CardDescription className="text-xs sm:text-sm">Teams on duty — {format(parseISO(istToday), "dd MMM yyyy")}</CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
              <div className="space-y-2.5 sm:space-y-3">
                {[
                  { key: "M", label: "Morning", icon: Sunrise, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800/40" },
                  { key: "A", label: "Afternoon", icon: Sun, color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-950/40", border: "border-orange-200 dark:border-orange-800/40" },
                  { key: "N", label: "Night", icon: Moon, color: "text-indigo-500", bg: "bg-indigo-50 dark:bg-indigo-950/40", border: "border-indigo-200 dark:border-indigo-800/40" },
                  { key: "NO", label: "Night Off", icon: Moon, color: "text-slate-400", bg: "bg-slate-50 dark:bg-slate-950/40", border: "border-slate-200 dark:border-slate-800/40" },
                  { key: "CO", label: "Clear Off", icon: Clock, color: "text-gray-400", bg: "bg-gray-50 dark:bg-gray-950/40", border: "border-gray-200 dark:border-gray-800/40" },
                ].map(({ key, label, icon: ShiftIcon, color, bg, border }) => (
                  <Link
                    key={key}
                    to={`/supervisor/attendance?shift=${encodeURIComponent(key)}&date=${encodeURIComponent(today)}`}
                    className={`flex items-center gap-3 rounded-lg border p-2.5 ${bg} ${border} hover:shadow-md transition-shadow sm:gap-4 sm:p-3`}
                    title={`Open ${label} attendance list`}
                  >
                    <ShiftIcon className={`h-4 w-4 flex-shrink-0 sm:h-5 sm:w-5 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p>
                      <p className="mt-0.5 text-sm font-bold text-foreground sm:text-base">
                        {shiftTeams[key]?.length > 0
                          ? shiftTeams[key].join(", ")
                          : <span className="text-xs font-normal italic text-muted-foreground sm:text-sm">—</span>}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs font-bold tabular-nums sm:text-sm">
                      {isLoading ? "..." : shiftCounts[key] || 0}
                    </Badge>
                  </Link>
                ))}

                {/* General shift — Team G */}
                <div className={`flex items-center gap-3 rounded-lg border p-2.5 sm:gap-4 sm:p-3 ${isGeneralOnDuty ? "bg-teal-50 border-teal-200 dark:bg-teal-950/40 dark:border-teal-800/40" : "bg-gray-50 border-gray-200 dark:bg-gray-950/40 dark:border-gray-800/40 opacity-60"}`}>
                  <Briefcase className={`h-4 w-4 flex-shrink-0 sm:h-5 sm:w-5 ${isGeneralOnDuty ? "text-teal-500" : "text-gray-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">General</p>
                    <p className="mt-0.5 text-sm font-bold text-foreground sm:text-base">
                      Team G
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground sm:text-xs">
                        {isGeneralOnDuty ? "Mon – Fri" : "Off today"}
                      </span>
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-xs font-bold tabular-nums sm:text-sm">
                    {isLoading ? "..." : generalCount}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-emerald-50/40 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/30">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-lg sm:text-2xl">Duty Exchange Approvals</CardTitle>
            <CardDescription className="text-xs sm:text-sm">Requests approved by WSO awaiting final approval</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
            <div className="space-y-3 sm:space-y-4">
              {pendingExchanges.slice(0, 5).map((exchange) => (
                <div key={exchange.id} className="flex flex-col gap-3 border-b pb-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium sm:text-base">
                      {(exchange as any).requesting_user?.full_name || "Unknown"} ↔ {(exchange as any).exchange_partner?.full_name || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground sm:text-sm">Reason: {exchange.reason}</p>
                    <Badge variant="outline" className="mt-1 text-[11px] sm:text-xs">WSO Approved</Badge>
                  </div>
                  <Link to="/supervisor/duty-exchange">
                    <Button size="sm" variant="outline" className="text-xs sm:text-sm">Review</Button>
                  </Link>
                </div>
              ))}
              {pendingExchanges.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No pending duty exchange requests</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Missing Employees */}
        {missingEmployees.length > 0 && !missingEmployeesHidden && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                  Missing from API
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{missingEmployees.length}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs"
                    onClick={() => hideMissingEmployeesBoard.mutate()}
                    disabled={hideMissingEmployeesBoard.isPending}
                  >
                    OK
                  </Button>
                </div>
              </CardTitle>
              <CardDescription>
                Employees in the database but not found in the latest employee data sync
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {missingEmployees.map((emp) => (
                  <div key={emp.employee_id} className="border-b pb-2 last:border-0 text-sm">
                    <div>
                      <p className="font-medium">{emp.full_name}</p>
                      <p className="text-xs text-muted-foreground">{emp.employee_id}{emp.designation ? ` · ${emp.designation}` : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="bg-slate-50/50 border-slate-200 dark:bg-slate-950/20 dark:border-slate-800/30">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-lg sm:text-2xl">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-7 sm:gap-4">
              <Link to="/supervisor/attendance">
                <Button variant="outline" className="flex h-16 w-full flex-col gap-1.5 text-xs sm:h-20 sm:gap-2 sm:text-sm">
                  <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6" />
                  Mark Attendance
                </Button>
              </Link>
              <Link to="/supervisor/leaves">
                <Button variant="outline" className="flex h-16 w-full flex-col gap-1.5 text-xs sm:h-20 sm:gap-2 sm:text-sm">
                  <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
                  Approve Leaves
                </Button>
              </Link>
              <Link to="/supervisor/employees">
                <Button variant="outline" className="flex h-16 w-full flex-col gap-1.5 text-xs sm:h-20 sm:gap-2 sm:text-sm">
                  <Users className="h-5 w-5 sm:h-6 sm:w-6" />
                  Manage Employees
                </Button>
              </Link>
              <Button
                variant="outline"
                className="flex h-16 w-full flex-col gap-1.5 text-xs sm:h-20 sm:gap-2 sm:text-sm"
                onClick={handleFetchSchedule}
                disabled={fetchSchedule.isPending}
              >
                {fetchSchedule.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin sm:h-6 sm:w-6" />
                ) : (
                  <CalendarIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                )}
                Fetch Schedule
              </Button>
              <Button
                variant="outline"
                className="flex h-16 w-full flex-col gap-1.5 text-xs sm:h-20 sm:gap-2 sm:text-sm"
                onClick={handleFetchLeave}
                disabled={fetchLeave.isPending}
              >
                {fetchLeave.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin sm:h-6 sm:w-6" />
                ) : (
                  <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
                )}
                Fetch Leave
              </Button>
              <Link to="/supervisor/roster">
                <Button variant="outline" className="flex h-16 w-full flex-col gap-1.5 text-xs sm:h-20 sm:gap-2 sm:text-sm">
                  <CalendarIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                  Shift Roster Data
                </Button>
              </Link>
              <Link to="/supervisor/duty-management">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <CalendarIcon className="h-6 w-6" />
                  Roster Data
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
