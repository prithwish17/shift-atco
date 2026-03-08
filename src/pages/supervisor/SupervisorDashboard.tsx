import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

import { useToast } from "@/hooks/use-toast";
import { useFetchSchedule } from "@/hooks/useEmployeeSchedules";

import { Users, FileText, Calendar as CalendarIcon, ClipboardList, Clock, Search, Loader2, Sun, Sunrise, Moon, Briefcase } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useMemo } from "react";
import { useDutyExchanges } from "@/hooks/useDutyExchanges";
import { useAttendance } from "@/hooks/useAttendance";
import { format, differenceInCalendarDays } from "date-fns";
import { useAllLeaveRequests } from "@/hooks/useLeaveRequests";
import { getLeaveTypeLabel } from "@/lib/leaveConstants";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ── Duty-cycle constants (mirrors WSOAttendance.tsx) ── */
const DUTY_CYCLE: Array<"M" | "A" | "N" | "NO" | "CO"> = ["M", "A", "N", "NO", "CO"];
const TODAY_TEAM_DUTY_BASE: Record<string, "M" | "A" | "N" | "NO" | "CO"> = {
  A: "A",
  B: "M",
  C: "CO",
  D: "NO",
  E: "N",
};
const SHIFT_LABELS: Record<string, string> = {
  M: "Morning",
  A: "Afternoon",
  N: "Night",
  NO: "Night Off",
  CO: "Clear Off",
};

