import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Calendar, FileText, Clock, Info, Shield, Users, ClipboardList, Briefcase, AlertTriangle, CheckCircle, XCircle, User } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLeaves, useLeaveBalances } from "@/hooks/useLeaves";
import { useLicenses } from "@/hooks/useLicenses";
import { useShifts } from "@/hooks/useShifts";
import { useMyRoster } from "@/hooks/useRosters";
import { useMySchedule, DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import { format, addDays, isSameDay, parse, differenceInDays } from "date-fns";

const LICENSE_LABELS: Record<string, string> = {
  rdr: "Radar",
  app: "Approach",
  plr: "Precision",
  adc: "Aerodrome",
  alpha: "Alpha",
  occ: "Oceanic",
};

/** Parse roster date strings like "17-Feb-2026" into Date objects */
function parseRosterDate(dateStr: string): Date | null {
  try {
    return parse(dateStr, "dd-MMM-yyyy", new Date());
  } catch {
    return null;
  }
}

export default function EmployeeDashboard() {
  const { user, userRole } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const { licenses, isLoading: licensesLoading } = useLicenses(user?.id);

  const today = format(new Date(), "yyyy-MM-dd");
  const weekEnd = format(addDays(new Date(), 7), "yyyy-MM-dd");

  const { data: leaves, isLoading: leavesLoading } = useLeaves(user?.id);
  const { data: balances, isLoading: balancesLoading } = useLeaveBalances(user?.id);
  const { shifts, isLoading: shiftsLoading } = useShifts(user?.id, today, weekEnd);
  const { data: myRoster, isLoading: rosterLoading } = useMyRoster(profile?.full_name);
  const { data: mySchedule = [], isLoading: scheduleLoading } = useMySchedule(
    profile?.employee_id,
    today,
    format(addDays(new Date(), 7), 'yyyy-MM-dd')
  );

  const currentYear = new Date().getFullYear();
  const yearBalances = balances?.filter(b => b.year === currentYear) || [];
  const clBalance = yearBalances.find(b => b.leave_type === "cl");
  const rhBalance = yearBalances.find(b => b.leave_type === "rh");
  const elBalance = yearBalances.find(b => b.leave_type === "el");
  const compOff = yearBalances.find(b => b.leave_type === "comp_off");

  const recentLeaves = leaves?.slice(0, 5) || [];

  // 2-day roster + schedule lookup
  const now = new Date();
  const tomorrow = addDays(now, 1);
  const tomorrowStr = format(tomorrow, "yyyy-MM-dd");

  const todayRoster = myRoster?.find(r => {
    const d = parseRosterDate(r.date);
    return d && isSameDay(d, now);
  });
  const tomorrowRoster = myRoster?.find(r => {
    const d = parseRosterDate(r.date);
    return d && isSameDay(d, tomorrow);
  });
  const todaySchedule = mySchedule.find(s => s.duty_date === today);
  const tomorrowSchedule = mySchedule.find(s => s.duty_date === tomorrowStr);

  const isLoading = profileLoading || leavesLoading || balancesLoading || shiftsLoading;

  const employeeName = profile?.full_name || "Employee";
  const employeeId = profile?.employee_id || "—";
  const currentShift = profile?.current_shift ? `${profile.current_shift.toUpperCase()} Shift` : "—";

  return (
    <DashboardLayout role="employee">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome, {employeeName}</h1>
          <p className="text-muted-foreground">
            {employeeId} - {currentShift}
          </p>
        </div>

        {userRole && userRole !== 'employee' && (
          <Card>
            <CardHeader>
              <CardTitle>Role Dashboards</CardTitle>
              <CardDescription>Access your management dashboards</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                {userRole === 'admin' && (
                  <Link to="/admin">
                    <Button variant="outline" className="w-full h-20 flex flex-col gap-2 border-primary/50 hover:bg-primary/10">
                      <Shield className="h-6 w-6 text-primary" />
                      <span className="font-semibold">Admin Dashboard</span>
                    </Button>
                  </Link>
                )}
                {userRole === 'supervisor' && (
                  <Link to="/supervisor">
                    <Button variant="outline" className="w-full h-20 flex flex-col gap-2 border-primary/50 hover:bg-primary/10">
                      <Users className="h-6 w-6 text-primary" />
                      <span className="font-semibold">Supervisor Dashboard</span>
                    </Button>
                  </Link>
                )}
                {userRole === 'wso' && (
                  <Link to="/wso">
                    <Button variant="outline" className="w-full h-20 flex flex-col gap-2 border-primary/50 hover:bg-primary/10">
                      <ClipboardList className="h-6 w-6 text-primary" />
                      <span className="font-semibold">WSO Dashboard</span>
                    </Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Duty Overview — Today + Tomorrow */}
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between p-[var(--space-4)]">
            <CardTitle className="flex items-center gap-[var(--space-2)] font-semibold text-[length:var(--text-title)] text-slate-900 dark:text-slate-100">
              <Briefcase className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              Duty Overview
            </CardTitle>
            <span className="font-medium text-[length:var(--text-body)] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-[var(--space-2)] py-[var(--space-1)] rounded-md">
              {currentShift}
            </span>
          </CardHeader>
          <CardContent className="p-[var(--space-4)] pt-0">
            {(rosterLoading || scheduleLoading) ? (
              <p className="text-[length:var(--text-body)] text-slate-400">Loading…</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-3)]">
                {/* TODAY */}
                <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-[var(--space-3)] space-y-[var(--space-2)]">
                  <div>
                    <p className="uppercase tracking-wide text-slate-500 dark:text-slate-400 text-[length:var(--text-meta)] font-semibold">Today</p>
                    <p className="text-[length:var(--text-body)] text-slate-500 dark:text-slate-400">{format(now, "EEE, dd MMM")}</p>
                  </div>
                  {todayRoster ? (
                    <div className="grid grid-cols-2 auto-rows-min gap-[var(--space-2)]">
                      <div>
                        <p className="text-[length:var(--text-label)] text-slate-400 dark:text-slate-500">Unit</p>
                        <p className="font-medium text-[length:var(--text-body)] text-slate-800 dark:text-slate-200">{todayRoster.unit}</p>
                      </div>
                      <div>
                        <p className="text-[length:var(--text-label)] text-slate-400 dark:text-slate-500">Position</p>
                        <span className="inline-block bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium text-[length:var(--text-body)] rounded-md px-[var(--space-2)] py-[var(--space-1)]">{todayRoster.position}</span>
                      </div>
                      <div>
                        <p className="text-[length:var(--text-label)] text-slate-400 dark:text-slate-500">Team</p>
                        <p className="font-medium text-[length:var(--text-body)] text-slate-800 dark:text-slate-200">Team {todayRoster.team}</p>
                      </div>
                      <div>
                        <p className="text-[length:var(--text-label)] text-slate-400 dark:text-slate-500">Shift</p>
                        <span className="inline-block bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-600 font-medium text-[length:var(--text-body)] rounded-md px-[var(--space-2)] py-[var(--space-1)]">{todayRoster.shift}</span>
                      </div>
                    </div>
                  ) : todaySchedule ? (
                    <div className="space-y-[var(--space-1)]">
                      <span className="inline-block bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-600 font-medium text-[length:var(--text-body)] font-mono rounded-md px-[var(--space-2)] py-[var(--space-1)]">{todaySchedule.duty_code}</span>
                      <p className="text-[length:var(--text-body)] text-slate-500 dark:text-slate-400">{todaySchedule.duty_description || DUTY_DESCRIPTIONS[todaySchedule.duty_code] || ''}</p>
                    </div>
                  ) : (
                    <p className="text-[length:var(--text-body)] text-slate-400 dark:text-slate-500">No assignment</p>
                  )}
                </div>

                {/* TOMORROW */}
                <div className="rounded-md border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 p-[var(--space-3)] space-y-[var(--space-2)]">
                  <div>
                    <p className="uppercase tracking-wide text-slate-400 dark:text-slate-500 text-[length:var(--text-meta)] font-semibold">Tomorrow</p>
                    <p className="text-[length:var(--text-body)] text-slate-400 dark:text-slate-500">{format(tomorrow, "EEE, dd MMM")}</p>
                  </div>
                  {tomorrowRoster ? (
                    <div className="grid grid-cols-2 auto-rows-min gap-[var(--space-2)]">
                      <div>
                        <p className="text-[length:var(--text-label)] text-slate-400 dark:text-slate-500">Unit</p>
                        <p className="font-medium text-[length:var(--text-body)] text-slate-800 dark:text-slate-200">{tomorrowRoster.unit}</p>
                      </div>
                      <div>
                        <p className="text-[length:var(--text-label)] text-slate-400 dark:text-slate-500">Position</p>
                        <span className="inline-block bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium text-[length:var(--text-body)] rounded-md px-[var(--space-2)] py-[var(--space-1)]">{tomorrowRoster.position}</span>
                      </div>
                      <div>
                        <p className="text-[length:var(--text-label)] text-slate-400 dark:text-slate-500">Team</p>
                        <p className="font-medium text-[length:var(--text-body)] text-slate-800 dark:text-slate-200">Team {tomorrowRoster.team}</p>
                      </div>
                      <div>
                        <p className="text-[length:var(--text-label)] text-slate-400 dark:text-slate-500">Shift</p>
                        <span className="inline-block bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-600 font-medium text-[length:var(--text-body)] rounded-md px-[var(--space-2)] py-[var(--space-1)]">{tomorrowRoster.shift}</span>
                      </div>
                    </div>
                  ) : tomorrowSchedule ? (
                    <div className="space-y-[var(--space-1)]">
                      <span className="inline-block bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-600 font-medium text-[length:var(--text-body)] font-mono rounded-md px-[var(--space-2)] py-[var(--space-1)]">{tomorrowSchedule.duty_code}</span>
                      <p className="text-[length:var(--text-body)] text-slate-400 dark:text-slate-500">{tomorrowSchedule.duty_description || DUTY_DESCRIPTIONS[tomorrowSchedule.duty_code] || ''}</p>
                    </div>
                  ) : (
                    <p className="text-[length:var(--text-body)] text-slate-400 dark:text-slate-500">No assignment</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>


        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title="CL Balance" value={clBalance ? clBalance.balance : "—"} icon={FileText} description="Casual Leave" />
          <StatCard title="RH Balance" value={rhBalance ? rhBalance.balance : "—"} icon={FileText} description="Restricted Holiday" />
          <StatCard title="EL Balance" value={elBalance ? elBalance.balance : "—"} icon={FileText} description="Earned Leave" />
          <StatCard title="Comp Off" value={compOff ? compOff.balance : "—"} icon={Clock} description={compOff?.expiry_date ? `Expires ${compOff.expiry_date}` : "No comp off"} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Schedule</CardTitle>
              <CardDescription>Next 7 days duty assignments</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {mySchedule.length > 0 ? mySchedule.map((duty) => (
                  <div key={duty.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium">{format(new Date(duty.duty_date), "MMM d, EEE")}</p>
                      <p className="text-sm text-muted-foreground">{duty.duty_description || DUTY_DESCRIPTIONS[duty.duty_code] || duty.duty_code}</p>
                    </div>
                    <Badge variant={duty.duty_code === 'CO' || duty.duty_code === 'LEAVE' || duty.duty_code === 'SL' ? 'secondary' : 'default'} className="font-mono">
                      {duty.duty_code}
                    </Badge>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No schedule data yet. Fetch from Settings.</p>
                )}
              </div>
              <Link to="/employee/schedule">
                <Button variant="outline" className="w-full mt-4">View Full Schedule</Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Profile & Ratings
              </CardTitle>
              <CardDescription>Your profile snapshot and license validity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Profile Snapshot */}
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-sm text-muted-foreground">Designation</span>
                  <span className="font-medium">{profile?.designation || '—'}</span>
                </div>
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-sm text-muted-foreground">Email</span>
                  <span className="font-medium text-sm truncate max-w-[180px]">{profile?.email || '—'}</span>
                </div>
                {profile?.stream && (
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-sm text-muted-foreground">Stream</span>
                    <Badge variant="outline" className="uppercase">{profile.stream}</Badge>
                  </div>
                )}
              </div>

              {/* License / Ratings */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Licenses & Ratings</p>
                <div className="space-y-2">
                  {licenses && licenses.length > 0 ? licenses.map((lic) => {
                    const now = new Date();
                    const expiry = lic.expiry_date ? new Date(lic.expiry_date) : null;
                    const daysLeft = expiry ? differenceInDays(expiry, now) : null;
                    let statusColor = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
                    let StatusIcon = CheckCircle;
                    let statusLabel = 'Valid';
                    if (daysLeft !== null && daysLeft < 0) {
                      statusColor = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                      StatusIcon = XCircle;
                      statusLabel = 'Expired';
                    } else if (daysLeft !== null && daysLeft <= 30) {
                      statusColor = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
                      StatusIcon = AlertTriangle;
                      statusLabel = `${daysLeft}d left`;
                    }
                    return (
                      <div key={lic.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-primary" />
                          <div>
                            <p className="font-medium text-sm">{LICENSE_LABELS[lic.license_type] || lic.license_type.toUpperCase()}</p>
                            <p className="text-xs text-muted-foreground">
                              {expiry ? `Expires ${format(expiry, 'dd MMM yyyy')}` : 'No expiry'}
                            </p>
                          </div>
                        </div>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${statusColor}`}>
                          <StatusIcon className="h-3 w-3" />
                          {statusLabel}
                        </span>
                      </div>
                    );
                  }) : (
                    <p className="text-sm text-muted-foreground text-center py-3">No licenses found</p>
                  )}
                </div>
              </div>

              <Link to="/employee/profile">
                <Button variant="outline" className="w-full mt-2">View Full Profile</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Leave History</CardTitle>
            <CardDescription>Your recent leave applications</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentLeaves.length > 0 ? recentLeaves.map((leave) => (
                <div key={leave.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                  <div>
                    <p className="font-medium">{leave.leave_type.toUpperCase()}</p>
                    <p className="text-sm text-muted-foreground">{leave.start_date} to {leave.end_date}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">{leave.status.replace("_", " ")}</Badge>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground text-center py-4">No leave history</p>
              )}
            </div>
            <Link to="/employee/leave">
              <Button variant="outline" className="w-full mt-4">View All Leaves</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-5">
              <Link to="/employee/leave">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <FileText className="h-6 w-6" />
                  Apply for Leave
                </Button>
              </Link>
              <Link to="/employee/duty-exchange">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Clock className="h-6 w-6" />
                  Request Exchange
                </Button>
              </Link>
              <Link to="/employee/schedule">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Calendar className="h-6 w-6" />
                  View Schedule
                </Button>
              </Link>
              <Link to="/employee/atc-duties">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <ClipboardList className="h-6 w-6" />
                  ATC Duties
                </Button>
              </Link>
              <Link to="/employee/profile">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Info className="h-6 w-6" />
                  My Profile
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
