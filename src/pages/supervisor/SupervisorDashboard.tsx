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
import { useIsMobile } from "@/hooks/use-mobile";
import { useDebounce } from "use-debounce";

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
    <div className="group relative flex h-full min-h-[108px] flex-col justify-between overflow-hidden rounded-[18px] border border-slate-200/80 bg-white/90 p-2.5 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.4)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-32px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-950/80 sm:min-h-[172px] sm:rounded-[24px] sm:p-5">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-slate-300/70 to-transparent dark:via-slate-700/70" />
      <div className="flex items-start justify-between gap-2.5 sm:gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.18em]">{label}</p>
          <p className="mt-1 text-[1.35rem] font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-3 sm:text-3xl">{value}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-sm sm:leading-6">{detail}</p>
        </div>
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-11 sm:w-11 sm:rounded-2xl", toneClass)}>
          <Icon className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
        </div>
      </div>
      {href ? (
        <div className="mt-3 hidden items-center gap-1 text-xs font-medium text-slate-600 transition group-hover:text-slate-950 dark:text-slate-300 dark:group-hover:text-white sm:mt-4 sm:inline-flex">
          Open panel
          <ArrowRight className="h-3.5 w-3.5" />
        </div>
      ) : null}
    </div>
  );

  return href ? <Link to={href} className="block h-full">{content}</Link> : content;
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
    <div className="group flex h-full min-h-[102px] flex-col justify-between rounded-[18px] border border-slate-200/80 bg-white/90 p-3 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.3)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-32px_rgba(15,23,42,0.38)] dark:border-slate-800 dark:bg-slate-950/80 sm:min-h-[152px] sm:rounded-[24px] sm:p-5">
      <div className="flex items-start justify-between gap-2.5 sm:gap-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg sm:h-11 sm:w-11 sm:rounded-2xl", tintClass)}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin sm:h-5 sm:w-5" /> : <Icon className="h-4 w-4 sm:h-5 sm:w-5" />}
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-300 sm:h-4 sm:w-4" />
      </div>
      <div className="mt-4 sm:mt-8">
        <h3 className="text-[13px] font-semibold tracking-tight text-slate-950 dark:text-white sm:text-base">{title}</h3>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:mt-2 sm:line-clamp-none sm:text-sm sm:leading-6">{description}</p>
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
  const [debouncedSearch] = useDebounce(employeeSearch, 300);
  const isMobile = useIsMobile();
  const today = istToday;
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: allLeaveRequests = [], isLoading: leavesLoading } = useAllLeaveRequests();
  const { data: allExchanges = [], isLoading: exchangesLoading } = useDutyExchanges();
  const { attendance = [] } = useAttendance(today);
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

  const trimmedEmployeeSearch = debouncedSearch.trim();

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
          .neq('is_hidden', true)
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
  const queuePreviewCount = isMobile ? 2 : 4;
  const heroDateLabel = format(parseISO(istToday), isMobile ? "EEE, dd MMM yyyy" : "EEEE, dd MMMM yyyy");
  const heroDescription = isMobile
    ? "Manage approvals, coverage, attendance, and roster alignment from one view."
    : "Command ATC operations—manage approvals, ensure controller coverage, track attendance, and maintain precise roster alignment.";
  const leaveQueueTitle = isMobile ? "Leave Queue" : "Pending Leave Requests";
  const leaveQueueDescription = isMobile
    ? "Supervisor leave approvals waiting."
    : "Final approvals and WSO escalations waiting in the supervisor queue.";
  const exchangeQueueTitle = isMobile ? "Exchange Queue" : "Duty Exchange Approvals";
  const exchangeQueueDescription = isMobile
    ? "WSO-approved swaps needing review."
    : "Requests approved by WSO and queued for final supervisor review.";
  const dutyArchitectureTitle = isMobile ? "Duty Plan" : "Duty Architecture";
  const dutyArchitectureDescription = isMobile
    ? `Rotation and coverage for ${format(parseISO(istToday), "dd MMM")}.`
    : `Team rotation, staff volume, and general-shift presence for ${format(parseISO(istToday), "dd MMM yyyy")}.`;
  const employeeSearchTitle = isMobile ? "Employee Search" : "Employee Command Search";
  const employeeSearchDescription = isMobile
    ? "Search staff and open a profile."
    : "Search by employee name or registration number and open one complete operational profile.";
  const latestRegistrationTitle = isMobile ? "Latest Registration" : "Latest Registration Number";
  const latestRegistrationDescription = isMobile
    ? "Newest employee record from the profile ledger."
    : "Highlight the newest registered employee record directly from the profile ledger.";
  const syncCenterTitle = isMobile ? "Sync" : "Sync Center";
  const syncCenterDescription = isMobile
    ? "Refresh critical feeds."
    : "Refresh critical data feeds without leaving the dashboard.";
  const searchPlaceholder = isMobile ? "Search employee or reg no..." : "Search employee name or registration number...";
  const scheduleButtonLabel = isMobile ? "Schedule" : "Fetch Schedule";
  const leaveButtonLabel = isMobile ? "Leave" : "Fetch Leave";
  const openLeavesLabel = isMobile ? "Open leaves" : "Open leave approvals";
  const openExchangesLabel = isMobile ? "Open exchanges" : "Open exchange queue";
  const openEmployeeRecordLabel = isMobile ? "Open record" : "Open employee record";
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
      <div className="space-y-3 sm:space-y-6 lg:space-y-8">
        <section className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.22),transparent_32%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_28%),linear-gradient(135deg,#f8fbff_0%,#edf5ff_38%,#f5f9f6_100%)] p-4 shadow-[0_28px_80px_-42px_rgba(15,23,42,0.42)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_24%),linear-gradient(135deg,rgba(15,23,42,0.98)_0%,rgba(15,23,42,0.94)_40%,rgba(2,44,34,0.92)_100%)] sm:rounded-[28px] sm:p-7 xl:p-8">
          <div className="relative">
            <div className="space-y-4 sm:space-y-6">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <Badge variant="outline" className="rounded-full border-slate-300/70 bg-white/60 px-2.5 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 sm:px-3 sm:py-1 sm:text-xs">
                  {heroDateLabel}
                </Badge>
              </div>

              <div className="max-w-2xl sm:max-w-3xl">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-4xl xl:text-[3.2rem] xl:leading-[1.05]">
                  SQMS Control Panel
                </h1>
                <p className="mt-3 max-w-xl text-xs leading-6 text-slate-600 dark:text-slate-300 sm:mt-4 sm:max-w-2xl sm:text-base sm:leading-7">
                  {heroDescription}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                <div className="rounded-[18px] border border-white/70 bg-white/75 p-3 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 sm:rounded-[22px] sm:p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Queue Pressure</p>
                  <p className={cn("mt-1 text-[1.35rem] font-semibold tracking-tight sm:mt-2 sm:text-2xl", queueToneClass)}>{backlogCount}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-sm sm:leading-5">{urgentLeaveCount} awaiting decision</p>
                </div>
                <div className="rounded-[18px] border border-white/70 bg-white/75 p-3 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 sm:rounded-[22px] sm:p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Attendance Capture</p>
                  <p className="mt-1 text-[1.35rem] font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:text-2xl">{attendanceCoverage}%</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-sm sm:leading-5">{attendanceLogged} of {onDutyCount} logged</p>
                </div>
                <div className="col-span-2 rounded-[18px] border border-white/70 bg-white/75 p-3 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-white/5 sm:col-span-1 sm:rounded-[22px] sm:p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-[11px]">Latest Registration</p>
                  <p className="mt-1 text-[1.35rem] font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:text-2xl">{latestRegistration?.employee_id || "—"}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-sm sm:leading-5">
                    {latestRegistration
                      ? `${latestRegistration.full_name} · ${format(parseISO(latestRegistration.created_at), "dd MMM yyyy")}`
                      : "No recent registration found"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid auto-rows-fr grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ExecutiveMetricCard
            label="On Duty Today"
            value={isLoading ? "..." : onDutyCount}
            detail={isMobile ? "Active duty roster" : "Employees currently rostered on active duty"}
            icon={Users}
            toneClass="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
            href="/supervisor/attendance"
          />
          <ExecutiveMetricCard
            label="Pending Leaves"
            value={isLoading ? "..." : pendingLeaves.length}
            detail={isMobile ? `${pendingLeaves.filter((request) => request.status === "Pending WSO").length} at WSO stage` : `${pendingLeaves.filter((request) => request.status === "Pending WSO").length} still at WSO stage`}
            icon={FileText}
            toneClass="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            href="/supervisor/leaves"
          />
          <ExecutiveMetricCard
            label="Duty Exchanges"
            value={isLoading ? "..." : pendingExchanges.length}
            detail={isMobile ? "Awaiting final approval" : "Waiting for final supervisor approval"}
            icon={Workflow}
            toneClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            href="/supervisor/duty-exchange"
          />
          <ExecutiveMetricCard
            label="OPE Assignments"
            value={isLoading ? "..." : opeCount}
            detail={isMobile ? "Compound duty codes today" : "Compound duty codes detected for today"}
            icon={ClipboardList}
            toneClass="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            href="/supervisor/ope-assignments"
          />
        </section>

        <section className="grid gap-2.5 sm:gap-4 xl:grid-cols-3">
          <Card className="h-full overflow-hidden rounded-[20px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.4)] dark:border-slate-800 dark:bg-slate-950/85 sm:rounded-[28px]">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#fff8eb_0%,#fffdf7_42%,#f7fbff_100%)] pb-3 dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(120,53,15,0.2)_0%,rgba(15,23,42,0.96)_40%,rgba(15,23,42,0.96)_100%)] sm:pb-5">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base text-slate-950 dark:text-white sm:text-2xl">{leaveQueueTitle}</CardTitle>
                  <CardDescription className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:mt-2 sm:text-sm">
                    {leaveQueueDescription}
                  </CardDescription>
                </div>
                <Badge className="w-fit rounded-full bg-slate-950 px-2 py-0.5 text-[11px] text-white dark:bg-white dark:text-slate-950 sm:px-2.5 sm:py-1">
                  {pendingLeaves.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-6">
              <div className="space-y-2 sm:space-y-3">
                {pendingLeaves.slice(0, queuePreviewCount).map((request) => (
                  <div key={request.id} className="rounded-[16px] border border-slate-200/80 bg-slate-50/80 p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 sm:rounded-2xl sm:p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-slate-950 dark:text-white sm:text-sm">{request.employee_name || "Unknown"}</p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-xs sm:leading-5">
                          {getLeaveTypeLabel(request.leave_type)} · {formatLeaveWindow(request)} · {request.total_days} day{request.total_days > 1 ? "s" : ""}
                        </p>
                      </div>
                      <Badge variant={request.status === "Pending WSO" ? "outline" : "secondary"} className="shrink-0 rounded-full px-2 py-0.5 text-[10px]">
                        {request.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {pendingLeaves.length === 0 ? (
                  <div className="rounded-[16px] border border-dashed border-amber-200 bg-white/70 px-3.5 py-5 text-center text-xs text-slate-500 dark:border-amber-900/40 dark:bg-slate-950/60 dark:text-slate-400 sm:rounded-2xl sm:px-4 sm:py-8 sm:text-sm">
                    No leave requests are waiting right now.
                  </div>
                ) : null}
              </div>
              <Link to="/supervisor/leaves" className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white sm:mt-4 sm:gap-2 sm:text-sm">
                {openLeavesLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>

          <Card className="h-full overflow-hidden rounded-[20px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.4)] dark:border-slate-800 dark:bg-slate-950/85 sm:rounded-[28px]">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#ecfdf5_0%,#f8fffc_42%,#f7fbff_100%)] pb-3 dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(4,120,87,0.18)_0%,rgba(15,23,42,0.96)_40%,rgba(15,23,42,0.96)_100%)] sm:pb-5">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base text-slate-950 dark:text-white sm:text-2xl">{exchangeQueueTitle}</CardTitle>
                  <CardDescription className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:mt-2 sm:text-sm">
                    {exchangeQueueDescription}
                  </CardDescription>
                </div>
                <Badge className="w-fit rounded-full bg-slate-950 px-2 py-0.5 text-[11px] text-white dark:bg-white dark:text-slate-950 sm:px-2.5 sm:py-1">
                  {pendingExchanges.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-6">
              <div className="space-y-2 sm:space-y-3">
                {pendingExchanges.slice(0, queuePreviewCount).map((exchange) => (
                  <div key={exchange.id} className="rounded-[16px] border border-slate-200/80 bg-slate-50/80 p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 sm:rounded-2xl sm:p-3">
                    <p className="text-[13px] font-semibold text-slate-950 dark:text-white sm:text-sm">
                      {exchange.requesting_user?.full_name || "Unknown"} ↔ {exchange.exchange_partner?.full_name || "Unknown"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-xs sm:leading-5">
                      {exchange.duty_date ? format(parseISO(exchange.duty_date), "dd MMM yyyy") : "Date not available"} · {exchange.reason || "No reason provided"}
                    </p>
                  </div>
                ))}
                {pendingExchanges.length === 0 ? (
                  <div className="rounded-[16px] border border-dashed border-emerald-200 bg-white/70 px-3.5 py-5 text-center text-xs text-slate-500 dark:border-emerald-900/40 dark:bg-slate-950/60 dark:text-slate-400 sm:rounded-2xl sm:px-4 sm:py-8 sm:text-sm">
                    No duty exchange requests need approval.
                  </div>
                ) : null}
              </div>
              <Link to="/supervisor/duty-exchange" className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white sm:mt-4 sm:gap-2 sm:text-sm">
                {openExchangesLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>

          <Card className="h-full overflow-hidden rounded-[20px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.4)] dark:border-slate-800 dark:bg-slate-950/85 sm:rounded-[28px]">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#eff8ff_0%,#f8fbff_52%,#f8fafc_100%)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(14,116,144,0.16)_0%,rgba(15,23,42,0.97)_52%,rgba(15,23,42,0.97)_100%)]">
              <CardTitle className="text-base text-slate-950 dark:text-white sm:text-2xl">{dutyArchitectureTitle}</CardTitle>
              <CardDescription className="text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-sm sm:leading-5">
                {dutyArchitectureDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-3 sm:space-y-3 sm:p-6">
              {shiftPanels.map(({ key, label, icon: ShiftIcon, accent, chip, iconClass }) => (
                <Link
                  key={key}
                  to={`/supervisor/attendance?shift=${encodeURIComponent(key)}&date=${encodeURIComponent(today)}`}
                  className={cn(
                    "group block rounded-[16px] border border-slate-200/80 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#f8fafc_100%)] p-2.5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/80 sm:rounded-[22px] sm:p-4",
                    `bg-[radial-gradient(circle_at_top_right,var(--tw-gradient-stops))] ${accent}`,
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/85 shadow-sm dark:bg-slate-900 sm:h-10 sm:w-10 sm:rounded-2xl">
                        <ShiftIcon className={cn("h-3.5 w-3.5 sm:h-5 sm:w-5", iconClass)} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-950 dark:text-white sm:text-sm">{label}</p>
                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-slate-500 dark:text-slate-400 sm:text-xs sm:leading-5">
                          {shiftTeams[key]?.length > 0 ? shiftTeams[key].join(", ") : "No teams allocated"}
                        </p>
                      </div>
                    </div>
                    <Badge className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] sm:px-2.5 sm:py-1 sm:text-[11px]", chip)}>{isLoading ? "..." : shiftCounts[key] || 0}</Badge>
                  </div>
                </Link>
              ))}

              <div className={cn(
                "rounded-[16px] border p-3 sm:rounded-[22px] sm:p-4",
                isGeneralOnDuty
                  ? "border-teal-200 bg-teal-50/70 dark:border-teal-900/40 dark:bg-teal-950/20"
                  : "border-slate-200 bg-slate-50/70 opacity-75 dark:border-slate-800 dark:bg-slate-950/50",
              )}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/85 shadow-sm dark:bg-slate-900 sm:h-10 sm:w-10 sm:rounded-2xl">
                      <Briefcase className={cn("h-3.5 w-3.5 sm:h-5 sm:w-5", isGeneralOnDuty ? "text-teal-600 dark:text-teal-300" : "text-slate-400 dark:text-slate-500")} />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-slate-950 dark:text-white sm:text-sm">General Shift</p>
                      <p className="mt-0.5 text-[10px] leading-4 text-slate-500 dark:text-slate-400 sm:text-xs sm:leading-5">
                        Team G · {isGeneralOnDuty ? "Operational window is open today" : "Off-duty day for the general team"}
                      </p>
                    </div>
                  </div>
                  <Badge className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:text-[11px]">
                    {isLoading ? "..." : generalCount}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-2.5 sm:gap-4 xl:grid-cols-3">
          <Card className="h-full overflow-hidden rounded-[20px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.36)] dark:border-slate-800 dark:bg-slate-950/85 sm:rounded-[28px]">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_40%,#eff6ff_100%)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(30,41,59,0.88)_0%,rgba(15,23,42,0.98)_100%)]">
              <CardTitle className="flex items-center gap-2 text-base text-slate-950 dark:text-white sm:text-2xl">
                <Search className="h-4 w-4 text-sky-600 dark:text-sky-300 sm:h-5 sm:w-5" />
                {employeeSearchTitle}
              </CardTitle>
              <CardDescription className="text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-sm sm:leading-5">
                {employeeSearchDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 sm:p-6">
              <div className="rounded-[16px] border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-slate-800 dark:bg-slate-900/60 sm:rounded-[22px] sm:p-3">
                <Input
                  placeholder={searchPlaceholder}
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && employeeSuggestions[0]?.employee_code) {
                      event.preventDefault();
                      handleEmployeeOpen(employeeSuggestions[0].employee_code);
                    }
                  }}
                  className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-none dark:border-slate-700 dark:bg-slate-950 sm:h-12 sm:rounded-2xl"
                />
              </div>

              <div className="mt-3">
                {trimmedEmployeeSearch.length === 0 ? (
                  <div className="rounded-[16px] border border-dashed border-slate-300 bg-slate-50/70 px-3.5 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400 sm:rounded-[24px] sm:px-5 sm:py-12 sm:text-sm">
                    Start typing a name or registration number. Suggestions will appear instantly and open the full employee page.
                  </div>
                ) : employeeSuggestionsLoading ? (
                  <div className="rounded-[16px] border border-dashed border-slate-300 bg-slate-50/70 px-3.5 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400 sm:rounded-[24px] sm:px-5 sm:py-12 sm:text-sm">
                    Searching employees...
                  </div>
                ) : employeeSuggestions.length > 0 ? (
                  <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1 sm:max-h-[360px] sm:space-y-3">
                    {employeeSuggestions.map((employee) => (
                      <button
                        key={employee.employee_code}
                        type="button"
                        onClick={() => handleEmployeeOpen(employee.employee_code)}
                        className="w-full rounded-[16px] border border-slate-200/80 bg-white p-3 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/80 dark:hover:border-sky-900/40 sm:rounded-[22px] sm:p-4"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-slate-950 dark:text-white sm:text-sm">{employee.full_name || employee.employee_code}</p>
                            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">
                              {employee.employee_code} {employee.current_shift ? `· ${String(employee.current_shift).toUpperCase()} shift` : "· Shift not assigned"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {employee.current_shift ? (
                              <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] sm:text-[11px]">
                                {String(employee.current_shift).toUpperCase()}
                              </Badge>
                            ) : null}
                            <Badge className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] text-white dark:bg-white dark:text-slate-950 sm:text-[11px]">
                              Open profile
                            </Badge>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[16px] border border-dashed border-slate-300 bg-slate-50/70 px-3.5 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400 sm:rounded-[24px] sm:px-5 sm:py-12 sm:text-sm">
                    No employee suggestions matched this search.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="h-full overflow-hidden rounded-[20px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.36)] dark:border-slate-800 dark:bg-slate-950/85 sm:rounded-[28px]">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#f0fdf4_0%,#ffffff_55%,#f8fafc_100%)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(16,185,129,0.12)_0%,rgba(15,23,42,0.98)_60%,rgba(15,23,42,0.98)_100%)]">
              <CardTitle className="flex items-center gap-2 text-base text-slate-950 dark:text-white sm:text-xl">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300 sm:h-5 sm:w-5" />
                {latestRegistrationTitle}
              </CardTitle>
              <CardDescription className="text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-sm sm:leading-5">
                {latestRegistrationDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 sm:p-6">
              {latestRegistration ? (
                <div className="space-y-2.5 sm:space-y-4">
                  <div className="rounded-[16px] border border-emerald-200/80 bg-emerald-50/70 p-3.5 dark:border-emerald-900/40 dark:bg-emerald-950/20 sm:rounded-[24px] sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-[11px] sm:tracking-[0.18em]">Registration Number</p>
                        <p className="mt-1.5 text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-3 sm:text-3xl">{latestRegistration.employee_id}</p>
                        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 sm:text-sm">
                          Added on {format(parseISO(latestRegistration.created_at), "dd MMM yyyy")}
                        </p>
                      </div>
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm dark:bg-slate-900 dark:text-emerald-300 sm:h-12 sm:w-12 sm:rounded-2xl">
                        <UserCheck className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[16px] border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:rounded-2xl sm:p-4">
                    <p className="text-[13px] font-semibold text-slate-950 dark:text-white sm:text-sm">{latestRegistration.full_name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">
                      {latestRegistration.designation || "Designation not recorded"}
                    </p>
                  </div>

                  <Link to={`/supervisor/employees/${encodeURIComponent(latestRegistration.employee_id)}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white sm:gap-2 sm:text-sm">
                    {openEmployeeRecordLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <div className="rounded-[16px] border border-dashed border-emerald-300 bg-emerald-50/70 px-4 py-6 text-center dark:border-emerald-900/40 dark:bg-emerald-950/20 sm:rounded-[24px] sm:px-5 sm:py-10">
                  <UserCheck className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-300" />
                  <p className="mt-4 text-sm font-semibold text-slate-950 dark:text-white">No registration record found</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">The dashboard could not find a profile entry with a recent registration timestamp.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="h-full overflow-hidden rounded-[20px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.36)] dark:border-slate-800 dark:bg-slate-950/85 sm:rounded-[28px]">
            <CardHeader className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_48%,#eef2ff_100%)] dark:border-slate-800 dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.12)_0%,rgba(15,23,42,0.98)_58%,rgba(15,23,42,0.98)_100%)]">
              <CardTitle className="flex items-center gap-2 text-base text-slate-950 dark:text-white sm:text-xl">
                <DatabaseZap className="h-4 w-4 text-violet-600 dark:text-violet-300 sm:h-5 sm:w-5" />
                {syncCenterTitle}
              </CardTitle>
              <CardDescription className="text-[11px] leading-4 text-slate-500 dark:text-slate-400 sm:text-sm sm:leading-5">
                {syncCenterDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-3 sm:space-y-3 sm:p-6">
              <div className="rounded-[16px] border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:rounded-2xl sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-950 dark:text-white sm:text-sm">Schedule Feed</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">Pull the latest duty rows for supervisors and WSO workflows.</p>
                  </div>
                  <Badge className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 sm:text-[11px]">Core</Badge>
                </div>
              </div>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60 sm:rounded-2xl sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-950 dark:text-white sm:text-sm">Leave Feed</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">{leaveApiUrl ? "External leave API is configured." : "Leave API URL still needs admin configuration."}</p>
                  </div>
                  <Badge className={cn("rounded-full px-2 py-0.5 text-[10px] sm:text-[11px]", leaveApiUrl ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300")}>
                    {leaveApiUrl ? "Ready" : "Needs Setup"}
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <Button onClick={handleFetchSchedule} disabled={fetchSchedule.isPending} className="h-9 rounded-xl bg-slate-950 px-2.5 text-xs text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 sm:h-11 sm:px-3 sm:text-sm">
                  {fetchSchedule.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                  {scheduleButtonLabel}
                </Button>
                <Button onClick={handleFetchLeave} disabled={fetchLeave.isPending} variant="outline" className="h-9 rounded-xl px-2.5 text-xs sm:h-11 sm:px-3 sm:text-sm">
                  {fetchLeave.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DatabaseZap className="mr-2 h-4 w-4" />}
                  {leaveButtonLabel}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <div className="mb-2.5 flex flex-col gap-1.5 sm:mb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Execution Layer</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950 dark:text-white sm:text-2xl">Quick Actions</h2>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-sm">Shortcuts for the workflows supervisors use most often.</p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            <QuickActionTile
              title="Attendance Board"
              description={isMobile ? "Capture today’s attendance." : "Open the attendance surface and capture today’s operational presence."}
              icon={ClipboardList}
              href="/supervisor/attendance"
              tintClass="bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
            />
            <QuickActionTile
              title="Leave Decisions"
              description={isMobile ? "Review leave approvals." : "Review leave requests with the latest queue already summarized above."}
              icon={FileText}
              href="/supervisor/leaves"
              tintClass="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            />
            <QuickActionTile
              title="Employee Directory"
              description={isMobile ? "Open employee records fast." : "Jump into employee records, roster context, and master-data management."}
              icon={Users}
              href="/supervisor/employees"
              tintClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            />
            <QuickActionTile
              title="Duty Management"
              description={isMobile ? "Adjust roster duty data." : "Adjust roster data and oversee the duty-management workspace."}
              icon={CalendarIcon}
              href="/supervisor/duty-management"
              tintClass="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            />
            <QuickActionTile
              title="Shift Roster Data"
              description={isMobile ? "Inspect roster coverage." : "Inspect roster records and verify structural duty coverage."}
              icon={CalendarIcon}
              href="/supervisor/roster"
              tintClass="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
            />
            <QuickActionTile
              title="OPE Assignments"
              description={isMobile ? "Review extra-duty allocations." : "Review extra-duty allocations and move directly into assignment oversight."}
              icon={Radar}
              href="/supervisor/ope-assignments"
              tintClass="bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300"
            />
            <QuickActionTile
              title="Roster Suggestions"
              description={isMobile ? "Run suggestion lookup." : "Run the separate automation service and review exchange or OPE names inside Shift ATCO."}
              icon={Search}
              href="/supervisor/suggestions"
              tintClass="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
            />
            <QuickActionTile
              title="Team Details"
              description={isMobile ? "Open the team-wise day roster." : "Open the team-wise day roster with joined rating, trainee, license, and leave details."}
              icon={Workflow}
              href="/supervisor/shift-details"
              tintClass="bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
            />
            <QuickActionTile
              title="Sync Schedule"
              description={isMobile ? "Refresh schedule data." : "Refresh the latest schedule payload into the dashboard data model."}
              icon={RefreshCcw}
              onClick={handleFetchSchedule}
              loading={fetchSchedule.isPending}
              disabled={fetchSchedule.isPending}
              tintClass="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
            <QuickActionTile
              title="Refresh Leave Feed"
              description={isMobile ? "Refresh leave records." : "Pull leave records from the configured external leave service."}
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
