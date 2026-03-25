import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useFetchSchedule } from "@/hooks/useEmployeeSchedules";
import {
  Users,
  FileText,
  Calendar as CalendarIcon,
  ClipboardList,
  Clock,
  Search,
  Loader2,
  Sun,
  Sunrise,
  Moon,
  Briefcase,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Workflow,
  DatabaseZap,
  UserCheck,
  Radar,
  RefreshCcw,
  ChevronRight,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { useDutyExchanges } from "@/hooks/useDutyExchanges";
import { useAttendance } from "@/hooks/useAttendance";
import { format, differenceInCalendarDays, parseISO } from "date-fns";
import { useAllLeaveRequests, type LeaveRequest } from "@/hooks/useLeaveRequests";
import { getLeaveTypeLabel } from "@/lib/leaveConstants";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLeaveApiUrl, useLeaveRefresh } from "@/hooks/useLeaveData";
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from "@/lib/scheduleQueryConfig";
import { getAttendanceShiftTokens } from "@/lib/teamDutyRotation";

const DUTY_CYCLE: Array<"M" | "A" | "N" | "NO" | "CO"> = ["M", "A", "N", "NO", "CO"];
const TODAY_TEAM_DUTY_BASE: Record<string, "M" | "A" | "N" | "NO" | "CO"> = {
  A: "N",
  B: "A",
  C: "M",
  D: "CO",
  E: "NO",
};
const DUTY_ROTATION_ANCHOR_DATE_IST = "2026-03-09";
const OFF_DUTY_CODES = new Set(["NO", "CO", "SAT", "SUN", "CH", "NH", "NA", "SL", "GO", "TR", "LEAVE"]);
const OPE_CODES = new Set([
  "M+A", "NO+N", "SAT+NO", "SUN+N", "SUN+M", "SUN+A", "SUN+NO",
  "SAT+N", "CO+N", "CO+A", "CO+M", "A+M",
]);

type DutyExchangeDashboard = {
  id: string;
  status: string;
  reason: string | null;
  duty_date: string | null;
  requesting_user?: { full_name: string; employee_id: string } | null;
  exchange_partner?: { full_name: string; employee_id: string } | null;
};

type TodayScheduleRow = {
  employee_code: string;
  duty_code: string | null;
};

type LatestRegistrationRecord = {
  employee_id: string;
  full_name: string;
  designation: string | null;
  created_at: string;
};

type EmployeeSuggestionRow = {
  employee_code: string;
  full_name: string;
  current_shift: string;
};

function getISTDateKey(now = new Date()): string {
  const istDate = new Date(now.getTime() + 330 * 60 * 1000);
  const y = istDate.getUTCFullYear();
  const m = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(istDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function msUntilNextISTMidnight(now = new Date()): number {
  const istNow = new Date(now.getTime() + 330 * 60 * 1000);
  const nextIstMidnightUtcMs =
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + 1, 0, 0, 0) -
    330 * 60 * 1000;
  return Math.max(1000, nextIstMidnightUtcMs - now.getTime());
}

function getISTDayOfWeek(istDateKey: string): number {
  return parseISO(istDateKey).getDay();
}

function getTeamDutyForISTDate(teamKey: string, istDateKey: string) {
  const base = TODAY_TEAM_DUTY_BASE[teamKey] || "M";
  const baseIndex = DUTY_CYCLE.indexOf(base);
  const offset = differenceInCalendarDays(parseISO(istDateKey), parseISO(DUTY_ROTATION_ANCHOR_DATE_IST));
  const idx = (baseIndex + (offset % DUTY_CYCLE.length) + DUTY_CYCLE.length) % DUTY_CYCLE.length;
  return DUTY_CYCLE[idx];
}

function isOnDuty(dutyCode: string | null | undefined): boolean {
  if (!dutyCode) return false;
  const tokens = dutyCode.toUpperCase().split("+").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some((t) => !OFF_DUTY_CODES.has(t));
}

function formatLeaveWindow(request: LeaveRequest) {
  const start = format(parseISO(request.start_date), "dd MMM");
  const end = format(parseISO(request.end_date), "dd MMM");
  return request.start_date === request.end_date ? start : `${start} - ${end}`;
}

function ExecutiveMetricCard({
  label,
  value,
  detail,
  icon: Icon,
  toneClass,
  href,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Users;
  toneClass: string;
  href?: string;
}) {
  const content = (
    <div className="group relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.4)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-32px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-950/80 sm:p-5">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-slate-300/70 to-transparent dark:via-slate-700/70" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">{value}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{detail}</p>
        </div>
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", toneClass)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {href ? (
        <div className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-slate-600 transition group-hover:text-slate-950 dark:text-slate-300 dark:group-hover:text-white">
          Open panel
          <ArrowRight className="h-3.5 w-3.5" />
        </div>
      ) : null}
    </div>
  );

  return href ? <Link to={href}>{content}</Link> : content;
}

