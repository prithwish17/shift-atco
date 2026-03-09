import { useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Activity, CheckCircle, Settings, FileText, AlertCircle, RefreshCw, CalendarDays, Clock, Terminal } from "lucide-react";
import { Link } from "react-router-dom";
import { useUsers } from "@/hooks/useUsers";
import { useFetchSchedule } from "@/hooks/useEmployeeSchedules";

interface LogEntry {
  id: number;
  timestamp: string;
  status: "pending" | "success" | "error";
  message: string;
  durationMs?: number;
}

let logIdCounter = 0;

export default function AdminDashboard() {
  const { users, isLoading, approveUser, isApproving } = useUsers();
  const fetchSchedule = useFetchSchedule();
  const [apiLogs, setApiLogs] = useState<LogEntry[]>([]);

  const pendingApprovals = users?.filter(u => !u.approved) || [];
  const totalUsers = users?.length || 0;
  const recentUsers = users?.slice(0, 5) || [];

  const addLog = useCallback((entry: Omit<LogEntry, "id">) => {
    setApiLogs(prev => [{ ...entry, id: ++logIdCounter }, ...prev].slice(0, 50));
  }, []);

  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => {
    setApiLogs(prev => prev.map(e => (e.id === id ? { ...e, ...updates } : e)));
  }, []);

  const handleFetchSchedule = useCallback(async () => {
    const now = new Date();
    const ts = now.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const thisId = ++logIdCounter;

    addLog({
      timestamp: ts,
      status: "pending",
      message: "POST /api/functions/fetch-schedule — calling…",
    });

    const start = performance.now();
    try {
      await fetchSchedule.mutateAsync();
      const ms = Math.round(performance.now() - start);
      updateLog(thisId, {
        status: "success",
        message: `POST /api/functions/fetch-schedule — 200 OK (${ms}ms)`,
        durationMs: ms,
      });
    } catch (err: any) {
      const ms = Math.round(performance.now() - start);
      updateLog(thisId, {
        status: "error",
        message: `POST /api/functions/fetch-schedule — ${err.message || "Failed"} (${ms}ms)`,
        durationMs: ms,
      });
    }
  }, [fetchSchedule, addLog, updateLog]);

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

        {/* ── Fetch Schedule + API Log ── */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-blue-600" />
                Fetch Schedule
              </CardTitle>
              <CardDescription>
                Pull employee duty schedules from Google Sheets into the database
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This calls the <code className="bg-muted px-1 py-0.5 rounded text-xs">fetch-schedule</code> edge
                function to sync the latest duty roster from the configured Google Sheet.
              </p>
              <Button
                onClick={handleFetchSchedule}
                disabled={fetchSchedule.isPending}
                className="w-full"
              >
                {fetchSchedule.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Fetch Schedule Now
                  </>
                )}
              </Button>
              {fetchSchedule.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> Schedule fetched successfully
                </p>
              )}
              {fetchSchedule.isError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> {(fetchSchedule.error as Error)?.message || "Failed to fetch schedule"}
                </p>
              )}
            </CardContent>
          </Card>

          {/* API Call Log */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-gray-600" />
                API Call Log
              </CardTitle>
              <CardDescription>
                Live log of schedule API calls
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-950 rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs space-y-1.5">
                {apiLogs.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No API calls yet. Click "Fetch Schedule Now" to start.</p>
                ) : (
                  apiLogs.map(log => (
                    <div key={log.id} className="flex items-start gap-2">
                      <span className="text-gray-500 shrink-0">{log.timestamp}</span>
                      {log.status === "pending" && (
                        <span className="text-yellow-400 shrink-0">
                          <Clock className="h-3 w-3 inline mr-0.5 animate-pulse" />
                        </span>
                      )}
                      {log.status === "success" && (
                        <span className="text-green-400 shrink-0">✓</span>
                      )}
                      {log.status === "error" && (
                        <span className="text-red-400 shrink-0">✗</span>
                      )}
                      <span
                        className={
                          log.status === "success" ? "text-green-300"
                            : log.status === "error" ? "text-red-300"
                              : "text-yellow-200"
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
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
