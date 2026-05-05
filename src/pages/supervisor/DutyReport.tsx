import { useMemo, useState } from "react";
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown as ChevronDownIcon, Download, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  SUPERVISOR_MONTH_PILL,
  SUPERVISOR_TOOLBAR_ICON_BUTTON,
  SUPERVISOR_TOOLBAR_SHELL,
} from "@/lib/supervisorTableTheme";

// ── Duty code definitions ────────────────────────────────────────────────────

const NIGHT_CODES = ["N", "NO+N", "SUN+N", "SAT+N", "CO+N"] as const;
type NightCode = (typeof NIGHT_CODES)[number];

const OPE_CODES = [
  "M+A", "NO+N", "SAT+NO", "SUN+N", "SUN+M",
  "SUN+A", "SUN+NO", "SAT+N", "CO+N", "CO+A", "CO+M", "A+M",
] as const;

const NIGHT_CODE_LABELS: Record<NightCode, string> = {
  N: "N — Night Shift",
  "NO+N": "NO+N — Night Off + Night",
  "SUN+N": "SUN+N — Sunday + Night",
  "SAT+N": "SAT+N — Saturday + Night",
  "CO+N": "CO+N — Comp-Off + Night",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface DutyRow {
  employee_code: string;
  employee_name: string;
  duty_date: string;
  duty_code: string;
  duty_description: string | null;
}

// ── Supabase pagination helper ───────────────────────────────────────────────
// PostgREST's server-side max_rows overrides .limit(); the only reliable way
// to retrieve every row is to walk through pages with .range().

const PAGE_SIZE = 1000;

async function fetchAllPages(
  startDate: string,
  endDate: string,
  allCodes: string[],
): Promise<DutyRow[]> {
  const all: DutyRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await (supabase as any)
      .from("employee_schedules")
      .select("employee_code, employee_name, duty_date, duty_code, duty_description")
      .gte("duty_date", startDate)
      .lte("duty_date", endDate)
      .in("duty_code", allCodes)
      .order("duty_date")
      .order("employee_name")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as DutyRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  try {
    return format(new Date(iso + "T00:00:00"), "dd MMM yyyy");
  } catch {
    return iso;
  }
}

function downloadCsv(rows: DutyRow[], filename: string, monthLabel: string) {
  const header = ["Sr #", "Employee Name", "Date", "Duty Code", "Description"];
  const lines = rows.map((r, i) =>
    [
      i + 1,
      `"${(r.employee_name || "").replace(/"/g, '""')}"`,
      formatDate(r.duty_date),
      r.duty_code,
      `"${(r.duty_description || "").replace(/"/g, '""')}"`,
    ].join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${monthLabel}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPdf(rows: DutyRow[], title: string, monthLabel: string) {
  const doc = new jsPDF();
  doc.setFontSize(13);
  doc.text(`${title} — ${monthLabel}`, 14, 15);
  autoTable(doc, {
    startY: 22,
    head: [["Sr #", "Employee Name", "Date", "Duty Code", "Description"]],
    body: rows.map((r, i) => [
      i + 1,
      r.employee_name || "",
      formatDate(r.duty_date),
      r.duty_code,
      r.duty_description || "",
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  doc.save(`${title.replace(/ /g, "_")}_${monthLabel}.pdf`);
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

type SortKey = "name" | "date";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="ml-1 inline size-3 opacity-40" />;
  return sortDir === "asc"
    ? <ChevronUp className="ml-1 inline size-3 text-blue-400" />
    : <ChevronDownIcon className="ml-1 inline size-3 text-blue-400" />;
}

function sortRows(rows: DutyRow[], key: SortKey, dir: SortDir): DutyRow[] {
  return [...rows].sort((a, b) => {
    const primary =
      key === "name"
        ? (a.employee_name || "").localeCompare(b.employee_name || "")
        : a.duty_date.localeCompare(b.duty_date);
    const secondary =
      key === "name"
        ? a.duty_date.localeCompare(b.duty_date)
        : (a.employee_name || "").localeCompare(b.employee_name || "");
    const result = primary !== 0 ? primary : secondary;
    return dir === "asc" ? result : -result;
  });
}

// ── Sub-component: duty table ─────────────────────────────────────────────────

const ROWS_PER_PAGE = 50;

interface DutyTableProps {
  rows: DutyRow[];
  downloadTitle: string;
  downloadFilename: string;
  monthLabel: string;
  monthDate: Date;
}

function DutyTable({ rows, downloadTitle, downloadFilename, monthLabel, monthDate }: DutyTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  const handleSort = (col: SortKey) => {
    if (col === sortKey) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
    setPage(0);
  };

  // sorted = full dataset in current sort order — used for downloads
  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  // pageRows = slice shown in the table
  const totalPages = Math.max(1, Math.ceil(sorted.length / ROWS_PER_PAGE));
  const pageRows = useMemo(
    () => sorted.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE),
    [sorted, page],
  );

  const sortLabel = sortKey === "name" ? "sorted by name" : "sorted by date";

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
        No duty records found for this selection.
      </div>
    );
  }

  const thBase =
    "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300";
  const thSortable =
    `${thBase} cursor-pointer select-none hover:text-white transition-colors`;

  return (
    <div className="space-y-2">
      {/* Toolbar: record count + downloads (always use full sorted set) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {sorted.length} record{sorted.length !== 1 ? "s" : ""}
          <span className="ml-1 text-slate-400 dark:text-slate-500">({sortLabel})</span>
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={sorted.length === 0}
            onClick={() => downloadCsv(sorted, downloadFilename, format(monthDate, "MMM_yyyy"))}
          >
            <Download className="size-3.5" />
            CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={sorted.length === 0}
            onClick={() => downloadPdf(sorted, downloadTitle, monthLabel)}
          >
            <FileText className="size-3.5" />
            PDF
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-900 text-left dark:border-slate-700">
              <th className={thBase}>Sr #</th>
              <th
                className={thSortable}
                onClick={() => handleSort("name")}
                aria-sort={sortKey === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              >
                Employee Name
                <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th
                className={thSortable}
                onClick={() => handleSort("date")}
                aria-sort={sortKey === "date" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              >
                Date
                <SortIcon col="date" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={thBase}>Duty Code</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => {
              const globalIdx = page * ROWS_PER_PAGE + idx;
              return (
                <tr
                  key={`${row.employee_code}-${row.duty_date}-${row.duty_code}-${globalIdx}`}
                  className={
                    globalIdx % 2 === 0
                      ? "bg-white dark:bg-slate-950"
                      : "bg-slate-50 dark:bg-slate-900"
                  }
                >
                  <td className="border-b border-slate-100 px-4 py-2.5 tabular-nums text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    {globalIdx + 1}
                  </td>
                  <td className="border-b border-slate-100 px-4 py-2.5 font-medium text-slate-900 dark:border-slate-800 dark:text-slate-100">
                    {row.employee_name || row.employee_code}
                  </td>
                  <td className="border-b border-slate-100 px-4 py-2.5 tabular-nums text-slate-700 dark:border-slate-800 dark:text-slate-300">
                    {formatDate(row.duty_date)}
                  </td>
                  <td className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {row.duty_code}
                      </span>
                      {row.duty_description && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {row.duty_description}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Page {page + 1} of {totalPages}
            <span className="ml-1 text-slate-400 dark:text-slate-500">
              · showing {page * ROWS_PER_PAGE + 1}–{Math.min((page + 1) * ROWS_PER_PAGE, sorted.length)} of {sorted.length}
            </span>
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page === 0}
              onClick={() => setPage(0)}
              aria-label="First page"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="min-w-[2.5rem] text-center text-xs tabular-nums text-slate-600 dark:text-slate-300">
              {page + 1} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
              aria-label="Last page"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DutyReport() {
  const [monthOffset, setMonthOffset] = useState(0);
  const [activeCodes, setActiveCodes] = useState<Set<NightCode>>(
    () => new Set(NIGHT_CODES),
  );

  const monthDate = useMemo(() => addMonths(new Date(), monthOffset), [monthOffset]);
  const monthLabel = useMemo(() => format(monthDate, "MMMM yyyy"), [monthDate]);
  const startDate = useMemo(() => format(startOfMonth(monthDate), "yyyy-MM-dd"), [monthDate]);
  const endDate = useMemo(() => format(endOfMonth(monthDate), "yyyy-MM-dd"), [monthDate]);

  const allCodes = useMemo(
    () => [...new Set([...NIGHT_CODES, ...OPE_CODES])],
    [],
  );

  const { data: rawRows = [], isLoading } = useQuery<DutyRow[]>({
    queryKey: ["duty-report", startDate, endDate],
    queryFn: () => fetchAllPages(startDate, endDate, allCodes),
    staleTime: 2 * 60_000,
  });

  const nightRows = useMemo(
    () =>
      rawRows
        .filter(r => activeCodes.has(r.duty_code as NightCode))
        .sort((a, b) => {
          const d = a.duty_date.localeCompare(b.duty_date);
          return d !== 0 ? d : (a.employee_name || "").localeCompare(b.employee_name || "");
        }),
    [rawRows, activeCodes],
  );

  const opeRows = useMemo(
    () =>
      rawRows
        .filter(r => (OPE_CODES as readonly string[]).includes(r.duty_code))
        .sort((a, b) => {
          const d = a.duty_date.localeCompare(b.duty_date);
          return d !== 0 ? d : (a.employee_name || "").localeCompare(b.employee_name || "");
        }),
    [rawRows],
  );

  const toggleCode = (code: NightCode) => {
    setActiveCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  return (
    <DashboardLayout role="supervisor">
      <div className="space-y-4">

        {/* ── Toolbar ── */}
        <div className={`${SUPERVISOR_TOOLBAR_SHELL} gap-2 sm:gap-3`}>
          <div className="min-w-0 flex-1">
            <div className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:block">
              Supervisor report
            </div>
            <h1 className="text-base font-semibold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-lg">
              Night &amp; OPE Duty Report
            </h1>
            <p className="mt-1 hidden text-sm text-slate-600 dark:text-slate-300 sm:block">
              Monthly log of night shift and OPE duty occurrences per employee.
            </p>
          </div>

          {/* Month navigation */}
          <div className={`ml-auto flex w-auto shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900`}>
            <button
              type="button"
              onClick={() => setMonthOffset(o => o - 1)}
              className={SUPERVISOR_TOOLBAR_ICON_BUTTON}
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <div className={SUPERVISOR_MONTH_PILL}>{monthLabel}</div>
            <button
              type="button"
              onClick={() => setMonthOffset(o => o + 1)}
              className={SUPERVISOR_TOOLBAR_ICON_BUTTON}
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <Tabs defaultValue="night">
          <TabsList className="h-9 rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
            <TabsTrigger value="night" className="rounded-lg px-4 text-sm">
              Night Duty
              {!isLoading && (
                <Badge className="ml-1.5 rounded-full border-0 bg-slate-200 px-1.5 py-0 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  {nightRows.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="ope" className="rounded-lg px-4 text-sm">
              OPE Duty
              {!isLoading && (
                <Badge className="ml-1.5 rounded-full border-0 bg-slate-200 px-1.5 py-0 text-[10px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  {opeRows.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Night Duty tab ── */}
          <TabsContent value="night" className="mt-4 space-y-4">
            {/* Code filter toggles */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Show codes:
              </span>
              {NIGHT_CODES.map(code => (
                <button
                  key={code}
                  type="button"
                  title={NIGHT_CODE_LABELS[code]}
                  onClick={() => toggleCode(code)}
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                    activeCodes.has(code)
                      ? "border-blue-500 bg-blue-600 text-white"
                      : "border-slate-300 bg-white text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {code}
                </button>
              ))}
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                (click to toggle)
              </span>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                  />
                ))}
              </div>
            ) : (
              <DutyTable
                rows={nightRows}
                downloadTitle="Night Duty Report"
                downloadFilename="Night_Duty_Report"
                monthLabel={monthLabel}
                monthDate={monthDate}
              />
            )}
          </TabsContent>

          {/* ── OPE Duty tab ── */}
          <TabsContent value="ope" className="mt-4 space-y-4">
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                  />
                ))}
              </div>
            ) : (
              <DutyTable
                rows={opeRows}
                downloadTitle="OPE Duty Report"
                downloadFilename="OPE_Duty_Report"
                monthLabel={monthLabel}
                monthDate={monthDate}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
