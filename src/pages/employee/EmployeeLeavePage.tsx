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
import { ChevronLeft, ChevronRight, RefreshCw, CalendarDays } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLeaveData } from "@/hooks/useLeaveData";
import type { CompOffHistoryEntry } from "@/utils/leaveCalculations";

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

// Extract ISO date strings (YYYY-MM-DD) from items for calendar matching
function extractIsoDates(items: unknown[], fields: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      try {
        const d = new Date(item);
        if (!isNaN(d.getTime())) out.push(d.toISOString().split("T")[0]);
      } catch { /* skip */ }
      continue;
    }
    if (item && typeof item === "object") {
      if ((item as any).hideDates) continue;
      for (const field of fields) {
        const val = (item as any)[field];
        if (typeof val === "string") {
          try {
            const d = new Date(val);
            if (!isNaN(d.getTime())) out.push(d.toISOString().split("T")[0]);
          } catch { /* skip */ }
        }
      }
    }
  }
  return out;
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
      return "bg-teal-100 text-teal-800";
    case "FROM_LAST_YEAR":
    case "LAST_YEAR_CH_DUTY":
    case "LAST_YEAR_COMP_OFF":
      return "bg-violet-100 text-violet-800";
    case "OPE_DUTY":
    case "OPE":
    case "OPE_COMP_OFF":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-sky-100 text-sky-800";
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
      return "bg-red-100 text-red-700";
    case "expired":
      return "bg-rose-100 text-rose-800";
    case "used":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-emerald-100 text-emerald-800";
  }
}

function getLeaveTypeHighlightClass(type: string): string {
  switch (type) {
    case "Casual Leave":
      return "border-l-teal-500 bg-teal-50/80 text-teal-900";
    case "Earned Leave":
      return "border-l-blue-500 bg-blue-50/80 text-blue-900";
    case "Compensatory Off":
      return "border-l-rose-500 bg-rose-50/80 text-rose-900";
    case "Reserved Holiday":
      return "border-l-amber-500 bg-amber-50/80 text-amber-900";
    default:
      return "border-l-slate-400 bg-slate-50 text-slate-900";
  }
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 3 }, (_, i) => CURRENT_YEAR - i);

type CalendarLeaveStyle = {
  label: string;
  legend: string;
  cellClass: string;
  badgeClass: string;
};

const CALENDAR_LEAVE_STYLES: Record<string, CalendarLeaveStyle> = {
  CL: {
    label: "CL",
    legend: "CL",
    cellClass: "bg-teal-100 text-teal-900",
    badgeClass: "bg-teal-200 text-teal-900",
  },
  RH: {
    label: "RH",
    legend: "RH",
    cellClass: "bg-amber-100 text-amber-900",
    badgeClass: "bg-amber-200 text-amber-900",
  },
  NH: {
    label: "NH",
    legend: "NH",
    cellClass: "bg-sky-100 text-sky-900",
    badgeClass: "bg-sky-200 text-sky-900",
  },
  CH: {
    label: "CH",
    legend: "CH",
    cellClass: "bg-violet-100 text-violet-900",
    badgeClass: "bg-violet-200 text-violet-900",
  },
  COFF: {
    label: "C-OFF",
    legend: "C-OFF",
    cellClass: "bg-rose-100 text-rose-900",
    badgeClass: "bg-rose-200 text-rose-900",
  },
  OPE: {
    label: "OPE",
    legend: "OPE",
    cellClass: "bg-orange-100 text-orange-900",
    badgeClass: "bg-orange-200 text-orange-900",
  },
  EL: {
    label: "EL",
    legend: "EL",
    cellClass: "bg-blue-100 text-blue-900",
    badgeClass: "bg-blue-200 text-blue-900",
  },
};

