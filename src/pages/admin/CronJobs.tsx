import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import {
    Timer, Play, Loader2, CheckCircle2, XCircle, Clock, ArrowLeft,
    RefreshCw, Settings, Calendar, FileText, ChevronDown, ChevronRight,
    Pencil, X, Save, AlertTriangle, Bell, Database, List, History, Activity,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface SyncJob {
    id: string;
    job_name: string;
    edge_function_name: string;
    cron_schedule: string;
    is_active: boolean;
    last_run_at: string | null;
    last_run_status: string | null;
    payload: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

interface ApiCallLog {
    id: string;
    endpoint: string;
    status: string;
    message: string | null;
    duration_ms: number | null;
    triggered_by: string | null;
    job_name: string | null;
    created_at: string;
}

interface QueueEntry {
    id: string;
    job_name: string;
    edge_function_name: string;
    payload: Record<string, unknown>;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    priority: number;
    queued_at: string;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
    triggered_by: string;
}

interface CronHealth {
    job_name: string;
    edge_function_name: string | null;
    cron_schedule: string | null;
    is_active: boolean | null;
    is_registered: boolean;
    health_status: "healthy" | "missed" | "failed" | "stale" | "disabled" | "not_registered";
    last_run_at: string | null;
    last_run_status: string | null;
    last_queue_status: string | null;
    last_queued_at: string | null;
    last_completed_at: string | null;
    last_error: string | null;
}

/* ── Cron ↔ IST helpers ─────────────────────────────────────────────────────── */

function cronToIST(cron: string): { hour: number; minute: number } | null {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const m = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(h)) return null;
    let istMin = m + 30;
    let istHour = h + 5;
    if (istMin >= 60) { istMin -= 60; istHour += 1; }
    if (istHour >= 24) istHour -= 24;
    return { hour: istHour, minute: istMin };
}

function istToCron(istHour: number, istMinute: number): string {
    let utcMin = istMinute - 30;
    let utcHour = istHour - 5;
    if (utcMin < 0) { utcMin += 60; utcHour -= 1; }
    if (utcHour < 0) utcHour += 24;
    return `${utcMin} ${utcHour} * * *`;
}

function istTimeString(cron: string): string {
    const ist = cronToIST(cron);
    if (!ist) return "—";
    return `${String(ist.hour).padStart(2, "0")}:${String(ist.minute).padStart(2, "0")}`;
}

function parseTimeInput(val: string): { hour: number; minute: number } | null {
    const [h, m] = val.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return { hour: h, minute: m };
}

function healthBadgeVariant(status?: CronHealth["health_status"]): "default" | "secondary" | "destructive" | "outline" {
    if (status === "healthy") return "default";
    if (status === "disabled") return "secondary";
    if (status === "failed" || status === "stale" || status === "not_registered") return "destructive";
    return "outline";
}

function healthLabel(status?: CronHealth["health_status"]): string {
    if (!status) return "unknown";
    return status.replace("_", " ");
}

/* ── API helpers ────────────────────────────────────────────────────────────── */

async function callManageCronJob(params: {
    action: "schedule" | "unschedule" | "reschedule" | "trigger";
    job_name: string;
    cron_schedule?: string;
    edge_function?: string;
    payload?: Record<string, unknown>;
}) {
    // Try direct Supabase edge function invocation first
    try {
        const { data, error } = await supabase.functions.invoke("manage-cron-job", { body: params });
        if (!error) {
            if (data?.error) throw new Error(data.error);
            return data;
        }
        // Fall through to proxy on any invoke error
        console.warn("[manage-cron-job] Direct invoke failed, retrying via proxy:", error?.message);
    } catch (directErr) {
        console.warn("[manage-cron-job] Direct invoke threw, retrying via proxy:", directErr);
    }

    // Fallback: retry via the Vercel /api/functions proxy
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated — please refresh the page and try again");

    const base = getFunctionsProxyBaseUrl();
    const res = await fetch(`${base}/api/functions/manage-cron-job`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(result?.error || `Edge function failed: HTTP ${res.status}`);
    }
    if (result?.error) throw new Error(result.error);
    return result;
}

type DynamicQueryResponse = {
    data: unknown;
    error: unknown;
};

type DynamicQuery = PromiseLike<DynamicQueryResponse> & {
    select: (columns: string) => DynamicQuery;
    order: (column: string, options?: { ascending?: boolean }) => DynamicQuery;
    in: (column: string, values: string[]) => DynamicQuery;
    limit: (count: number) => DynamicQuery;
};

type DynamicSupabase = {
    from: (table: string) => DynamicQuery;
    rpc: (fn: string) => PromiseLike<DynamicQueryResponse>;
};

const dynamicSupabase = supabase as unknown as DynamicSupabase;

/* ── GroupCard ──────────────────────────────────────────────────────────────── */

interface GroupCardProps {
    title: string;
    description: string;
    icon: React.ReactNode;
    colorClass: string;
    jobs: SyncJob[];
    batchIntervalLabel?: string;
    triggeringJob: string | null;
    togglingJob: string | null;
    onTrigger: (job: SyncJob) => void;
    onToggle: (job: SyncJob, enable: boolean) => void;
    onReschedule: (job: SyncJob, newCron: string) => void;
    healthByJob: Map<string, CronHealth>;
}

function GroupCard({
    title, description, icon, colorClass, jobs,
    batchIntervalLabel, triggeringJob, togglingJob,
    onTrigger, onToggle, onReschedule, healthByJob,
}: GroupCardProps) {
    const [open, setOpen] = useState(false);
    const [editingJobId, setEditingJobId] = useState<string | null>(null);
    const [editTime, setEditTime] = useState("10:00");
    const [savingBatch, setSavingBatch] = useState(false);
    const { toast } = useToast();

    const activeCount = jobs.filter((j) => j.is_active).length;
    const lastRun = jobs
        .filter((j) => j.last_run_at)
        .sort((a, b) => new Date(b.last_run_at!).getTime() - new Date(a.last_run_at!).getTime())[0];
    const hasError = jobs.some((j) => j.last_run_status === "error");

    const schedSummary = useMemo(() => {
        const times = jobs
            .filter((j) => j.is_active)
            .map((j) => istTimeString(j.cron_schedule))
            .filter((t) => t !== "—");
        if (times.length === 0) return "No active schedules";
        if (times.length <= 4) return `${times.join(", ")} IST`;
        return `${times[0]} – ${times[times.length - 1]} IST (${times.length} runs)`;
    }, [jobs]);

    async function handleBatchSave() {
        const parsed = parseTimeInput(editTime);
        if (!parsed) return;
        setSavingBatch(true);
        const sorted = [...jobs].sort((a, b) => {
            const ta = cronToIST(a.cron_schedule);
            const tb = cronToIST(b.cron_schedule);
            return (ta ? ta.hour * 60 + ta.minute : 0) - (tb ? tb.hour * 60 + tb.minute : 0);
        });
        let intervalMin = 120;
        if (sorted.length >= 2) {
            const t0 = cronToIST(sorted[0].cron_schedule);
            const t1 = cronToIST(sorted[1].cron_schedule);
            if (t0 && t1) {
                intervalMin = ((t1.hour * 60 + t1.minute) - (t0.hour * 60 + t0.minute) + 1440) % 1440;
            }
        }
        try {
            for (let i = 0; i < sorted.length; i++) {
                const totalMin = parsed.hour * 60 + parsed.minute + i * intervalMin;
                const newHour = Math.floor(totalMin / 60) % 24;
                const newMin = totalMin % 60;
                await callManageCronJob({
                    action: "reschedule",
                    job_name: sorted[i].job_name,
                    cron_schedule: istToCron(newHour, newMin),
                    edge_function: sorted[i].edge_function_name,
                    payload: sorted[i].payload,
                });
            }
            toast({ title: "Schedule Updated", description: `${sorted.length} jobs rescheduled starting ${editTime} IST.` });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            toast({ title: "Batch Reschedule Failed", description: msg, variant: "destructive" });
        } finally {
            setSavingBatch(false);
        }
    }

    const batchPreview = useMemo(() => {
        const parsed = parseTimeInput(editTime);
        if (!parsed || !batchIntervalLabel) return "";
        const intervalMin = batchIntervalLabel === "every 2 hours" ? 120 : 240;
        return Array.from({ length: jobs.length }, (_, i) => {
            const totalMin = parsed.hour * 60 + parsed.minute + i * intervalMin;
            const h = Math.floor(totalMin / 60) % 24;
            const m = totalMin % 60;
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        }).join(", ") + " IST";
    }, [editTime, batchIntervalLabel, jobs.length]);

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <Card className={`border-l-4 ${colorClass}`}>
                <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground flex-shrink-0">{icon}</span>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold">{title}</span>
                                {hasError && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                                <Badge variant={activeCount === jobs.length ? "default" : "secondary"} className="text-xs">
                                    {activeCount}/{jobs.length} active
                                </Badge>
                                <span className="text-xs text-muted-foreground ml-1 hidden sm:inline">{description}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {schedSummary}
                                </span>
                                {lastRun?.last_run_at && (
                                    <span className={lastRun.last_run_status === "error" ? "text-red-500" : ""}>
                                        Last: {formatDistanceToNow(new Date(lastRun.last_run_at), { addSuffix: true })}
                                    </span>
                                )}
                            </div>
                        </div>
                        <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0">
                                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                        </CollapsibleTrigger>
                    </div>
                </CardHeader>

                <CollapsibleContent>
                    <CardContent className="pt-2 pb-4 px-4 space-y-3">
                        {/* Batch time editor */}
                        {batchIntervalLabel && (
                            <div className="flex flex-wrap items-end gap-3 p-3 bg-muted/40 rounded-lg border border-dashed">
                                <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Start time (IST)</Label>
                                    <Input
                                        type="time"
                                        value={editTime}
                                        onChange={(e) => setEditTime(e.target.value)}
                                        className="h-8 w-28 text-sm font-mono"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Interval</Label>
                                    <div className="h-8 px-2 border rounded-md bg-background flex items-center text-sm text-muted-foreground">
                                        {batchIntervalLabel}
                                    </div>
                                </div>
                                <div className="space-y-1 flex-1 min-w-0">
                                    <Label className="text-xs text-muted-foreground">Preview</Label>
                                    <p className="text-xs text-muted-foreground h-8 flex items-center truncate">
                                        → {batchPreview || "—"}
                                    </p>
                                </div>
                                <Button size="sm" className="h-8 gap-1.5" disabled={savingBatch} onClick={handleBatchSave}>
                                    {savingBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                    Apply to All
                                </Button>
                            </div>
                        )}

                        {/* Job rows */}
                        <div className="space-y-1.5">
                            {jobs.map((job) => (
                                <JobRow
                                    key={job.id}
                                    job={job}
                                    health={healthByJob.get(job.job_name)}
                                    isTriggering={triggeringJob === job.job_name}
                                    isToggling={togglingJob === job.job_name}
                                    isEditing={editingJobId === job.id}
                                    editTime={editingJobId === job.id ? editTime : ""}
                                    onEditOpen={() => {
                                        const ist = cronToIST(job.cron_schedule);
                                        setEditTime(ist
                                            ? `${String(ist.hour).padStart(2, "0")}:${String(ist.minute).padStart(2, "0")}`
                                            : "10:00");
                                        setEditingJobId(job.id);
                                    }}
                                    onEditClose={() => setEditingJobId(null)}
                                    onEditTimeChange={setEditTime}
                                    onSaveEdit={() => {
                                        const parsed = parseTimeInput(editTime);
                                        if (!parsed) return;
                                        onReschedule(job, istToCron(parsed.hour, parsed.minute));
                                        setEditingJobId(null);
                                    }}
                                    onTrigger={onTrigger}
                                    onToggle={onToggle}
                                />
                            ))}
                        </div>
                    </CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    );
}

/* ── JobRow ─────────────────────────────────────────────────────────────────── */

interface JobRowProps {
    job: SyncJob;
    isTriggering: boolean;
    isToggling: boolean;
    isEditing: boolean;
    editTime: string;
    onEditOpen: () => void;
    onEditClose: () => void;
    onEditTimeChange: (v: string) => void;
    onSaveEdit: () => void;
    onTrigger: (j: SyncJob) => void;
    onToggle: (j: SyncJob, enable: boolean) => void;
    health?: CronHealth;
}

function JobRow({
    job, isTriggering, isToggling, isEditing, editTime,
    onEditOpen, onEditClose, onEditTimeChange, onSaveEdit, onTrigger, onToggle, health,
}: JobRowProps) {
    const [confirmOff, setConfirmOff] = useState(false);

    return (
        <div className="space-y-1.5">
            <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${
                job.is_active ? "bg-background hover:bg-muted/40" : "opacity-50 bg-muted/20"
            }`}>
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="font-mono text-xs truncate">{job.job_name}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{istTimeString(job.cron_schedule)} IST</span>
                    {job.last_run_status === "success" && <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-shrink-0" />}
                    {job.last_run_status === "error" && <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                    {health && (
                        <Badge variant={healthBadgeVariant(health.health_status)} className="h-4 px-1.5 text-[10px]">
                            {healthLabel(health.health_status)}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onEditOpen} title="Change time">
                        <Pencil className="h-3 w-3" />
                    </Button>
                    {confirmOff ? (
                        <div className="flex items-center gap-1 text-xs text-destructive">
                            <span>Off?</span>
                            <Button variant="ghost" size="sm" className="h-5 px-1 text-destructive"
                                disabled={isToggling}
                                onClick={() => { onToggle(job, false); setConfirmOff(false); }}>
                                {isToggling ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => setConfirmOff(false)}>No</Button>
                        </div>
                    ) : (
                        <Switch
                            checked={job.is_active}
                            disabled={isToggling}
                            onCheckedChange={(v) => v ? onToggle(job, true) : setConfirmOff(true)}
                            className="scale-75"
                        />
                    )}
                    <Button variant="outline" size="sm" className="h-6 text-xs px-2 gap-1"
                        disabled={isTriggering} onClick={() => onTrigger(job)}>
                        {isTriggering ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    </Button>
                </div>
            </div>

            {isEditing && (
                <div className="flex flex-wrap items-center gap-2 ml-4 pl-2 border-l-2 border-primary/30 pb-1">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">New time (IST):</Label>
                    <Input
                        type="time"
                        value={editTime}
                        onChange={(e) => onEditTimeChange(e.target.value)}
                        className="h-7 w-28 text-sm font-mono"
                        autoFocus
                    />
                    {(() => {
                        const p = parseTimeInput(editTime);
                        return p ? (
                            <span className="text-xs text-muted-foreground font-mono">
                                UTC: {istToCron(p.hour, p.minute)}
                            </span>
                        ) : null;
                    })()}
                    <Button size="sm" className="h-7 gap-1" onClick={onSaveEdit}>
                        <Save className="h-3 w-3" /> Save
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEditClose}>
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            )}
        </div>
    );
}

/* ── Main component ─────────────────────────────────────────────────────────── */
export default function CronJobs() {
    const { toast } = useToast();
    const qc = useQueryClient();
    const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
    const [togglingJob, setTogglingJob] = useState<string | null>(null);
    const [logFilter, setLogFilter] = useState("all");

    /* ── Data queries ──────────────────────────────────────────────────────── */

    const { data: jobs = [], isLoading: isJobsLoading } = useQuery({
        queryKey: ["admin", "sync-jobs"],
        queryFn: async () => {
            const { data, error } = await dynamicSupabase
                .from("sync_jobs")
                .select("*")
                .order("job_name");
            if (error) throw error;
            return (data || []) as SyncJob[];
        },
        refetchInterval: 30_000,
    });

    const { data: queue = [], isLoading: isQueueLoading } = useQuery({
        queryKey: ["admin", "cron-queue"],
        queryFn: async () => {
            const { data, error } = await dynamicSupabase
                .from("cron_job_queue")
                .select("*")
                .in("status", ["pending", "running", "failed", "completed"])
                .order("queued_at", { ascending: false })
                .limit(60);
            if (error) throw error;
            return (data || []) as QueueEntry[];
        },
        refetchInterval: 15_000,
    });

    const { data: logs = [], isLoading: isLogsLoading } = useQuery({
        queryKey: ["admin", "api-call-logs"],
        queryFn: async () => {
            const { data, error } = await dynamicSupabase
                .from("api_call_logs")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(100);
            if (error) throw error;
            return (data || []) as ApiCallLog[];
        },
        refetchInterval: 30_000,
    });

    const { data: healthRows = [], isLoading: isHealthLoading } = useQuery({
        queryKey: ["admin", "cron-health"],
        queryFn: async () => {
            const { data, error } = await dynamicSupabase.rpc("get_cron_job_health");
            if (error) throw error;
            return (data || []) as CronHealth[];
        },
        refetchInterval: 30_000,
    });

    const refresh = useCallback(() => {
        qc.invalidateQueries({ queryKey: ["admin", "sync-jobs"] });
        qc.invalidateQueries({ queryKey: ["admin", "cron-queue"] });
        qc.invalidateQueries({ queryKey: ["admin", "api-call-logs"] });
        qc.invalidateQueries({ queryKey: ["admin", "cron-health"] });
    }, [qc]);

    /* ── Job action handlers ───────────────────────────────────────────────── */

    async function handleToggle(job: SyncJob, enable: boolean) {
        setTogglingJob(job.job_name);
        try {
            await callManageCronJob({
                action: enable ? "schedule" : "unschedule",
                job_name: job.job_name,
                cron_schedule: job.cron_schedule,
                edge_function: job.edge_function_name,
                payload: job.payload,
            });
            refresh();
            toast({ title: enable ? "Job Enabled" : "Job Disabled" });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            toast({ title: "Error", description: msg, variant: "destructive" });
        } finally {
            setTogglingJob(null);
        }
    }

    async function handleReschedule(job: SyncJob, newCron: string) {
        try {
            await callManageCronJob({
                action: "reschedule",
                job_name: job.job_name,
                cron_schedule: newCron,
                edge_function: job.edge_function_name,
                payload: job.payload,
            });
            refresh();
            toast({ title: "Schedule Updated", description: `${job.job_name} → ${newCron} UTC` });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            toast({ title: "Reschedule Failed", description: msg, variant: "destructive" });
        }
    }

    async function handleTrigger(job: SyncJob) {
        setTriggeringJob(job.job_name);
        try {
            await callManageCronJob({
                action: "trigger",
                job_name: job.job_name,
                edge_function: job.edge_function_name,
                payload: job.payload,
            });
            toast({ title: "Queued", description: `${job.edge_function_name} was added to the cron queue.` });
            refresh();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            toast({ title: "Trigger Failed", description: msg, variant: "destructive" });
        } finally {
            setTriggeringJob(null);
        }
    }

    /* ── Derived groups ────────────────────────────────────────────────────── */

    const scheduleJobs    = useMemo(() => jobs.filter((j) => j.job_name.startsWith("schedule-sync")), [jobs]);
    const leaveJobs       = useMemo(() => jobs.filter((j) => j.job_name.startsWith("leave-sync")), [jobs]);
    const rosterMorning   = useMemo(() => jobs.filter((j) => j.job_name.startsWith("roster-morning")), [jobs]);
    const rosterAfternoon = useMemo(() => jobs.filter((j) => j.job_name.startsWith("roster-afternoon")), [jobs]);
    const rosterNight     = useMemo(() => jobs.filter((j) => j.job_name.startsWith("roster-night")), [jobs]);
    const workingHoursJobs = useMemo(() => jobs.filter((j) => j.job_name.startsWith("working-hours-cache")), [jobs]);
    const baTestJobs      = useMemo(() => jobs.filter((j) => j.job_name.startsWith("ba-test-fetch")), [jobs]);
    const systemJobs      = useMemo(
        () => jobs.filter((j) =>
            !j.job_name.startsWith("schedule-sync") &&
            !j.job_name.startsWith("leave-sync") &&
            !j.job_name.startsWith("roster-") &&
            !j.job_name.startsWith("working-hours-cache") &&
            !j.job_name.startsWith("ba-test-fetch")
        ),
        [jobs]
    );

    /* ── Stats ─────────────────────────────────────────────────────────────── */

    const totalActive  = jobs.filter((j) => j.is_active).length;
    const pendingQueue = queue.filter((q) => q.status === "pending").length;
    const runningQueue = queue.filter((q) => q.status === "running").length;
    const lastSuccess  = logs.find((l) => l.status === "success");
    const lastError    = logs.find((l) => l.status === "error");
    const healthByJob  = useMemo(() => new Map(healthRows.map((h) => [h.job_name, h])), [healthRows]);
    const unhealthyCount = healthRows.filter((h) =>
        !["healthy", "disabled"].includes(h.health_status)
    ).length;

    const endpointOptions = useMemo(() => Array.from(new Set(logs.map((l) => l.endpoint))).sort(), [logs]);
    const filteredLogs    = useMemo(
        () => logFilter === "all" ? logs : logs.filter((l) => l.endpoint === logFilter),
        [logs, logFilter]
    );

    /* ── Shared group card props ────────────────────────────────────────────── */

    const groupProps = { triggeringJob, togglingJob, onTrigger: handleTrigger, onToggle: handleToggle, onReschedule: handleReschedule, healthByJob };

    return (
        <DashboardLayout role="admin">
            <div className="space-y-5 max-w-4xl">

                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex items-center gap-3">
                        <Link to="/admin">
                            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold flex items-center gap-2">
                                <Timer className="h-6 w-6" /> Cron Jobs
                            </h1>
                            <p className="text-sm text-muted-foreground">Automated data sync &amp; notification jobs</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Link to="/admin/settings">
                            <Button variant="outline" size="sm" className="gap-1.5">
                                <Settings className="h-4 w-4" /> URL Settings
                            </Button>
                        </Link>
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={refresh}>
                            <RefreshCw className="h-4 w-4" /> Refresh
                        </Button>
                    </div>
                </div>

                {/* Summary strip */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {[
                        { label: "Active Jobs",    value: isJobsLoading  ? "…" : `${totalActive}/${jobs.length}`,        icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" /> },
                        {
                            label: "Health",
                            value: isHealthLoading ? "…" : unhealthyCount ? `${unhealthyCount} issue${unhealthyCount === 1 ? "" : "s"}` : "Healthy",
                            icon: unhealthyCount ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
                        },
                        { label: "Queue Pending",  value: isQueueLoading ? "…" : String(pendingQueue + runningQueue),    icon: <List className="h-4 w-4 text-blue-500" /> },
                        { label: "Last Success",   value: isLogsLoading  ? "…" : lastSuccess ? formatDistanceToNow(new Date(lastSuccess.created_at), { addSuffix: true }) : "—",  icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" /> },
                        { label: "Last Error",     value: isLogsLoading  ? "…" : lastError ? formatDistanceToNow(new Date(lastError.created_at), { addSuffix: true }) : "—",      icon: <XCircle className="h-4 w-4 text-red-500" /> },
                    ].map(({ label, value, icon }) => (
                        <Card key={label} className="py-3">
                            <CardContent className="px-4 py-0 flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-xs text-muted-foreground">{label}</p>
                                    <p className="text-lg font-bold leading-tight">{value}</p>
                                </div>
                                {icon}
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Job groups */}
                {isJobsLoading ? (
                    <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
                ) : (
                    <div className="space-y-3">
                        {scheduleJobs.length > 0 && (
                            <GroupCard
                                title="Schedule Sync"
                                description={`Fetches duty schedule from Google Sheets — ${scheduleJobs.length} runs/day`}
                                icon={<Calendar className="h-4 w-4" />}
                                colorClass="border-l-emerald-500"
                                jobs={scheduleJobs}
                                batchIntervalLabel="every 2 hours"
                                {...groupProps}
                            />
                        )}
                        {leaveJobs.length > 0 && (
                            <GroupCard
                                title="Leave Sync"
                                description={`Syncs leave & comp-off from Google Sheets — ${leaveJobs.length} runs/day`}
                                icon={<FileText className="h-4 w-4" />}
                                colorClass="border-l-blue-500"
                                jobs={leaveJobs}
                                batchIntervalLabel="every 4 hours"
                                {...groupProps}
                            />
                        )}

                        {/* Roster groups nested in one card */}
                        {(rosterMorning.length + rosterAfternoon.length + rosterNight.length) > 0 && (
                            <Card className="border-l-4 border-l-violet-500">
                                <CardHeader className="pb-2 pt-4 px-4">
                                    <div className="flex items-center gap-2">
                                        <Database className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-sm font-semibold">Roster Sync</span>
                                        <Badge variant="secondary" className="text-xs">
                                            {rosterMorning.length + rosterAfternoon.length + rosterNight.length} jobs
                                        </Badge>
                                        <p className="text-xs text-muted-foreground hidden sm:block ml-1">
                                            Syncs roster data for all 3 shifts
                                        </p>
                                    </div>
                                </CardHeader>
                                <CardContent className="px-4 pb-4 space-y-2">
                                    {[
                                        { label: "Morning Shift",   jobs: rosterMorning,   colorClass: "border-l-amber-400" },
                                        { label: "Afternoon Shift", jobs: rosterAfternoon, colorClass: "border-l-orange-400" },
                                        { label: "Night Shift",     jobs: rosterNight,     colorClass: "border-l-indigo-400" },
                                    ].map(({ label, jobs: sJobs, colorClass }) => sJobs.length > 0 && (
                                        <GroupCard
                                            key={label}
                                            title={label}
                                            description={`${sJobs.filter(j => j.is_active).length}/${sJobs.length} active`}
                                            icon={<Timer className="h-3.5 w-3.5" />}
                                            colorClass={colorClass}
                                            jobs={sJobs}
                                            {...groupProps}
                                        />
                                    ))}
                                </CardContent>
                            </Card>
                        )}


                        {workingHoursJobs.length > 0 && (
                            <GroupCard
                                title="Working Hours Cache"
                                description={`Pre-computes working hours data — ${workingHoursJobs.length} runs/day`}
                                icon={<Clock className="h-4 w-4" />}
                                colorClass="border-l-cyan-500"
                                jobs={workingHoursJobs}
                                batchIntervalLabel="every 2 hours"
                                {...groupProps}
                            />
                        )}

                        {baTestJobs.length > 0 && (
                            <GroupCard
                                title="BA Test List"
                                description={`Fetches Breath Analyser test list from Google Sheets — ${baTestJobs.length} runs/day at shift change times`}
                                icon={<Activity className="h-4 w-4" />}
                                colorClass="border-l-amber-500"
                                jobs={baTestJobs}
                                batchIntervalLabel="3 shift changes/day"
                                {...groupProps}
                            />
                        )}

                        {systemJobs.length > 0 && (
                            <GroupCard
                                title="Notifications &amp; System"
                                description="Duty change checks, licence/OPE reminders, queue processor"
                                icon={<Bell className="h-4 w-4" />}
                                colorClass="border-l-slate-400"
                                jobs={systemJobs}
                                {...groupProps}
                            />
                        )}
                    </div>
                )}

                {/* Queue + History tabs */}
                <Tabs defaultValue="health">
                    <TabsList className="h-8">
                        <TabsTrigger value="health" className="text-xs gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Health
                            {unhealthyCount > 0 && (
                                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                                    {unhealthyCount}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="queue" className="text-xs gap-1.5">
                            <List className="h-3.5 w-3.5" />
                            Queue
                            {(pendingQueue + runningQueue) > 0 && (
                                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                    {pendingQueue + runningQueue}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="history" className="text-xs gap-1.5">
                            <History className="h-3.5 w-3.5" />
                            Run History
                        </TabsTrigger>
                    </TabsList>

                    {/* Health tab */}
                    <TabsContent value="health" className="mt-3">
                        <Card>
                            <CardHeader className="pb-2 pt-4 px-4">
                                <div>
                                    <p className="text-sm font-semibold">Cron Health</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Checks registration, missed runs, stale queue entries, and recent failures.
                                    </p>
                                </div>
                            </CardHeader>
                            <CardContent className="px-4 pb-4">
                                {isHealthLoading ? (
                                    <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                                ) : healthRows.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-8">No cron diagnostics found.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b text-muted-foreground">
                                                    <th className="text-left py-2 pr-3 font-medium">Job</th>
                                                    <th className="text-left py-2 pr-3 font-medium">Health</th>
                                                    <th className="text-left py-2 pr-3 font-medium">Schedule</th>
                                                    <th className="text-left py-2 pr-3 font-medium">Last Run</th>
                                                    <th className="text-left py-2 font-medium">Last Error</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {healthRows.map((row) => (
                                                    <tr key={row.job_name} className="border-b border-dashed hover:bg-muted/30">
                                                        <td className="py-1.5 pr-3">
                                                            <div className="font-mono">{row.job_name}</div>
                                                            {row.edge_function_name && (
                                                                <div className="text-[10px] text-muted-foreground">{row.edge_function_name}</div>
                                                            )}
                                                        </td>
                                                        <td className="py-1.5 pr-3">
                                                            <Badge variant={healthBadgeVariant(row.health_status)} className="text-[10px]">
                                                                {healthLabel(row.health_status)}
                                                            </Badge>
                                                        </td>
                                                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                                                            {row.cron_schedule ? `${istTimeString(row.cron_schedule)} IST` : "—"}
                                                        </td>
                                                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                                                            {row.last_run_at
                                                                ? formatDistanceToNow(new Date(row.last_run_at), { addSuffix: true })
                                                                : row.last_queued_at
                                                                    ? `queued ${formatDistanceToNow(new Date(row.last_queued_at), { addSuffix: true })}`
                                                                    : "—"}
                                                        </td>
                                                        <td className="py-1.5 text-muted-foreground">
                                                            {row.last_error ? (
                                                                <span className="text-red-500 break-all whitespace-pre-wrap font-mono text-[10px] leading-snug">
                                                                    {row.last_error}
                                                                </span>
                                                            ) : "—"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Queue tab */}
                    <TabsContent value="queue" className="mt-3">
                        <Card>
                            <CardHeader className="pb-2 pt-4 px-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-semibold">Cron Job Queue</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Jobs are enqueued by pg_cron and processed one at a time — no concurrent Google Sheets calls.
                                        </p>
                                    </div>
                                    {runningQueue > 0 && (
                                        <Badge variant="secondary" className="gap-1">
                                            <Loader2 className="h-3 w-3 animate-spin" /> {runningQueue} running
                                        </Badge>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="px-4 pb-4">
                                {isQueueLoading ? (
                                    <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                                ) : queue.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-8">Queue is empty.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b text-muted-foreground">
                                                    <th className="text-left py-2 pr-3 font-medium">Job</th>
                                                    <th className="text-left py-2 pr-3 font-medium">Status</th>
                                                    <th className="text-left py-2 pr-3 font-medium">Queued</th>
                                                    <th className="text-left py-2 font-medium">Duration / Error</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {queue.map((entry) => (
                                                    <tr key={entry.id} className="border-b border-dashed hover:bg-muted/30">
                                                        <td className="py-1.5 pr-3 font-mono">{entry.job_name}</td>
                                                        <td className="py-1.5 pr-3">
                                                            <Badge
                                                                variant={
                                                                    entry.status === "completed" ? "default" :
                                                                    entry.status === "running"   ? "secondary" :
                                                                    entry.status === "failed"    ? "destructive" : "outline"
                                                                }
                                                                className="text-[10px] gap-1"
                                                            >
                                                                {entry.status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                                                                {entry.status}
                                                            </Badge>
                                                        </td>
                                                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                                                            {formatDistanceToNow(new Date(entry.queued_at), { addSuffix: true })}
                                                        </td>
                                                        <td className="py-1.5 text-muted-foreground">
                                                            {entry.error_message
                                                                ? <span className="text-red-500 break-all whitespace-pre-wrap font-mono text-[10px] leading-snug">{entry.error_message}</span>
                                                                : entry.completed_at && entry.started_at
                                                                    ? `${Math.round((new Date(entry.completed_at).getTime() - new Date(entry.started_at).getTime()) / 1000)}s`
                                                                    : "—"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* History tab */}
                    <TabsContent value="history" className="mt-3">
                        <Card>
                            <CardHeader className="pb-2 pt-4 px-4">
                                <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div>
                                        <p className="text-sm font-semibold">Run History</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">Last 100 edge function calls</p>
                                    </div>
                                    <Select value={logFilter} onValueChange={setLogFilter}>
                                        <SelectTrigger className="h-7 w-44 text-xs">
                                            <SelectValue placeholder="Filter by endpoint" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all" className="text-xs">All Endpoints</SelectItem>
                                            {endpointOptions.map((ep) => (
                                                <SelectItem key={ep} value={ep} className="text-xs">
                                                    {ep.replace("/functions/v1/", "")}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </CardHeader>
                            <CardContent className="px-4 pb-4">
                                {isLogsLoading ? (
                                    <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                                ) : filteredLogs.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-8">No logs found.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="border-b text-muted-foreground">
                                                    <th className="text-left py-2 pr-3 font-medium">Time</th>
                                                    <th className="text-left py-2 pr-3 font-medium">Endpoint</th>
                                                    <th className="text-left py-2 pr-3 font-medium">Status</th>
                                                    <th className="text-left py-2 pr-3 font-medium">Duration</th>
                                                    <th className="text-left py-2 font-medium">Message</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredLogs.map((log) => (
                                                    <tr key={log.id} className="border-b border-dashed hover:bg-muted/30">
                                                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                                                            {format(new Date(log.created_at), "dd MMM HH:mm")}
                                                        </td>
                                                        <td className="py-1.5 pr-3">
                                                            <span className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">
                                                                {log.endpoint.replace("/functions/v1/", "")}
                                                            </span>
                                                        </td>
                                                        <td className="py-1.5 pr-3">
                                                            <Badge
                                                                variant={log.status === "success" ? "default" : "destructive"}
                                                                className="text-[10px] h-4"
                                                            >
                                                                {log.status}
                                                            </Badge>
                                                        </td>
                                                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                                                            {log.duration_ms != null ? `${(log.duration_ms / 1000).toFixed(1)}s` : "—"}
                                                        </td>
                                                        <td className="py-1.5 text-muted-foreground break-all whitespace-pre-wrap">
                                                            {log.message || "—"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
