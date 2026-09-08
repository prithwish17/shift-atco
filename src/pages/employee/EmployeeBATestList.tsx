import { useCallback, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Activity,
  Search,
  RefreshCw,
  CalendarDays,
  AlertCircle,
  CheckCircle2,
  Clock3,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { format, parseISO } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

type ListType = "MAIN" | "STANDBY";

interface BATestRow {
  id: string;
  sl_no: number | null;
  employee_name: string;
  employee_code: string | null;
  list_type: string | null;
  test_time: string | null;
  remarks: string | null;
  shift: string | null;
  test_date: string;
  fetched_at: string;
  expires_at: string;
}

interface DateGroup {
  date: string;
  main: BATestRow[];
  standby: BATestRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function guessShift(time: string | null): string {
  if (!time) return "";
  const [hStr] = time.split(":");
  const h = parseInt(hStr, 10);
  if (isNaN(h)) return "";
  if (h < 9)  return "Morning";
  if (h < 15) return "Afternoon";
  return "Evening";
}

function formatFetchedAt(iso: string): string {
  try {
    return format(parseISO(iso), "dd MMM yyyy, HH:mm");
  } catch {
    return iso;
  }
}

function normaliseCode(val: string | null | undefined): string {
  return (val ?? "").trim().toLowerCase();
}

/** Rows written before the standby list existed carry no list_type — they are main. */
function rowListType(row: BATestRow): ListType {
  return (row.list_type ?? "").trim().toUpperCase() === "STANDBY" ? "STANDBY" : "MAIN";
}

/** Higher number = later shift. */
function shiftPriority(shift: string | null): number {
  const s = (shift ?? "").trim().toLowerCase();
  if (s === "night")     return 4;
  if (s === "evening")   return 3;
  if (s === "afternoon") return 2;
  if (s === "morning")   return 1;
  if (s === "general")   return 0;
  return 0;
}

function getRowShift(row: BATestRow): string {
  return (row.shift ?? "").trim() || guessShift(row.test_time);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmployeeBATestList() {
  const { user } = useAuth();
  const { profile } = useUserProfile(user?.id);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const myCode = normaliseCode(profile?.employee_id);
  const myName = normaliseCode(profile?.full_name);

  const { data: rows = [], isLoading, error } = useQuery<BATestRow[]>({
    queryKey: ["ba-test-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ba_test_list")
        .select("*")
        .order("test_date", { ascending: false })
        .order("sl_no", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BATestRow[];
    },
    refetchInterval: 5 * 60 * 1000,
  });

  // Group by date — show only the latest shift per date, split main vs standby.
  const byDate = useMemo<DateGroup[]>(() => {
    // First pass: determine latest shift for each date
    const dateToLatestShift = new Map<string, string>();
    for (const r of rows) {
      const dateKey = r.test_date;
      const shift = getRowShift(r);
      const existing = dateToLatestShift.get(dateKey);
      if (!existing || shiftPriority(shift) > shiftPriority(existing)) {
        dateToLatestShift.set(dateKey, shift);
      }
    }

    // Second pass: keep only rows from the latest shift, deduplicate employees.
    // A name is kept once per date across both lists, so someone who somehow
    // appears on main and standby is shown as main only.
    const map = new Map<string, DateGroup>();
    const seenByDate = new Map<string, Set<string>>();

    for (const r of rows) {
      const dateKey = r.test_date;
      const shift = getRowShift(r);
      const latestShift = dateToLatestShift.get(dateKey);
      if (!latestShift || shift !== latestShift) continue;

      const employeeKey = normaliseCode(r.employee_name);
      if (!employeeKey) continue;

      if (!seenByDate.has(dateKey)) seenByDate.set(dateKey, new Set());
      const seenNames = seenByDate.get(dateKey)!;
      if (seenNames.has(employeeKey)) continue;
      seenNames.add(employeeKey);

      if (!map.has(dateKey)) map.set(dateKey, { date: dateKey, main: [], standby: [] });
      const group = map.get(dateKey)!;
      if (rowListType(r) === "STANDBY") group.standby.push(r);
      else group.main.push(r);
    }

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [rows]);

  // Filter rows by search
  const filtered = useMemo<DateGroup[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byDate;
    const matches = (r: BATestRow) =>
      r.employee_name.toLowerCase().includes(q) ||
      (r.employee_code ?? "").toLowerCase().includes(q) ||
      (r.test_time ?? "").toLowerCase().includes(q);

    return byDate
      .map((g) => ({ date: g.date, main: g.main.filter(matches), standby: g.standby.filter(matches) }))
      .filter((g) => g.main.length > 0 || g.standby.length > 0);
  }, [byDate, search]);

  const isMyRow = useCallback(
    (r: BATestRow) =>
      Boolean(
        (myCode && normaliseCode(r.employee_code) === myCode) ||
        (myName && normaliseCode(r.employee_name) === myName),
      ),
    [myCode, myName],
  );

  /** Which list the current user is on, across everything loaded. */
  const myListType = useMemo<ListType | null>(() => {
    if (!myCode && !myName) return null;
    const mine = rows.filter(isMyRow);
    if (mine.length === 0) return null;
    return mine.some((r) => rowListType(r) === "MAIN") ? "MAIN" : "STANDBY";
  }, [rows, myCode, myName, isMyRow]);

  const statusBanner =
    myListType === "MAIN"
      ? {
          className:
            "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300",
          icon: <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />,
          text: "You are on the main list for a BA test in the current list.",
        }
      : myListType === "STANDBY"
      ? {
          className:
            "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300",
          icon: <Clock3 className="h-4 w-4 shrink-0 text-amber-500" />,
          text: "You are on the standby list — report only if you are called.",
        }
      : {
          className:
            "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300",
          icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />,
          text: "You are not listed for a BA test in the current list.",
        };

  const renderTable = (rowList: BATestRow[], listType: ListType) => (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-900 text-left dark:border-slate-700">
            <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Employee Name
            </th>
            <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Employee Number
            </th>
            <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Shift
            </th>
          </tr>
        </thead>
        <tbody>
          {rowList.map((row, idx) => {
            const mine = isMyRow(row);
            const highlight =
              listType === "STANDBY"
                ? "bg-amber-50/70 dark:bg-amber-900/20"
                : "bg-amber-50 dark:bg-amber-900/20";
            return (
              <tr
                key={row.id}
                className={`${
                  mine
                    ? highlight
                    : idx % 2 === 0
                    ? "bg-white dark:bg-slate-950"
                    : "bg-slate-50 dark:bg-slate-900"
                }`}
              >
                <td className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    {mine && <User className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    <p
                      className={`font-medium ${
                        mine
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-slate-900 dark:text-slate-100"
                      }`}
                    >
                      {row.employee_name}
                    </p>
                    {mine && (
                      <Badge className="ml-1 bg-amber-500 text-white text-[10px]">You</Badge>
                    )}
                  </div>
                </td>
                <td className="border-b border-slate-100 px-4 py-2.5 tabular-nums text-slate-600 dark:border-slate-800 dark:text-slate-300">
                  {row.employee_code ?? "—"}
                </td>
                <td className="border-b border-slate-100 px-4 py-2.5 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  {row.shift ?? (guessShift(row.test_time) || "—")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <DashboardLayout role="employee">
      <div className="space-y-5 max-w-3xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
              <Activity className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                BA Test List
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Current Breath Analyser test roster
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 self-start sm:self-auto"
            onClick={() => qc.invalidateQueries({ queryKey: ["ba-test-list"] })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* Personal status banner */}
        {!isLoading && rows.length > 0 && (
          <div
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${statusBanner.className}`}
          >
            {statusBanner.icon}
            <span>{statusBanner.text}</span>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search by name, code, or time…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
            <CardContent className="flex items-center gap-2 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load BA Test list. Please refresh.
            </CardContent>
          </Card>
        )}

        {/* Empty */}
        {!isLoading && !error && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center dark:border-slate-800 dark:bg-slate-900/40">
            <Activity className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-700" />
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              No BA Test list available
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              The list is fetched automatically at scheduled times. Check back later.
            </p>
          </div>
        )}

        {/* Grouped date sections */}
        {!isLoading &&
          filtered.map((group) => {
            const headRow = group.main[0] ?? group.standby[0];
            const fetchedAt = headRow?.fetched_at ? formatFetchedAt(headRow.fetched_at) : null;

            return (
              <div key={group.date} className="space-y-3">
                {/* Date header */}
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {(() => {
                      try {
                        return format(parseISO(group.date), "EEEE, dd MMMM yyyy");
                      } catch {
                        return group.date;
                      }
                    })()}
                  </span>
                  {headRow?.shift && (
                    <Badge className="text-xs bg-slate-700 text-slate-200">
                      {headRow.shift} Shift
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {group.main.length} main
                  </Badge>
                  {group.standby.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {group.standby.length} standby
                    </Badge>
                  )}
                  {fetchedAt && (
                    <span className="ml-auto hidden text-[11px] text-slate-400 sm:block">
                      Fetched {fetchedAt}
                    </span>
                  )}
                </div>

                {/* Main list */}
                {group.main.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                        Selected for BA test — main list
                      </span>
                    </div>
                    {renderTable(group.main, "MAIN")}
                  </div>
                )}

                {/* Standby list */}
                {group.standby.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                        Standby list
                      </span>
                    </div>
                    {renderTable(group.standby, "STANDBY")}
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      Standby ATCOs are tested only if someone on the main list is unavailable.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </DashboardLayout>
  );
}