function getTeamDutyForDate(teamKey: string, date: Date) {
  const base = TODAY_TEAM_DUTY_BASE[teamKey] || "M";
  const baseIndex = DUTY_CYCLE.indexOf(base);
  const offset = differenceInCalendarDays(date, new Date());
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

  const today = format(new Date(), "yyyy-MM-dd");
  const [rosterSearch, setRosterSearch] = useState("");
  const { toast } = useToast();

  const { data: allLeaveRequests = [], isLoading: leavesLoading } = useAllLeaveRequests();
  const { data: allExchanges, isLoading: exchangesLoading } = useDutyExchanges();
  const { attendance, isLoading: attendanceLoading } = useAttendance(today);
  const fetchSchedule = useFetchSchedule();

  const { data: rosterResults = [] } = useQuery({
    queryKey: ["supervisor-schedule-lookup", rosterSearch],
    enabled: rosterSearch.trim().length >= 2,
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
    queryKey: ["supervisor-today-schedules", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("employee_code, duty_code")
        .eq("duty_date", today);
      if (error) throw error;
      return (data || []) as unknown as Array<{ employee_code: string; duty_code: string }>;
    },
    staleTime: 2 * 60 * 1000,
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

  // Derive today's shift ↔ team mapping from duty cycle logic
  const todayDate = new Date();
  const shiftTeams: Record<string, string[]> = { M: [], A: [], N: [], NO: [], CO: [] };
  Object.keys(TODAY_TEAM_DUTY_BASE).forEach((teamKey) => {
    const duty = getTeamDutyForDate(teamKey, todayDate);
    shiftTeams[duty].push(`Team ${teamKey}`);
  });

  // Team G (General) works Mon–Fri, except CH/NH holidays
  const dayOfWeek = todayDate.getDay(); // 0=Sun, 6=Sat
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

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Supervisor Dashboard</h1>
          <p className="text-muted-foreground">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title="On Duty Today" value={isLoading ? "..." : onDutyCount} icon={Users} description="Employees currently on duty" className="bg-blue-50/70 border-blue-100 dark:bg-blue-950/30 dark:border-blue-900/40" />
          <StatCard title="Leave Requests" value={isLoading ? "..." : pendingLeaves.length} icon={FileText} description="Pending approval" className="bg-amber-50/70 border-amber-100 dark:bg-amber-950/30 dark:border-amber-900/40" />
          <StatCard title="Duty Exchanges" value={isLoading ? "..." : pendingExchanges.length} icon={Clock} description="Awaiting final approval" className="bg-emerald-50/70 border-emerald-100 dark:bg-emerald-950/30 dark:border-emerald-900/40" />
          <Link to="/supervisor/ope-assignments">
            <StatCard title="OPE Assignments" value={isLoading ? "..." : opeCount} icon={ClipboardList} description="Extra duties today" className="bg-violet-50/70 border-violet-100 dark:bg-violet-950/30 dark:border-violet-900/40 cursor-pointer hover:shadow-md transition-shadow" />
          </Link>
        </div>

        {/* Roster Lookup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Employee Roster Lookup
            </CardTitle>
            <CardDescription>Search by employee name to view their roster assignments</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Type employee name..."
              value={rosterSearch}
              onChange={(e) => setRosterSearch(e.target.value)}
              className="mb-4"
            />
            {rosterSearch.length >= 2 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {rosterResults.length > 0 ? rosterResults.slice(0, 10).map((r, i) => (
                  <div key={i} className="flex items-center justify-between border-b pb-2 last:border-0 text-sm">
                    <div>
                      <p className="font-medium">{r.employee_name}</p>
                      <p className="text-muted-foreground">{r.duty_date} — {r.employee_code}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline">{r.duty_code}</Badge>
                      <Badge>{r.duty_description || "-"}</Badge>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No schedule records found</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card className="lg:col-span-2 bg-amber-50/40 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/30">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Pending Leave Requests
                <Badge variant="secondary">{pendingLeaves.length}</Badge>
              </CardTitle>
              <CardDescription>Review and approve employee leave applications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {pendingLeaves.slice(0, 5).map((leaveReq) => (
                  <div key={leaveReq.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div>
                      <p className="font-medium">{leaveReq.employee_name || "Unknown"}</p>
                      <p className="text-sm text-muted-foreground">
                        {getLeaveTypeLabel(leaveReq.leave_type)} - {leaveReq.start_date} to {leaveReq.end_date}
                      </p>
                      <Badge variant={leaveReq.status === "Pending WSO" ? "outline" : "secondary"} className="mt-1">
                        {leaveReq.status}
                      </Badge>
                    </div>
                    <Link to="/supervisor/leaves">
                      <Button size="sm" variant="outline">Review</Button>
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
            <CardHeader>
              <CardTitle>Today's Shifts</CardTitle>
              <CardDescription>Teams on duty — {format(new Date(), "dd MMM yyyy")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { key: "M", label: "Morning", icon: Sunrise, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/40", border: "border-amber-200 dark:border-amber-800/40" },
                  { key: "A", label: "Afternoon", icon: Sun, color: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-950/40", border: "border-orange-200 dark:border-orange-800/40" },
                  { key: "N", label: "Night", icon: Moon, color: "text-indigo-500", bg: "bg-indigo-50 dark:bg-indigo-950/40", border: "border-indigo-200 dark:border-indigo-800/40" },
                  { key: "NO", label: "Night Off", icon: Moon, color: "text-slate-400", bg: "bg-slate-50 dark:bg-slate-950/40", border: "border-slate-200 dark:border-slate-800/40" },
                  { key: "CO", label: "Clear Off", icon: Clock, color: "text-gray-400", bg: "bg-gray-50 dark:bg-gray-950/40", border: "border-gray-200 dark:border-gray-800/40" },
                ].map(({ key, label, icon: ShiftIcon, color, bg, border }) => (
                  <div key={key} className={`flex items-center gap-4 p-3 rounded-lg border ${bg} ${border}`}>
                    <ShiftIcon className={`h-5 w-5 flex-shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">{label}</p>
                      <p className="text-base font-bold text-foreground mt-0.5">
                        {shiftTeams[key]?.length > 0
                          ? shiftTeams[key].join(", ")
                          : <span className="text-muted-foreground font-normal text-sm italic">—</span>}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-sm font-bold tabular-nums">
                      {isLoading ? "..." : shiftCounts[key] || 0}
                    </Badge>
                  </div>
                ))}

                {/* General shift — Team G */}
                <div className={`flex items-center gap-4 p-3 rounded-lg border ${isGeneralOnDuty ? "bg-teal-50 border-teal-200 dark:bg-teal-950/40 dark:border-teal-800/40" : "bg-gray-50 border-gray-200 dark:bg-gray-950/40 dark:border-gray-800/40 opacity-60"}`}>
                  <Briefcase className={`h-5 w-5 flex-shrink-0 ${isGeneralOnDuty ? "text-teal-500" : "text-gray-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">General</p>
                    <p className="text-base font-bold text-foreground mt-0.5">
                      Team G
                      <span className="text-xs font-normal text-muted-foreground ml-2">
                        {isGeneralOnDuty ? "Mon – Fri" : "Off today"}
                      </span>
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-sm font-bold tabular-nums">
                    {isLoading ? "..." : generalCount}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-emerald-50/40 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/30">
          <CardHeader>
            <CardTitle>Duty Exchange Approvals</CardTitle>
            <CardDescription>Requests approved by WSO awaiting final approval</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pendingExchanges.slice(0, 5).map((exchange) => (
                <div key={exchange.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                  <div>
                    <p className="font-medium">
                      {(exchange as any).requesting_user?.full_name || "Unknown"} ↔ {(exchange as any).exchange_partner?.full_name || "Unknown"}
                    </p>
                    <p className="text-sm text-muted-foreground">Reason: {exchange.reason}</p>
                    <Badge variant="outline" className="mt-1">WSO Approved</Badge>
                  </div>
                  <Link to="/supervisor/duty-exchange">
                    <Button size="sm" variant="outline">Review</Button>
                  </Link>
                </div>
              ))}
              {pendingExchanges.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No pending duty exchange requests</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-50/50 border-slate-200 dark:bg-slate-950/20 dark:border-slate-800/30">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-6">
              <Link to="/supervisor/attendance">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <ClipboardList className="h-6 w-6" />
                  Mark Attendance
                </Button>
              </Link>
              <Link to="/supervisor/leaves">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <FileText className="h-6 w-6" />
                  Approve Leaves
                </Button>
              </Link>
              <Link to="/supervisor/employees">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Users className="h-6 w-6" />
                  Manage Employees
                </Button>
              </Link>
              <Button
                variant="outline"
                className="w-full h-20 flex flex-col gap-2"
                onClick={handleFetchSchedule}
                disabled={fetchSchedule.isPending}
              >
                {fetchSchedule.isPending ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <CalendarIcon className="h-6 w-6" />
                )}
                Fetch Schedule
              </Button>
              <Link to="/supervisor/roster">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <CalendarIcon className="h-6 w-6" />
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