function QuickActionTile({
  title,
  description,
  icon: Icon,
  href,
  onClick,
  loading,
  disabled,
  tintClass,
}: {
  title: string;
  description: string;
  icon: typeof Users;
  href?: string;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  tintClass: string;
}) {
  const body = (
    <div className="group flex h-full min-h-[152px] flex-col justify-between rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.3)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-32px_rgba(15,23,42,0.38)] dark:border-slate-800 dark:bg-slate-950/80 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", tintClass)}>
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
        </div>
        <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-300" />
      </div>
      <div className="mt-8">
        <h3 className="text-base font-semibold tracking-tight text-slate-950 dark:text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );

  if (href) {
    return <Link to={href}>{body}</Link>;
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className="h-full w-full text-left disabled:cursor-not-allowed disabled:opacity-70">
      {body}
    </button>
  );
}

export default function SupervisorDashboard() {
  const [istToday, setIstToday] = useState(() => getISTDateKey());
  const [employeeSearch, setEmployeeSearch] = useState("");
  const today = istToday;
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: allLeaveRequests = [], isLoading: leavesLoading } = useAllLeaveRequests();
  const { data: allExchanges = [], isLoading: exchangesLoading } = useDutyExchanges();
  const { attendance = [], isLoading: attendanceLoading } = useAttendance(today);
  const fetchSchedule = useFetchSchedule();
  const { data: leaveApiUrl = "" } = useLeaveApiUrl();
  const fetchLeave = useLeaveRefresh();

  const { data: todaySchedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: scheduleKeys.today(today),
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_schedules" as never)
        .select("employee_code, duty_code")
        .eq("duty_date", today);
      if (error) throw error;
      return (data || []) as unknown as TodayScheduleRow[];
    },
  });

  const { data: latestRegistration } = useQuery({
    queryKey: ["profiles", "latest-registration"],
    ...SCHEDULE_QUERY_OPTIONS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("employee_id, full_name, designation, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as LatestRegistrationRecord | null;
    },
  });

  const onDutyCount = useMemo(
    () => todaySchedules.filter((schedule) => isOnDuty(schedule.duty_code)).length,
    [todaySchedules],
  );

  const opeCount = useMemo(
    () => todaySchedules.filter((schedule) => schedule.duty_code && OPE_CODES.has(schedule.duty_code.toUpperCase().trim())).length,
    [todaySchedules],
  );

  const shiftCounts = useMemo(() => {
    const counts: Record<string, number> = { M: 0, A: 0, N: 0, NO: 0, CO: 0 };
    todaySchedules.forEach((schedule) => {
      if (!schedule.duty_code) return;
      schedule.duty_code.toUpperCase().split("+").map((token) => token.trim()).forEach((token) => {
        if (token in counts) counts[token] += 1;
      });
    });
    return counts;
  }, [todaySchedules]);

  const generalCount = useMemo(
    () => todaySchedules.filter((schedule) => getAttendanceShiftTokens(schedule.duty_code).includes("G")).length,
    [todaySchedules],
  );

  const trimmedEmployeeSearch = employeeSearch.trim();

  const {
    data: employeeSuggestions = [],
    isLoading: employeeSuggestionsLoading,
  } = useQuery({
    queryKey: ["supervisor-employee-search", trimmedEmployeeSearch],
    enabled: trimmedEmployeeSearch.length >= 1,
    queryFn: async () => {
      const search = trimmedEmployeeSearch;
      const results = new Map<string, EmployeeSuggestionRow>();

      const [{ data: profileRows, error: profileError }, { data: scheduleRows, error: scheduleError }] = await Promise.all([
        supabase
          .from("profiles")
          .select("employee_id, full_name, current_shift")
          .or(`full_name.ilike.%${search}%,employee_id.ilike.%${search}%`)
          .limit(12),
        supabase
          .from("employee_schedules" as never)
          .select("employee_code, employee_name")
          .or(`employee_name.ilike.%${search}%,employee_code.ilike.%${search}%`)
          .limit(60),
      ]);

      if (!profileError) {
        (profileRows || []).forEach((row) => {
          if (!row.employee_id || results.has(row.employee_id)) return;
          results.set(row.employee_id, {
            employee_code: row.employee_id,
            full_name: row.full_name || row.employee_id,
            current_shift: row.current_shift || "",
          });
        });
      }

      if (!scheduleError) {
        ((scheduleRows || []) as Array<{ employee_code: string; employee_name: string | null }>).forEach((row) => {
          if (!row.employee_code || results.has(row.employee_code)) return;
          results.set(row.employee_code, {
            employee_code: row.employee_code,
            full_name: row.employee_name || row.employee_code,
            current_shift: "",
          });
        });
      }

      const query = search.toLowerCase();
      return Array.from(results.values())
        .sort((left, right) => {
          const leftName = (left.full_name || "").toLowerCase();
          const rightName = (right.full_name || "").toLowerCase();
          const leftCode = left.employee_code.toLowerCase();
          const rightCode = right.employee_code.toLowerCase();
          const leftStarts = leftName.startsWith(query) || leftCode.startsWith(query);
          const rightStarts = rightName.startsWith(query) || rightCode.startsWith(query);
          if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
          return leftName.localeCompare(rightName) || leftCode.localeCompare(rightCode);
        })
        .slice(0, 6);
    },
  });

  useEffect(() => {
    const timer = setTimeout(() => setIstToday(getISTDateKey()), msUntilNextISTMidnight());
    return () => clearTimeout(timer);
  }, [istToday]);

  const shiftTeams: Record<string, string[]> = { M: [], A: [], N: [], NO: [], CO: [] };
  Object.keys(TODAY_TEAM_DUTY_BASE).forEach((teamKey) => {
    const duty = getTeamDutyForISTDate(teamKey, istToday);
    shiftTeams[duty].push(`Team ${teamKey}`);
  });

  const dayOfWeek = getISTDayOfWeek(istToday);
  const isGeneralOnDuty = dayOfWeek >= 1 && dayOfWeek <= 5;

  const pendingLeaves = allLeaveRequests.filter(
    (request) => request.status === "Pending Supervisor" || request.status === "Pending WSO",
  );
  const pendingExchanges = (allExchanges as DutyExchangeDashboard[]).filter(
    (exchange) => exchange.status === "pending_supervisor",
  );

  const isLoading = leavesLoading || exchangesLoading || schedulesLoading;
  const attendanceLogged = attendance.length;
  const attendanceCoverage = onDutyCount > 0 ? Math.min(100, Math.round((attendanceLogged / onDutyCount) * 100)) : 0;
  const backlogCount = pendingLeaves.length + pendingExchanges.length;
  const urgentLeaveCount = pendingLeaves.filter((request) => request.status === "Pending Supervisor").length;
  const queueToneClass =
    backlogCount > 8
      ? "text-rose-600 dark:text-rose-400"
      : backlogCount > 0
        ? "text-amber-600 dark:text-amber-400"
        : "text-emerald-600 dark:text-emerald-400";

  const shiftPanels = [
    { key: "M", label: "Morning", icon: Sunrise, accent: "from-amber-400/25 to-orange-300/10", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", iconClass: "text-amber-600 dark:text-amber-300" },
    { key: "A", label: "Afternoon", icon: Sun, accent: "from-orange-400/25 to-rose-300/10", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", iconClass: "text-orange-600 dark:text-orange-300" },
    { key: "N", label: "Night", icon: Moon, accent: "from-indigo-400/25 to-sky-300/10", chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300", iconClass: "text-indigo-600 dark:text-indigo-300" },
    { key: "NO", label: "Night Off", icon: Moon, accent: "from-slate-300/30 to-slate-200/10", chip: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", iconClass: "text-slate-500 dark:text-slate-300" },
    { key: "CO", label: "Clear Off", icon: Clock, accent: "from-zinc-300/30 to-slate-200/10", chip: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", iconClass: "text-zinc-500 dark:text-zinc-300" },
  ] as const;

  const handleFetchSchedule = () => {
    fetchSchedule.mutate(undefined, {
      onSuccess: (result: unknown) => {
        const payload = result as { rows?: number; employees?: number } | undefined;
        toast({
          title: "Schedule synced",
          description: `Fetched ${payload?.rows ?? 0} duty rows for ${payload?.employees ?? 0} employees.`,
        });
      },
      onError: (error: unknown) => {
        const payload = error as { message?: string } | undefined;
        toast({
          title: "Schedule sync failed",
          description: payload?.message || "Unable to fetch schedule right now.",
          variant: "destructive",
        });
      },
    });
  };

  const handleFetchLeave = () => {
    if (!leaveApiUrl) {
      toast({
        title: "Leave API not configured",
        description: "Set leave_webapp_url in Admin Settings first.",
        variant: "destructive",
      });
      return;
    }

    fetchLeave.mutate(undefined, {
      onSuccess: (result: unknown) => {
        const payload = result as { count?: number; data?: unknown[] } | undefined;
        toast({
          title: "Leave data fetched",
          description: `Fetched ${payload?.count ?? payload?.data?.length ?? 0} leave records.`,
        });
      },
      onError: (error: unknown) => {
        const payload = error as { message?: string } | undefined;
        toast({
          title: "Leave fetch failed",
          description: payload?.message || "Unable to fetch leave data right now.",
          variant: "destructive",
        });
      },
    });
  };

  const handleEmployeeOpen = (employeeCode: string) => {
    setEmployeeSearch("");
    navigate(`/supervisor/employees/${encodeURIComponent(employeeCode)}`);
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6 lg:space-y-8">
        <section className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.22),transparent_32%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_28%),linear-gradient(135deg,#f8fbff_0%,#edf5ff_38%,#f5f9f6_100%)] p-5 shadow-[0_28px_80px_-42px_rgba(15,23,42,0.42)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_24%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.94)_40%,rgba(2,44,34,0.92)_100%)] sm:p-7 xl:p-8">
          <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.22),transparent)] xl:block dark:bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.06),transparent)]" />
          <div className="relative grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full border border-white/60 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Supervisor Command Center
                </Badge>
                <Badge variant="outline" className="rounded-full border-slate-300/70 bg-white/60 text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                  {format(parseISO(istToday), "EEEE, dd MMMM yyyy")}
                </Badge>
              </div>

              <div className="max-w-3xl">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-4xl xl:text-[3.2rem] xl:leading-[1.05]">
                  Run daily airside operations with the clarity of a premium HR platform.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">
                  Review approvals, monitor duty coverage, track attendance capture, and keep schedule sync tightly under control from one polished operational overview.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] border border-white/70 bg-white/75 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Queue Pressure</p>
                  <p className={cn("mt-2 text-2xl font-semibold tracking-tight", queueToneClass)}>{backlogCount}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{urgentLeaveCount} awaiting supervisor decision</p>
                </div>
                <div className="rounded-[22px] border border-white/70 bg-white/75 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Attendance Capture</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{attendanceCoverage}%</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{attendanceLogged} records against {onDutyCount} on duty</p>
                </div>
                <div className="rounded-[22px] border border-white/70 bg-white/75 p-4 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Latest Registration</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{latestRegistration?.employee_id || "—"}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {latestRegistration
                      ? `${latestRegistration.full_name} · ${format(parseISO(latestRegistration.created_at), "dd MMM yyyy")}`
                      : "No recent registration found"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-5 shadow-[0_22px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/70 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Operations Brief</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">Today at a glance</h2>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                  <Radar className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/70">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-white">Leave API</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{leaveApiUrl ? "Connected and ready to refresh" : "Admin setup required"}</p>
                  </div>
                  <Badge className={cn("rounded-full", leaveApiUrl ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300")}>
                    {leaveApiUrl ? "Connected" : "Blocked"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/70">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-white">Attendance Feed</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{attendanceLoading ? "Refreshing live records" : `${attendanceLogged} records logged today`}</p>
                  </div>
                  <Badge className="rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                    {attendanceLoading ? "Refreshing" : "Live"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/70">
                  <div>
                    <p className="text-sm font-medium text-slate-950 dark:text-white">Duty Coverage</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{opeCount} OPE assignments and {generalCount} general-shift staff</p>
                  </div>
                  <Badge className="rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                    Active
                  </Badge>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Button onClick={handleFetchSchedule} disabled={fetchSchedule.isPending} className="h-11 rounded-xl bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
                  {fetchSchedule.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                  Sync Schedule
                </Button>
                <Button onClick={handleFetchLeave} disabled={fetchLeave.isPending} variant="outline" className="h-11 rounded-xl border-slate-300 bg-white/80 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
                  {fetchLeave.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DatabaseZap className="mr-2 h-4 w-4" />}
                  Refresh Leave
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ExecutiveMetricCard
            label="On Duty Today"
            value={isLoading ? "..." : onDutyCount}
            detail="Employees currently rostered on active duty"
            icon={Users}
            toneClass="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
            href="/supervisor/attendance"
          />
          <ExecutiveMetricCard
            label="Pending Leaves"
            value={isLoading ? "..." : pendingLeaves.length}
            detail={`${pendingLeaves.filter((request) => request.status === "Pending WSO").length} still at WSO stage`}
            icon={FileText}
            toneClass="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            href="/supervisor/leaves"
          />
          <ExecutiveMetricCard
            label="Duty Exchanges"
            value={isLoading ? "..." : pendingExchanges.length}
            detail="Waiting for final supervisor approval"
            icon={Workflow}
            toneClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            href="/supervisor/duty-exchange"
          />
          <ExecutiveMetricCard
            label="OPE Assignments"
            value={isLoading ? "..." : opeCount}
            detail="Compound duty codes detected for today"
            icon={ClipboardList}
            toneClass="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            href="/supervisor/ope-assignments"
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <Card className="h-full overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.4)] dark:border-slate-800 dark:bg-slate-950/85">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#fff8eb_0%,#fffdf7_42%,#f7fbff_100%)] pb-5 dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(120,53,15,0.2)_0%,rgba(15,23,42,0.96)_40%,rgba(15,23,42,0.96)_100%)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl text-slate-950 dark:text-white sm:text-2xl">Pending Leave Requests</CardTitle>
                  <CardDescription className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Final approvals and WSO escalations waiting in the supervisor queue.
                  </CardDescription>
                </div>
                <Badge className="w-fit rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                  {pendingLeaves.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="space-y-3">
                {pendingLeaves.slice(0, 4).map((request) => (
                  <div key={request.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{request.employee_name || "Unknown"}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {getLeaveTypeLabel(request.leave_type)} · {formatLeaveWindow(request)} · {request.total_days} day{request.total_days > 1 ? "s" : ""}
                        </p>
                      </div>
                      <Badge variant={request.status === "Pending WSO" ? "outline" : "secondary"} className="shrink-0 rounded-full text-[11px]">
                        {request.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {pendingLeaves.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-amber-200 bg-white/70 px-4 py-8 text-center text-sm text-slate-500 dark:border-amber-900/40 dark:bg-slate-950/60 dark:text-slate-400">
                    No leave requests are waiting right now.
                  </div>
                ) : null}
              </div>
              <Link to="/supervisor/leaves" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                Open leave approvals
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>

          <Card className="h-full overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.4)] dark:border-slate-800 dark:bg-slate-950/85">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#ecfdf5_0%,#f8fffc_42%,#f7fbff_100%)] pb-5 dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(4,120,87,0.18)_0%,rgba(15,23,42,0.96)_40%,rgba(15,23,42,0.96)_100%)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl text-slate-950 dark:text-white sm:text-2xl">Duty Exchange Approvals</CardTitle>
                  <CardDescription className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    Requests approved by WSO and queued for final supervisor review.
                  </CardDescription>
                </div>
                <Badge className="w-fit rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                  {pendingExchanges.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="space-y-3">
                {pendingExchanges.slice(0, 4).map((exchange) => (
                  <div key={exchange.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                    <p className="text-sm font-semibold text-slate-950 dark:text-white">
                      {exchange.requesting_user?.full_name || "Unknown"} ↔ {exchange.exchange_partner?.full_name || "Unknown"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {exchange.duty_date ? format(parseISO(exchange.duty_date), "dd MMM yyyy") : "Date not available"} · {exchange.reason || "No reason provided"}
                    </p>
                  </div>
                ))}
                {pendingExchanges.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-emerald-200 bg-white/70 px-4 py-8 text-center text-sm text-slate-500 dark:border-emerald-900/40 dark:bg-slate-950/60 dark:text-slate-400">
                    No duty exchange requests need approval.
                  </div>
                ) : null}
              </div>
              <Link to="/supervisor/duty-exchange" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                Open exchange queue
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>

          <Card className="h-full overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.4)] dark:border-slate-800 dark:bg-slate-950/85">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#eff8ff_0%,#f8fbff_52%,#f8fafc_100%)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(14,116,144,0.16)_0%,rgba(15,23,42,0.97)_52%,rgba(15,23,42,0.97)_100%)]">
              <CardTitle className="text-xl text-slate-950 dark:text-white sm:text-2xl">Duty Architecture</CardTitle>
              <CardDescription className="text-sm text-slate-500 dark:text-slate-400">
                Team rotation, staff volume, and general-shift presence for {format(parseISO(istToday), "dd MMM yyyy")}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 sm:p-6">
              {shiftPanels.map(({ key, label, icon: ShiftIcon, accent, chip, iconClass }) => (
                <Link
                  key={key}
                  to={`/supervisor/attendance?shift=${encodeURIComponent(key)}&date=${encodeURIComponent(today)}`}
                  className={cn(
                    "group block rounded-[22px] border border-slate-200/80 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#f8fafc_100%)] p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/80",
                    `bg-[radial-gradient(circle_at_top_right,var(--tw-gradient-stops))] ${accent}`,
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/85 shadow-sm dark:bg-slate-900">
                        <ShiftIcon className={cn("h-5 w-5", iconClass)} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-950 dark:text-white">{label}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {shiftTeams[key]?.length > 0 ? shiftTeams[key].join(", ") : "No teams allocated"}
                        </p>
                      </div>
                    </div>
                    <Badge className={cn("shrink-0 rounded-full px-2.5 py-1", chip)}>{isLoading ? "..." : shiftCounts[key] || 0}</Badge>
                  </div>
                </Link>
              ))}

              <div className={cn(
                "rounded-[22px] border p-4",
                isGeneralOnDuty
                  ? "border-teal-200 bg-teal-50/70 dark:border-teal-900/40 dark:bg-teal-950/20"
                  : "border-slate-200 bg-slate-50/70 opacity-75 dark:border-slate-800 dark:bg-slate-950/50",
              )}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/85 shadow-sm dark:bg-slate-900">
                      <Briefcase className={cn("h-5 w-5", isGeneralOnDuty ? "text-teal-600 dark:text-teal-300" : "text-slate-400 dark:text-slate-500")} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-950 dark:text-white">General Shift</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        Team G · {isGeneralOnDuty ? "Operational window is open today" : "Off-duty day for the general team"}
                      </p>
                    </div>
                  </div>
                  <Badge className="rounded-full bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    {isLoading ? "..." : generalCount}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <Card className="h-full overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.36)] dark:border-slate-800 dark:bg-slate-950/85">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_40%,#eff6ff_100%)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(30,41,59,0.88)_0%,rgba(15,23,42,0.98)_100%)]">
              <CardTitle className="flex items-center gap-2 text-xl text-slate-950 dark:text-white sm:text-2xl">
                <Search className="h-5 w-5 text-sky-600 dark:text-sky-300" />
                Employee Command Search
              </CardTitle>
              <CardDescription className="text-sm text-slate-500 dark:text-slate-400">
                Search by employee name or registration number and open one complete operational profile.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                <Input
                  placeholder="Search employee name or registration number..."
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && employeeSuggestions[0]?.employee_code) {
                      event.preventDefault();
                      handleEmployeeOpen(employeeSuggestions[0].employee_code);
                    }
                  }}
                  className="h-12 rounded-2xl border-slate-200 bg-white text-sm shadow-none dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div className="mt-4">
                {trimmedEmployeeSearch.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-5 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                    Start typing a name or registration number. Suggestions will appear instantly and open the full employee page.
                  </div>
                ) : employeeSuggestionsLoading ? (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-5 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                    Searching employees...
                  </div>
                ) : employeeSuggestions.length > 0 ? (
                  <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                    {employeeSuggestions.map((employee) => (
                      <button
                        key={employee.employee_code}
                        type="button"
                        onClick={() => handleEmployeeOpen(employee.employee_code)}
                        className="w-full rounded-[22px] border border-slate-200/80 bg-white p-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/80 dark:hover:border-sky-900/40"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{employee.full_name || employee.employee_code}</p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {employee.employee_code} {employee.current_shift ? `· ${String(employee.current_shift).toUpperCase()} shift` : "· Shift not assigned"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {employee.current_shift ? (
                              <Badge variant="outline" className="rounded-full text-[11px]">
                                {String(employee.current_shift).toUpperCase()}
                              </Badge>
                            ) : null}
                            <Badge className="rounded-full bg-slate-950 text-[11px] text-white dark:bg-white dark:text-slate-950">
                              Open profile
                            </Badge>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-5 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                    No employee suggestions matched this search.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="h-full overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.36)] dark:border-slate-800 dark:bg-slate-950/85">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#f0fdf4_0%,#ffffff_55%,#f8fafc_100%)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(16,185,129,0.12)_0%,rgba(15,23,42,0.98)_60%,rgba(15,23,42,0.98)_100%)]">
              <CardTitle className="flex items-center gap-2 text-xl text-slate-950 dark:text-white">
                <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                Latest Registration Number
              </CardTitle>
              <CardDescription className="text-sm text-slate-500 dark:text-slate-400">
                Highlight the newest registered employee record directly from the profile ledger.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              {latestRegistration ? (
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-emerald-200/80 bg-emerald-50/70 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Registration Number</p>
                        <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">{latestRegistration.employee_id}</p>
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                          Added on {format(parseISO(latestRegistration.created_at), "dd MMM yyyy")}
                        </p>
                      </div>
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm dark:bg-slate-900 dark:text-emerald-300">
                        <UserCheck className="h-5 w-5" />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <p className="text-sm font-semibold text-slate-950 dark:text-white">{latestRegistration.full_name}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {latestRegistration.designation || "Designation not recorded"}
                    </p>
                  </div>

                  <Link to={`/supervisor/employees/${encodeURIComponent(latestRegistration.employee_id)}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white">
                    Open employee record
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <div className="rounded-[24px] border border-dashed border-emerald-300 bg-emerald-50/70 px-5 py-10 text-center dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <UserCheck className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-300" />
                  <p className="mt-4 text-sm font-semibold text-slate-950 dark:text-white">No registration record found</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The dashboard could not find a profile entry with a recent registration timestamp.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="h-full overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.36)] dark:border-slate-800 dark:bg-slate-950/85">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_48%,#eef2ff_100%)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.12)_0%,rgba(15,23,42,0.98)_58%,rgba(15,23,42,0.98)_100%)]">
              <CardTitle className="flex items-center gap-2 text-xl text-slate-950 dark:text-white">
                <DatabaseZap className="h-5 w-5 text-violet-600 dark:text-violet-300" />
                Sync Center
              </CardTitle>
              <CardDescription className="text-sm text-slate-500 dark:text-slate-400">
                Refresh critical data feeds without leaving the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950 dark:text-white">Schedule Feed</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Pull the latest duty rows for supervisors and WSO workflows.</p>
                  </div>
                  <Badge className="rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">Core</Badge>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950 dark:text-white">Leave Feed</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{leaveApiUrl ? "External leave API is configured." : "Leave API URL still needs admin configuration."}</p>
                  </div>
                  <Badge className={cn("rounded-full", leaveApiUrl ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300")}>
                    {leaveApiUrl ? "Ready" : "Needs Setup"}
                  </Badge>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button onClick={handleFetchSchedule} disabled={fetchSchedule.isPending} className="h-11 rounded-xl bg-slate-950 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200">
                  {fetchSchedule.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                  Fetch Schedule
                </Button>
                <Button onClick={handleFetchLeave} disabled={fetchLeave.isPending} variant="outline" className="h-11 rounded-xl">
                  {fetchLeave.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DatabaseZap className="mr-2 h-4 w-4" />}
                  Fetch Leave
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Execution Layer</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">Quick Actions</h2>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Shortcuts for the workflows supervisors use most often.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <QuickActionTile
              title="Attendance Board"
              description="Open the attendance surface and capture today’s operational presence."
              icon={ClipboardList}
              href="/supervisor/attendance"
              tintClass="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
            />
            <QuickActionTile
              title="Leave Decisions"
              description="Review leave requests with the latest queue already summarized above."
              icon={FileText}
              href="/supervisor/leaves"
              tintClass="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            />
            <QuickActionTile
              title="Employee Directory"
              description="Jump into employee records, roster context, and master-data management."
              icon={Users}
              href="/supervisor/employees"
              tintClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            />
            <QuickActionTile
              title="Duty Management"
              description="Adjust roster data and oversee the duty-management workspace."
              icon={CalendarIcon}
              href="/supervisor/duty-management"
              tintClass="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            />
            <QuickActionTile
              title="Shift Roster Data"
              description="Inspect roster records and verify structural duty coverage."
              icon={CalendarIcon}
              href="/supervisor/roster"
              tintClass="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
            />
            <QuickActionTile
              title="OPE Assignments"
              description="Review extra-duty allocations and move directly into assignment oversight."
              icon={Radar}
              href="/supervisor/ope-assignments"
              tintClass="bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300"
            />
            <QuickActionTile
              title="Sync Schedule"
              description="Refresh the latest schedule payload into the dashboard data model."
              icon={RefreshCcw}
              onClick={handleFetchSchedule}
              loading={fetchSchedule.isPending}
              disabled={fetchSchedule.isPending}
              tintClass="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
            <QuickActionTile
              title="Refresh Leave Feed"
              description="Pull leave records from the configured external leave service."
              icon={DatabaseZap}
              onClick={handleFetchLeave}
              loading={fetchLeave.isPending}
              disabled={fetchLeave.isPending}
              tintClass="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
            />
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