export default function EmployeeLeavePage() {
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const employeeEmpId = profile?.employee_id ? String(profile.employee_id) : null;
  const { data, leaveQuery, refresh } = useLeaveData(selectedYear, employeeEmpId);

  const [calendarDate, setCalendarDate] = useState(() => new Date());

  const employeeRecord = useMemo(() => {
    const empId = employeeEmpId || "";
    if (!empId) return null;
    return data.find((record) => record.empId === empId) || null;
  }, [data, employeeEmpId]);

  const isLoading = profileLoading || leaveQuery.isLoading;

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

  const visibleCompOffLedgerRows = useMemo(
    () => compOffLedgerRows.filter((row) => row.status === "available"),
    [compOffLedgerRows],
  );

  const cards = useMemo(() => {
    if (!employeeRecord) {
      return [];
    }

    return [
      {
        label: "Casual Leave",
        remaining: employeeRecord.casualRemaining,
        total: 12,
        color: "#4FD1C5",
        helper: `${employeeRecord.casualCount} used`,
      },
      {
        label: "Earned Leave",
        remaining: 0,
        total: 0,
        color: "#63B3ED",
        helper: "No synced data",
      },
      {
        label: "Compensatory Off",
        remaining: employeeRecord.compOffRemaining,
        total: employeeRecord.compOffEarned,
        color: "#F87171",
        helper: `${employeeRecord.compOffUsed} used${employeeRecord.compOffExpired ? ` · ${employeeRecord.compOffExpired} expired` : ""}`,
      },
      {
        label: "Reserved Holiday",
        remaining: Math.max(2 - employeeRecord.restrictedCount, 0),
        total: 2,
        color: "#F6AD55",
        helper: `${employeeRecord.restrictedCount} used`,
      },
    ].filter((card) => card.label === "Earned Leave" || card.remaining > 0);
  }, [employeeRecord]);

  const leaveSummary = useMemo(() => {
    if (!employeeRecord) return [];
    const casualDates = extractDates(employeeRecord.casualLeave, []);
    const reservedDates = extractDates(employeeRecord.restrictedHolidays, ["date", "leaveApplied"]);
    const compOffDates = extractDates(employeeRecord.compOffUsedEntries, ["leaveApplied"]);

    return [
      { type: "Casual Leave", dates: casualDates },
      { type: "Earned Leave", dates: [] },
      { type: "Compensatory Off", dates: compOffDates },
      { type: "Reserved Holiday", dates: reservedDates },
    ];
  }, [employeeRecord]);

  // Calendar data: map of ISO date -> leave style
  const calendarLeaves = useMemo(() => {
    if (!employeeRecord) return new Map<string, CalendarLeaveStyle>();
    const map = new Map<string, CalendarLeaveStyle>();

    const addDates = (dates: string[], style: CalendarLeaveStyle) => {
      dates.forEach((d) => {
        if (!map.has(d)) map.set(d, style);
      });
    };

    const clDates = extractIsoDates(employeeRecord.casualLeave, []);
    addDates(clDates, CALENDAR_LEAVE_STYLES.CL);

    const rhDates = extractIsoDates(employeeRecord.restrictedHolidays, ["date"]);
    addDates(rhDates, CALENDAR_LEAVE_STYLES.RH);

    const nhDates = extractIsoDates(employeeRecord.nationalHolidays, []);
    addDates(nhDates, CALENDAR_LEAVE_STYLES.NH);

    const chDates = extractIsoDates(employeeRecord.closedHolidays, ["leaveApplied"]);
    addDates(chDates, CALENDAR_LEAVE_STYLES.CH);

    const coDates = extractIsoDates(employeeRecord.compOffUsedEntries, ["leaveApplied"]);
    addDates(coDates, CALENDAR_LEAVE_STYLES.COFF);

    const opeDates = extractIsoDates(employeeRecord.opeDuty, ["opeDutyDate"]);
    addDates(opeDates, CALENDAR_LEAVE_STYLES.OPE);

    return map;
  }, [employeeRecord]);

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
            <h1 className="whitespace-nowrap text-2xl font-black tracking-tight">Leave Summary</h1>
            <p className="text-sm text-muted-foreground mt-1">
              View your leave balances and usage from the official register
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="h-9 w-full sm:w-[120px]">
                <CalendarDays className="h-4 w-4 mr-1.5 text-muted-foreground" />
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
              <RefreshCw className={`h-4 w-4 mr-2 ${refresh.isPending ? "animate-spin" : ""}`} />
              {refresh.isPending ? "Syncing…" : "Sync Data"}
            </Button>
            <Button asChild size="sm" className="w-full sm:w-auto">
              <Link to="/employee/leave">Apply Leave</Link>
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Leave Availability</h2>
        </div>

        {leaveQuery.error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-4 pb-4 text-sm text-red-800">
              {(leaveQuery.error as Error).message || "Failed to load leave data"}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          </div>
        ) : !profile?.employee_id ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-4 pb-4 text-sm text-amber-800">
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

        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {cards.map((card) => {
            const percent = card.total > 0 ? Math.round(((card.total - card.remaining) / card.total) * 100) : 0;
            return (
              <Card key={card.label} className="shadow-sm h-full">
                <CardContent className="flex h-full items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-800">{card.label}</div>
                    <div className="mt-1 text-2xl font-black leading-none tracking-tight text-slate-900 sm:mt-2 sm:text-3xl">
                      {card.total > 0 ? `${card.remaining} / ${card.total}` : "—"}
                    </div>
                    <div className="mt-1 break-words text-xs font-semibold text-slate-700">
                      {card.total > 0 ? "remaining" : "No balance data"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 break-words">
                      {card.helper}
                    </div>
                  </div>
                  <div
                    className="h-16 w-16 shrink-0 rounded-full flex items-center justify-center self-center"
                    style={{
                      background: `conic-gradient(${card.color} ${percent}%, #E5E7EB 0)`,
                    }}
                  >
                    <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center">
                      <div className="text-sm font-bold text-slate-700">{percent}%</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Comp-Off Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Earned: {employeeRecord?.compOffEarned ?? 0}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Used: {employeeRecord?.compOffUsed ?? 0}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Expired: {employeeRecord?.compOffExpired ?? 0}</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> Remaining: {employeeRecord?.compOffRemaining ?? 0}</span>
                </div>
              </div>
              <div className="space-y-3 mb-4 sm:hidden">
                {visibleCompOffLedgerRows.length ? (
                  visibleCompOffLedgerRows.map((row, idx) => (
                    <div
                      key={`${row.sourceType}-${row.dutyDate || row.leaveApplied || idx}-mobile`}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0 text-base font-bold tracking-tight text-slate-900">
                          {formatDate(row.dutyDate) || "—"}
                        </div>
                        <span
                          className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-tight ${getCompOffStatusBadgeClass(row.status)}`}
                        >
                          {getCompOffStatusLabel(row)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        <div>
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Duty Code</div>
                          <div className="text-sm font-semibold text-slate-800">{row.dutyPerformed || "—"}</div>
                        </div>
                        <div>
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Source</div>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${getCompOffSourceBadgeClass(row.sourceType)}`}
                          >
                            {getCompOffSourceLabel(row.sourceType, row.sourceLabel)}
                          </span>
                        </div>
                        <div>
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Leave Used On</div>
                          <div className="text-sm font-semibold text-slate-800">{formatDate(row.leaveApplied) || "—"}</div>
                        </div>
                        <div>
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Expiry Date</div>
                          <div className="text-sm font-semibold text-slate-800">{formatDate(row.expiryDate) || "—"}</div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-muted-foreground">
                    No earned comp-off records available.
                  </div>
                )}
              </div>

              <div className="hidden sm:block border rounded-lg overflow-hidden mb-4">
                <div className="grid grid-cols-6 border-b-2 border-slate-300 bg-slate-200/95 text-slate-800 text-xs font-bold uppercase tracking-[0.14em] shadow-sm">
                  <div className="px-3 py-2.5 border-r border-slate-300">Duty Date</div>
                  <div className="px-3 py-2.5 border-r border-slate-300">Duty Code</div>
                  <div className="px-3 py-2.5 border-r border-slate-300">Source</div>
                  <div className="px-3 py-2.5 border-r border-slate-300">Leave Used On</div>
                  <div className="px-3 py-2.5 border-r border-slate-300">Expiry Date</div>
                  <div className="px-3 py-2.5">Remarks</div>
                </div>
                <div className="divide-y divide-slate-200">
                  {visibleCompOffLedgerRows.length ? (
                    visibleCompOffLedgerRows.map((row, idx) => (
                      <div
                        key={`${row.sourceType}-${row.dutyDate || row.leaveApplied || idx}`}
                        className={`grid grid-cols-6 text-sm ${idx % 2 === 0 ? "bg-sky-100/70" : "bg-slate-50/80"}`}
                      >
                        <div className="px-3 py-2 text-slate-700">{formatDate(row.dutyDate) || "—"}</div>
                        <div className="px-3 py-2 text-slate-700">{row.dutyPerformed || "—"}</div>
                        <div className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-md px-2.5 py-1 text-[10px] font-semibold leading-tight ${getCompOffSourceBadgeClass(row.sourceType)}`}
                          >
                            {getCompOffSourceLabel(row.sourceType, row.sourceLabel)}
                          </span>
                        </div>
                        <div className="px-3 py-2 text-slate-700">{formatDate(row.leaveApplied) || "—"}</div>
                        <div className="px-3 py-2 text-slate-700">{formatDate(row.expiryDate) || "—"}</div>
                        <div className="px-3 py-2">
                          <span
                            className={`inline-flex rounded-md px-2.5 py-1 text-[10px] font-semibold leading-tight ${getCompOffStatusBadgeClass(row.status)}`}
                          >
                            {getCompOffStatusLabel(row)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-6 text-sm text-muted-foreground text-center">
                      No earned comp-off records available.
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Leave Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <Table>
                  <TableHeader className="border-b-2 border-slate-300 bg-slate-200/95">
                    <TableRow className="border-b-0 hover:bg-transparent">
                      <TableHead className="px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-800">Leave Type</TableHead>
                      <TableHead className="px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-800">Leave Used On</TableHead>
                      <TableHead className="px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-800">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaveSummary.map((row, idx) => (
                      <TableRow
                        key={row.type}
                        className={`${idx % 2 === 0 ? "bg-white" : "bg-slate-50/70"}`}
                      >
                        <TableCell>
                          <span
                            className={`inline-flex min-h-11 items-center border-l-4 px-3 py-2 text-sm font-semibold leading-snug ${getLeaveTypeHighlightClass(row.type)}`}
                          >
                            {row.type}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {row.dates.length > 0 ? (
                              row.dates.map((d) => (
                                <Badge key={d} variant="secondary" className="bg-slate-100 text-slate-700">
                                  {d}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">No records</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                            {row.dates.length}
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
            <CardTitle className="text-base">Leave Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="font-semibold min-w-[160px] text-center">{monthLabel}</div>
              <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-7 gap-px border border-slate-200 mt-4 text-sm">
              {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                <div key={d} className="bg-slate-50 text-center py-2 font-semibold text-xs">{d}</div>
              ))}
              {calendarGrid.map((cell, idx) => {
                const leaveStyle = cell.iso ? calendarLeaves.get(cell.iso) : undefined;
                const todayIso = new Date().toISOString().split("T")[0];
                const isToday = cell.iso === todayIso;

                return (
                  <div
                    key={idx}
                    className={`h-20 bg-white border border-slate-100 p-1.5 text-xs ${!cell.day ? "bg-slate-50/50" : ""}`}
                  >
                    {cell.day && (
                      <div className="flex h-full flex-col">
                        <div className={`font-medium ${isToday ? "text-blue-600 font-bold" : "text-slate-600"}`}>
                          {cell.day}
                        </div>
                        {leaveStyle && (
                          <div
                            className={`mt-1 flex flex-1 items-end rounded-md px-1.5 py-1 ${leaveStyle.cellClass}`}
                          >
                            <span className={`inline-flex rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${leaveStyle.badgeClass}`}>
                              {leaveStyle.label}
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
