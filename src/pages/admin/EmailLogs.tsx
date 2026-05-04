import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  Search,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Trash2,
  Clock3,
  Power,
  PauseCircle,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { logSupervisorEdit } from "@/lib/supervisorAuditLog";

const EVENT_TYPE_LABELS: Record<string, string> = {
  leave_status: "Leave Status",
  leave_request: "Leave Request",
  duty_exchange: "Duty Exchange",
  duty_change: "Duty Change",
  ope_reminder: "OPE Reminder",
  license_expiry: "License Expiry",
  compoff_expiry: "Comp-Off Expiry",
  compoff_expired: "Comp-Off Expired",
  license_expired: "License Expired",
  general: "General",
};

const PAGE_SIZE = 25;

interface EmailLog {
  id: string;
  queue_id: string | null;
  user_id: string;
  user_name: string;
  email_to: string;
  subject: string;
  event_type: string;
  provider: string;
  provider_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface EmailLogsSummary {
  total: number;
  sent: number;
  failed: number;
  bounced: number;
  by_event_type: Record<string, number>;
}

interface EmailLogsResponse {
  logs: EmailLog[];
  total: number;
  limit: number;
  offset: number;
  summary: EmailLogsSummary;
}

interface QueueEmail {
  id: string;
  user_id: string;
  user_name: string;
  email_to: string;
  subject: string;
  body: string;
  event_type: string;
  priority: number;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
}

interface QueueSummary {
  total: number;
  pending: number;
  processing: number;
  failed: number;
  dead_letter: number;
}

interface QueueEmailResponse {
  logs: QueueEmail[];
  total: number;
  limit: number;
  offset: number;
  summary: QueueSummary;
}

export default function EmailLogs({ portalRole = "admin" }: { portalRole?: "admin" | "supervisor" }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"logs" | "queue">("logs");
  const [logPage, setLogPage] = useState(0);
  const [queuePage, setQueuePage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [queueStatusFilter, setQueueStatusFilter] = useState("all");
  const isAdmin = portalRole === "admin";

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["email-logs", logPage, search, eventTypeFilter, statusFilter],
    queryFn: async () => {
      const body: Record<string, string> = {
        limit: String(PAGE_SIZE),
        offset: String(logPage * PAGE_SIZE),
      };
      if (search) body.search = search;
      if (eventTypeFilter !== "all") body.event_type = eventTypeFilter;
      if (statusFilter !== "all") body.status = statusFilter;

      const { data, error } = await supabase.functions.invoke("email-logs", { body });
      if (error) throw new Error(error.message || "Failed to fetch email logs");
      return data as EmailLogsResponse;
    },
    staleTime: 30_000,
  });

  const {
    data: queueData,
    isLoading: isQueueLoading,
    isError: isQueueError,
    refetch: refetchQueue,
    isFetching: isQueueFetching,
  } = useQuery({
    queryKey: ["email-queue", queuePage, search, eventTypeFilter, queueStatusFilter],
    queryFn: async () => {
      const body: Record<string, string> = {
        view: "queue",
        limit: String(PAGE_SIZE),
        offset: String(queuePage * PAGE_SIZE),
      };
      if (search) body.search = search;
      if (eventTypeFilter !== "all") body.event_type = eventTypeFilter;
      if (queueStatusFilter !== "all") body.status = queueStatusFilter;

      const { data, error } = await supabase.functions.invoke("email-logs", { body });
      if (error) throw new Error(error.message || "Failed to fetch pending email queue");
      return data as QueueEmailResponse;
    },
    staleTime: 30_000,
    enabled: activeTab === "queue",
  });

