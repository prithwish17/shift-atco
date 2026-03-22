import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Activity, CheckCircle, Settings, FileText, AlertCircle, RefreshCw, CalendarDays, Clock, Terminal, ClipboardList, Trash2, UserCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useFetchSchedule } from "@/hooks/useEmployeeSchedules";
import { supabase } from "@/integrations/supabase/client";
import { useLeaveRefresh, useLeaveApiUrl } from "@/hooks/useLeaveData";
import { useFetchLeaveData } from "@/hooks/useLeaveRecords";
import { useElApiUrl, useSyncElData } from "@/hooks/useElData";
import { useTeamCodeApiUrl, useSyncTeamCode } from "@/hooks/useTeamCodeSync";
import { useEmployeeDataApiUrl, useHideMissingEmployeesBoard, useMissingEmployees, useMissingEmployeesHidden, useSyncEmployeeData } from "@/hooks/useEmployeeDataSync";
import { useUsers } from "@/hooks/useUsers";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";

interface LogEntry {
  id: string | number;
  timestamp: string;
  status: "pending" | "success" | "error";
  message: string;
  durationMs?: number;
  triggeredBy?: string;
  isLocal?: boolean; // true = from current button click, false = from DB
}

export default function AdminDashboard() {
  const { users, isLoading, approveUser, isApproving } = useUsers();
  const fetchSchedule = useFetchSchedule();
  const { data: leaveApiUrl } = useLeaveApiUrl(); // Removed `= ""` default as per instruction
  const { data: elApiUrl } = useElApiUrl();
  const { data: teamCodeApiUrl } = useTeamCodeApiUrl();
  const fetchLeaveData = useFetchLeaveData(); // Removed duplicate declaration
  const syncElData = useSyncElData();
  const syncTeamCode = useSyncTeamCode();
  const { data: employeeDataApiUrl } = useEmployeeDataApiUrl();
  const syncEmployeeData = useSyncEmployeeData();
  const { data: missingEmployees = [] } = useMissingEmployees();
  const { data: missingEmployeesHidden = false } = useMissingEmployeesHidden();
  const hideMissingEmployeesBoard = useHideMissingEmployeesBoard();
  const [apiLogs, setApiLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<{ count: number; cutoff: string } | null>(null);

  const { data: scheduleHealth, isLoading: scheduleHealthLoading, refetch: refetchScheduleHealth } = useQuery({
    queryKey: scheduleKeys.health(),
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      const { data: latestRows, error: latestError, count } = await supabase
        .from("employee_schedules" as any)
        .select("updated_at", { count: "exact" })
        .order("updated_at", { ascending: false })
        .limit(1);

      if (latestError) throw latestError;

      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: updatedLast24h, error: last24hError } = await supabase
        .from("employee_schedules" as any)
        .select("id", { count: "exact", head: true })
        .gte("updated_at", since24h);

      if (last24hError) throw last24hError;

      const latestUpdatedAt = latestRows?.[0]?.updated_at as string | undefined;
      return {
        totalRows: count || 0,
        latestUpdatedAt: latestUpdatedAt || null,
        updatedLast24h: updatedLast24h || 0,
      };
    },
  });

  const pendingApprovals = users?.filter(u => !u.approved) || [];
  const totalUsers = users?.length || 0;
  const recentUsers = users?.slice(0, 5) || [];
  const lastSyncDate = scheduleHealth?.latestUpdatedAt ? new Date(scheduleHealth.latestUpdatedAt) : null;
  const minutesSinceLastSync = lastSyncDate ? Math.round((Date.now() - lastSyncDate.getTime()) / 60000) : null;
  const autoFetchHealthy = minutesSinceLastSync !== null && minutesSinceLastSync <= 26 * 60;

  const addLog = useCallback((entry: LogEntry) => {
    setApiLogs(prev => [entry, ...prev].slice(0, 50));
  }, []);

  const updateLog = useCallback((id: string | number, updates: Partial<LogEntry>) => {
    setApiLogs(prev => prev.map(e => (e.id === id ? { ...e, ...updates } : e)));
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("api_call_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25);

      if (error) {
        console.error("Failed to load api_call_logs:", error);
      } else if (data) {
        const dbLogs: LogEntry[] = data.map((row: any) => ({
          id: row.id,
          timestamp: new Date(row.created_at).toLocaleTimeString("en-IN", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }) + " " + new Date(row.created_at).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          }),
          status: row.status as "success" | "error",
          message: `${row.method} /api/functions/${row.endpoint} — ${row.message}`,
          durationMs: row.duration_ms,
          triggeredBy: row.triggered_by,
          isLocal: false,
        }));
        setApiLogs(dbLogs);
      }
    } catch (e) {
      console.error("Failed to load logs:", e);
    }
    setLogsLoading(false);
  }, []);

  // Load persistent logs from DB on mount
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleFetchSchedule = useCallback(async () => {
    const now = new Date();
    const ts = now.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const localId = `local-${Date.now()}`;

    // Add pending entry at top
    setApiLogs(prev => [{
      id: localId,
      timestamp: ts,
      status: "pending" as const,
      message: "POST /api/functions/fetch-schedule — calling…",
      triggeredBy: "manual",
      isLocal: true,
    }, ...prev].slice(0, 50));

    const start = performance.now();
    try {
      const result = await fetchSchedule.mutateAsync() as any;
      const ms = Math.round(performance.now() - start);
      // Update the pending entry
      setApiLogs(prev => prev.map(e =>
        e.id === localId
          ? { ...e, status: "success" as const, message: `POST /api/functions/fetch-schedule — 200 OK (${ms}ms) employees=${result?.employees ?? "-"} rows=${result?.rows ?? "-"}`, durationMs: ms }
          : e
      ));
      refetchScheduleHealth();
      // Refresh DB logs after a short delay (edge function writes the log async)
      setTimeout(() => {
        void loadLogs();
      }, 2000);
    } catch (err: any) {
      const ms = Math.round(performance.now() - start);
      setApiLogs(prev => prev.map(e =>
        e.id === localId
          ? { ...e, status: "error" as const, message: `POST /api/functions/fetch-schedule — ${err.message || "Failed"} (${ms}ms)`, durationMs: ms }
          : e
      ));
    }
  }, [fetchSchedule, loadLogs, refetchScheduleHealth]);

  const fetchLeave = useLeaveRefresh();

  const handleFetchLeave = useCallback(async () => {
    const now = new Date();
    const ts = now.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const localId = `local-${Date.now()}`;

    // Add pending entry at top
    setApiLogs((prev) => [
      {
        id: localId,
        timestamp: ts,
        status: "pending" as const,
        message: "POST /api/functions/fetch-leave-data — calling…",
        triggeredBy: "manual",
        isLocal: true,
      },
      ...prev,
    ].slice(0, 50));

    const start = performance.now();
    try {
      const result = await fetchLeave.mutateAsync() as any;
      const ms = Math.round(performance.now() - start);

      setApiLogs((prev) => prev.map((e) =>
        e.id === localId
          ? {
            ...e,
            status: "success" as const,
            message: `POST /api/functions/fetch-leave-data — 200 OK (${ms}ms) employees=${result?.employees ?? "-"} records=${result?.records ?? "-"}`,
            durationMs: ms,
          }
          : e
      ));

      // Refresh DB logs after a short delay (edge function writes the log async)
      setTimeout(() => {
        void loadLogs();
      }, 2000);
    } catch (err: any) {
      const ms = Math.round(performance.now() - start);
      setApiLogs((prev) => prev.map((e) =>
        e.id === localId
          ? {
            ...e,
            status: "error" as const,
            message: `POST /api/functions/fetch-leave-data — ${err.message || "Failed"} (${ms}ms)`,
            durationMs: ms,
          }
          : e
      ));
    }
  }, [fetchLeave, loadLogs]);

  const handleFetchEl = useCallback(async () => {
    const now = new Date();
    const ts = now.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const localId = `local-${Date.now()}`;

    setApiLogs((prev) => [
      {
        id: localId,
        timestamp: ts,
        status: "pending" as const,
        message: "POST /api/functions/fetch-el-data — calling…",
        triggeredBy: "manual",
        isLocal: true,
      },
      ...prev,
    ].slice(0, 50));

    const start = performance.now();
    try {
      const result = await syncElData.mutateAsync() as any;
      const ms = Math.round(performance.now() - start);

      setApiLogs((prev) => prev.map((e) =>
        e.id === localId
          ? {
            ...e,
            status: "success" as const,
            message: `POST /api/functions/fetch-el-data — 200 OK (${ms}ms) employees=${result?.employees ?? "-"} details=${result?.details ?? "-"}`,
            durationMs: ms,
          }
          : e
      ));

      setTimeout(() => {
        void loadLogs();
      }, 2000);
    } catch (err: any) {
      const ms = Math.round(performance.now() - start);
      setApiLogs((prev) => prev.map((e) =>
        e.id === localId
          ? {
            ...e,
            status: "error" as const,
            message: `POST /api/functions/fetch-el-data — ${err.message || "Failed"} (${ms}ms)`,
            durationMs: ms,
          }
          : e
      ));
    }
  }, [loadLogs, syncElData]);

  const handleFetchTeamCode = useCallback(async () => {
    const now = new Date();
    const ts = now.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const localId = `local-${Date.now()}`;

    setApiLogs((prev) => [
      {
        id: localId,
        timestamp: ts,
        status: "pending" as const,
        message: "POST /api/functions/fetch-team-code — calling…",
        triggeredBy: "manual",
        isLocal: true,
      },
      ...prev,
    ].slice(0, 50));

    const start = performance.now();
    try {
      const result = await syncTeamCode.mutateAsync() as any;
      const ms = Math.round(performance.now() - start);

      setApiLogs((prev) => prev.map((e) =>
        e.id === localId
          ? {
            ...e,
            status: "success" as const,
            message: `POST /api/functions/fetch-team-code — 200 OK (${ms}ms) total=${result?.total ?? "-"} updated=${result?.updated ?? "-"}`,
            durationMs: ms,
          }
          : e
      ));

      setTimeout(() => {
        void loadLogs();
      }, 2000);
    } catch (err: any) {
      const ms = Math.round(performance.now() - start);
      setApiLogs((prev) => prev.map((e) =>
        e.id === localId
          ? {
            ...e,
            status: "error" as const,
            message: `POST /api/functions/fetch-team-code — ${err.message || "Failed"} (${ms}ms)`,
            durationMs: ms,
          }
          : e
      ));
    }
  }, [loadLogs, syncTeamCode]);

  const handleFetchEmployeeData = useCallback(async () => {
    const now = new Date();
    const ts = now.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const localId = `local-${Date.now()}`;

    setApiLogs((prev) => [
      {
        id: localId,
        timestamp: ts,
        status: "pending" as const,
        message: "POST /api/functions/fetch-employee-data — calling…",
        triggeredBy: "manual",
        isLocal: true,
      },
      ...prev,
    ].slice(0, 50));

    const start = performance.now();
    try {
      const result = await syncEmployeeData.mutateAsync() as any;
      const ms = Math.round(performance.now() - start);

      setApiLogs((prev) => prev.map((e) =>
        e.id === localId
          ? {
            ...e,
            status: "success" as const,
            message: `POST /api/functions/fetch-employee-data — 200 OK (${ms}ms) total=${result?.total ?? "-"} new=${result?.newEmployeesCreated ?? "-"} designation=${result?.designationUpdated ?? "-"} missing=${result?.missingEmployees ?? "-"}`,
            durationMs: ms,
          }
          : e
      ));

      setTimeout(() => {
        void loadLogs();
      }, 2000);
    } catch (err: any) {
      const ms = Math.round(performance.now() - start);
      setApiLogs((prev) => prev.map((e) =>
        e.id === localId
          ? {
            ...e,
            status: "error" as const,
            message: `POST /api/functions/fetch-employee-data — ${err.message || "Failed"} (${ms}ms)`,
            durationMs: ms,
          }
          : e
      ));
    }
  }, [loadLogs, syncEmployeeData]);

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
                Pull employee duty schedules from Google Sheets into the database.
                Auto-runs daily at <strong>19:00 IST</strong>.
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

          {/* Fetch Leave Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-violet-600" />
                Fetch Leave Data
              </CardTitle>
              <CardDescription>
                Import official leave register from Google Sheets into the database.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This calls the <code className="bg-muted px-1 py-0.5 rounded text-xs">fetch-leave-data</code> edge
                function to sync CL, RH, NH, CH, Comp Off, and OPE duty records.
              </p>
              <Button
                onClick={handleFetchLeave}
                disabled={fetchLeave.isPending || !leaveApiUrl}
                className="w-full"
              >
                {fetchLeave.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Fetch Leave Data Now
                  </>
                )}
              </Button>
              {!leaveApiUrl && (
                <p className="text-xs text-amber-600">
                  Leave API URL not configured. Set <code className="bg-muted px-1 py-0.5 rounded text-xs">leave_data_webapp_url</code> in Admin Settings.
                </p>
              )}
              {fetchLeave.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> Leave data fetched successfully
                </p>
              )}
              {fetchLeave.isError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> {(fetchLeave.error as Error)?.message || "Failed to fetch leave data"}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Fetch Earned Leave Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-teal-600" />
                Fetch Earned Leave Data
              </CardTitle>
              <CardDescription>
                Import earned leave (EL) records from the configured webapp URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This calls the <code className="bg-muted px-1 py-0.5 rounded text-xs">fetch-el-data</code> edge
                function to sync EL leave periods.
              </p>
              <Button
                onClick={handleFetchEl}
                disabled={syncElData.isPending || !elApiUrl}
                className="w-full"
              >
                {syncElData.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Fetch EL Data Now
                  </>
                )}
              </Button>
              {syncElData.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> EL data fetched successfully
                </p>
              )}
              {!elApiUrl && (
                <p className="text-xs text-amber-600">
                  EL API URL not configured. Set <code className="bg-muted px-1 py-0.5 rounded text-xs">el_data_webapp_url</code> in Admin Settings.
                </p>
              )}
              {syncElData.isError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> {(syncElData.error as Error)?.message || "Failed to fetch EL data"}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Fetch Team Code Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-orange-600" />
                Fetch Team Code Data
              </CardTitle>
              <CardDescription>
                Import team code (shift group) assignments from the configured webapp URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This calls the <code className="bg-muted px-1 py-0.5 rounded text-xs">fetch-team-code</code> edge
                function to update each employee's current_shift in profiles.
              </p>
              <Button
                onClick={handleFetchTeamCode}
                disabled={syncTeamCode.isPending || !teamCodeApiUrl}
                className="w-full"
              >
                {syncTeamCode.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Fetch Team Codes Now
                  </>
                )}
              </Button>
              {!teamCodeApiUrl && (
                <p className="text-xs text-amber-600">
                  Team Code API URL not configured. Set <code className="bg-muted px-1 py-0.5 rounded text-xs">team_code_webapp_url</code> in Admin Settings.
                </p>
              )}
              {syncTeamCode.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> Team codes synced successfully
                </p>
              )}
              {syncTeamCode.isError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> {(syncTeamCode.error as Error)?.message || "Failed to fetch team codes"}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Fetch Employee Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-indigo-600" />
                Fetch Employee Data
              </CardTitle>
              <CardDescription>
                Sync employee details, ratings, designations, and register new employees from the configured webapp.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This calls the <code className="bg-muted px-1 py-0.5 rounded text-xs">fetch-employee-data</code> edge
                function to update designations, contacts, ratings, and auto-register new employees.
              </p>
              <Button
                onClick={handleFetchEmployeeData}
                disabled={syncEmployeeData.isPending || !employeeDataApiUrl}
                className="w-full"
              >
                {syncEmployeeData.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Syncing…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Fetch Employee Data Now
                  </>
                )}
              </Button>
              {!employeeDataApiUrl && (
                <p className="text-xs text-amber-600">
                  Employee Data API URL not configured. Set <code className="bg-muted px-1 py-0.5 rounded text-xs">employee_data_webapp_url</code> in Admin Settings.
                </p>
              )}
              {syncEmployeeData.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> Employee data synced successfully
                </p>
              )}
              {syncEmployeeData.isError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> {(syncEmployeeData.error as Error)?.message || "Failed to sync employee data"}
                </p>
              )}
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

          {/* API Call Log */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-gray-600" />
                API Call Log
              </CardTitle>
              <CardDescription>
                Persistent log of edge function calls from manual syncs and cron jobs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-950 rounded-lg p-3 max-h-72 overflow-y-auto font-mono text-xs space-y-1.5">
                {logsLoading ? (
                  <p className="text-gray-500 text-center py-4">Loading logs…</p>
                ) : apiLogs.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No API calls yet. Trigger a fetch action or wait for the scheduled sync.</p>
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
                      {log.triggeredBy && (
                        <span className="text-gray-600 shrink-0 ml-auto">
                          [{log.triggeredBy}]
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Automatic Schedule Fetch Status
              <Badge variant={autoFetchHealthy ? "default" : "destructive"}>
                {autoFetchHealthy ? "Healthy" : "Needs Check"}
              </Badge>
            </CardTitle>
            <CardDescription>
              Runtime health view for daily automatic schedule sync
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {scheduleHealthLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <p>
                  Last schedule update:{" "}
                  <span className="font-medium">
                    {lastSyncDate ? lastSyncDate.toLocaleString() : "No schedule records found"}
                  </span>
                </p>
                <p>
                  Rows updated in last 24h:{" "}
                  <span className="font-medium">{scheduleHealth?.updatedLast24h ?? 0}</span>
                </p>
                <p>
                  Total schedule rows:{" "}
                  <span className="font-medium">{scheduleHealth?.totalRows ?? 0}</span>
                </p>
                <p className="text-muted-foreground">
                  Automatic sync is considered healthy when the latest schedule row update is within the last 26 hours.
                </p>
              </>
            )}
            <Button variant="outline" onClick={() => refetchScheduleHealth()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Status
            </Button>
          </CardContent>
        </Card>

        {/* ── Purge Old Roster Data ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" />
              Purge Old Roster Data
            </CardTitle>
            <CardDescription>
              Delete roster entries older than 7 days to keep the database lean.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will permanently delete all rows in the <code className="bg-muted px-1 py-0.5 rounded text-xs">rosters</code> table
              with a date before{" "}
              <strong>
                {new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </strong>.
            </p>
            <Button
              variant="destructive"
              disabled={purging}
              onClick={async () => {
                const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                const cutoffStr = cutoff.toISOString().split("T")[0];
                if (!confirm(`Delete all roster data before ${cutoffStr}? This cannot be undone.`)) return;
                setPurging(true);
                setPurgeResult(null);
                try {
                  const { count, error } = await (supabase as any)
                    .from("rosters")
                    .delete({ count: "exact" })
                    .lt("date", cutoffStr);
                  if (error) throw error;
                  setPurgeResult({ count: count ?? 0, cutoff: cutoffStr });
                } catch (err: any) {
                  setPurgeResult({ count: -1, cutoff: err.message });
                } finally {
                  setPurging(false);
                }
              }}
              className="w-full"
            >
              {purging ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Roster Data Older Than 7 Days
                </>
              )}
            </Button>
            {purgeResult && purgeResult.count >= 0 && (
              <p className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle className="h-4 w-4" /> Deleted {purgeResult.count} rows (before {purgeResult.cutoff})
              </p>
            )}
            {purgeResult && purgeResult.count < 0 && (
              <p className="text-sm text-red-600 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" /> {purgeResult.cutoff}
              </p>
            )}
          </CardContent>
        </Card>

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
