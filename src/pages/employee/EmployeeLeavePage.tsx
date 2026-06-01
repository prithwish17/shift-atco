import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, RefreshCw, CalendarDays, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useElDetails } from "@/hooks/useElData";
import { useLeaveData } from "@/hooks/useLeaveData";
import { isFinalLeaveApproved, useMyLeaveRequests } from "@/hooks/useLeaveRequests";
import { DEFAULT_CL_BALANCE, DEFAULT_RH_BALANCE, YEAR_LOOKBACK } from "@/lib/leaveConstants";
import { useMySchedule } from "@/hooks/useEmployeeSchedules";
import type { CompOffHistoryEntry } from "@/utils/leaveCalculations";
import { eachDayOfInterval, endOfMonth, format, isAfter, isBefore, parseISO, startOfMonth } from "date-fns";

function formatDate(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const monthMatch = trimmed.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b\s+(\d{1,2})\s+(\d{4})/i);
  if (monthMatch) {
    const formattedMonth = monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1).toLowerCase();
    return `${formattedMonth} ${monthMatch[2].padStart(2, "0")} ${monthMatch[3]}`;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;
  return date
    .toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    .replace(",", "");
}

function getInclusiveOverlapDayCount(startValue: string, endValue: string, rangeStart: string, rangeEnd: string): number {
  const start = new Date(`${startValue}T00:00:00Z`);
  const end = new Date(`${endValue}T00:00:00Z`);
  const boundedStart = new Date(`${rangeStart}T00:00:00Z`);
  const boundedEnd = new Date(`${rangeEnd}T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    Number.isNaN(boundedStart.getTime()) ||
    Number.isNaN(boundedEnd.getTime())
  ) {
    return 0;
  }

  const overlapStart = start > boundedStart ? start : boundedStart;
  const overlapEnd = end < boundedEnd ? end : boundedEnd;

  if (overlapEnd < overlapStart) {
    return 0;
  }

  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / millisecondsPerDay) + 1;
}

function formatLeaveRange(startValue: string, endValue: string): string {
  const formattedStart = formatDate(startValue) || startValue;
  const formattedEnd = formatDate(endValue) || endValue;
  return startValue === endValue ? formattedStart : `${formattedStart} - ${formattedEnd}`;
}

function extractDates(items: unknown[], fields: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const formatted = formatDate(item);
      if (formatted) out.push(formatted);
      continue;
    }
    if (item && typeof item === "object") {
      if ((item as any).hideDates) continue;
      for (const field of fields) {
        const formatted = formatDate((item as any)[field]);
        if (formatted) out.push(formatted);
      }
    }
  }
  return Array.from(new Set(out));
}

function getCompOffSourceLabel(sourceType?: string, sourceLabel?: string): string {
  switch ((sourceType || "").toUpperCase()) {
    case "COMP_OFF_DUTY":
      return "Comp-Off";
    case "FROM_LAST_YEAR":
      return "Last Year";
    case "LAST_YEAR_CH_DUTY":
      return "Last Year";
    case "OPE_DUTY":
    case "OPE":
      return "OPE";
    case "LAST_YEAR_COMP_OFF":
      return "Last Year";
    case "OPE_COMP_OFF":
      return "OPE";
    case "COMP_OFF":
      return "Comp-Off";
    default:
      return sourceLabel?.trim() || sourceType || "Comp-Off";
  }
}

function getCompOffSourceBadgeClass(sourceType?: string): string {
  switch ((sourceType || "").toUpperCase()) {
    case "COMP_OFF_DUTY":
    case "COMP_OFF":
      return "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200";
    case "FROM_LAST_YEAR":
    case "LAST_YEAR_CH_DUTY":
    case "LAST_YEAR_COMP_OFF":
      return "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200";
    case "OPE_DUTY":
    case "OPE":
    case "OPE_COMP_OFF":
      return "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200";
    default:
      return "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200";
  }
}

function getCompOffStatusLabel(entry: CompOffHistoryEntry): string {
  if (entry.status === "available" && entry.daysRemaining != null) {
    return `${entry.daysRemaining} Day${entry.daysRemaining === 1 ? "" : "s"} Left`;
  }

  switch (entry.status) {
    case "not_available":
      return "Not Available";
    case "expired":
      return "Expired";
    case "used":
      return "Used";
    default:
      return "Available";
  }
}

function getCompOffStatusBadgeClass(status: CompOffHistoryEntry["status"]): string {
  switch (status) {
    case "not_available":
      return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200";
    case "expired":
      return "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200";
    case "used":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
    default:
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
  }
}

function getLeaveTypeHighlightClass(type: string): string {
  switch (type) {
    case "Casual Leave":
      return "border-l-teal-500 bg-teal-50/80 text-teal-900 dark:bg-teal-950/30 dark:text-teal-100";
    case "Earned Leave":
      return "border-l-blue-500 bg-blue-50/80 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100";
    case "Compensatory Off":
      return "border-l-rose-500 bg-rose-50/80 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100";
    case "Restricted Holiday":
      return "border-l-amber-500 bg-amber-50/80 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100";
    default:
      return "border-l-slate-400 bg-slate-50 text-slate-900 dark:bg-slate-900/60 dark:text-slate-100";
  }
}

const DUTY_CODE_LABELS: Record<string, string> = {
  M: "MORNING",
  A: "AFTERNOON",
  N: "NIGHT",
  NO: "NIGHT OFF",
  CO: "CLEAR OFF",
  "M+A": "MORNING NORMAL+AFTERNOON OPE",
  "NO+N": "NIGHT OPE",
  LEAVE: "LEAVE",
  SAT: "SATURDAY",
  SUN: "SUNDAY",
  G: "GENERAL",
  T: "TOUR",
  CH: "CLOSED HOLIDAY",
  NH: "NATIONAL HOLIDAY",
  "SAT+NO": "NIGHT OFF",
  NA: "NOT AVAILABLE",
  "SUN+N": "NIGHT OPE",
  "SUN+M": "MORNING OPE",
  "SUN+A": "AFTERNOON OPE",
  "SUN+NO": "NIGHT OFF",
  "SAT+N": "NIGHT OPE",
  "CO+N": "NIGHT OPE",
  SL: "CLEAR OFF",
  Tr: "TRAINING",
  "CO+A": "AFTERNOON OPE",
  "CO+M": "MORNING OPE",
  GO: "GENERAL-O",
  "A+M": "MORNING OPE+AFTERNOON NORMAL",
};

function formatDutyPerformed(value?: string | null): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "—";

  const normalizedKey = Object.keys(DUTY_CODE_LABELS).find(
    (code) => code.toUpperCase() === trimmed.toUpperCase(),
  );

  if (!normalizedKey) return trimmed;
  return DUTY_CODE_LABELS[normalizedKey];
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: YEAR_LOOKBACK }, (_, i) => CURRENT_YEAR - i);

type CalendarLeaveStyle = {
  label: string;
  legend: string;
  cellClass: string;
  badgeClass: string;
};

const CALENDAR_LEAVE_STYLES: Record<string, CalendarLeaveStyle> = {
  REQ: {
    label: "REQ",
    legend: "Applied",
    cellClass: "bg-amber-50 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-100 dark:ring-amber-900/50",
    badgeClass: "bg-amber-200 text-amber-900 dark:bg-amber-900/70 dark:text-amber-100",
  },
  APR: {
    label: "LEAVE",
    legend: "Approved",
    cellClass: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100 dark:ring-emerald-900/50",
    badgeClass: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-100",
  },
};

export default function EmployeeLeavePage() {
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [compOffView, setCompOffView] = useState<"available" | "all">("available");
  const employeeEmpId = profile?.employee_id ? String(profile.employee_id) : null;
  const { data, leaveQuery, refresh } = useLeaveData(selectedYear, employeeEmpId);
  const { data: elDetails = [], isLoading: elLoading, error: elError } = useElDetails(employeeEmpId || undefined);
  const { data: myLeaveRequests = [], isLoading: leaveRequestsLoading } = useMyLeaveRequests(user?.id);

  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const calendarMonthStart = format(startOfMonth(calendarDate), "yyyy-MM-dd");
  const calendarMonthEnd = format(endOfMonth(calendarDate), "yyyy-MM-dd");
  const { data: monthlySchedule = [], isLoading: monthlyScheduleLoading } = useMySchedule(
    employeeEmpId || undefined,
    calendarMonthStart,
    calendarMonthEnd
  );

  const employeeRecord = useMemo(() => {
    const empId = employeeEmpId || "";
    if (!empId) return null;
    return data.find((record) => record.empId === empId) || null;
  }, [data, employeeEmpId]);

  const earnedLeaveSummary = useMemo(() => {
    const yearStart = `${selectedYear}-01-01`;
    const yearEnd = `${selectedYear}-12-31`;

    const filteredDetails = elDetails.filter((row) =>
      getInclusiveOverlapDayCount(row.leave_from, row.leave_to, yearStart, yearEnd) > 0,
    );

    const totalDays = filteredDetails.reduce((sum, row) => {
      return sum + getInclusiveOverlapDayCount(row.leave_from, row.leave_to, yearStart, yearEnd);
    }, 0);

    const ranges = filteredDetails.map((row) => formatLeaveRange(row.leave_from, row.leave_to));

    return {
      details: filteredDetails,
      totalDays,
      ranges,
    };
  }, [elDetails, selectedYear]);

  const isLoading = profileLoading || leaveQuery.isLoading || elLoading || leaveRequestsLoading || monthlyScheduleLoading;

  const compOffLedgerRows = useMemo(() => {
    if (!employeeRecord) return [] as CompOffHistoryEntry[];
    return [...employeeRecord.compOffEntries]
      .filter((row) => !row.hideDates)
      .sort((a, b) => {
        const left = a.dutyDate || a.leaveApplied || "";
        const right = b.dutyDate || b.leaveApplied || "";

        if (left !== right) {
          return right.localeCompare(left);
        }

        return (b.leaveApplied || "").localeCompare(a.leaveApplied || "");
      });
  }, [employeeRecord]);

  const visibleCompOffLedgerRows = useMemo(() => {
    if (compOffView === "all") return compOffLedgerRows;
    return compOffLedgerRows.filter((row) => row.status === "available");
  }, [compOffLedgerRows, compOffView]);

  // Calculate comp-off stats from the visible ledger entries (excludes hideDates rows)
  const compOffStats = useMemo(() => {
    const visible = compOffLedgerRows;
    const remaining = visible.filter((e) => e.status === "available").length;
    const used = visible.filter((e) => e.status === "used").length;
    const expired = visible.filter((e) => e.status === "expired").length;
    const earned = remaining + used + expired;
    return { earned, used, expired, remaining };
  }, [compOffLedgerRows]);

  // Filter CL/RH dates by selected year
  const yearFilteredCounts = useMemo(() => {
    if (!employeeRecord) return { casualCount: 0, restrictedCount: 0 };

    const yearPrefix = String(selectedYear);

    const casualCount = (employeeRecord.casualLeave || []).filter((date) => {
      if (typeof date !== "string") return false;
      return date.startsWith(yearPrefix);
    }).length;

    const restrictedCount = (employeeRecord.restrictedHolidays || []).filter((entry) => {
      if (typeof entry === "string") return entry.startsWith(yearPrefix);
      if (typeof entry === "object" && entry !== null) {
        const date = (entry as any).date || (entry as any).leaveApplied;
        return typeof date === "string" && date.startsWith(yearPrefix);
      }
      return false;
    }).length;

    return { casualCount, restrictedCount };
  }, [employeeRecord, selectedYear]);

  const cards = useMemo(() => {
    if (!employeeRecord) {
      return [];
    }

    return [
      {
        label: "Casual Leave",
        remaining: Math.max(DEFAULT_CL_BALANCE - yearFilteredCounts.casualCount, 0),
        total: DEFAULT_CL_BALANCE,
        color: "#4FD1C5",
        helper: `${yearFilteredCounts.casualCount} used`,
      },
      {
        label: "Earned Leave",
        remaining: 0,
        total: 0,
        color: "#63B3ED",
        helper: earnedLeaveSummary.details.length
          ? `${earnedLeaveSummary.details.length} synced entr${earnedLeaveSummary.details.length === 1 ? "y" : "ies"}`
          : "No EL taken this year",
        valueText: earnedLeaveSummary.details.length ? String(earnedLeaveSummary.totalDays) : "—",
        valueLabel: earnedLeaveSummary.details.length ? "days availed" : "No balance data",
        percent: earnedLeaveSummary.details.length ? 100 : 0,
      },
      {
        label: "Compensatory Off",
        remaining: compOffStats.remaining,
        total: compOffStats.earned,
        color: "#F87171",
        helper: `${compOffStats.used} used${compOffStats.expired ? ` · ${compOffStats.expired} expired` : ""}`,
      },
      {
        label: "Restricted Holiday",
        remaining: Math.max(DEFAULT_RH_BALANCE - yearFilteredCounts.restrictedCount, 0),
        total: DEFAULT_RH_BALANCE,
        color: "#F6AD55",
        helper: `${yearFilteredCounts.restrictedCount} used`,
      },
    ].filter((card) => card.label === "Earned Leave" || card.remaining > 0);
  }, [earnedLeaveSummary.details.length, earnedLeaveSummary.totalDays, employeeRecord, compOffStats, yearFilteredCounts]);

  const leaveSummary = useMemo(() => {
    if (!employeeRecord) return [];
    
    const yearPrefix = String(selectedYear);
    
    // Extract dates and filter by year (formatted dates contain the year, e.g., "Jan 15 2026")
    const casualDates = extractDates(employeeRecord.casualLeave, [])
      .filter(date => date.includes(yearPrefix));
    
    const reservedDates = extractDates(employeeRecord.restrictedHolidays, ["date", "leaveApplied"])
      .filter(date => date.includes(yearPrefix));
    
    const compOffDates = extractDates(employeeRecord.compOffUsedEntries, ["leaveApplied"])
      .filter(date => date.includes(yearPrefix));

    return [
      { type: "Casual Leave", dates: casualDates },
      {
        type: "Earned Leave",
        dates: earnedLeaveSummary.ranges,
        count: earnedLeaveSummary.totalDays,
      },
      { type: "Compensatory Off", dates: compOffDates },
      { type: "Restricted Holiday", dates: reservedDates },
    ];
  }, [earnedLeaveSummary.ranges, earnedLeaveSummary.totalDays, employeeRecord, selectedYear]);

  // Calendar data: map of ISO date -> leave style
  const calendarLeaves = useMemo(() => {
    const map = new Map<string, CalendarLeaveStyle>();

    const monthStartDate = parseISO(calendarMonthStart);
    const monthEndDate = parseISO(calendarMonthEnd);

    myLeaveRequests
      .filter((request) => request.status === "Pending WSO" || request.status === "Pending Supervisor")
      .forEach((request) => {
        const requestStart = parseISO(request.start_date);
        const requestEnd = parseISO(request.end_date);
        if (isAfter(requestStart, monthEndDate) || isBefore(requestEnd, monthStartDate)) return;

        const boundedStart = isBefore(requestStart, monthStartDate) ? monthStartDate : requestStart;
        const boundedEnd = isAfter(requestEnd, monthEndDate) ? monthEndDate : requestEnd;

        eachDayOfInterval({ start: boundedStart, end: boundedEnd }).forEach((day) => {
          map.set(format(day, "yyyy-MM-dd"), CALENDAR_LEAVE_STYLES.REQ);
        });
      });

    let approvedCount = 0;
    monthlySchedule.forEach((entry) => {
      if (entry.duty_code === "LEAVE") {
        map.set(entry.duty_date, CALENDAR_LEAVE_STYLES.APR);
        approvedCount++;
      }
    });

    if (approvedCount === 0) {
      myLeaveRequests
        .filter((request) => isFinalLeaveApproved(request))
        .forEach((request) => {
          const requestStart = parseISO(request.start_date);
          const requestEnd = parseISO(request.end_date);
          if (isAfter(requestStart, monthEndDate) || isBefore(requestEnd, monthStartDate)) return;

          const boundedStart = isBefore(requestStart, monthStartDate) ? monthStartDate : requestStart;
          const boundedEnd = isAfter(requestEnd, monthEndDate) ? monthEndDate : requestEnd;

          eachDayOfInterval({ start: boundedStart, end: boundedEnd }).forEach((day) => {
            map.set(format(day, "yyyy-MM-dd"), CALENDAR_LEAVE_STYLES.APR);
          });
        });
    }

    return map;
  }, [calendarMonthEnd, calendarMonthStart, monthlySchedule, myLeaveRequests]);

  // Calendar grid calculation
  const calendarGrid = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: { day: number | null; iso: string | null }[] = [];

    // Leading empty cells
    for (let i = 0; i < firstDay; i++) {
      cells.push({ day: null, iso: null });
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, iso });
    }

    return cells;
  }, [calendarDate]);

  const monthLabel = calendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const prevMonth = () => {
    setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    setCalendarDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  return (
    <DashboardLayout role="employee">
      <div className="space-y-6">
        <div>
          <div>
            <h1 className="whitespace-nowrap text-xl font-black tracking-tight sm:text-2xl">Leave Summary</h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              View your leave balances and usage from the official register
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:items-center">
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="h-9 w-full sm:w-[120px]">
                  <CalendarDays className="mr-1.5 h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="w-full sm:w-auto"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} />
                {refresh.isPending ? "Syncing…" : "Sync Data"}
              </Button>
            </div>
            <Button asChild size="sm" className="w-full sm:w-auto">
              <Link to="/employee/leave">Apply Leave</Link>
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold sm:text-lg">Leave Availability</h2>
        </div>

        {(leaveQuery.error || elError) && (
          <Card className="border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30">
            <CardContent className="pt-4 pb-4 text-sm text-red-800 dark:text-red-200">
              {((leaveQuery.error || elError) as Error).message || "Failed to load leave data"}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          </div>
        ) : !profile?.employee_id ? (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30">
            <CardContent className="pt-4 pb-4 text-sm text-amber-800 dark:text-amber-200">
              Your profile is missing an Employee ID. Please update your profile.
            </CardContent>
          </Card>
        ) : !employeeRecord ? (
          <Card>
            <CardContent className="pt-6 pb-6 text-sm text-muted-foreground">
              No leave data found for Employee ID {profile.employee_id}. Ask an admin to sync leave data.
            </CardContent>
          </Card>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
          {cards.map((card) => {
            const hasBalance = typeof card.total === "number" && card.total > 0;
            const percent = typeof card.percent === "number"
              ? card.percent
              : hasBalance
                ? Math.round(((card.total - card.remaining) / card.total) * 100)
                : 0;
            const valueText = card.valueText ?? (hasBalance ? `${card.remaining} / ${card.total}` : "—");
            const valueLabel = card.valueLabel ?? (hasBalance ? "remaining" : "No balance data");
            return (
              <Card key={card.label} className="h-full w-full shadow-sm">
                <CardContent className="flex h-full items-center justify-between gap-2 px-2.5 py-2 sm:gap-4 sm:px-6 sm:py-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-slate-800 dark:text-slate-200 sm:text-xs">{card.label}</div>
                    <div className="mt-0.5 text-lg font-black leading-none tracking-tight text-slate-900 dark:text-white sm:mt-2 sm:text-3xl">
                      {valueText}
                    </div>
                    <div className="mt-0.5 break-words text-[9px] font-semibold text-slate-700 dark:text-slate-300 sm:mt-1 sm:text-xs">
                      {valueLabel}
                    </div>
                    <div className="mt-0.5 break-words text-[9px] text-muted-foreground sm:mt-1 sm:text-xs">
                      {card.helper}
                    </div>
                  </div>
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full sm:h-16 sm:w-16"
                    style={{
                      background: `conic-gradient(${card.color} ${percent}%, var(--card-progress-track, #E5E7EB) 0)`,
                    }}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white dark:bg-slate-950 sm:h-12 sm:w-12">
                      <div className="text-[9px] font-bold text-slate-700 dark:text-slate-200 sm:text-sm">{percent}%</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="w-full shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-4">
              <CardTitle className="text-sm sm:text-lg">Comp-Off Balance</CardTitle>
              <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:w-auto sm:gap-2">
                {[
                  { key: "available" as const, label: "Available" },
                  { key: "all" as const, label: "View All" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setCompOffView(tab.key)}
                    className={`rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors sm:rounded-xl sm:px-3 sm:py-2 sm:text-sm ${
                      compOffView === tab.key
                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex items-center justify-between text-[11px] text-muted-foreground sm:text-sm">
                <div className="flex flex-wrap items-center gap-2 text-[10px] sm:gap-3 sm:text-xs">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Earned: {compOffStats.earned}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Used: {compOffStats.used}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Expired: {compOffStats.expired}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> Remaining: {compOffStats.remaining}</span>
                </div>
              </div>
              <div className="space-y-2 mb-4 sm:hidden">
                {visibleCompOffLedgerRows.length ? (
                  visibleCompOffLedgerRows.map((row, idx) => (
                    <div
                      key={`${row.sourceType}-${row.dutyDate || row.leaveApplied || idx}-mobile`}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0 text-xs font-bold tracking-tight text-slate-900 dark:text-white">
                          {formatDate(row.dutyDate) || "—"}
                        </div>
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold leading-tight ${getCompOffStatusBadgeClass(row.status)}`}
                        >
                          {getCompOffStatusLabel(row)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div className="overflow-hidden">
                          <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Duty Performed</div>
                          <div className="text-[10px] font-semibold text-slate-800 dark:text-slate-200 break-words">{formatDutyPerformed(row.dutyPerformed)}</div>
                        </div>
                        <div className="overflow-hidden">
                          <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Expiry Date</div>
                          <div className="text-[10px] font-semibold text-slate-800 dark:text-slate-200 break-words">{formatDate(row.expiryDate) || "—"}</div>
                        </div>
                        <div className="overflow-hidden">
                          <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Source</div>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${getCompOffSourceBadgeClass(row.sourceType)}`}
                          >
                            {getCompOffSourceLabel(row.sourceType, row.sourceLabel)}
                          </span>
                        </div>
                        <div className="overflow-hidden">
                          <div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Leave Used On</div>
                          <div className="text-[10px] font-semibold text-slate-800 dark:text-slate-200 break-words">{formatDate(row.leaveApplied) || "—"}</div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-center text-xs text-muted-foreground">
                    {compOffView === "all" ? "No comp-off records available." : "No earned comp-off records available."}
                  </div>
                )}
              </div>

              <div className="hidden sm:block border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden mb-4 overflow-x-auto">
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col className="w-[14%]" />
                    <col className="w-[22%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                    <col className="w-[16%]" />
                    <col className="w-[20%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b-2 border-slate-300 bg-slate-200/95 text-slate-800 text-xs font-bold uppercase tracking-[0.14em] shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                      <th className="px-3 py-2.5 text-left border-r border-slate-300 dark:border-slate-700 font-bold">Duty Date</th>
                      <th className="px-3 py-2.5 text-left border-r border-slate-300 dark:border-slate-700 font-bold">Duty Performed</th>
                      <th className="px-3 py-2.5 text-left border-r border-slate-300 dark:border-slate-700 font-bold">Expiry Date</th>
                      <th className="px-3 py-2.5 text-left border-r border-slate-300 dark:border-slate-700 font-bold">Source</th>
                      <th className="px-3 py-2.5 text-left border-r border-slate-300 dark:border-slate-700 font-bold">Leave Used On</th>
                      <th className="px-3 py-2.5 text-left font-bold">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {visibleCompOffLedgerRows.length ? (
                      visibleCompOffLedgerRows.map((row, idx) => (
                        <tr
                          key={`${row.sourceType}-${row.dutyDate || row.leaveApplied || idx}`}
                          className={`text-sm ${idx % 2 === 0 ? "bg-sky-100/70 dark:bg-sky-950/20" : "bg-slate-50/80 dark:bg-slate-900/70"}`}
                        >
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-normal break-words">{formatDate(row.dutyDate) || "—"}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-normal break-words">{formatDutyPerformed(row.dutyPerformed)}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-normal break-words">{formatDate(row.expiryDate) || "—"}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-md px-2.5 py-1 text-[10px] font-semibold leading-tight ${getCompOffSourceBadgeClass(row.sourceType)}`}
                            >
                              {getCompOffSourceLabel(row.sourceType, row.sourceLabel)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-normal break-words">{formatDate(row.leaveApplied) || "—"}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-md px-2.5 py-1 text-[10px] font-semibold leading-tight ${getCompOffStatusBadgeClass(row.status)}`}
                            >
                              {getCompOffStatusLabel(row)}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground text-center">
                          {compOffView === "all" ? "No comp-off records available." : "No earned comp-off records available."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="w-full shadow-sm">
            <CardHeader className="px-3 py-2 sm:px-6 sm:py-4">
              <CardTitle className="text-xs sm:text-base">Leave Summary</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                <Table>
                  <TableHeader className="border-b-2 border-slate-300 bg-slate-200/95 dark:border-slate-700 dark:bg-slate-900">
                    <TableRow className="border-b-0 hover:bg-transparent">
                      <TableHead className="px-2 py-1.5 text-[8px] font-bold uppercase tracking-[0.14em] text-slate-800 dark:text-slate-200 sm:px-4 sm:py-3 sm:text-xs">Leave Type</TableHead>
                      <TableHead className="px-2 py-1.5 text-[8px] font-bold uppercase tracking-[0.14em] text-slate-800 dark:text-slate-200 sm:px-4 sm:py-3 sm:text-xs">Leave Used On</TableHead>
                      <TableHead className="px-2 py-1.5 text-[8px] font-bold uppercase tracking-[0.14em] text-slate-800 dark:text-slate-200 sm:px-4 sm:py-3 sm:text-xs">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaveSummary.map((row, idx) => (
                      <TableRow
                        key={row.type}
                        className={`${idx % 2 === 0 ? "bg-white dark:bg-slate-950" : "bg-slate-50/70 dark:bg-slate-900/70"}`}
                      >
                        <TableCell className="px-2 py-1.5 sm:px-4 sm:py-2">
                          <span
                            className={`inline-flex min-h-7 items-center border-l-4 px-1.5 py-1 text-[10px] font-semibold leading-snug sm:min-h-11 sm:px-3 sm:py-2 sm:text-sm ${getLeaveTypeHighlightClass(row.type)}`}
                          >
                            {row.type}
                          </span>
                        </TableCell>
                        <TableCell className="px-2 py-1.5 sm:px-4 sm:py-2">
                          <div className="flex flex-wrap gap-1 sm:gap-2">
                            {row.dates.length > 0 ? (
                              row.dates.map((d) => (
                                <Badge key={d} variant="secondary" className="bg-slate-100 text-[8px] text-slate-700 px-1.5 py-0.5 dark:bg-slate-800 dark:text-slate-200 sm:text-xs sm:px-2.5 sm:py-0.5">
                                  {d}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-[9px] text-muted-foreground sm:text-xs">No records</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-2 py-1.5 sm:px-4 sm:py-2">
                          <Badge variant="secondary" className="bg-emerald-100 text-[9px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 sm:text-xs">
                            {row.count ?? row.dates.length}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Leave Calendar</CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 md:text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50">
                  <span className="inline-flex rounded-sm bg-amber-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-900/70 dark:text-amber-100">REQ</span>
                  Applied
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50">
                  <span className="inline-flex rounded-sm bg-emerald-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-100">APR</span>
                  Approved
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="font-semibold min-w-[160px] text-center">{monthLabel}</div>
              <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-7 gap-px border border-slate-200 dark:border-slate-800 mt-4 text-sm">
              {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                <div key={d} className="bg-slate-50 dark:bg-slate-900 text-center py-2 font-semibold text-xs text-slate-700 dark:text-slate-300">{d}</div>
              ))}
              {calendarGrid.map((cell, idx) => {
                const leaveStyle = cell.iso ? calendarLeaves.get(cell.iso) : undefined;
                const todayIso = new Date().toISOString().split("T")[0];
                const isToday = cell.iso === todayIso;

                return (
                  <div
                    key={idx}
                    className={`h-20 bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-900 p-1.5 text-xs ${!cell.day ? "bg-slate-50/50 dark:bg-slate-900/70" : ""}`}
                  >
                    {cell.day && (
                      <div className="flex h-full flex-col">
                        <div className={`font-medium ${isToday ? "text-blue-600 dark:text-blue-400 font-bold" : "text-slate-600 dark:text-slate-300"}`}>
                          {cell.day}
                        </div>
                        {leaveStyle && (
                          <div
                            className={`mt-1 flex flex-1 items-end rounded-md px-1.5 py-1 ${leaveStyle.cellClass}`}
                          >
                            <span className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${leaveStyle.badgeClass}`}>
                              {leaveStyle.label}
                              {leaveStyle.label === "LEAVE" ? <CheckCircle2 className="h-3 w-3" /> : null}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
