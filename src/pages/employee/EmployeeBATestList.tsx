import { useMemo, useState } from "react";
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
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { format, parseISO } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BATestRow {
  id: string;
  sl_no: number | null;
  employee_name: string;
  employee_code: string | null;
  test_time: string | null;
  remarks: string | null;
  shift: string | null;
  test_date: string;
  fetched_at: string;
  expires_at: string;
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

  // Group by date and show each employee name only once per date.
  const byDate = useMemo(() => {
    const map = new Map<string, BATestRow[]>();
    const seenByDate = new Map<string, Set<string>>();

    for (const r of rows) {
      const key = r.test_date;
      const employeeKey = normaliseCode(r.employee_name);
      if (!employeeKey) continue;

      if (!seenByDate.has(key)) seenByDate.set(key, new Set());
      const seenNames = seenByDate.get(key)!;
      if (seenNames.has(employeeKey)) continue;
      seenNames.add(employeeKey);

      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  // Filter rows by search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byDate;
    return byDate.map(([date, dateRows]) => [
      date,
      dateRows.filter(
        (r) =>
          r.employee_name.toLowerCase().includes(q) ||
          (r.employee_code ?? "").toLowerCase().includes(q) ||
          (r.test_time ?? "").toLowerCase().includes(q),
      ),
    ] as [string, BATestRow[]]).filter(([, dateRows]) => (dateRows as BATestRow[]).length > 0);
  }, [byDate, search]);

  // Check if current user is in the list
  const iAmListed = useMemo(() => {
    if (!myCode && !myName) return false;
    return rows.some(
      (r) =>
        (myCode && normaliseCode(r.employee_code) === myCode) ||
        (myName && normaliseCode(r.employee_name) === myName),
    );
  }, [rows, myCode, myName]);

  const isMyRow = (r: BATestRow) =>
    (myCode && normaliseCode(r.employee_code) === myCode) ||
    (myName && normaliseCode(r.employee_name) === myName);

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
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
              iAmListed
                ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
            }`}
          >
            {iAmListed ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            )}
            <span>
              {iAmListed
                ? "You are listed for a BA test in the current list."
                : "You are not listed for a BA test in the current list."}
            </span>
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
          filtered.map(([dateStr, dateRows]) => {
            const rowList = dateRows as BATestRow[];
            const fetchedAt =
              rowList[0]?.fetched_at ? formatFetchedAt(rowList[0].fetched_at) : null;

            return (
              <div key={dateStr} className="space-y-2">
                {/* Date header */}
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-slate-400" />
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {(() => {
                      try {
                        return format(parseISO(dateStr), "EEEE, dd MMMM yyyy");
                      } catch {
                        return dateStr;
                      }
                    })()}
                  </span>
                  {rowList[0]?.shift && (
                    <Badge className="text-xs bg-slate-700 text-slate-200">
                      {rowList[0].shift} Shift
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {rowList.length} {rowList.length === 1 ? "employee" : "employees"}
                  </Badge>
                  {fetchedAt && (
                    <span className="ml-auto hidden text-[11px] text-slate-400 sm:block">
                      Fetched {fetchedAt}
                    </span>
                  )}
                </div>

                {/* Table */}
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
                        return (
                          <tr
                            key={row.id}
                            className={`${
                              mine
                                ? "bg-amber-50 dark:bg-amber-900/20"
                                : idx % 2 === 0
                                ? "bg-white dark:bg-slate-950"
                                : "bg-slate-50 dark:bg-slate-900"
                            }`}
                          >
                            <td className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                              <div className="flex items-center gap-2">
                                {mine && (
                                  <User className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                                )}
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
                                  <Badge className="ml-1 bg-amber-500 text-white text-[10px]">
                                    You
                                  </Badge>
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
              </div>
            );
          })}
      </div>
    </DashboardLayout>
  );
}
