import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShieldAlert, Search, X, CalendarDays, Users, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { endOfMonth, format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { getLeaveTypeLabel, YEAR_LOOKBACK } from "@/lib/leaveConstants";
import {
  fetchLeaveDiscrepancies,
  type DiscrepancyKind,
  type DiscrepancyRow,
} from "@/lib/leaveReconciliation";
import { useResolveSheetConflict } from "@/hooks/useLeaveBacklog";
import { useToast } from "@/hooks/use-toast";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: YEAR_LOOKBACK }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i),
  label: format(new Date(2000, i, 1), "MMMM"),
}));

const LEAVE_TYPE_BADGE_COLORS: Record<string, string> = {
  CL: "bg-amber-100 text-amber-800",
  EL: "bg-blue-100 text-blue-800",
  NEE: "bg-blue-100 text-blue-800",
  COMP_OFF: "bg-rose-100 text-rose-800",
  RH: "bg-teal-100 text-teal-800",
};
function leaveTypeBadgeClass(type: string | null): string {
  if (!type) return "bg-slate-100 text-slate-700";
  return LEAVE_TYPE_BADGE_COLORS[type.toUpperCase()] ?? "bg-violet-100 text-violet-800";
}

const KIND_ORDER: DiscrepancyKind[] = [
  "schedule_no_request",
  "approved_no_schedule",
  "record_no_schedule",
  "sheet_vs_app",
];

const KIND_META: Record<DiscrepancyKind, { label: string; short: string; badge: string }> = {
  schedule_no_request: {
    label: "In schedule · no data",
    short: "in schedule",
    badge: "bg-orange-100 text-orange-800",
  },
  approved_no_schedule: {
    label: "Approved · not in schedule",
    short: "approved",
    badge: "bg-blue-100 text-blue-800",
  },
  record_no_schedule: {
    label: "Record · not in schedule",
    short: "record",
    badge: "bg-green-100 text-green-800",
  },
  sheet_vs_app: {
    label: "Sheet · disagrees with app",
    short: "sheet conflict",
    badge: "bg-purple-100 text-purple-800",
  },
};