  // ── Email system toggle (admin-only) ──────────────────────────────────────
  // Read directly from app_settings (RLS allows all authenticated users to SELECT).
  // This avoids needing the edge function to be deployed for the read path.
  const { data: emailSystemStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: ["email-system-status"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("value")
        .eq("key", "email_system_enabled")
        .maybeSingle();
      if (error) throw error;
      // Row missing = feature not yet seeded, treat as enabled
      const enabled = (data as any)?.value !== "false";
      return { enabled };
    },
    enabled: true, // both admin and supervisor can see the status (RLS allows SELECT)
    staleTime: 15_000,
  });

  // Optimistic state so the badge/button flip instantly on click
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(null);

  const toggleEmailSystem = useMutation({
    mutationFn: async (enable: boolean) => {
      const { data, error } = await supabase.functions.invoke("email-logs", {
        body: { action: "set_email_system", enabled: enable },
      });
      if (error) throw new Error(error.message || "Failed to update mail system");
      return data as { enabled: boolean; cancelled_count: number };
    },
    onMutate: (enable) => {
      setOptimisticEnabled(enable);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["email-system-status"] });
      queryClient.invalidateQueries({ queryKey: ["email-queue"] });
      setOptimisticEnabled(null);
      if (result.enabled) {
        toast.success("Mail system resumed. New notifications will be sent.");
      } else {
        toast.success(
          result.cancelled_count > 0
            ? `Mail system paused. ${result.cancelled_count} queued email(s) discarded.`
            : "Mail system paused."
        );
      }
      logSupervisorEdit({
        action: "update",
        table: "app_settings",
        description: result.enabled
          ? "Email system resumed (enabled)"
          : `Email system paused (disabled)${result.cancelled_count > 0 ? ` — ${result.cancelled_count} queued email(s) discarded` : ""}`,
        recordId: "email_system_enabled",
        after: { enabled: result.enabled },
      });
    },
    onError: (error: Error) => {
      setOptimisticEnabled(null);
      toast.error(error.message || "Failed to update mail system");
    },
  });

  // Optimistic value wins while in-flight; fall back to DB value; default true (active)
  const emailEnabledResolved: boolean =
    optimisticEnabled !== null
      ? optimisticEnabled
      : (emailSystemStatus?.enabled ?? true);

  const deleteQueuedEmail = useMutation({
    mutationFn: async (queueId: string) => {
      const { data, error } = await supabase.functions.invoke("email-logs", {
        body: {
          action: "delete_queue",
          queue_id: queueId,
        },
      });

      if (error) throw new Error(error.message || "Failed to delete queued email");
      return data as { deleted: number };
    },
    onSuccess: (_, queueId) => {
      queryClient.invalidateQueries({ queryKey: ["email-queue"] });
      toast.success("Queued email deleted");
      logSupervisorEdit({
        action: "delete",
        table: "email_queue",
        description: `Queued email deleted (queue_id: ${queueId})`,
        recordId: queueId,
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete queued email");
    },
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const summary = data?.summary;
  const queueLogs = queueData?.logs || [];
  const queueTotal = queueData?.total || 0;
  const queueSummary = queueData?.summary;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const queueTotalPages = Math.ceil(queueTotal / PAGE_SIZE);
  const currentPage = activeTab === "logs" ? logPage : queuePage;
  const currentTotalPages = activeTab === "logs" ? totalPages : queueTotalPages;
  const currentIsFetching = activeTab === "logs" ? isFetching : isQueueFetching;

  const handleSearch = () => {
    setSearch(searchInput);
    setLogPage(0);
    setQueuePage(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return (
          <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1">
            <CheckCircle className="size-3" /> Sent
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="size-3" /> Failed
          </Badge>
        );
      case "bounced":
        return (
          <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1">
            <AlertTriangle className="size-3" /> Bounced
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary" className="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 gap-1">
            <Clock3 className="size-3" /> Pending
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="secondary" className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 gap-1">
            <Loader2 className="size-3 animate-spin" /> Processing
          </Badge>
        );
      case "dead_letter":
        return (
          <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 gap-1">
            <AlertTriangle className="size-3" /> Dead Letter
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const providerBadge = (provider: string) => {
    const colors =
      provider === "resend"
        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
        : "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400";
    return (
      <Badge variant="outline" className={colors}>
        {provider}
      </Badge>
    );
  };

  return (
    <DashboardLayout role={portalRole}>
      <div className="space-y-4 p-3 sm:p-4 md:space-y-6 md:p-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
              <Mail className="size-5 sm:size-6" />
              Email Logs
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              View all emails sent by the system
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => (activeTab === "logs" ? refetch() : refetchQueue())}
              disabled={currentIsFetching}
            >
              <RefreshCw className={`size-4 mr-1 ${currentIsFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {/* Status badge — visible to both admin and supervisor */}
            <div className="flex items-center gap-2">
              {isStatusLoading ? (
                <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
                  <Loader2 className="size-3 animate-spin" />
                  <span className="text-xs">Checking…</span>
                </Badge>
              ) : emailEnabledResolved ? (
                <Badge className="gap-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 px-2.5 py-1">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-semibold">Mail Active</span>
                </Badge>
              ) : (
                <Badge className="gap-1.5 bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 px-2.5 py-1">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  <span className="text-xs font-semibold">Mail Paused</span>
                </Badge>
              )}
              {/* Toggle button — admin only */}
              {isAdmin && (
                <Button
                  variant={emailEnabledResolved ? "outline" : "default"}
                  size="sm"
                  disabled={toggleEmailSystem.isPending || isStatusLoading}
                  onClick={() => {
                    if (emailEnabledResolved) {
                      if (!window.confirm("Pause the mail system? Queued emails will be discarded. Password-reset emails are unaffected.")) return;
                    }
                    toggleEmailSystem.mutate(!emailEnabledResolved);
                  }}
                >
                  {toggleEmailSystem.isPending ? (
                    <Loader2 className="size-4 mr-1 animate-spin" />
                  ) : emailEnabledResolved ? (
                    <PauseCircle className="size-4 mr-1" />
                  ) : (
                    <Power className="size-4 mr-1" />
                  )}
                  {emailEnabledResolved ? "Pause" : "Resume"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Mail system status banner — shown to both roles when paused */}
        {!emailEnabledResolved && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            <PauseCircle className="size-5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Mail system is paused</p>
              <p className="text-xs opacity-80">No notification emails will be queued or sent. Click &ldquo;Resume&rdquo; to re-enable. Password-reset emails are unaffected.</p>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "logs" | "queue") }>
          <TabsList className="grid w-full grid-cols-2 md:w-[360px]">
            <TabsTrigger value="logs">Sent Mail Log</TabsTrigger>
            <TabsTrigger value="queue">Pending Mail Queue</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Summary Cards */}
        {activeTab === "logs" && summary && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            <Card>
              <CardContent className="px-3 py-3 md:px-4 md:pt-4 md:pb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Emails</p>
                <p className="mt-1 text-xl font-bold sm:text-2xl">{summary.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-3 py-3 md:px-4 md:pt-4 md:pb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Sent</p>
                <p className="mt-1 text-xl font-bold text-emerald-600 sm:text-2xl">{summary.sent}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-3 py-3 md:px-4 md:pt-4 md:pb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Failed</p>
                <p className="mt-1 text-xl font-bold text-red-600 sm:text-2xl">{summary.failed}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-3 py-3 md:px-4 md:pt-4 md:pb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Bounced</p>
                <p className="mt-1 text-xl font-bold text-amber-600 sm:text-2xl">{summary.bounced}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "queue" && queueSummary && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            <Card>
              <CardContent className="px-3 py-3 md:px-4 md:pt-4 md:pb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Queued</p>
                <p className="mt-1 text-xl font-bold sm:text-2xl">{queueSummary.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-3 py-3 md:px-4 md:pt-4 md:pb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending</p>
                <p className="mt-1 text-xl font-bold text-sky-600 sm:text-2xl">{queueSummary.pending}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-3 py-3 md:px-4 md:pt-4 md:pb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Processing</p>
                <p className="mt-1 text-xl font-bold text-indigo-600 sm:text-2xl">{queueSummary.processing}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-3 py-3 md:px-4 md:pt-4 md:pb-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Failed / Dead</p>
                <p className="mt-1 text-xl font-bold text-red-600 sm:text-2xl">{queueSummary.failed + queueSummary.dead_letter}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="px-3 py-3 md:pt-4 md:pb-4 md:px-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
              <div className="flex flex-1 gap-2">
                <Input
                  placeholder={activeTab === "logs" ? "Search by email or subject..." : "Search by email or employee..."}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="h-9 flex-1 text-sm"
                />
                <Button variant="secondary" size="icon" onClick={handleSearch} className="h-9 w-9 shrink-0">
                  <Search className="size-4" />
                </Button>
              </div>
              <Select
                value={eventTypeFilter}
                onValueChange={(v) => {
                  setEventTypeFilter(v);
                  setLogPage(0);
                  setQueuePage(0);
                }}
              >
                <SelectTrigger className="h-9 w-full sm:w-44">
                  <SelectValue placeholder="Event Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Event Types</SelectItem>
                  {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={activeTab === "logs" ? statusFilter : queueStatusFilter}
                onValueChange={(v) => {
                  if (activeTab === "logs") {
                    setStatusFilter(v);
                    setLogPage(0);
                    return;
                  }
                  setQueueStatusFilter(v);
                  setQueuePage(0);
                }}
              >
                <SelectTrigger className="h-9 w-full sm:w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {activeTab === "logs" ? (
                    <>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="bounced">Bounced</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="dead_letter">Dead Letter</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base">
              {activeTab === "logs"
                ? (total > 0
                  ? `Showing ${logPage * PAGE_SIZE + 1}–${Math.min((logPage + 1) * PAGE_SIZE, total)} of ${total}`
                  : "No emails found")
                : (queueTotal > 0
                  ? `Showing ${queuePage * PAGE_SIZE + 1}–${Math.min((queuePage + 1) * PAGE_SIZE, queueTotal)} of ${queueTotal}`
                  : "No queued emails found")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {activeTab === "logs" && isLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : activeTab === "queue" && isQueueLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : activeTab === "logs" && isError ? (
              <div className="flex items-center justify-center h-48 text-red-500">
                Failed to load email logs. Please try again.
              </div>
            ) : activeTab === "queue" && isQueueError ? (
              <div className="flex items-center justify-center h-48 text-red-500">
                Failed to load pending mail queue. Please try again.
              </div>
            ) : activeTab === "logs" && logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Mail className="size-10 mb-2 opacity-40" />
                <p>No email logs found</p>
              </div>
            ) : activeTab === "queue" && queueLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Mail className="size-10 mb-2 opacity-40" />
                <p>No queued emails found</p>
              </div>
            ) : activeTab === "logs" ? (
              <>
                <div className="space-y-3 p-3 md:hidden">
                  {logs.map((log) => (
                    <div key={log.id} className="rounded-lg border bg-background p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-tight">{log.user_name}</p>
                          <p className="truncate text-xs text-muted-foreground">{log.email_to}</p>
                        </div>
                        <div className="shrink-0">{statusBadge(log.status)}</div>
                      </div>

                      <div className="mt-3 space-y-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Subject</p>
                          <p className="mt-1 text-sm leading-snug">{log.subject}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Type</p>
                            <div className="mt-1">
                              <Badge variant="outline" className="text-[10px]">
                                {EVENT_TYPE_LABELS[log.event_type] || log.event_type}
                              </Badge>
                            </div>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Provider</p>
                            <div className="mt-1">{providerBadge(log.provider)}</div>
                          </div>
                        </div>

                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sent At</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {format(new Date(log.created_at), "dd MMM yyyy, HH:mm")}
                          </p>
                        </div>

                        {log.error_message && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-red-500">Error</p>
                            <p className="mt-1 text-xs leading-snug text-red-500 break-words">
                              {log.error_message}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Date</th>
                      <th className="text-left px-4 py-3 font-medium">Recipient</th>
                      <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Subject</th>
                      <th className="text-left px-4 py-3 font-medium">Type</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Provider</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {format(new Date(log.created_at), "dd MMM yyyy, HH:mm")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{log.user_name}</div>
                          <div className="text-xs text-muted-foreground">{log.email_to}</div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell max-w-xs truncate">
                          {log.subject}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">
                            {EVENT_TYPE_LABELS[log.event_type] || log.event_type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {providerBadge(log.provider)}
                        </td>
                        <td className="px-4 py-3">
                          {statusBadge(log.status)}
                          {log.error_message && (
                            <p className="text-xs text-red-500 mt-1 max-w-xs truncate">
                              {log.error_message}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3 p-3 md:hidden">
                  {queueLogs.map((log) => {
                    const canDelete = log.status !== "processing";

                    return (
                      <div key={log.id} className="rounded-lg border bg-background p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold leading-tight">{log.user_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{log.email_to || "No email on file"}</p>
                          </div>
                          <div className="shrink-0">{statusBadge(log.status)}</div>
                        </div>

                        <div className="mt-3 space-y-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Subject</p>
                            <p className="mt-1 text-sm leading-snug">{log.subject}</p>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Type</p>
                              <div className="mt-1">
                                <Badge variant="outline" className="text-[10px]">
                                  {EVENT_TYPE_LABELS[log.event_type] || log.event_type}
                                </Badge>
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Next Attempt</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {log.next_attempt_at ? format(new Date(log.next_attempt_at), "dd MMM yyyy, HH:mm") : "-"}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Attempts</p>
                              <p className="mt-1 text-sm text-muted-foreground">{log.attempts} / {log.max_attempts}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Queued At</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {format(new Date(log.created_at), "dd MMM yyyy, HH:mm")}
                              </p>
                            </div>
                          </div>

                          {log.error_message && (
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-500">Error</p>
                              <p className="mt-1 text-xs leading-snug text-red-500 break-words">{log.error_message}</p>
                            </div>
                          )}

                          <div className="pt-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={!canDelete || deleteQueuedEmail.isPending}
                              onClick={() => {
                                if (!canDelete) return;
                                if (!window.confirm("Delete this queued email?")) return;
                                deleteQueuedEmail.mutate(log.id);
                              }}
                            >
                              <Trash2 className="mr-1 size-4" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-3 font-medium">Queued At</th>
                        <th className="text-left px-4 py-3 font-medium">Recipient</th>
                        <th className="text-left px-4 py-3 font-medium">Subject</th>
                        <th className="text-left px-4 py-3 font-medium">Type</th>
                        <th className="text-left px-4 py-3 font-medium">Next Attempt</th>
                        <th className="text-left px-4 py-3 font-medium">Status</th>
                        <th className="text-left px-4 py-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueLogs.map((log) => {
                        const canDelete = log.status !== "processing";

                        return (
                          <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                              {format(new Date(log.created_at), "dd MMM yyyy, HH:mm")}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium">{log.user_name}</div>
                              <div className="text-xs text-muted-foreground">{log.email_to || "No email on file"}</div>
                            </td>
                            <td className="px-4 py-3 max-w-xs truncate">{log.subject}</td>
                            <td className="px-4 py-3">
                              <Badge variant="outline" className="text-xs">
                                {EVENT_TYPE_LABELS[log.event_type] || log.event_type}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                              {log.next_attempt_at ? format(new Date(log.next_attempt_at), "dd MMM yyyy, HH:mm") : "-"}
                              <p className="mt-1 text-xs text-muted-foreground">Attempts: {log.attempts} / {log.max_attempts}</p>
                            </td>
                            <td className="px-4 py-3">
                              {statusBadge(log.status)}
                              {log.error_message && (
                                <p className="text-xs text-red-500 mt-1 max-w-xs truncate">{log.error_message}</p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={!canDelete || deleteQueuedEmail.isPending}
                                onClick={() => {
                                  if (!canDelete) return;
                                  if (!window.confirm("Delete this queued email?")) return;
                                  deleteQueuedEmail.mutate(log.id);
                                }}
                              >
                                <Trash2 className="mr-1 size-4" />
                                Delete
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {currentTotalPages > 1 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-center text-sm text-muted-foreground sm:text-left">
              Page {currentPage + 1} of {currentTotalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (activeTab === "logs") {
                    setLogPage((p) => Math.max(0, p - 1));
                    return;
                  }
                  setQueuePage((p) => Math.max(0, p - 1));
                }}
                disabled={currentPage === 0}
                className="flex-1 sm:flex-none"
              >
                <ChevronLeft className="size-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (activeTab === "logs") {
                    setLogPage((p) => Math.min(totalPages - 1, p + 1));
                    return;
                  }
                  setQueuePage((p) => Math.min(queueTotalPages - 1, p + 1));
                }}
                disabled={currentPage >= currentTotalPages - 1}
                className="flex-1 sm:flex-none"
              >
                Next
                <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
