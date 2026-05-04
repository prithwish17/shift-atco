import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Activity, CheckCircle, Settings, FileText, AlertCircle, RefreshCw, CalendarDays, Clock, Terminal, ClipboardList, Trash2, UserCheck, GraduationCap, Languages, Stethoscope, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { useFetchSchedule } from "@/hooks/useEmployeeSchedules";
import { supabase } from "@/integrations/supabase/client";
import { useLeaveRefresh, useLeaveApiUrl } from "@/hooks/useLeaveData";
import { useElApiUrl, useSyncElData } from "@/hooks/useElData";
import { useTeamCodeApiUrl, useSyncTeamCode } from "@/hooks/useTeamCodeSync";
import { useEmployeeDataApiUrl, useHideMissingEmployeesBoard, useMissingEmployees, useMissingEmployeesHidden, useSyncEmployeeData } from "@/hooks/useEmployeeDataSync";
import { useUsers } from "@/hooks/useUsers";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";

interface LogEntry {
  id: string | number;
  timestamp: string;
  status: "pending" | "success" | "error";
  message: string;
  durationMs?: number;
  triggeredBy?: string;
  isLocal?: boolean; // true = from current button click, false = from DB
}

const ADMIN_SYNC_SETTING_KEYS = [
  "training_data_webapp_url",
  "elpa_data_webapp_url",
  "medical_data_webapp_url",
  "rating_data_webapp_url",
] as const;

type AdminSyncSettingKey = typeof ADMIN_SYNC_SETTING_KEYS[number];
type AdminSyncSettingsMap = Partial<Record<AdminSyncSettingKey, string>>;

async function getCurrentOrRefreshedSession(forceRefresh = false) {
  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      return data.session;
    }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session;
}

function isUnauthorizedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return normalized.includes("unauthorized") || normalized.includes("401");
}