export default function LeaveDiscrepancyPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<"date" | "employee">("date");
  // Tracks the collapsed employees, so groups start expanded.
  const [collapsedCodes, setCollapsedCodes] = useState<Set<string>>(new Set());

  const { toast } = useToast();
  const resolveConflict = useResolveSheetConflict();

  const resolve = async (
    recordId: string | null | undefined,
    resolution: "keep_app" | "accept_sheet",
  ) => {
    if (!recordId) return;
    try {
      const result = await resolveConflict.mutateAsync({ recordId, resolution });
      toast({
        title: result?.ok
          ? resolution === "keep_app"
            ? "Kept the app value"
            : "Applied the sheet value"
          : "Nothing to resolve",
        description: result?.ok ? undefined : result?.message,
      });
    } catch (err) {
      toast({
        title: "Could not resolve this conflict",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const monthStart = format(new Date(selectedYear, selectedMonth, 1), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date(selectedYear, selectedMonth, 1)), "yyyy-MM-dd");

  const { data: discrepancies = [], isLoading, error } = useQuery({
    queryKey: ["leave-discrepancy-page", monthStart, monthEnd],
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchLeaveDiscrepancies(monthStart, monthEnd),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return discrepancies;
    return discrepancies.filter(
      (row) =>
        row.employeeName.toLowerCase().includes(q) ||
        row.employeeCode.toLowerCase().includes(q) ||
        row.team.toLowerCase().includes(q),
    );
  }, [discrepancies, search]);

  // One entry per person, their dates ascending, busiest people first.
  const employeeGroups = useMemo(() => {
    const map = new Map<string, { code: string; name: string; team: string; rows: DiscrepancyRow[] }>();
    for (const row of filtered) {
      let group = map.get(row.employeeCode);
      if (!group) {
        group = { code: row.employeeCode, name: row.employeeName, team: row.team, rows: [] };
        map.set(row.employeeCode, group);
      }
      group.rows.push(row);
    }
    return [...map.values()]
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort(
          (a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind),
        ),
        counts: KIND_ORDER.reduce(
          (acc, kind) => {
            acc[kind] = group.rows.filter((r) => r.kind === kind).length;
            return acc;
          },
          {} as Record<DiscrepancyKind, number>,
        ),
      }))
      .sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
  }, [filtered]);

  const allCollapsed = employeeGroups.length > 0 && collapsedCodes.size >= employeeGroups.length;

  const toggleGroup = (code: string) =>
    setCollapsedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const toggleAllGroups = () =>
    setCollapsedCodes(allCollapsed ? new Set() : new Set(employeeGroups.map((g) => g.code)));

  const scheduleNoRequest = filtered.filter((r) => r.kind === "schedule_no_request");
  const approvedNoSchedule = filtered.filter((r) => r.kind === "approved_no_schedule");
  const recordNoSchedule = filtered.filter((r) => r.kind === "record_no_schedule");
  const sheetVsApp = filtered.filter((r) => r.kind === "sheet_vs_app");

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6">
        {/* Header */}
        <div className="rounded-3xl border border-slate-200 bg-gradient-to-r from-rose-50 via-white to-slate-50 p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-rose-100 p-3 text-rose-700">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                  Leave Discrepancy Report
                </h1>
                <p className="mt-1 text-sm text-muted-foreground sm:text-base">
                  Mismatches between the roster, leave requests, leave records, and the Google Sheet.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:items-center">
              <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                <SelectTrigger className="h-10 w-[140px]">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="h-10 w-[110px]">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-4 pb-4 text-sm text-red-800">
              {(error as Error).message || "Failed to load discrepancy data"}
            </CardContent>
          </Card>
        )}

        {/* Summary cards */}
        {!isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Card className="shadow-sm">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <div className="text-sm text-muted-foreground">Total Discrepancies</div>
                  <div className="mt-1 text-3xl font-black text-slate-900">{discrepancies.length}</div>
                </div>
                <ShieldAlert className="h-10 w-10 text-rose-300" />
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <div className="text-sm text-muted-foreground">In Schedule — No Data</div>
                  <div className="mt-1 text-3xl font-black text-orange-600">
                    {discrepancies.filter((r) => r.kind === "schedule_no_request").length}
                  </div>
                </div>
                <div className="rounded-full bg-orange-100 p-3 text-orange-600">
                  <ShieldAlert className="h-6 w-6" />
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <div className="text-sm text-muted-foreground">Approved — Not in Schedule</div>
                  <div className="mt-1 text-3xl font-black text-blue-600">
                    {discrepancies.filter((r) => r.kind === "approved_no_schedule").length}
                  </div>
                </div>
                <div className="rounded-full bg-blue-100 p-3 text-blue-600">
                  <ShieldAlert className="h-6 w-6" />
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <div className="text-sm text-muted-foreground">Record — Not in Schedule</div>
                  <div className="mt-1 text-3xl font-black text-green-600">
                    {discrepancies.filter((r) => r.kind === "record_no_schedule").length}
                  </div>
                </div>
                <div className="rounded-full bg-green-100 p-3 text-green-600">
                  <ShieldAlert className="h-6 w-6" />
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <div className="text-sm text-muted-foreground">Sheet — Disagrees with App</div>
                  <div className="mt-1 text-3xl font-black text-purple-600">
                    {discrepancies.filter((r) => r.kind === "sheet_vs_app").length}
                  </div>
                </div>
                <div className="rounded-full bg-purple-100 p-3 text-purple-600">
                  <ShieldAlert className="h-6 w-6" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Table */}
        <Card className="shadow-sm">
          <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">
                Discrepancies — {MONTH_OPTIONS[selectedMonth]?.label} {selectedYear}
              </CardTitle>
              <CardDescription>
                Showing {filtered.length} of {discrepancies.length} record
                {discrepancies.length !== 1 ? "s" : ""}
                {groupBy === "employee" &&
                  ` across ${employeeGroups.length} ${
                    employeeGroups.length === 1 ? "employee" : "employees"
                  }`}
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              {/* Group-by toggle */}
              <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {([
                  ["date", "By date", CalendarDays],
                  ["employee", "By employee", Users],
                ] as const).map(([mode, label, Icon]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setGroupBy(mode)}
                    aria-pressed={groupBy === mode}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      groupBy === mode
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-[260px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 pr-8"
                  placeholder="Search by name, ID or team…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearch("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex h-48 items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                <ShieldAlert className="h-8 w-8 text-green-400" />
                <span className="font-medium text-green-700">No discrepancies found</span>
                <span>Schedule and leave records are in sync for this period.</span>
              </div>
            ) : groupBy === "employee" ? (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={toggleAllGroups}>
                    {allCollapsed ? "Expand all" : "Collapse all"}
                  </Button>
                </div>

                {employeeGroups.map((group) => {
                  const isOpen = !collapsedCodes.has(group.code);
                  return (
                    <div key={group.code} className="overflow-hidden rounded-xl border border-slate-200">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.code)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-3 bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-slate-900">{group.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {group.code} · Team {group.team}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          {KIND_ORDER.filter((kind) => group.counts[kind] > 0).map((kind) => (
                            <Badge key={kind} className={`text-[10px] ${KIND_META[kind].badge}`}>
                              {group.counts[kind]} {KIND_META[kind].short}
                            </Badge>
                          ))}
                          <Badge variant="secondary" className="text-xs">
                            {group.rows.length} {group.rows.length === 1 ? "day" : "days"}
                          </Badge>
                        </div>
                      </button>

                      {isOpen && (
                        <ul className="divide-y">
                          {group.rows.map((row) => (
                            <li
                              key={`${row.date}-${row.kind}`}
                              className="flex flex-col gap-1.5 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3"
                            >
                              <span className="shrink-0 text-sm font-medium text-slate-800 sm:w-[110px]">
                                {format(parseISO(row.date), "dd MMM yyyy")}
                              </span>
                              <span className="shrink-0 sm:w-[80px]">
                                {row.leaveType ? (
                                  <Badge className={`text-xs ${leaveTypeBadgeClass(row.leaveType)}`}>
                                    {getLeaveTypeLabel(row.leaveType)}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </span>
                              <Badge className={`w-fit shrink-0 text-xs ${KIND_META[row.kind].badge}`}>
                                {KIND_META[row.kind].label}
                              </Badge>
                              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                                {row.detail}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-left">
                      <th className="px-3 py-3 font-semibold text-slate-700">Date</th>
                      <th className="px-3 py-3 font-semibold text-slate-700">Employee</th>
                      <th className="px-3 py-3 font-semibold text-slate-700">Emp ID</th>
                      <th className="px-3 py-3 font-semibold text-slate-700">Team</th>
                      <th className="px-3 py-3 font-semibold text-slate-700">Leave Type</th>
                      <th className="px-3 py-3 font-semibold text-slate-700">Discrepancy</th>
                      <th className="px-3 py-3 font-semibold text-slate-700">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row, idx) => (
                      <tr
                        key={`${row.employeeCode}-${row.date}-${row.kind}`}
                        className={`border-b transition-colors ${
                          idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"
                        } hover:bg-slate-100/60`}
                      >
                        <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-800">
                          {format(parseISO(row.date), "dd MMM yyyy")}
                        </td>
                        <td className="px-3 py-3 font-semibold text-slate-900">
                          {row.employeeName}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground text-xs">
                          {row.employeeCode}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="secondary" className="text-xs">
                            {row.team}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          {row.leaveType ? (
                            <Badge className={`text-xs ${leaveTypeBadgeClass(row.leaveType)}`}>
                              {getLeaveTypeLabel(row.leaveType)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Badge className={`text-xs ${KIND_META[row.kind].badge}`}>
                            {KIND_META[row.kind].label}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          {row.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grouped breakdown */}
        {!isLoading && filtered.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-orange-700">
                  In Schedule — No Data ({scheduleNoRequest.length})
                </CardTitle>
                <CardDescription>
                  Marked LEAVE in schedule but no leave request or leave record found.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {scheduleNoRequest.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None for this period.</p>
                ) : (
                  <ul className="divide-y">
                    {scheduleNoRequest.map((row) => (
                      <li
                        key={`${row.employeeCode}-${row.date}`}
                        className="flex items-start justify-between gap-3 py-2.5"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">{row.employeeName}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.employeeCode} · Team {row.team}
                          </div>
                        </div>
                        <div className="text-right text-xs text-slate-600 shrink-0">
                          {format(parseISO(row.date), "dd MMM yyyy")}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-blue-700">
                  Approved — Not in Schedule ({approvedNoSchedule.length})
                </CardTitle>
                <CardDescription>
                  Approved leave request exists but the schedule was not updated.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {approvedNoSchedule.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None for this period.</p>
                ) : (
                  <ul className="divide-y">
                    {approvedNoSchedule.map((row) => (
                      <li
                        key={`${row.employeeCode}-${row.date}`}
                        className="flex items-start justify-between gap-3 py-2.5"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">{row.employeeName}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.employeeCode} · Team {row.team}
                          </div>
                          {row.leaveType && (
                            <Badge className={`mt-1 text-[10px] ${leaveTypeBadgeClass(row.leaveType)}`}>
                              {getLeaveTypeLabel(row.leaveType)}
                            </Badge>
                          )}
                        </div>
                        <div className="text-right text-xs text-slate-600 shrink-0">
                          {format(parseISO(row.date), "dd MMM yyyy")}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-green-700">
                  Leave Record — Not in Schedule ({recordNoSchedule.length})
                </CardTitle>
                <CardDescription>
                  Leave data exists in records but the schedule was not updated.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {recordNoSchedule.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None for this period.</p>
                ) : (
                  <ul className="divide-y">
                    {recordNoSchedule.map((row) => (
                      <li
                        key={`${row.employeeCode}-${row.date}`}
                        className="flex items-start justify-between gap-3 py-2.5"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">{row.employeeName}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.employeeCode} · Team {row.team}
                          </div>
                          {row.leaveType && (
                            <Badge className={`mt-1 text-[10px] ${leaveTypeBadgeClass(row.leaveType)}`}>
                              {getLeaveTypeLabel(row.leaveType)}
                            </Badge>
                          )}
                        </div>
                        <div className="text-right text-xs text-slate-600 shrink-0">
                          {format(parseISO(row.date), "dd MMM yyyy")}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-purple-700">
                  Sheet — Disagrees with App ({sheetVsApp.length})
                </CardTitle>
                <CardDescription>
                  The Google Sheet tried to overwrite a record the app owns. The app value was kept;
                  what the sheet sent is shown below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sheetVsApp.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None for this period.</p>
                ) : (
                  <ul className="divide-y">
                    {sheetVsApp.map((row) => (
                      <li
                        key={`${row.employeeCode}-${row.date}-sheet`}
                        className="flex items-start justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{row.employeeName}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.employeeCode} · Team {row.team}
                          </div>
                          {row.leaveType && (
                            <Badge className={`mt-1 text-[10px] ${leaveTypeBadgeClass(row.leaveType)}`}>
                              {getLeaveTypeLabel(row.leaveType)}
                            </Badge>
                          )}
                          {row.sheetShadow && (
                            <div className="mt-1 break-words text-[11px] text-purple-700">
                              Sheet sent:{" "}
                              {Object.entries(row.sheetShadow)
                                .map(([key, value]) => `${key}=${String(value)}`)
                                .join(", ")}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className="text-xs text-slate-600">
                            {format(parseISO(row.date), "dd MMM yyyy")}
                          </span>
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              disabled={resolveConflict.isPending}
                              onClick={() => resolve(row.recordId, "keep_app")}
                            >
                              Keep app
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              disabled={resolveConflict.isPending}
                              onClick={() => resolve(row.recordId, "accept_sheet")}
                            >
                              Accept sheet
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
