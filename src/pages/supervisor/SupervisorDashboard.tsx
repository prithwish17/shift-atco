import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";

import { Users, FileText, Calendar as CalendarIcon, ClipboardList, Clock, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useLeaves } from "@/hooks/useLeaves";
import { useDutyExchanges } from "@/hooks/useDutyExchanges";
import { useAttendance } from "@/hooks/useAttendance";
import { useRosters } from "@/hooks/useRosters";
import { format } from "date-fns";

export default function SupervisorDashboard() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const today = format(new Date(), "yyyy-MM-dd");
  const [rosterSearch, setRosterSearch] = useState("");

  const { data: allLeaves, isLoading: leavesLoading } = useLeaves();
  const { data: allExchanges, isLoading: exchangesLoading } = useDutyExchanges();
  const { attendance, isLoading: attendanceLoading } = useAttendance(today);
  const { data: rosterResults = [] } = useRosters({ search: rosterSearch || undefined });

  const pendingLeaves = allLeaves?.filter(l => l.status === "pending_supervisor" || l.status === "pending_wso") || [];
  const pendingExchanges = allExchanges?.filter(e => e.status === "pending_supervisor") || [];
  const onDutyCount = attendance?.filter(a => a.status === "present").length || 0;

  const isLoading = leavesLoading || exchangesLoading || attendanceLoading;

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
          <StatCard title="On Duty Today" value={isLoading ? "..." : onDutyCount} icon={Users} description="Employees currently on duty" />
          <StatCard title="Leave Requests" value={isLoading ? "..." : pendingLeaves.length} icon={FileText} description="Pending approval" />
          <StatCard title="Duty Exchanges" value={isLoading ? "..." : pendingExchanges.length} icon={Clock} description="Awaiting final approval" />
          <StatCard title="OPE Assignments" value="—" icon={ClipboardList} description="Extra duties this week" />
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
                      <p className="text-muted-foreground">{r.date} — {r.unit}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline">{r.shift}</Badge>
                      <Badge>{r.position}</Badge>
                    </div>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No roster records found</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Pending Leave Requests
                <Badge variant="secondary">{pendingLeaves.length}</Badge>
              </CardTitle>
              <CardDescription>Review and approve employee leave applications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {pendingLeaves.slice(0, 5).map((leave) => (
                  <div key={leave.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div>
                      <p className="font-medium">{(leave as any).user?.full_name || "Unknown"}</p>
                      <p className="text-sm text-muted-foreground">
                        {leave.leave_type.toUpperCase()} - {leave.start_date} to {leave.end_date}
                      </p>
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
              <CardTitle>Shift Calendar</CardTitle>
              <CardDescription>Overview of shift schedules</CardDescription>
            </CardHeader>
            <CardContent>
              <Calendar mode="single" selected={date} onSelect={setDate} className="rounded-md" />
            </CardContent>
          </Card>
        </div>

        <Card>
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

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-5">
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
              <Link to="/supervisor/atc-grid">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <CalendarIcon className="h-6 w-6" />
                  ATC Operations
                </Button>
              </Link>
              <Link to="/roster">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <CalendarIcon className="h-6 w-6" />
                  Daily Roster
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