async function invokeEdgeFunctionViaProxy<T>(functionName: string, body: Record<string, unknown>, forceRefresh = false) {
  const session = await getCurrentOrRefreshedSession(forceRefresh);

  if (!session) {
    throw new Error("Unauthorized");
  }

  const base = getFunctionsProxyBaseUrl();
  const response = await fetch(`${base}/api/functions/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return (await response.json()) as T;
  }

  const contentType = response.headers.get("content-type") || "";
  let message = `Edge function ${functionName} failed: HTTP ${response.status}`;

  if (contentType.includes("application/json")) {
    const errBody = await response.json().catch(() => ({}));
    message = errBody.error || errBody.message || message;
  }

  if (response.status === 401 && !forceRefresh) {
    return invokeEdgeFunctionViaProxy<T>(functionName, body, true);
  }

  throw new Error(message);
}

async function invokeEdgeFunctionWithProxyFallback<T>(functionName: string, body: Record<string, unknown> = {}) {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, { body });
    if (!error) {
      return data as T;
    }

    throw error;
  } catch (error) {
    if (isUnauthorizedError(error)) {
      await getCurrentOrRefreshedSession(true);

      try {
        const { data, error: retryError } = await supabase.functions.invoke(functionName, { body });
        if (!retryError) {
          return data as T;
        }

        throw retryError;
      } catch (retryError) {
        error = retryError;
      }
    }

    return invokeEdgeFunctionViaProxy<T>(functionName, body, isUnauthorizedError(error));
  }
}

function useAdminSyncSettings() {
  return useQuery({
    queryKey: ["admin-sync-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("key, value")
        .in("key", [...ADMIN_SYNC_SETTING_KEYS]);

      if (error) throw error;

      return ((data || []) as Array<{ key: string; value: string | null }>).reduce<AdminSyncSettingsMap>((acc, row) => {
        if (ADMIN_SYNC_SETTING_KEYS.includes(row.key as AdminSyncSettingKey) && row.value) {
          acc[row.key as AdminSyncSettingKey] = row.value;
        }
        return acc;
      }, {});
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useAdminEdgeSync(functionName: string, queryKeys: string[][]) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => invokeEdgeFunctionWithProxyFallback<Record<string, unknown>>(functionName),
    onSuccess: async () => {
      await Promise.all(
        queryKeys.map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
    },
  });
}

export default function AdminDashboard() {
  const { users, isLoading, approveUser, isApproving } = useUsers();
  const fetchSchedule = useFetchSchedule();
  const { data: leaveApiUrl } = useLeaveApiUrl(); // Removed `= ""` default as per instruction
  const { data: elApiUrl } = useElApiUrl();
  const { data: teamCodeApiUrl } = useTeamCodeApiUrl();
  const syncElData = useSyncElData();
  const syncTeamCode = useSyncTeamCode();
  const { data: employeeDataApiUrl } = useEmployeeDataApiUrl();
  const { data: adminSyncSettings = {} } = useAdminSyncSettings();
  const syncEmployeeData = useSyncEmployeeData();
  const syncTrainingData = useAdminEdgeSync("fetch-training-data", [["training-data"]]);
  const syncElpaData = useAdminEdgeSync("fetch-elpa-data", [["elpa-data"]]);
  const syncMedicalData = useAdminEdgeSync("fetch-medical-data", [["medical-sync-data"]]);
  const syncRatingData = useAdminEdgeSync("fetch-rating-data", [["rating-sync-data"]]);
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
  const trainingApiUrl = adminSyncSettings.training_data_webapp_url;
  const elpaApiUrl = adminSyncSettings.elpa_data_webapp_url;
  const medicalApiUrl = adminSyncSettings.medical_data_webapp_url;
  const ratingApiUrl = adminSyncSettings.rating_data_webapp_url;

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

  const handleAdminSync = useCallback(async (
    functionName: string,
    mutation: { mutateAsync: () => Promise<any> },
    successMessage: (result: any, durationMs: number) => string,
  ) => {
    const now = new Date();
    const ts = now.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const localId = `local-${Date.now()}`;

    setApiLogs((prev) => [
      {
        id: localId,
        timestamp: ts,
        status: "pending" as const,
        message: `POST /api/functions/${functionName} — calling…`,
        triggeredBy: "manual",
        isLocal: true,
      },
      ...prev,
    ].slice(0, 50));

    const start = performance.now();
    try {
      const result = await mutation.mutateAsync();
      const ms = Math.round(performance.now() - start);

      setApiLogs((prev) => prev.map((entry) =>
        entry.id === localId
          ? {
            ...entry,
            status: "success" as const,
            message: successMessage(result, ms),
            durationMs: ms,
          }
          : entry,
      ));

      setTimeout(() => {
        void loadLogs();
      }, 2000);
    } catch (err: any) {
      const ms = Math.round(performance.now() - start);
      setApiLogs((prev) => prev.map((entry) =>
        entry.id === localId
          ? {
            ...entry,
            status: "error" as const,
            message: `POST /api/functions/${functionName} — ${err.message || "Failed"} (${ms}ms)`,
            durationMs: ms,
          }
          : entry,
      ));
    }
  }, [loadLogs]);

  const handleFetchTraining = useCallback(async () => {
    await handleAdminSync(
      "fetch-training-data",
      syncTrainingData,
      (result, ms) => `POST /api/functions/fetch-training-data — 200 OK (${ms}ms) records=${result?.records ?? "-"} upserted=${result?.upserted ?? "-"}`,
    );
  }, [handleAdminSync, syncTrainingData]);

  const handleFetchElpa = useCallback(async () => {
    await handleAdminSync(
      "fetch-elpa-data",
      syncElpaData,
      (result, ms) => `POST /api/functions/fetch-elpa-data — 200 OK (${ms}ms) records=${result?.records ?? "-"} upserted=${result?.upserted ?? "-"}`,
    );
  }, [handleAdminSync, syncElpaData]);

  const handleFetchMedical = useCallback(async () => {
    await handleAdminSync(
      "fetch-medical-data",
      syncMedicalData,
      (result, ms) => `POST /api/functions/fetch-medical-data — 200 OK (${ms}ms) records=${result?.records ?? "-"} upserted=${result?.upserted ?? "-"}`,
    );
  }, [handleAdminSync, syncMedicalData]);

  const handleFetchRating = useCallback(async () => {
    await handleAdminSync(
      "fetch-rating-data",
      syncRatingData,
      (result, ms) => `POST /api/functions/fetch-rating-data — 200 OK (${ms}ms) records=${result?.records ?? "-"} upserted=${result?.upserted ?? "-"}`,
    );
  }, [handleAdminSync, syncRatingData]);

  if (isLoading) {
    return (
      <DashboardLayout role="admin">
        <div className="max-w-full space-y-4 overflow-hidden sm:space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin Dashboard</h1>
            <p className="text-sm text-muted-foreground sm:text-base">Welcome back, Administrator</p>
          </div>
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="admin">
        <div className="max-w-full space-y-4 overflow-hidden sm:space-y-6 [&_button]:min-w-0 [&_button]:whitespace-normal [&_code]:break-all [&_code]:whitespace-normal">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground sm:text-base">Welcome back, Administrator</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
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
        <div className="grid min-w-0 gap-3 sm:gap-4 lg:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <CalendarDays className="h-5 w-5 shrink-0 text-blue-600" />
                Fetch Schedule
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Pull employee duty schedules from Google Sheets into the database.
                Auto-runs daily at <strong>19:00 IST</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
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
          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <ClipboardList className="h-5 w-5 shrink-0 text-violet-600" />
                Fetch Leave Data
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Import official leave register from Google Sheets into the database.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
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
          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <ClipboardList className="h-5 w-5 shrink-0 text-teal-600" />
                Fetch Earned Leave Data
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Import earned leave (EL) records from the configured webapp URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
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
          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <Users className="h-5 w-5 shrink-0 text-orange-600" />
                Fetch Team Code Data
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Import team code (shift group) assignments from the configured webapp URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
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
          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <UserCheck className="h-5 w-5 shrink-0 text-indigo-600" />
                Fetch Employee Data
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Sync employee details, ratings, designations, and register new employees from the configured webapp.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
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

          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <GraduationCap className="h-5 w-5 shrink-0 text-sky-600" />
                Fetch Training Data
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Import training, OJTI, examiner, and validity records into the training table.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
              <p className="text-sm text-muted-foreground">
                This calls the <code className="bg-muted px-1 py-0.5 rounded text-xs">fetch-training-data</code> edge
                function and upserts the latest training records into <code className="bg-muted px-1 py-0.5 rounded text-xs">employee_training_records</code>.
              </p>
              <Button
                onClick={handleFetchTraining}
                disabled={syncTrainingData.isPending}
                className="w-full"
              >
                {syncTrainingData.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Fetch Training Data Now
                  </>
                )}
              </Button>
              {trainingApiUrl ? (
                <p className="text-xs text-muted-foreground break-all">
                  Source URL: {trainingApiUrl}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Using the built-in default training source because no custom URL is set.
                </p>
              )}
              {syncTrainingData.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> Training data synced successfully
                </p>
              )}
              {syncTrainingData.isError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> {(syncTrainingData.error as Error)?.message || "Failed to fetch training data"}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <Languages className="h-5 w-5 shrink-0 text-violet-600" />
                Fetch ELPA Data
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Import ELPA level and validity data into the admin database.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
              <p className="text-sm text-muted-foreground">
                This calls the <code className="bg-muted px-1 py-0.5 rounded text-xs">fetch-elpa-data</code> edge
                function and updates ELPA fields in <code className="bg-muted px-1 py-0.5 rounded text-xs">employee_training_records</code>.
              </p>
              <Button
                onClick={handleFetchElpa}
                disabled={syncElpaData.isPending || !elpaApiUrl}
                className="w-full"
              >
                {syncElpaData.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Fetch ELPA Data Now
                  </>
                )}
              </Button>
              {!elpaApiUrl && (
                <p className="text-xs text-amber-600">
                  ELPA API URL not configured. Set <code className="bg-muted px-1 py-0.5 rounded text-xs">elpa_data_webapp_url</code> in Admin Settings.
                </p>
              )}
              {syncElpaData.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> ELPA data synced successfully
                </p>
              )}
              {syncElpaData.isError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> {(syncElpaData.error as Error)?.message || "Failed to fetch ELPA data"}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <Stethoscope className="h-5 w-5 shrink-0 text-emerald-600" />
                Fetch Medical Data
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Import medical validity records and last medical dates into the admin database.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
              <p className="text-sm text-muted-foreground">
                This calls the <code className="bg-muted px-1 py-0.5 rounded text-xs">fetch-medical-data</code> edge
                function and updates medical fields in <code className="bg-muted px-1 py-0.5 rounded text-xs">employee_training_records</code>.
              </p>
              <Button
                onClick={handleFetchMedical}
                disabled={syncMedicalData.isPending || !medicalApiUrl}
                className="w-full"
              >
                {syncMedicalData.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Fetch Medical Data Now
                  </>
                )}
              </Button>
              {!medicalApiUrl && (
                <p className="text-xs text-amber-600">
                  Medical API URL not configured. Set <code className="bg-muted px-1 py-0.5 rounded text-xs">medical_data_webapp_url</code> in Admin Settings.
                </p>
              )}
              {syncMedicalData.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> Medical data synced successfully
                </p>
              )}
              {syncMedicalData.isError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> {(syncMedicalData.error as Error)?.message || "Failed to fetch medical data"}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <Shield className="h-5 w-5 shrink-0 text-amber-600" />
                Fetch Rating Data
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Import rating and proficiency records into the centralized admin database.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
              <p className="text-sm text-muted-foreground">
                This calls the <code className="bg-muted px-1 py-0.5 rounded text-xs">fetch-rating-data</code> edge
                function and updates rating fields in <code className="bg-muted px-1 py-0.5 rounded text-xs">employee_training_records</code>.
              </p>
              <Button
                onClick={handleFetchRating}
                disabled={syncRatingData.isPending || !ratingApiUrl}
                className="w-full"
              >
                {syncRatingData.isPending ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Fetch Rating Data Now
                  </>
                )}
              </Button>
              {!ratingApiUrl && (
                <p className="text-xs text-amber-600">
                  Rating API URL not configured. Set <code className="bg-muted px-1 py-0.5 rounded text-xs">rating_data_webapp_url</code> in Admin Settings.
                </p>
              )}
              {syncRatingData.isSuccess && (
                <p className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" /> Rating data synced successfully
                </p>
              )}
              {syncRatingData.isError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" /> {(syncRatingData.error as Error)?.message || "Failed to fetch rating data"}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Missing Employees */}
          {missingEmployees.length > 0 && !missingEmployeesHidden && (
            <Card className="min-w-0">
              <CardHeader className="space-y-1.5 p-4 sm:p-6">
                <CardTitle className="flex flex-col gap-3 text-base sm:flex-row sm:items-center sm:justify-between sm:text-lg">
                  <span className="flex min-w-0 items-center gap-2">
                    <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
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
                <CardDescription className="text-xs sm:text-sm">
                  Employees in the database but not found in the latest employee data sync
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {missingEmployees.map((emp) => (
                    <div key={emp.employee_id} className="min-w-0 border-b pb-2 text-sm last:border-0">
                      <div>
                        <p className="break-words font-medium">{emp.full_name}</p>
                        <p className="break-words text-xs text-muted-foreground">{emp.employee_id}{emp.designation ? ` · ${emp.designation}` : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* API Call Log */}
          <Card className="min-w-0 lg:col-span-2">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
                <Terminal className="h-5 w-5 shrink-0 text-gray-600" />
                API Call Log
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Persistent log of edge function calls from manual syncs and cron jobs
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
              <div className="max-h-72 overflow-y-auto rounded-lg bg-gray-950 p-2.5 font-mono text-[11px] leading-relaxed sm:p-3 sm:text-xs">
                {logsLoading ? (
                  <p className="text-gray-500 text-center py-4">Loading logs…</p>
                ) : apiLogs.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No API calls yet. Trigger a fetch action or wait for the scheduled sync.</p>
                ) : (
                  apiLogs.map(log => (
                    <div key={log.id} className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-b border-gray-800/70 py-1.5 last:border-0">
                      <span className="col-span-2 text-gray-500 sm:col-span-1">{log.timestamp}</span>
                      <div className="col-span-2 flex min-w-0 items-start gap-1.5 sm:col-span-1">
                        {log.status === "pending" && (
                          <span className="shrink-0 text-yellow-400">
                            <Clock className="mr-0.5 inline h-3 w-3 animate-pulse" />
                          </span>
                        )}
                        {log.status === "success" && (
                          <span className="shrink-0 text-green-400">OK</span>
                        )}
                        {log.status === "error" && (
                          <span className="shrink-0 text-red-400">ERR</span>
                        )}
                        <span
                          className={`min-w-0 flex-1 break-words ${
                            log.status === "success" ? "text-green-300"
                              : log.status === "error" ? "text-red-300"
                                : "text-yellow-200"
                          }`}
                        >
                          {log.message}
                        </span>
                        {log.triggeredBy && (
                          <span className="hidden shrink-0 text-gray-600 sm:inline">
                            [{log.triggeredBy}]
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader className="space-y-1.5 p-4 sm:p-6">
            <CardTitle className="flex flex-col gap-2 text-base sm:flex-row sm:items-center sm:justify-between sm:text-lg">
              <span>Automatic Schedule Fetch Status</span>
              <Badge variant={autoFetchHealthy ? "default" : "destructive"}>
                {autoFetchHealthy ? "Healthy" : "Needs Check"}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Runtime health view for daily automatic schedule sync
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4 text-sm sm:px-6 sm:pb-6">
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
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => refetchScheduleHealth()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Status
            </Button>
          </CardContent>
        </Card>

        {/* ── Purge Old Roster Data ── */}
        <Card className="min-w-0">
          <CardHeader className="space-y-1.5 p-4 sm:p-6">
            <CardTitle className="flex min-w-0 items-center gap-2 text-base sm:text-lg">
              <Trash2 className="h-5 w-5 shrink-0 text-red-600" />
              Purge Old Roster Data
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Delete roster entries older than 7 days to keep the database lean.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4 sm:space-y-4 sm:px-6 sm:pb-6">
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

        <div className="grid min-w-0 gap-3 sm:gap-4 lg:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="flex items-center justify-between gap-3 text-base sm:text-lg">
                <span>Pending Approvals</span>
                <Badge variant="secondary">{pendingApprovals.length}</Badge>
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Review and approve user registrations
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
              <div className="space-y-3 sm:space-y-4">
                {pendingApprovals.map((approval) => (
                  <div key={approval.id} className="flex flex-col gap-2 border-b pb-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{approval.full_name}</p>
                      <p className="break-words text-sm text-muted-foreground">
                        {approval.role || "employee"} - {approval.employee_id}
                      </p>
                    </div>
                    <div className="flex sm:justify-end">
                      <Button size="sm" className="w-full sm:w-auto" onClick={() => approveUser(approval.id)} disabled={isApproving}>
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

          <Card className="min-w-0">
            <CardHeader className="space-y-1.5 p-4 sm:p-6">
              <CardTitle className="text-base sm:text-lg">Recent Registrations</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Latest users in the system
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
              <div className="space-y-3 sm:space-y-4">
                {recentUsers.map((user) => (
                  <div key={user.id} className="border-b pb-3 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">{user.full_name}</p>
                        <p className="break-words text-xs text-muted-foreground">
                          {user.employee_id} · {user.role || "employee"}
                        </p>
                      </div>
                      <Badge variant={user.approved ? "default" : "secondary"} className="shrink-0">
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

        <Card className="min-w-0">
          <CardHeader className="space-y-1.5 p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Quick Actions</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Common administrative tasks
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 sm:px-6 sm:pb-6">
            <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
              <Link to="/admin/users">
                <Button variant="outline" className="h-16 w-full gap-2 sm:h-20 sm:flex-col">
                  <Users className="h-5 w-5 sm:h-6 sm:w-6" />
                  User Management
                </Button>
              </Link>
              <Link to="/admin/settings">
                <Button variant="outline" className="h-16 w-full gap-2 sm:h-20 sm:flex-col">
                  <Settings className="h-5 w-5 sm:h-6 sm:w-6" />
                  System Settings
                </Button>
              </Link>
              <Button variant="outline" className="h-16 w-full gap-2 sm:h-20 sm:flex-col">
                <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
                Generate Reports
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
