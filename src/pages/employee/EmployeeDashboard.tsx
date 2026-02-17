import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Calendar, FileText, Clock, Info, Shield, Users, ClipboardList, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLeaves, useLeaveBalances } from "@/hooks/useLeaves";
import { useShifts } from "@/hooks/useShifts";
import { useMyRoster } from "@/hooks/useRosters";
import { useMySchedule, DUTY_DESCRIPTIONS } from "@/hooks/useEmployeeSchedules";
import { format, addDays } from "date-fns";

export default function EmployeeDashboard() {
  const { user, userRole } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);

  const today = format(new Date(), "yyyy-MM-dd");
  const weekEnd = format(addDays(new Date(), 7), "yyyy-MM-dd");
  const todayDisplay = format(new Date(), "dd-MM-yyyy");

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

  // Roster: today's duty and history
  const todayDuty = myRoster?.find(r => r.date === todayDisplay);
  const pastDuties = myRoster?.filter(r => r.date !== todayDisplay).slice(0, 3) || [];

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

        {/* My Duty Today Widget */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              My Duty Today
            </CardTitle>
            <CardDescription>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</CardDescription>
          </CardHeader>
          <CardContent>
            {rosterLoading ? (
              <p className="text-sm text-muted-foreground">Loading roster…</p>
            ) : todayDuty ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Unit</p>
                  <p className="font-semibold text-lg">{todayDuty.unit}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Position</p>
                  <Badge className="text-base">{todayDuty.position}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Team</p>
                  <p className="font-semibold">Team {todayDuty.team}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Shift</p>
                  <p className="font-semibold">{todayDuty.shift}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">No roster assignment for today</p>
            )}

            {pastDuties.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="text-xs text-muted-foreground mb-2">Recent Duties</p>
                <div className="space-y-2">
                  {pastDuties.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="font-mono">{d.date}</span>
                      <span>{d.unit} — {d.position}</span>
                      <Badge variant="outline">{d.shift}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-primary text-primary-foreground">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-90">Current Shift Assignment</p>
                <p className="text-3xl font-bold mt-1">{currentShift}</p>
                <p className="text-sm opacity-90 mt-1">
                  {new Date().toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
              <Calendar className="h-16 w-16 opacity-50" />
            </div>
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
              <CardTitle>Leave Balance Summary</CardTitle>
              <CardDescription>Your available leave balances</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {yearBalances.length > 0 ? yearBalances.map((bal) => (
                  <div key={bal.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <div>
                      <p className="font-medium">{bal.leave_type.toUpperCase()}</p>
                      {bal.expiry_date && (
                        <p className="text-xs text-warning flex items-center gap-1">
                          <Info className="h-3 w-3" />
                          Expires: {bal.expiry_date}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg">{bal.balance}</p>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No leave balances configured</p>
                )}
              </div>
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
