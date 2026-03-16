import { useMemo, useState } from "react";
import { CalendarDays, Clock3, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useLeaveData } from "@/hooks/useLeaveData";
import type { CompOffHistoryEntry } from "@/utils/leaveCalculations";

type CompOffFilter = "all" | "available" | "used";

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

function getCompOffSourceLabel(sourceType?: string, sourceLabel?: string): string {
  switch ((sourceType || "").toUpperCase()) {
    case "COMP_OFF_DUTY":
      return "Comp-Off";
    case "FROM_LAST_YEAR":
    case "LAST_YEAR_CH_DUTY":
    case "LAST_YEAR_COMP_OFF":
      return "Last Year";
    case "OPE_DUTY":
    case "OPE":
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
      return "bg-emerald-100 text-emerald-800";
    case "FROM_LAST_YEAR":
    case "LAST_YEAR_CH_DUTY":
    case "LAST_YEAR_COMP_OFF":
      return "bg-violet-100 text-violet-800";
    case "OPE_DUTY":
    case "OPE":
    case "OPE_COMP_OFF":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function getCompOffStatusLabel(entry: CompOffHistoryEntry): string {
  if (entry.status === "available" && entry.daysRemaining != null) {
    return `${entry.daysRemaining} days left`;
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

function isDaysLeftStatus(entry: CompOffHistoryEntry): boolean {
  return entry.status === "available" && entry.daysRemaining != null;
}

function getCompOffStatusBadgeClass(entry: CompOffHistoryEntry): string {
  if (entry.status === "available") {
    if ((entry.daysRemaining ?? 0) >= 60) {
      return "bg-emerald-100 text-emerald-800";
    }
    return "bg-amber-100 text-amber-800";
  }

  switch (entry.status) {
    case "used":
      return "bg-slate-200 text-slate-700";
    case "expired":
      return "bg-rose-100 text-rose-800";
    case "not_available":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function getSortableDateValue(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
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

  return normalizedKey ? DUTY_CODE_LABELS[normalizedKey] : trimmed;
}

function compareCompOffRows(a: CompOffHistoryEntry, b: CompOffHistoryEntry): number {
  const leftDutyDate = getSortableDateValue(a.dutyDate);
  const rightDutyDate = getSortableDateValue(b.dutyDate);

  if (leftDutyDate !== rightDutyDate) {
    return rightDutyDate - leftDutyDate;
  }

  const leftLeaveDate = getSortableDateValue(a.leaveApplied);
  const rightLeaveDate = getSortableDateValue(b.leaveApplied);

  if (leftLeaveDate !== rightLeaveDate) {
    return rightLeaveDate - leftLeaveDate;
  }

  return `${b.sourceType}-${b.dutyPerformed}-${b.expiryDate || ""}`.localeCompare(
    `${a.sourceType}-${a.dutyPerformed}-${a.expiryDate || ""}`,
  );
}

function getCompOffRowKey(row: CompOffHistoryEntry): string {
  return [
    row.sourceType,
    row.sourceLabel || "",
    row.dutyDate || "",
    row.leaveApplied || "",
    row.dutyPerformed || "",
    row.expiryDate || "",
    row.status,
  ].join("|");
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 3 }, (_, i) => CURRENT_YEAR - i);

export default function EmployeeCompOffPage() {
  const { user } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [activeFilter, setActiveFilter] = useState<CompOffFilter>("all");
  const employeeEmpId = profile?.employee_id ? String(profile.employee_id) : null;
  const { data, leaveQuery, refresh } = useLeaveData(selectedYear, employeeEmpId);

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
      .sort(compareCompOffRows);
  }, [employeeRecord]);

  const filteredCompOffRows = useMemo(() => {
    const filtered = (() => {
      switch (activeFilter) {
        case "available":
          return compOffLedgerRows.filter((row) => row.status === "available");
        case "used":
          return compOffLedgerRows.filter((row) => row.status === "used");
        default:
          return compOffLedgerRows;
      }
    })();

    return [...filtered].sort(compareCompOffRows);
  }, [activeFilter, compOffLedgerRows]);

  return (
    <DashboardLayout role="employee">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight sm:text-2xl">Comp-Off Management</h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Track available comp-off, expiry timelines, and full comp-off history
            </p>
          </div>
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
        </div>

        {leaveQuery.error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pb-4 pt-4 text-sm text-red-800">
              {(leaveQuery.error as Error).message || "Failed to load comp-off data"}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        ) : !profile?.employee_id ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pb-4 pt-4 text-sm text-amber-800">
              Your profile is missing an Employee ID. Please update your profile.
            </CardContent>
          </Card>
        ) : !employeeRecord ? (
          <Card>
            <CardContent className="pb-6 pt-6 text-sm text-muted-foreground">
              No comp-off data found for Employee ID {profile.employee_id}. Ask an admin to sync leave data.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
              <Card className="shadow-sm">
                <CardContent className="p-2.5 sm:p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">Available</div>
                  <div className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:mt-2 sm:text-3xl">{employeeRecord.compOffRemaining}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground sm:mt-1 sm:text-sm">Comp-off currently available</div>
                </CardContent>
              </Card>
              <Card className="shadow-sm">
                <CardContent className="p-2.5 sm:p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">Used</div>
                  <div className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:mt-2 sm:text-3xl">{employeeRecord.compOffUsed}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground sm:mt-1 sm:text-sm">Already used this year view</div>
                </CardContent>
              </Card>
              <Card className="shadow-sm">
                <CardContent className="p-2.5 sm:p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">Expired</div>
                  <div className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:mt-2 sm:text-3xl">{employeeRecord.compOffExpired}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground sm:mt-1 sm:text-sm">Expired before use</div>
                </CardContent>
              </Card>
              <Card className="shadow-sm">
                <CardContent className="p-2.5 sm:p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">Earned</div>
                  <div className="mt-1 text-xl font-black tracking-tight text-slate-900 sm:mt-2 sm:text-3xl">{employeeRecord.compOffEarned}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground sm:mt-1 sm:text-sm">Total valid comp-off earned</div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm sm:text-base">Comp-Off Balance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground sm:text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 sm:gap-1.5 sm:px-3 sm:py-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Earned: {employeeRecord.compOffEarned}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 sm:gap-1.5 sm:px-3 sm:py-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-500" /> Used: {employeeRecord.compOffUsed}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 sm:gap-1.5 sm:px-3 sm:py-1.5">
                    <span className="h-2 w-2 rounded-full bg-rose-500" /> Expired: {employeeRecord.compOffExpired}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 sm:gap-1.5 sm:px-3 sm:py-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-500" /> Remaining: {employeeRecord.compOffRemaining}
                  </span>
                </div>

                <div className="mb-4 grid grid-cols-3 gap-2 sm:max-w-md">
                  {[
                    { key: "all" as const, label: "All" },
                    { key: "available" as const, label: "Available" },
                    { key: "used" as const, label: "Used" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveFilter(tab.key)}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors sm:px-4 sm:py-2.5 sm:text-sm ${
                        activeFilter === tab.key
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {filteredCompOffRows.length ? (
                    filteredCompOffRows.map((row) => (
                      <div
                        key={getCompOffRowKey(row)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:px-4 sm:py-3"
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0 text-sm font-bold tracking-tight text-slate-900 sm:text-lg">
                            {formatDate(row.dutyDate) || "—"}
                          </div>
                          <span
                            className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 font-semibold capitalize ${getCompOffStatusBadgeClass(row)}`}
                          >
                            {isDaysLeftStatus(row) ? (
                              <span className="flex items-baseline gap-1">
                                <span className="text-[13px] font-black leading-none sm:text-[15px]">{row.daysRemaining}</span>
                                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] sm:text-[10px]">days left</span>
                              </span>
                            ) : (
                              <span className="text-[10px] sm:text-[11px]">{getCompOffStatusLabel(row)}</span>
                            )}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          <div className="overflow-hidden">
                            <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-[10px]">Duty Performed</div>
                            <div className="text-xs font-semibold text-slate-800 sm:text-sm break-words">{formatDutyPerformed(row.dutyPerformed)}</div>
                          </div>
                          <div className="overflow-hidden">
                            <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-[10px]">Expiry Date</div>
                            <div className="text-xs font-semibold text-slate-800 sm:text-sm break-words">{formatDate(row.expiryDate) || "—"}</div>
                          </div>
                          <div className="overflow-hidden">
                            <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-[10px]">Source</div>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold sm:px-2.5 sm:text-[11px] ${getCompOffSourceBadgeClass(row.sourceType)}`}>
                              {getCompOffSourceLabel(row.sourceType, row.sourceLabel)}
                            </span>
                          </div>
                          <div className="overflow-hidden">
                            <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-[10px]">Leave Used On</div>
                            <div className="text-xs font-semibold text-slate-800 sm:text-sm break-words">{formatDate(row.leaveApplied) || "—"}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-muted-foreground">
                      No comp-off records match this filter.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
