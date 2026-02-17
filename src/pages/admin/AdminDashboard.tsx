import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Activity, CheckCircle, Settings, FileText, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useUsers } from "@/hooks/useUsers";

export default function AdminDashboard() {
  const { users, isLoading, approveUser, isApproving } = useUsers();

  const pendingApprovals = users?.filter(u => !u.approved) || [];
  const totalUsers = users?.length || 0;
  const recentUsers = users?.slice(0, 5) || [];

  if (isLoading) {
    return (
      <DashboardLayout role="admin">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
            <p className="text-muted-foreground">Welcome back, Administrator</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, Administrator</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Users"
            value={totalUsers}
            icon={Users}
            description="Active users in system"
          />
          <StatCard
            title="Active Shifts"
            value="6"
            icon={Activity}
            description="General + A-E"
          />
          <StatCard
            title="Pending Approvals"
            value={pendingApprovals.length}
            icon={AlertCircle}
            description="Registration requests"
          />
          <StatCard
            title="System Status"
            value="Operational"
            icon={CheckCircle}
            description="All systems running"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Pending Approvals
                <Badge variant="secondary">{pendingApprovals.length}</Badge>
              </CardTitle>
              <CardDescription>
                Review and approve user registrations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {pendingApprovals.map((approval) => (
                  <div key={approval.id} className="flex items-center justify-between border-b pb-3 last:border-0">
                    <div>
                      <p className="font-medium">{approval.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {approval.role || "employee"} - {approval.employee_id}
                      </p>
                    </div>
                    <div className="space-x-2">
                      <Button size="sm" onClick={() => approveUser(approval.id)} disabled={isApproving}>
                        Approve
                      </Button>
                    </div>
                  </div>
                ))}
                {pendingApprovals.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No pending approvals
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Registrations</CardTitle>
              <CardDescription>
                Latest users in the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentUsers.map((user) => (
                  <div key={user.id} className="border-b pb-3 last:border-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">{user.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.employee_id} · {user.role || "employee"}
                        </p>
                      </div>
                      <Badge variant={user.approved ? "default" : "secondary"}>
                        {user.approved ? "Active" : "Pending"}
                      </Badge>
                    </div>
                  </div>
                ))}
                {recentUsers.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No users registered yet
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Common administrative tasks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <Link to="/admin/users">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Users className="h-6 w-6" />
                  User Management
                </Button>
              </Link>
              <Link to="/admin/settings">
                <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                  <Settings className="h-6 w-6" />
                  System Settings
                </Button>
              </Link>
              <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                <FileText className="h-6 w-6" />
                Generate Reports
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
