import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CalendarDays, ClipboardList, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_CL_BALANCE, DEFAULT_RH_BALANCE, getLeaveTypeLabel } from "@/lib/leaveConstants";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useElDetails } from "@/hooks/useElData";
import { useLeaveData } from "@/hooks/useLeaveData";
import { useLeaveBalances } from "@/hooks/useLeaves";
import type { CompOffHistoryEntry } from "@/utils/leaveCalculations";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProfileMatch = {
  id: string;           // auth UUID → used for leave_requests.employee_id
  employee_id: string;  // employee code → used for employee_schedules.employee_code
  full_name: string;
  current_shift: string | null;
};

type RequestRow = {
  id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  total_days: number | null;
  status: string;
  applied_at: string | null;
  reason: string | null;
};

type ScheduleRow = {
  duty_date: string;
};

type LeaveBalanceRow = {
  id: string;
  leave_type: string;
  balance: number;
  expiry_date: string | null;
  year: number;
};

type BalanceCard = {
  key: string;
  label: string;
  value: number;
  detail: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  Approved:             "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  "Pending Supervisor": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "Pending WSO":        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  Rejected:             "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  Cancelled:            "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRange(start: string, end: string) {
  try {
    const s = parseISO(start);
    const e = parseISO(end);
    if (start === end) return format(s, "dd MMM yyyy");
    if (s.getFullYear() === e.getFullYear()) {
      return `${format(s, "dd MMM")} – ${format(e, "dd MMM yyyy")}`;
    }
    return `${format(s, "dd MMM yyyy")} – ${format(e, "dd MMM yyyy")}`;
  } catch {
    return start !== end ? `${start} – ${end}` : start;
  }
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "—";

  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

function getOverlappingInclusiveDayCount(
  leaveFrom: string,
  leaveTo: string,
  rangeStart: string,
  rangeEnd: string,
) {
  const start = new Date(`${leaveFrom}T00:00:00Z`);
  const end = new Date(`${leaveTo}T00:00:00Z`);
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

  return Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function getCompOffSourceLabel(sourceType?: string, sourceLabel?: string) {
  switch ((sourceType || "").toUpperCase()) {
    case "COMP_OFF_DUTY":
    case "COMP_OFF":
      return "Comp-Off";
    case "FROM_LAST_YEAR":
    case "LAST_YEAR_CH_DUTY":
    case "LAST_YEAR_COMP_OFF":
      return "Last Year";
    case "OPE_DUTY":
    case "OPE":
    case "OPE_COMP_OFF":
      return "OPE";
    default:
      return sourceLabel?.trim() || sourceType || "Comp-Off";
  }
}

function formatDutyPerformed(value?: string | null) {
  if (!value) return "—";
  const normalized = value.replace(/_/g, " ").trim();
  if (!normalized) return "—";
  return normalized;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex h-32 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-5 text-xs text-muted-foreground sm:px-4 sm:py-6 sm:text-sm">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
      {message}
    </div>
  );
}

function RequestsTable({ requests }: { requests: RequestRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-xs sm:text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b bg-slate-50 text-[10px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 sm:text-xs">
            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">Date Range</th>
            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">Leave Type</th>
            <th className="px-2.5 py-2 text-center sm:px-3 sm:py-2.5">Days</th>
            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">Status</th>
            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">Applied On</th>
            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">Reason</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((req) => (
            <tr
              key={req.id}
              className="border-b last:border-0 transition-colors hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-900/70"
            >
              <td className="whitespace-nowrap px-2.5 py-2 font-medium text-slate-900 dark:text-white sm:px-3 sm:py-2.5">
                {formatRange(req.start_date, req.end_date)}
              </td>
              <td className="px-2.5 py-2 sm:px-3 sm:py-2.5">
                <Badge variant="secondary" className="text-[10px] sm:text-xs">
                  {getLeaveTypeLabel(req.leave_type)}
                </Badge>
              </td>
              <td className="px-2.5 py-2 text-center font-semibold text-slate-800 dark:text-slate-200 sm:px-3 sm:py-2.5">
                {req.total_days ?? "—"}
              </td>
              <td className="px-2.5 py-2 sm:px-3 sm:py-2.5">
                <Badge className={`text-[10px] sm:text-xs ${STATUS_STYLES[req.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {req.status}
                </Badge>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-[10px] text-muted-foreground sm:px-3 sm:py-2.5 sm:text-xs">
                {req.applied_at ? format(parseISO(req.applied_at), "dd MMM yyyy") : "—"}
              </td>
              <td className="max-w-[180px] truncate px-2.5 py-2 text-[10px] text-muted-foreground sm:max-w-[220px] sm:px-3 sm:py-2.5 sm:text-xs">
                {req.reason ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScheduleTable({ leaves }: { leaves: ScheduleRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-xs sm:text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-[10px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 sm:text-xs">
            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">#</th>
            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">Date</th>
            <th className="px-2.5 py-2 text-left sm:px-3 sm:py-2.5">Day</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map((row, idx) => (
            <tr
              key={row.duty_date}
              className="border-b last:border-0 transition-colors hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-900/70"
            >
              <td className="px-2.5 py-2 text-[10px] text-muted-foreground sm:px-3 sm:py-2.5 sm:text-xs">{idx + 1}</td>
              <td className="whitespace-nowrap px-2.5 py-2 font-medium text-slate-900 dark:text-white sm:px-3 sm:py-2.5">
                {format(parseISO(row.duty_date), "dd MMM yyyy")}
              </td>
              <td className="px-2.5 py-2 text-muted-foreground sm:px-3 sm:py-2.5">
                {format(parseISO(row.duty_date), "EEEE")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EmployeeLeaveSearch({ year = new Date().getFullYear() }: { year?: number }) {
  const [searchText, setSearchText] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<ProfileMatch | null>(null);
  const [scheduleLimit, setScheduleLimit] = useState(120);
  const debouncedSearch = useDebouncedValue(searchText, 250);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Search profiles
  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ["employee-profile-search", debouncedSearch],
    enabled: debouncedSearch.trim().length >= 2 && !selected,
    staleTime: 30_000,
    queryFn: async () => {
      const q = debouncedSearch.trim();
      const { data, error } = await supabase
        .from("profiles" as any)
        .select("id, employee_id, full_name, current_shift")
        .or(`full_name.ilike.%${q}%,employee_id.ilike.%${q}%`)
        .limit(10);
      if (error) throw error;
      return (data || []) as unknown as ProfileMatch[];
    },
  });

  const { data: leaveBalancesRaw = [], isLoading: balancesLoading } = useLeaveBalances(selected?.id);
  const { data: structuredLeaveData = [], leaveQuery: structuredLeaveQuery } = useLeaveData(year, selected?.employee_id ?? null);
  const { data: earnedLeaveDetails = [], isLoading: earnedLeaveLoading } = useElDetails(selected?.employee_id);

  useEffect(() => {
    if (searchResults.length > 0 && debouncedSearch.trim().length >= 2 && !selected) {
      setShowDropdown(true);
    }
  }, [searchResults, debouncedSearch, selected]);

  // Leave requests query
  const { data: leaveRequests = [], isLoading: requestsLoading } = useQuery({
    queryKey: ["leave-requests", "employee-search", selected?.id],
    enabled: !!selected?.id,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests" as any)
        .select("id, leave_type, start_date, end_date, total_days, status, applied_at, reason")
        .eq("employee_id", selected!.id)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as RequestRow[];
    },
  });

  // Schedule leaves query
  const { data: scheduleLeaves = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ["employee-leave-search-schedule", selected?.employee_id, year, scheduleLimit],
    enabled: !!selected?.employee_id,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const { data, error } = await supabase
        .from("employee_schedules" as any)
        .select("duty_date")
        .eq("employee_code", selected!.employee_id)
        .eq("duty_code", "LEAVE")
        .gte("duty_date", yearStart)
        .lte("duty_date", yearEnd)
        .order("duty_date", { ascending: false })
        .limit(scheduleLimit);
      if (error) throw error;
      return (data || []) as unknown as ScheduleRow[];
    },
  });

  const leaveBalances = useMemo(() => {
    const rows = (leaveBalancesRaw || []) as LeaveBalanceRow[];
    const latestYear = rows.reduce((current, row) => Math.max(current, row.year), 0);

    return {
      latestYear,
      rows: rows
        .filter((row) => row.year === year)
        .sort((left, right) => left.leave_type.localeCompare(right.leave_type)),
    };
  }, [leaveBalancesRaw, year]);

  const selectedLeaveRecord = useMemo(() => {
    if (!selected?.employee_id) return null;
    return structuredLeaveData.find((record) => record.empId === selected.employee_id) ?? structuredLeaveData[0] ?? null;
  }, [selected?.employee_id, structuredLeaveData]);

  const earnedLeaveSummary = useMemo(() => {
    const rangeStart = `${year}-01-01`;
    const rangeEnd = `${year}-12-31`;

    const relevantEntries = earnedLeaveDetails.filter((detail) => (
      getOverlappingInclusiveDayCount(detail.leave_from, detail.leave_to, rangeStart, rangeEnd) > 0
    ));

    const totalDays = relevantEntries.reduce((sum, detail) => (
      sum + getOverlappingInclusiveDayCount(detail.leave_from, detail.leave_to, rangeStart, rangeEnd)
    ), 0);

    return {
      entries: relevantEntries.length,
      totalDays,
    };
  }, [earnedLeaveDetails, year]);

  const displayBalanceCards = useMemo(() => {
    const cards = new Map<string, BalanceCard>();

    if (selectedLeaveRecord) {
      cards.set("CL", {
        key: "CL",
        label: "Casual Leave",
        value: selectedLeaveRecord.casualRemaining,
        detail: `${selectedLeaveRecord.casualCount} used of ${DEFAULT_CL_BALANCE}`,
      });
      cards.set("RH", {
        key: "RH",
        label: "Restricted Holiday",
        value: Math.max(DEFAULT_RH_BALANCE - selectedLeaveRecord.restrictedCount, 0),
        detail: `${selectedLeaveRecord.restrictedCount} used of ${DEFAULT_RH_BALANCE}`,
      });
      cards.set("COMP_OFF", {
        key: "COMP_OFF",
        label: "Compensatory Off",
        value: selectedLeaveRecord.compOffRemaining,
        detail: `${selectedLeaveRecord.compOffEarned} earned · ${selectedLeaveRecord.compOffUsed} used${selectedLeaveRecord.compOffExpired ? ` · ${selectedLeaveRecord.compOffExpired} expired` : ""}`,
      });
    }

    if (selectedLeaveRecord || earnedLeaveSummary.entries > 0) {
      cards.set("EL", {
        key: "EL",
        label: "Earned Leave Availed",
        value: earnedLeaveSummary.totalDays,
        detail: earnedLeaveSummary.entries > 0
          ? `${earnedLeaveSummary.entries} synced entr${earnedLeaveSummary.entries === 1 ? "y" : "ies"} in ${year}`
          : `No EL taken in ${year}`,
      });
    }

    for (const balance of leaveBalances.rows) {
      const leaveType = String(balance.leave_type).trim().toUpperCase();
      cards.set(leaveType, {
        key: leaveType,
        label: getLeaveTypeLabel(leaveType),
        value: balance.balance,
        detail: balance.expiry_date
          ? `Stored balance snapshot · Expires ${formatDisplayDate(balance.expiry_date)}`
          : `Stored balance snapshot · Year ${balance.year}`,
      });
    }

    return Array.from(cards.values());
  }, [earnedLeaveSummary.entries, earnedLeaveSummary.totalDays, leaveBalances.rows, selectedLeaveRecord, year]);

  const balancePanelLoading = balancesLoading || structuredLeaveQuery.isLoading || earnedLeaveLoading;

  const pendingRequests = useMemo(() => {
    return leaveRequests.filter((request) => {
      const normalizedStatus = String(request.status || "").trim();
      return normalizedStatus === "Pending WSO" || normalizedStatus === "Pending Supervisor";
    });
  }, [leaveRequests]);

  function selectEmployee(emp: ProfileMatch) {
    setSelected(emp);
    setSearchText(emp.full_name);
    setShowDropdown(false);
    setScheduleLimit(120);
  }

  function clearSelection() {
    setSelected(null);
    setSearchText("");
    setShowDropdown(false);
  }

  const pendingCount = pendingRequests.length;
  const availableCompOffEntries = useMemo(() => {
    return [...(selectedLeaveRecord?.compOffEntries ?? [])]
      .filter((entry): entry is CompOffHistoryEntry => entry.status === "available")
      .sort((left, right) => {
        const leftDate = left.expiryDate || left.dutyDate || "";
        const rightDate = right.expiryDate || right.dutyDate || "";
        return leftDate.localeCompare(rightDate);
      });
  }, [selectedLeaveRecord]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Search input with dropdown */}
      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground sm:left-3 sm:h-4 sm:w-4" />
          <Input
            ref={inputRef}
            className="h-9 pl-8 pr-8 text-xs sm:h-10 sm:pl-9 sm:pr-9 sm:text-sm"
            placeholder="Search employee by name or ID…"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              if (selected) setSelected(null);
            }}
            onFocus={() => {
              if (searchResults.length > 0 && !selected) setShowDropdown(true);
            }}
          />
          {searchText && (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700 dark:hover:text-slate-300 sm:right-3"
              onClick={clearSelection}
              type="button"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          )}
          {/* Inline searching spinner */}
          {searching && !selected && (
            <span className="absolute right-9 top-1/2 -translate-y-1/2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-primary block" />
            </span>
          )}
        </div>

        {/* Results dropdown */}
        {showDropdown && searchResults.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute z-50 bottom-full mb-1 sm:bottom-auto sm:top-full sm:mt-1 sm:mb-0 w-full rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950 overflow-hidden"
          >
            {searchResults.map((emp) => (
              <button
                key={emp.id}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-slate-50 first:rounded-t-lg last:rounded-b-lg dark:hover:bg-slate-900 sm:gap-3 sm:px-4 sm:py-2.5 sm:text-sm"
                onClick={() => selectEmployee(emp)}
                type="button"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 dark:text-white truncate">{emp.full_name}</div>
                  <div className="text-[10px] text-muted-foreground sm:text-xs">
                    {emp.employee_id} · Team {emp.current_shift ?? "—"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected employee results */}
      {selected && (
        <div className="space-y-3 sm:space-y-4">
          {/* Employee info strip */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900 sm:gap-3 sm:px-4 sm:py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white sm:text-base">{selected.full_name}</div>
              <div className="text-[10px] text-muted-foreground sm:text-xs">
                {selected.employee_id} · Team {selected.current_shift ?? "—"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="text-[10px] sm:text-xs">{pendingCount} pending request{pendingCount !== 1 ? "s" : ""}</Badge>
              <Badge variant="outline" className="text-[10px] sm:text-xs">{scheduleLeaves.length} scheduled</Badge>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/70 sm:rounded-2xl sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white sm:text-base">Leave Balances</p>
                  <p className="text-[10px] text-muted-foreground sm:text-xs">Selected year summary from leave records, with stored balance snapshots when available</p>
                </div>
                <Badge variant="outline" className="text-[10px] sm:text-xs">Year {year}</Badge>
              </div>

              {balancePanelLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                </div>
              ) : displayBalanceCards.length === 0 ? (
                <div className="mt-3">
                  <EmptyState message="No leave balance or yearly leave summary is available for this employee yet." />
                </div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {displayBalanceCards.map((balance) => (
                    <div
                      key={balance.key}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        {balance.label}
                      </p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
                        {balance.value}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground sm:text-xs">
                        {balance.detail}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/70 sm:rounded-2xl sm:p-4">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white sm:text-base">Available Comp Off Balance</p>
                <p className="text-[10px] text-muted-foreground sm:text-xs">Comp-off entries that are still available to use</p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Badge className="bg-blue-100 text-[10px] text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 sm:text-xs">
                  {selectedLeaveRecord?.compOffRemaining ?? 0} available
                </Badge>
                <Badge variant="secondary" className="text-[10px] sm:text-xs">
                  {selectedLeaveRecord?.compOffEarned ?? 0} earned
                </Badge>
                <Badge variant="outline" className="text-[10px] sm:text-xs">
                  {selectedLeaveRecord?.compOffUsed ?? 0} used
                </Badge>
                {(selectedLeaveRecord?.compOffExpired ?? 0) > 0 ? (
                  <Badge className="bg-rose-100 text-[10px] text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 sm:text-xs">
                    {selectedLeaveRecord?.compOffExpired ?? 0} expired
                  </Badge>
                ) : null}
              </div>

              {structuredLeaveQuery.isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                </div>
              ) : availableCompOffEntries.length === 0 ? (
                <div className="mt-3">
                  <EmptyState message="No available comp-off balance entries were found for this employee." />
                </div>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {availableCompOffEntries.map((entry, index) => (
                    <div
                      key={`${entry.sourceType}-${entry.dutyDate || entry.leaveApplied || index}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:text-[11px]">
                            Duty Date
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">
                            {formatDisplayDate(entry.dutyDate)}
                          </p>
                        </div>
                        <Badge className="bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 sm:text-xs">
                          {entry.daysRemaining != null
                            ? `${entry.daysRemaining} day${entry.daysRemaining === 1 ? "" : "s"} left`
                            : "Available"}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900/70">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Expiry Date</p>
                          <p className="mt-1 text-xs font-medium text-slate-900 dark:text-white">{formatDisplayDate(entry.expiryDate)}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-900/70">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Duty Performed</p>
                          <p className="mt-1 text-xs font-medium text-slate-900 dark:text-white">{formatDutyPerformed(entry.dutyPerformed)}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] sm:text-xs">
                          {getCompOffSourceLabel(entry.sourceType, entry.sourceLabel)}
                        </Badge>
                        {entry.remark ? (
                          <span className="text-[10px] text-muted-foreground sm:text-xs">{entry.remark}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="requests">
            <TabsList className="grid h-auto w-full grid-cols-2">
              <TabsTrigger value="requests" className="flex items-center gap-1 px-2 py-1.5 text-xs sm:gap-1.5 sm:text-sm">
                <ClipboardList className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                Pending Requests
                {pendingRequests.length > 0 && (
                  <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] sm:h-5 sm:min-w-5 sm:px-1.5 sm:text-xs">{pendingRequests.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="schedule" className="flex items-center gap-1 px-2 py-1.5 text-xs sm:gap-1.5 sm:text-sm">
                <CalendarDays className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                Schedule Leaves
                {scheduleLeaves.length > 0 && (
                  <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] sm:h-5 sm:min-w-5 sm:px-1.5 sm:text-xs">{scheduleLeaves.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="requests" className="mt-3 sm:mt-4">
              {requestsLoading ? (
                <LoadingSpinner />
              ) : pendingRequests.length === 0 ? (
                <EmptyState message="No pending leave requests found for this employee." />
              ) : (
                <RequestsTable requests={pendingRequests} />
              )}
            </TabsContent>

            <TabsContent value="schedule" className="mt-3 sm:mt-4">
              {scheduleLoading ? (
                <LoadingSpinner />
              ) : scheduleLeaves.length === 0 ? (
                <EmptyState message="No schedule leaves (duty_code = LEAVE) found for this employee." />
              ) : (
                <div className="space-y-3">
                  <ScheduleTable leaves={scheduleLeaves} />
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[10px] text-muted-foreground sm:text-xs">
                      Showing latest {scheduleLeaves.length} scheduled leaves for {year}.
                    </p>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900 sm:w-auto"
                      onClick={() => setScheduleLimit((v) => v + 120)}
                    >
                      Load more
                    </button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Prompt when nothing is typed yet */}
      {!selected && !searchText && (
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed py-10 text-center text-xs text-muted-foreground sm:gap-3 sm:py-12 sm:text-sm">
          <Search className="h-7 w-7 opacity-30 sm:h-8 sm:w-8" />
          <div>
            <p className="font-medium text-slate-700 dark:text-slate-300">Search for an employee</p>
            <p className="mt-1 text-[10px] sm:text-xs">
              Type a name or employee ID to view their leave requests and scheduled leaves
            </p>
          </div>
        </div>
      )}

      {/* No results state after typing */}
      {!selected && searchText.trim().length >= 2 && searchResults.length === 0 && !searching && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-5 text-xs text-muted-foreground sm:px-4 sm:py-6 sm:text-sm">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          No employees found matching &ldquo;{searchText}&rdquo;.
        </div>
      )}
    </div>
  );
}
