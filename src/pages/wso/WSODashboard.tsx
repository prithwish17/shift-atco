import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, FileText, Shield, Clock, Calendar } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLeaves } from "@/hooks/useLeaves";
import { useDutyExchanges } from "@/hooks/useDutyExchanges";
import { useAttendance } from "@/hooks/useAttendance";
import { useBaTests } from "@/hooks/useBaTests";
import { format } from "date-fns";

export default function WSODashboard() {
  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const today = format(new Date(), "yyyy-MM-dd");

  const { data: allLeaves } = useLeaves();
  const { data: allExchanges } = useDutyExchanges();
  const { attendance } = useAttendance(today);
  const { data: baTests } = useBaTests();

  const shiftLabel = profile?.current_shift ? `${profile.current_shift.toUpperCase()} Shift` : "—";
  const pendingLeaves = allLeaves?.filter(l => l.status === "pending_wso") || [];
  const pendingExchanges = allExchanges?.filter(e => e.status === "pending_wso") || [];
  const pendingCount = pendingLeaves.length + pendingExchanges.length;
  const onDutyCount = attendance?.filter(a => a.status === "present").length || 0;
  const latestBaTest = baTests?.[0];

  const positions = ["RDR", "APP", "PLR", "ADC", "ALPHA", "OCC"];

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
          <StatCard
            title="On Duty Today"
            value={onDutyCount}
            icon={Users}
            description={`${shiftLabel} employees`}
          />
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
            value="—"
            icon={Calendar}
            description="Check roster page"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Today's Duty Positions</CardTitle>
              <CardDescription>
                {shiftLabel} - Current assignments
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {positions.map((position) => (
                  <div key={position} className="flex items-center justify-between border-b pb-2 last:border-0">
                    <span className="font-medium font-mono">{position}</span>
                    <Badge variant="outline">—</Badge>
                  </div>
                ))}
              </div>
              <Link to="/wso/roster">
                <Button variant="outline" className="w-full mt-4">
                  View Full Roster
                </Button>
              </Link>
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
                {pendingLeaves.slice(0, 3).map((leave) => (
                  <div key={leave.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div>
                      <p className="font-medium">{(leave as any).user?.full_name || "Unknown"}</p>
                      <p className="text-sm text-muted-foreground">
                        Leave: {leave.leave_type.toUpperCase()} - {leave.start_date}
                      </p>
                    </div>
                    <Link to="/supervisor/leaves">
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
                    <Link to="/supervisor/duty-exchange">
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
                  ATC Duty Grid
                </Button>
              </Link>
              <Link to="/wso/requests">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <FileText className="h-6 w-6" />
                  Approve Requests
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
