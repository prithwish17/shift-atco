import { useMemo, useState } from "react";
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
  const { data, leaveQuery, refresh } = useLeaveData(selectedYear);

  const [calendarDate, setCalendarDate] = useState(() => new Date());

  const employeeRecord = useMemo(() => {
    const empId = profile?.employee_id ? String(profile.employee_id) : "";
    if (!empId) return null;
    return data.find((record) => record.empId === empId) || null;
  }, [data, profile?.employee_id]);

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

  const cards = useMemo(() => {
    if (!employeeRecord) {
      return [
        { label: "Casual Leave", remaining: 0, total: 12, color: "#4FD1C5", helper: "0 used" },
        { label: "Earned Leave", remaining: 0, total: 0, color: "#63B3ED", helper: "No synced data" },
        { label: "Compensatory Off", remaining: 0, total: 0, color: "#F87171", helper: "0 used" },
        { label: "Reserved Holiday", remaining: 0, total: 2, color: "#F6AD55", helper: "0 used" },
      ];
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
    ];
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Leave Management System</h1>
            <p className="text-sm text-muted-foreground mt-1">
              View your leave balances and usage from the official register
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-[120px] h-9">
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
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refresh.isPending ? "animate-spin" : ""}`} />
              {refresh.isPending ? "Syncing…" : "Sync Data"}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {cards.map((card) => {
            const percent = card.total > 0 ? Math.round(((card.total - card.remaining) / card.total) * 100) : 0;
            return (
              <Card key={card.label} className="shadow-sm h-full">
                <CardContent className="flex h-full items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remaining</div>
                    <div className="mt-1 text-2xl font-black leading-none tracking-tight text-slate-900 sm:mt-2 sm:text-3xl">
                      {card.total > 0 ? `${card.remaining} / ${card.total}` : "—"}
                    </div>
                    <div className="mt-1 text-lg font-semibold leading-snug break-words">{card.label}</div>
                    <div className="text-xs text-muted-foreground mt-1 break-words">
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
              <div className="border rounded-lg overflow-hidden mb-4">
                <div className="grid grid-cols-6 bg-emerald-50 text-emerald-900 text-xs font-semibold uppercase tracking-wide">
                  <div className="px-3 py-2 border-r">Duty Date</div>
                  <div className="px-3 py-2 border-r">Duty Code</div>
                  <div className="px-3 py-2 border-r">Source</div>
                  <div className="px-3 py-2 border-r">Leave Used On</div>
                  <div className="px-3 py-2 border-r">Expiry Date</div>
                  <div className="px-3 py-2">Remarks</div>
                </div>
                <div className="divide-y">
                  {compOffLedgerRows.length ? (
                    compOffLedgerRows.map((row, idx) => (
                      <div
                        key={`${row.sourceType}-${row.dutyDate || row.leaveApplied || idx}`}
                        className={`grid grid-cols-6 text-sm ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/70"}`}
                      >
                        <div className="px-3 py-2 text-slate-700">{formatDate(row.dutyDate) || "—"}</div>
                        <div className="px-3 py-2 text-slate-700">{row.dutyPerformed || "—"}</div>
                        <div className="px-3 py-2">
                          <Badge variant="secondary" className="bg-sky-100 text-sky-800 text-[10px]">
                            {getCompOffSourceLabel(row.sourceType, row.sourceLabel)}
                          </Badge>
                        </div>
                        <div className="px-3 py-2 text-slate-700">{formatDate(row.leaveApplied) || "—"}</div>
                        <div className="px-3 py-2 text-slate-700">{formatDate(row.expiryDate) || "—"}</div>
                        <div className="px-3 py-2">
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${getCompOffStatusBadgeClass(row.status)}`}
                          >
                            {getCompOffStatusLabel(row)}
                          </Badge>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Leave Type</TableHead>
                    <TableHead>Dates Taken</TableHead>
                    <TableHead>Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaveSummary.map((row) => (
                    <TableRow key={row.type}>
                      <TableCell className="font-medium">{row.type}</TableCell>
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
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Leave Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
                <div className="font-semibold min-w-[160px] text-center">{monthLabel}</div>
                <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {["CL", "RH", "NH", "CH", "COFF", "OPE", "EL"].map((key) => (
                  <Badge
                    key={key}
                    variant="secondary"
                    className={`${CALENDAR_LEAVE_STYLES[key].badgeClass} border-0 text-[10px] font-semibold`}
                  >
                    {CALENDAR_LEAVE_STYLES[key].legend}
                  </Badge>
                ))}
              </div>
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
