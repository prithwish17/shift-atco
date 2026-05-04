import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  differenceInDays,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
} from "date-fns";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  RefreshCw,
  Search,
  Stethoscope,
} from "lucide-react";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { getTeamLabel } from "@/lib/proficiency";
import { normalizeTeamKey } from "@/lib/teamDutyRotation";
import { useUsers } from "@/hooks/useUsers";

// ── Types ────────────────────────────────────────────────────────────────────

interface MedRawRecord {
  emp_id: string;
  employee_name: string;
  med_last_date: string | null;
  med_endorsed_upto: string | null;
  med_status: string | null;
}

interface MedRow {
  empId: string;
  name: string;
  teamKey: string;
  teamLabel: string;
  lastMedical: string | null;
  endorsedUpto: string;          // guaranteed non-null for rows that appear
  daysLeft: number;
  status: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TEAM_ORDER = ["G", "A", "B", "C", "D", "E"] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd MMM yyyy");
  } catch {
    return iso;
  }
}

function DaysLeftBadge({ days }: { days: number }) {
  if (days < 0) {
    return (
      <Badge className="border-red-200 bg-red-100 text-[10px] text-red-700 dark:border-red-900/60 dark:bg-red-900/30 dark:text-red-200">
        Expired {Math.abs(days)}d ago
      </Badge>
    );
  }
  if (days === 0) {
    return (
      <Badge className="border-red-200 bg-red-100 text-[10px] text-red-700 dark:border-red-900/60 dark:bg-red-900/30 dark:text-red-200">
        Expires today
      </Badge>
    );
  }
  if (days <= 30) {
    return (
      <Badge className="border-orange-200 bg-orange-100 text-[10px] text-orange-700 dark:border-orange-900/60 dark:bg-orange-900/30 dark:text-orange-200">
        {days}d left
      </Badge>
    );
  }
  if (days <= 90) {
    return (
      <Badge className="border-amber-200 bg-amber-100 text-[10px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/30 dark:text-amber-200">
        {days}d left
      </Badge>
    );
  }
  return (
    <Badge className="border-emerald-200 bg-emerald-100 text-[10px] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/30 dark:text-emerald-200">
      {days}d left
    </Badge>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const upper = status.toUpperCase();
  if (upper === "FIT") {
    return (
      <Badge className="border-emerald-200 bg-emerald-100 text-[10px] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/30 dark:text-emerald-200">
        FIT
      </Badge>
    );
  }
  if (upper === "TU") {
    return (
      <Badge className="border-amber-200 bg-amber-100 text-[10px] text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/30 dark:text-amber-200">
        TU
      </Badge>
    );
  }
  if (upper === "PENDING") {
    return (
      <Badge className="border-sky-200 bg-sky-100 text-[10px] text-sky-700 dark:border-sky-900/60 dark:bg-sky-900/30 dark:text-sky-200">
        PENDING
      </Badge>
    );
  }
  return (
    <Badge className="border-slate-200 bg-slate-100 text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      {status}
    </Badge>
  );
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function fetchMedicalData(): Promise<MedRawRecord[]> {
  const { data, error } = await supabase
    .from("employee_training_records" as any)
    .select("emp_id, employee_name, med_last_date, med_endorsed_upto, med_status")
    .not("med_endorsed_upto", "is", null)
    .order("employee_name", { ascending: true });

  if (error) throw error;

  return ((data || []) as unknown as Array<{
    emp_id: string;
    employee_name: string;
    med_last_date: string | null;
    med_endorsed_upto: string | null;
    med_status: string | null;
  }>).map((row) => ({
    emp_id: row.emp_id,
    employee_name: row.employee_name,
    med_last_date: row.med_last_date,
    med_endorsed_upto: row.med_endorsed_upto,
    med_status: row.med_status,
  }));
}

// ── Page component ───────────────────────────────────────────────────────────

export default function MedicalList() {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [searchText, setSearchText] = useState("");
  const [teamFilter, setTeamFilter] = useState("__all__");

  const { data: rawMedData = [], isLoading: medLoading, error, refetch } = useQuery<MedRawRecord[]>({
    queryKey: ["medical-list-data"],
    queryFn: fetchMedicalData,
    staleTime: 60_000,
  });

  const { users = [] } = useUsers();

  // Build profile map: emp_id → { full_name, current_shift }
  const profileMap = useMemo(() => {
    const map = new Map<string, { full_name: string | null; current_shift: string | null }>();
    users.forEach((u) => {
      if (u.employee_id) {
        map.set(String(u.employee_id).trim().toUpperCase(), {
          full_name: u.full_name ?? null,
          current_shift: u.current_shift ?? null,
        });
      }
    });
    return map;
  }, [users]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const monthStart = useMemo(() => startOfMonth(selectedMonth), [selectedMonth]);
  const monthEnd = useMemo(() => endOfMonth(selectedMonth), [selectedMonth]);

  // Count CA35 employees (excluded — for the badge)
  const ca35Count = useMemo(
    () => rawMedData.filter((r) => r.med_status?.toUpperCase() === "CA35").length,
    [rawMedData],
  );

  // Build rows: endorsed_upto falls in selected month AND status is not CA35
  const allRows = useMemo<MedRow[]>(() => {
    return rawMedData
      .filter((r) => {
        if (!r.med_endorsed_upto) return false;
        if (r.med_status?.toUpperCase() === "CA35") return false;
        const expiry = new Date(r.med_endorsed_upto);
        return expiry >= monthStart && expiry <= monthEnd;
      })
      .map((r) => {
        const empIdUpper = String(r.emp_id || "").trim().toUpperCase();
        const profile = profileMap.get(empIdUpper);
        const teamKey = normalizeTeamKey(profile?.current_shift ?? null);
        return {
          empId: r.emp_id,
          name: profile?.full_name || r.employee_name || r.emp_id,
          teamKey,
          teamLabel: getTeamLabel(teamKey),
          lastMedical: r.med_last_date,
          endorsedUpto: r.med_endorsed_upto!,
          daysLeft: differenceInDays(new Date(r.med_endorsed_upto!), today),
          status: r.med_status,
        };
      })
      .sort((a, b) => {
        const teamCompare =
          TEAM_ORDER.indexOf(a.teamKey as (typeof TEAM_ORDER)[number]) -
          TEAM_ORDER.indexOf(b.teamKey as (typeof TEAM_ORDER)[number]);
        if (teamCompare !== 0) return teamCompare;
        return new Date(a.endorsedUpto).getTime() - new Date(b.endorsedUpto).getTime();
      });
  }, [rawMedData, profileMap, monthStart, monthEnd, today]);

  // Unique teams present in the full allRows list (for filter dropdown)
  const teamOptions = useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.teamKey))).sort(
        (a, b) =>
          TEAM_ORDER.indexOf(a as (typeof TEAM_ORDER)[number]) -
          TEAM_ORDER.indexOf(b as (typeof TEAM_ORDER)[number]),
      ),
    [allRows],
  );

  // Filtered rows (search + team)
  const visibleRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return allRows.filter((r) => {
      if (teamFilter !== "__all__" && r.teamKey !== teamFilter) return false;
      if (!q) return true;
      return (
        r.empId.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.status ?? "").toLowerCase().includes(q) ||
        r.teamLabel.toLowerCase().includes(q)
      );
    });
  }, [allRows, searchText, teamFilter]);

  // Export CSV
  const handleExport = () => {
    if (visibleRows.length === 0) {
      toast.error("No rows to export");
      return;
    }
    const headers = ["Emp ID", "Name", "Team", "Last Medical", "Medical Valid Upto", "Days Left", "Status"];
    const body = visibleRows.map((r) =>
      [
        r.empId,
        r.name,
        r.teamLabel,
        r.lastMedical ? format(new Date(r.lastMedical), "dd-MM-yyyy") : "",
        format(new Date(r.endorsedUpto), "dd-MM-yyyy"),
        String(r.daysLeft),
        r.status ?? "",
      ]
        .map((v) => escapeCsvValue(String(v)))
        .join(","),
    );
    const blob = new Blob([[headers.join(","), ...body].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `medical-list-${format(selectedMonth, "yyyy-MM")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Medical list exported");
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-6 p-4 md:p-6">

        {/* ── Header card ── */}
        <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-5 p-5 md:p-7 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                <Stethoscope className="h-3.5 w-3.5" />
                Medical Planning
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-3xl">
                  Medical List
                </h1>
                <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300 md:text-[15px]">
                  Month-wise view of employees whose medical certificate expires in the selected month. CA35 employees are excluded.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                >
                  {allRows.length} due this month
                </Badge>
                <Badge
                  variant="secondary"
                  className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-700 shadow-none dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  {ca35Count} CA35 excluded
                </Badge>
              </div>
            </div>

            {/* Right controls */}
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/supervisor/licenses")}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Licenses
              </Button>

              {/* Month navigator */}
              <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setSelectedMonth((m) => addMonths(m, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-[126px] px-2 text-center text-sm font-semibold text-slate-900 dark:text-white">
                  {format(selectedMonth, "MMMM yyyy")}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setSelectedMonth((m) => addMonths(m, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <Button
                type="button"
                onClick={handleExport}
                disabled={visibleRows.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
          </div>
        </div>

        {/* ── CA35 exclusion notice ── */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">CA35 employees excluded:</span> Employees with a CA&nbsp;35 medical status have a pending endorsement, not a true expiry — they are not shown here. Use the Medical tab in License Management to view them.
          </span>
        </div>

        {/* ── Filters ── */}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_180px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by emp id, name, team, status…"
              className="pl-9"
            />
          </div>

          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All teams" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All teams</SelectItem>
              {teamOptions.map((teamKey) => (
                <SelectItem key={teamKey} value={teamKey}>
                  {getTeamLabel(teamKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSearchText("");
              setTeamFilter("__all__");
            }}
          >
            Reset Filters
          </Button>
        </div>

        {/* ── Error state ── */}
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-lg font-semibold">Unable to load medical data</div>
                <div className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                  {(error as Error).message || "The medical data could not be loaded."}
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        {/* ── Table card ── */}
        <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">Month Table</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {medLoading
                  ? "Loading…"
                  : `Showing ${visibleRows.length} employee${visibleRows.length === 1 ? "" : "s"} with medical expiring in ${format(selectedMonth, "MMMM yyyy")}`}
              </div>
            </div>
          </div>

          {medLoading ? (
            <div className="px-5 py-10 text-sm text-slate-600 dark:text-slate-300">
              Loading medical records…
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="px-5 py-10 text-sm text-slate-600 dark:text-slate-300">
              No employees with medical expiring in {format(selectedMonth, "MMMM yyyy")} for the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead className="min-w-[110px]">Emp ID</TableHead>
                    <TableHead className="min-w-[210px]">Name</TableHead>
                    <TableHead className="min-w-[120px]">Team</TableHead>
                    <TableHead className="min-w-[145px]">Last Medical</TableHead>
                    <TableHead className="min-w-[160px]">Medical Valid Upto</TableHead>
                    <TableHead className="min-w-[130px]">Days Left</TableHead>
                    <TableHead className="min-w-[100px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row, index) => (
                    <TableRow key={`${row.empId}-${row.endorsedUpto}`}>
                      <TableCell className="text-center text-xs text-slate-400">{index + 1}</TableCell>
                      <TableCell className="font-medium text-slate-900 dark:text-white">
                        {row.empId}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-900 dark:text-white">{row.name}</div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="rounded-full px-2.5 py-1 text-[11px]"
                        >
                          {row.teamLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700 dark:text-slate-300">
                        {formatDate(row.lastMedical)}
                      </TableCell>
                      <TableCell className="text-sm font-medium text-slate-900 dark:text-white">
                        {formatDate(row.endorsedUpto)}
                      </TableCell>
                      <TableCell>
                        <DaysLeftBadge days={row.daysLeft} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
