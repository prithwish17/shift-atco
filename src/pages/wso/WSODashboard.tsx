import { useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, FileText, Shield, Clock, Calendar } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useDutyExchanges } from "@/hooks/useDutyExchanges";
import { useBaTests } from "@/hooks/useBaTests";
import { useAllLeaveRequests } from "@/hooks/useLeaveRequests";
import {
  useDutyRoster,
  useGridExtraDuties,
  useGridLeaveRecords,
  useRosterAssignments,
  useRosterStatusEntries,
} from "@/hooks/useDutyGrid";
import { getLeaveTypeLabel } from "@/lib/leaveConstants";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import {
  getTeamDutyForDateKey,
  getTeamDutyLabel,
  isEligibleDutyForAttendance,
  normalizeTeamKey,
} from "@/lib/teamDutyRotation";

type TeamProfileSummary = {
  id: string;
  full_name: string | null;
  designation: string | null;
  employee_id: string | null;
  current_shift: string | null;
};

export default function WSODashboard() {
  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const todayDate = new Date();
  const today = format(todayDate, "yyyy-MM-dd");

  // WSO's team from profile (e.g. "a", "b", "c")
  const wsoTeam = normalizeTeamKey(profile?.current_shift);
  const teamDutyToday = getTeamDutyForDateKey(wsoTeam, today);
  const teamDutyLabel = getTeamDutyLabel(teamDutyToday);
  const rosterShift =
    teamDutyToday === "M" ? "Morning" :
    teamDutyToday === "A" ? "Afternoon" :
    teamDutyToday === "N" ? "Night" :
    null;

  // Fetch leave requests filtered by WSO's team + Pending WSO status
  const { data: teamLeaveRequests = [] } = useAllLeaveRequests(
    wsoTeam ? { team: wsoTeam, status: 'Pending WSO' } : undefined
  );
  const { data: allExchanges } = useDutyExchanges();
  const { data: baTests } = useBaTests();
  const { data: roster, isLoading: rosterLoading } = useDutyRoster(todayDate, rosterShift || "__OFF__", wsoTeam);
  const { data: assignments = [] } = useRosterAssignments(roster?.id);
  const { data: leaveRecords = [] } = useGridLeaveRecords(todayDate);
  const { data: extraDuties = [] } = useGridExtraDuties(roster?.id);
  const { data: rosterStatusEntries = [] } = useRosterStatusEntries(todayDate, rosterShift || "__OFF__", wsoTeam || "");
  const { data: teamProfiles = [] } = useQuery({
    queryKey: ["wso-team-profiles", wsoTeam],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      if (!wsoTeam) return [];

      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, designation, employee_id, current_shift")
        .neq("is_hidden" as any, true)
        .or(`current_shift.eq.${wsoTeam.toLowerCase()},current_shift.eq.${wsoTeam.toUpperCase()}`)
        .order("full_name");
      if (error) throw error;

      return (data || []) as TeamProfileSummary[];
    },
    enabled: !!wsoTeam,
  });
  const { data: onDutyCountData = 0, isLoading: onDutyLoading } = useQuery({
    queryKey: ["wso-on-duty-count", today, wsoTeam, teamDutyToday],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      if (!wsoTeam) return 0;

      const { data: shiftProfiles, error: profilesError } = await supabase
        .from("profiles")
        .select("employee_id, current_shift")
        .neq("is_hidden" as any, true)
        .or(`current_shift.eq.${wsoTeam.toLowerCase()},current_shift.eq.${wsoTeam.toUpperCase()}`);
      if (profilesError) throw profilesError;

      const employeeCodes = [...new Set((shiftProfiles || [])
        .map((p: any) => p.employee_id)
        .filter(Boolean))] as string[];
      if (employeeCodes.length === 0) return 0;

      const { data: schedules, error: schedulesError } = await supabase
        .from("employee_schedules" as any)
        .select("employee_code, duty_code")
        .eq("duty_date", today)
        .in("employee_code", employeeCodes);
      if (schedulesError) throw schedulesError;

      return (schedules || []).filter((schedule: any) =>
        isEligibleDutyForAttendance(schedule.duty_code, teamDutyToday)
      ).length;
    },
    enabled: !!wsoTeam,
  });

  const shiftLabel = profile?.current_shift ? `${profile.current_shift.toUpperCase()} Shift` : "—";
  const pendingExchanges = allExchanges?.filter(e => e.status === "pending_wso") || [];
  const pendingCount = teamLeaveRequests.length + pendingExchanges.length;
  const latestBaTest = baTests?.[0];
  const onDutyCount = typeof onDutyCountData === "number" ? onDutyCountData : 0;
  const teamProfileIds = useMemo(() => new Set(teamProfiles.map((member) => member.id)), [teamProfiles]);
  const markedAssignments = useMemo(
    () => assignments
      .filter((assignment) => assignment.employee_id)
      .sort((left, right) => {
        const leftLabel = left.position_label || left.position_name;
        const rightLabel = right.position_label || right.position_name;
        return leftLabel.localeCompare(rightLabel);
      }),
    [assignments]
  );
  const teamLeaveRecords = useMemo(
    () => leaveRecords
      .filter((record) => teamProfileIds.has(record.employee_id))
      .sort((left, right) => {
        const leftName = left.profiles?.full_name || "";
        const rightName = right.profiles?.full_name || "";
        return leftName.localeCompare(rightName);
      }),
    [leaveRecords, teamProfileIds]
  );
  const scheduleExtraDutyEntries = useMemo(
    () => rosterStatusEntries.filter((entry) => entry.unit?.toUpperCase() === "EXTRA DUTY"),
    [rosterStatusEntries]
  );
  const rosterStatusValue =
    !rosterShift ? "Off" :
    rosterLoading ? "..." :
    roster ? `${markedAssignments.length}` : "Pending";
  const rosterStatusDescription =
    !rosterShift
      ? `${teamDutyLabel} rotation today`
      : roster
        ? `${rosterShift} roster assignments`
        : `No ${rosterShift.toLowerCase()} roster yet`;

  return (
    <DashboardLayout role="wso">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">WSO Dashboard</h1>
          <p className="text-muted-foreground">
            {shiftLabel} - Watch Supervision Officer
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Link to="/employee/schedule" className="block">
            <StatCard
              title="On Duty Today"
              value={onDutyLoading ? "..." : onDutyCount}
              icon={Users}
              description={`${teamDutyLabel} duty attendance`}
            />
          </Link>
          <StatCard
            title="Pending Requests"
            value={pendingCount}
            icon={FileText}
            description="Leave & duty exchange"
          />
          <StatCard
            title="BA Tests"
            value={latestBaTest ? latestBaTest.selected_users.length : 0}
            icon={Shield}
            description={latestBaTest ? `Last: ${latestBaTest.test_date}` : "No tests yet"}
          />
          <StatCard
            title="Roster Status"
            value={rosterStatusValue}
            icon={Calendar}
            description={rosterStatusDescription}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Today's Shift Duty Roster</CardTitle>
              <CardDescription>
                {wsoTeam ? `Team ${wsoTeam} • ${teamDutyLabel}` : shiftLabel}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <Card className="border-border/70 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between text-base">
                      Duty Positions
                      <Badge variant="secondary">{markedAssignments.length} marked</Badge>
                    </CardTitle>
                    <CardDescription>
                      {rosterShift ? `${rosterShift} assignments linked to today's roster` : "This team is off duty today"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="max-h-[360px] space-y-3 overflow-y-auto pr-2">
                    {!rosterShift ? (
                      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        Team {wsoTeam} is on {teamDutyLabel.toLowerCase()} today, so no live shift roster is expected.
                      </p>
                    ) : rosterLoading ? (
                      <p className="text-sm text-muted-foreground">Loading today's roster...</p>
                    ) : markedAssignments.length > 0 ? (
                      markedAssignments.map((assignment) => (
                        <div key={assignment.id} className="flex items-start justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-3">
                          <div>
                            <p className="font-medium">{assignment.position_label || assignment.position_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {assignment.department} • {assignment.section_type}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">{assignment.profiles?.full_name || "Unassigned"}</p>
                            <p className="text-xs text-muted-foreground">
                              {assignment.profiles?.designation || assignment.remark || "Roster assignment"}
                            </p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        No positions have been marked yet for this shift. Sync or update the roster to populate the duty grid.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between text-base">
                      Extra Duty
                      <Badge variant="secondary">{extraDuties.length + scheduleExtraDutyEntries.length}</Badge>
                    </CardTitle>
                    <CardDescription>
                      Extra duty linked to today's roster and schedule
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="max-h-[360px] space-y-3 overflow-y-auto pr-2">
                    {extraDuties.length === 0 && scheduleExtraDutyEntries.length === 0 ? (
                      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        No extra duty entries recorded for today's shift.
                      </p>
                    ) : (
                      <>
                        {extraDuties.map((duty) => (
                          <div key={duty.id} className="rounded-xl border bg-muted/20 px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">{duty.profiles?.full_name || "Assigned employee"}</p>
                                <p className="text-xs text-muted-foreground">
                                  {duty.profiles?.designation || "Roster-linked duty"}
                                </p>
                              </div>
                              <Badge variant="outline">{duty.duty_type}</Badge>
                            </div>
                            {duty.remarks && (
                              <p className="mt-2 text-xs text-muted-foreground">{duty.remarks}</p>
                            )}
                          </div>
                        ))}
                        {scheduleExtraDutyEntries.map((entry) => (
                          <div key={entry.id} className="rounded-xl border bg-muted/20 px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">{entry.employee_name}</p>
                                <p className="text-xs text-muted-foreground">{entry.position || "Schedule entry"}</p>
                              </div>
                              <Badge variant="outline">Schedule</Badge>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between text-base">
                      Leave
                      <Badge variant="secondary">{teamLeaveRecords.length}</Badge>
                    </CardTitle>
                    <CardDescription>
                      Team members marked on leave in today's schedule
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="max-h-[360px] space-y-3 overflow-y-auto pr-2">
                    {teamLeaveRecords.length === 0 ? (
                      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        No leave is marked today for this team.
                      </p>
                    ) : (
                      teamLeaveRecords.map((record) => (
                        <div key={record.id} className="rounded-xl border bg-muted/20 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium">{record.profiles?.full_name || "Employee on leave"}</p>
                              <p className="text-xs text-muted-foreground">
                                {record.profiles?.designation || "Team member"}
                              </p>
                            </div>
                            <Badge variant="outline">{record.leave_type}</Badge>
                          </div>
                          {record.remarks && (
                            <p className="mt-2 text-xs text-muted-foreground">{record.remarks}</p>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link to="/wso/roster" className="flex-1 min-w-[180px]">
                  <Button variant="outline" className="w-full">
                    View Full Roster
                  </Button>
                </Link>
                <Link to="/wso/atc-grid" className="flex-1 min-w-[180px]">
                  <Button variant="outline" className="w-full">
                    Open Shift Duty Grid
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Pending Requests
                <Badge variant="secondary">{pendingCount}</Badge>
              </CardTitle>
              <CardDescription>
                Leave and duty exchange approvals
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {teamLeaveRequests.slice(0, 5).map((req) => (
                  <div key={req.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div>
                      <p className="font-medium">{req.employee_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {getLeaveTypeLabel(req.leave_type)} — {format(new Date(req.start_date), 'dd MMM')}
                        {req.start_date !== req.end_date && ` to ${format(new Date(req.end_date), 'dd MMM')}`}
                        {' '}({req.total_days} day{req.total_days > 1 ? 's' : ''})
                      </p>
                    </div>
                    <Link to="/wso/leaves">
                      <Button size="sm" variant="outline">Review</Button>
                    </Link>
                  </div>
                ))}
                {pendingExchanges.slice(0, 3).map((exchange) => (
                  <div key={exchange.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div>
                      <p className="font-medium">{(exchange as any).requesting_user?.full_name || "Unknown"}</p>
                      <p className="text-sm text-muted-foreground">
                        Duty Exchange: {exchange.reason}
                      </p>
                    </div>
                    <Link to="/wso/duty-exchange">
                      <Button size="sm" variant="outline">Review</Button>
                    </Link>
                  </div>
                ))}
                {pendingCount === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No pending requests
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>BA Test Schedule</CardTitle>
            <CardDescription>
              Breath Analyzer test management
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Latest Test</p>
                  <p className="text-sm text-muted-foreground">
                    {latestBaTest ? `${latestBaTest.test_date} - ${latestBaTest.selected_users.length} employees` : "No tests generated yet"}
                  </p>
                </div>
                {latestBaTest && (
                  <Badge variant={latestBaTest.completed ? "default" : "outline"}>
                    {latestBaTest.completed ? "Completed" : "Pending"}
                  </Badge>
                )}
              </div>
              <Link to="/wso/ba-test">
                <Button className="w-full">
                  <Shield className="mr-2 h-4 w-4" />
                  Generate BA Test List
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-5">
              <Link to="/wso/roster">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Calendar className="h-6 w-6" />
                  Manage Roster
                </Button>
              </Link>
              <Link to="/wso/attendance">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Users className="h-6 w-6" />
                  Mark Attendance
                </Button>
              </Link>
              <Link to="/wso/atc-grid">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Clock className="h-6 w-6" />
                  Shift Duty Grid
                </Button>
              </Link>
              <Link to="/wso/leaves">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <FileText className="h-6 w-6" />
                  Leave Requests
                </Button>
              </Link>
              <Link to="/wso/ba-test">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Shield className="h-6 w-6" />
                  BA Test
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
