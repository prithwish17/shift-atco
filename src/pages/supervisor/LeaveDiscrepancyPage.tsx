import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShieldAlert, Search, X, CalendarDays, Users, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { eachDayOfInterval, endOfMonth, format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getLeaveTypeLabel, YEAR_LOOKBACK } from "@/lib/leaveConstants";

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

const COMP_OFF_CATEGORIES = ["COMP_OFF", "COMP_OFF_USED", "OPE_COMP_OFF", "LAST_YEAR_COMP_OFF"];
const NON_COMPOFF_LEAVE_CATEGORIES = ["CL", "EL", "RH", "HPL", "NEE", "COMM"];

type DiscrepancyKind = "schedule_no_request" | "approved_no_schedule" | "record_no_schedule";

const KIND_ORDER: DiscrepancyKind[] = [
  "schedule_no_request",
  "approved_no_schedule",
  "record_no_schedule",
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
};

type DiscrepancyRow = {
  employeeCode: string;
  employeeName: string;
  team: string;
  date: string;
  kind: DiscrepancyKind;
  detail: string;
  leaveType: string | null;
  requestStatus: string | null;
};

async function fetchDiscrepancies(monthStart: string, monthEnd: string): Promise<DiscrepancyRow[]> {
  const [scheduleRes, requestRes, leaveRecordRes, compOffRecordRes] = await Promise.all([
    supabase
      .from("employee_schedules" as any)
      .select("employee_code, duty_date, employee_name")
      .eq("duty_code", "LEAVE")
      .gte("duty_date", monthStart)
      .lte("duty_date", monthEnd),
    supabase
      .from("leave_requests" as any)
      .select("employee_id, employee_name, leave_type, status, start_date, end_date")
      .not("status", "in", `("Rejected","Cancelled")`)
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart),
    // CL / EL / RH etc. — leave was taken on leave_date
    supabase
      .from("employee_leave_records" as any)
      .select("emp_id, employee_name, leave_category, leave_date, leave_used_on")
      .in("leave_category", NON_COMPOFF_LEAVE_CATEGORIES)
      .gte("leave_date", monthStart)
      .lte("leave_date", monthEnd),
    // COMP_OFF variants — leave was taken on leave_used_on
    supabase
      .from("employee_leave_records" as any)
      .select("emp_id, employee_name, leave_category, leave_date, leave_used_on")
      .in("leave_category", COMP_OFF_CATEGORIES)
      .gte("leave_used_on", monthStart)
      .lte("leave_used_on", monthEnd),
  ]);

  if (scheduleRes.error) throw scheduleRes.error;
  if (requestRes.error) throw requestRes.error;
  if (leaveRecordRes.error) throw leaveRecordRes.error;
  if (compOffRecordRes.error) throw compOffRecordRes.error;

  const scheduleRows = (scheduleRes.data || []) as unknown as Array<{
    employee_code: string;
    duty_date: string;
    employee_name: string | null;
  }>;
  const requestRows = (requestRes.data || []) as unknown as Array<{
    employee_id: string;
    employee_name: string;
    leave_type: string;
    status: string;
    start_date: string;
    end_date: string;
  }>;
  type LeaveRecordRow = {
    emp_id: string;
    employee_name: string | null;
    leave_category: string;
    leave_date: string;
    leave_used_on: string | null;
  };
  const allLeaveRecordRows = [
    ...((leaveRecordRes.data || []) as unknown as LeaveRecordRow[]),
    ...((compOffRecordRes.data || []) as unknown as LeaveRecordRow[]),
  ];

  // Fetch profiles to map auth UUID <-> employee_code and get team / full name
  const authIds = [...new Set(requestRows.map((r) => r.employee_id))];
  const scheduleCodes = [
    ...new Set([
      ...scheduleRows.map((r) => r.employee_code),
      ...allLeaveRecordRows.map((r) => r.emp_id),
    ]),
  ];

  type ProfileRow = {
    id: string;
    employee_id: string | null;
    full_name: string | null;
    current_shift: string | null;
  };

  const [authProfilesRes, codeProfilesRes] = await Promise.all([
    authIds.length > 0
      ? supabase
          .from("profiles" as any)
          .select("id, employee_id, full_name, current_shift")
          .in("id", authIds)
      : Promise.resolve({ data: [], error: null }),
    scheduleCodes.length > 0
      ? supabase
          .from("profiles" as any)
          .select("id, employee_id, full_name, current_shift")
          .in("employee_id", scheduleCodes)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (authProfilesRes.error) throw authProfilesRes.error;
  if (codeProfilesRes.error) throw codeProfilesRes.error;

  const allProfiles = [
    ...((authProfilesRes.data || []) as ProfileRow[]),
    ...((codeProfilesRes.data || []) as ProfileRow[]),
  ];

  const authToCode = new Map(
    allProfiles.filter((p) => p.employee_id).map((p) => [p.id, p.employee_id!]),
  );
  const codeToProfile = new Map(
    allProfiles.filter((p) => p.employee_id).map((p) => [p.employee_id!, p]),
  );

  // Build schedule set: `${employee_code}:${duty_date}`
  const scheduleSet = new Set(scheduleRows.map((r) => `${r.employee_code}:${r.duty_date}`));

  // Build request day set
  const requestDaySet = new Set<string>();
  type ApprovedEntry = { code: string; date: string; row: (typeof requestRows)[0] };
  const approvedEntries: ApprovedEntry[] = [];

  for (const req of requestRows) {
    const code = authToCode.get(req.employee_id);
    if (!code) continue;
    try {
      const days = eachDayOfInterval({
        start: parseISO(req.start_date),
        end: parseISO(req.end_date),
      });
      for (const day of days) {
        const iso = format(day, "yyyy-MM-dd");
        if (iso < monthStart || iso > monthEnd) continue;
        requestDaySet.add(`${code}:${iso}`);
        if (req.status === "Approved") approvedEntries.push({ code, date: iso, row: req });
      }
    } catch {
      // skip malformed dates
    }
  }

  // Build leave record set: `${emp_id}:${effectiveDate}`
  const leaveRecordSet = new Set<string>();
  type RecordEntry = { code: string; date: string; row: LeaveRecordRow };
  const recordEntries: RecordEntry[] = [];

  for (const rec of allLeaveRecordRows) {
    const isCompOff = COMP_OFF_CATEGORIES.includes(rec.leave_category);
    const effectiveDate = isCompOff ? (rec.leave_used_on ?? rec.leave_date) : rec.leave_date;
    if (!effectiveDate) continue;
    leaveRecordSet.add(`${rec.emp_id}:${effectiveDate}`);
    recordEntries.push({ code: rec.emp_id, date: effectiveDate, row: rec });
  }

  const rows: DiscrepancyRow[] = [];
  const seen = new Set<string>();

  // Case 1: In schedule but NEITHER a leave request NOR a leave record exists
  for (const sched of scheduleRows) {
    const empKey = `${sched.employee_code}:${sched.duty_date}`;
    if (requestDaySet.has(empKey) || leaveRecordSet.has(empKey)) continue;
    const key = `${sched.employee_code}:${sched.duty_date}:schedule_no_request`;
    if (seen.has(key)) continue;
    seen.add(key);
    const profile = codeToProfile.get(sched.employee_code);
    rows.push({
      employeeCode: sched.employee_code,
      employeeName: profile?.full_name || sched.employee_name || sched.employee_code,
      team: profile?.current_shift || "—",
      date: sched.duty_date,
      kind: "schedule_no_request",
      detail: "Marked LEAVE in schedule — no matching leave request or leave record found",
      leaveType: null,
      requestStatus: null,
    });
  }

  // Case 2: Approved leave request but not in schedule
  for (const entry of approvedEntries) {
    if (scheduleSet.has(`${entry.code}:${entry.date}`)) continue;
    const key = `${entry.code}:${entry.date}:approved_no_schedule`;
    if (seen.has(key)) continue;
    seen.add(key);
    const profile = codeToProfile.get(entry.code);
    rows.push({
      employeeCode: entry.code,
      employeeName: profile?.full_name || entry.row.employee_name || entry.code,
      team: profile?.current_shift || "—",
      date: entry.date,
      kind: "approved_no_schedule",
      detail: `Approved ${entry.row.leave_type} request — schedule not updated`,
      leaveType: entry.row.leave_type,
      requestStatus: entry.row.status,
    });
  }

  // Case 3: Leave record exists but not in schedule
  for (const entry of recordEntries) {
    if (scheduleSet.has(`${entry.code}:${entry.date}`)) continue;
    const key = `${entry.code}:${entry.date}:record_no_schedule`;
    if (seen.has(key)) continue;
    seen.add(key);
    const profile = codeToProfile.get(entry.code);
    rows.push({
      employeeCode: entry.code,
      employeeName: profile?.full_name || entry.row.employee_name || entry.code,
      team: profile?.current_shift || "—",
      date: entry.date,
      kind: "record_no_schedule",
      detail: `Leave record (${entry.row.leave_category}) found — schedule not updated`,
      leaveType: entry.row.leave_category,
      requestStatus: null,
    });
  }

  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName),
  );
}

export default function LeaveDiscrepancyPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<"date" | "employee">("date");
  // Tracks the collapsed employees, so groups start expanded.
  const [collapsedCodes, setCollapsedCodes] = useState<Set<string>>(new Set());

  const monthStart = format(new Date(selectedYear, selectedMonth, 1), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date(selectedYear, selectedMonth, 1)), "yyyy-MM-dd");

  const { data: discrepancies = [], isLoading, error } = useQuery({
    queryKey: ["leave-discrepancy-page", monthStart, monthEnd],
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchDiscrepancies(monthStart, monthEnd),
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
                  Mismatches between schedule (duty_code=LEAVE), leave requests, and leave records.
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
