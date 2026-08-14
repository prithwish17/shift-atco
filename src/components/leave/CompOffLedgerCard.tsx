import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COMP_OFF_EXPIRY_WARNING_DAYS } from "@/lib/leaveConstants";
import type { CompOffHistoryEntry } from "@/utils/leaveCalculations";
import { cn } from "@/lib/utils";

export type CompOffView = "available" | "all";

export type CompOffStats = {
  earned: number;
  used: number;
  expired: number;
  remaining: number;
};

const DUTY_CODE_LABELS: Record<string, string> = {
  M: "Morning",
  A: "Afternoon",
  N: "Night",
  NO: "Night off",
  CO: "Clear off",
  "M+A": "Morning normal + Afternoon OPE",
  "NO+N": "Night OPE",
  LEAVE: "Leave",
  SAT: "Saturday",
  SUN: "Sunday",
  G: "General",
  T: "Tour",
  CH: "Closed holiday",
  NH: "National holiday",
  "SAT+NO": "Night off",
  NA: "Not available",
  "SUN+N": "Night OPE",
  "SUN+M": "Morning OPE",
  "SUN+A": "Afternoon OPE",
  "SUN+NO": "Night off",
  "SAT+N": "Night OPE",
  "CO+N": "Night OPE",
  SL: "Clear off",
  Tr: "Training",
  "CO+A": "Afternoon OPE",
  "CO+M": "Morning OPE",
  GO: "General-O",
  "A+M": "Morning OPE + Afternoon normal",
};

/**
 * The register writes dates in a few shapes; render them one way so a column of
 * them lines up rather than mixing "JUL 15 2026" with an ISO day.
 *
 * Formatted through date-fns rather than toLocaleDateString: en-IN abbreviates
 * September to a four-letter "Sept", which alone breaks the alignment of a
 * tabular column of otherwise three-letter months.
 */
function formatLedgerDate(value: unknown): string {
  if (!value || typeof value !== "string") return "—";

  const trimmed = value.trim();
  if (!trimmed) return "—";

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;

  return format(date, "dd MMM yyyy");
}

function formatDutyPerformed(value?: string | null): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "—";

  const key = Object.keys(DUTY_CODE_LABELS).find((code) => code.toUpperCase() === trimmed.toUpperCase());
  return key ? DUTY_CODE_LABELS[key] : trimmed;
}

function getSourceLabel(sourceType?: string, sourceLabel?: string): string {
  switch ((sourceType || "").toUpperCase()) {
    case "COMP_OFF_DUTY":
    case "COMP_OFF":
      return "Comp-off";
    case "FROM_LAST_YEAR":
    case "LAST_YEAR_CH_DUTY":
    case "LAST_YEAR_COMP_OFF":
      return "Last year";
    case "OPE_DUTY":
    case "OPE":
    case "OPE_COMP_OFF":
      return "OPE";
    default:
      return sourceLabel?.trim() || sourceType || "Comp-off";
  }
}

/**
 * Source chips sit next to the status mark in every row, so they are tinted at
 * the palest step with a hairline ring — enough to tell the three sources apart
 * without two saturated pills competing in the same row.
 */
function getSourceChipClass(sourceType?: string): string {
  switch ((sourceType || "").toUpperCase()) {
    case "COMP_OFF_DUTY":
    case "COMP_OFF":
      return "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-400/20";
    case "FROM_LAST_YEAR":
    case "LAST_YEAR_CH_DUTY":
    case "LAST_YEAR_COMP_OFF":
      return "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-400/20";
    case "OPE_DUTY":
    case "OPE":
    case "OPE_COMP_OFF":
      return "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20";
  }
}

/**
 * Status reads as a dot plus words rather than a filled pill: a table of pills
 * is a table of shouting.  An entry inside the expiry window turns amber, which
 * is the same threshold the warning above the ledger counts.
 */
function getStatus(entry: CompOffHistoryEntry): { dot: string; text: string; label: string } {
  if (entry.status === "available") {
    const days = entry.daysRemaining;
    const expiringSoon = days != null && days <= COMP_OFF_EXPIRY_WARNING_DAYS;

    return {
      dot: expiringSoon ? "bg-amber-500" : "bg-emerald-500",
      text: expiringSoon
        ? "text-amber-700 dark:text-amber-400"
        : "text-emerald-700 dark:text-emerald-400",
      label: days != null ? `${days} day${days === 1 ? "" : "s"} left` : "Available",
    };
  }

  if (entry.status === "used") {
    return { dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-400", label: "Used" };
  }

  if (entry.status === "expired") {
    return { dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-400", label: "Expired" };
  }

  return { dot: "bg-slate-300", text: "text-slate-500 dark:text-slate-500", label: "Not available" };
}

function SegmentedControl({ view, onChange }: { view: CompOffView; onChange: (view: CompOffView) => void }) {
  const tabs: { key: CompOffView; label: string }[] = [
    { key: "available", label: "Available" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          aria-pressed={view === tab.key}
          className={cn(
            "rounded-md px-3 py-1 text-[13px] font-semibold transition-colors sm:px-4 sm:py-1.5 sm:text-sm",
            view === tab.key
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Four counts do not warrant four stacked blocks — as a single inline strip they
 * cost one row of height instead of a panel, and the flex wrap lets them fold
 * onto a second line on a narrow phone rather than being pinned to a grid.
 */
function StatStrip({ stats }: { stats: CompOffStats }) {
  const items: { label: string; value: number; accent?: string }[] = [
    { label: "Earned", value: stats.earned },
    { label: "Available", value: stats.remaining, accent: "text-emerald-600 dark:text-emerald-400" },
    { label: "Used", value: stats.used },
    {
      label: "Expired",
      value: stats.expired,
      accent: stats.expired > 0 ? "text-rose-600 dark:text-rose-400" : undefined,
    },
  ];

  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800 sm:gap-x-7 sm:px-6">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <span className={cn("text-base font-bold tabular-nums", item.accent || "text-slate-900 dark:text-white")}>
            {item.value}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 sm:text-[13px]">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

const HEADER_CELL = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400";
const BODY_CELL = "px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300";

export function CompOffLedgerCard({ rows, stats, view, onViewChange }: {
  rows: CompOffHistoryEntry[];
  stats: CompOffStats;
  view: CompOffView;
  onViewChange: (view: CompOffView) => void;
}) {
  const emptyMessage = view === "all" ? "No comp-off records yet." : "No comp-off available right now.";

  return (
    <Card className="w-full overflow-hidden shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-6 sm:py-3.5">
        <CardTitle className="min-w-0 truncate text-base font-bold sm:text-lg">Comp-Off Balance</CardTitle>
        <SegmentedControl view={view} onChange={onViewChange} />
      </CardHeader>

      <StatStrip stats={stats} />

      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</div>
        ) : (
          <>
            {/* Phone: one block per comp-off — six columns will not fit legibly. */}
            <div className="divide-y divide-slate-200 dark:divide-slate-800 sm:hidden">
              {rows.map((row, index) => {
                const status = getStatus(row);

                return (
                  <div key={`${row.sourceType}-${row.dutyDate || row.leaveApplied || index}-mobile`} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                          {formatLedgerDate(row.dutyDate)}
                        </div>
                        {/* Source rides alongside the duty rather than claiming a
                            labelled row of its own — it is one short word. */}
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600 dark:text-slate-400">
                          <span>{formatDutyPerformed(row.dutyPerformed)}</span>
                          <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset", getSourceChipClass(row.sourceType))}>
                            {getSourceLabel(row.sourceType, row.sourceLabel)}
                          </span>
                        </div>
                      </div>
                      <div className={cn("flex shrink-0 items-center gap-1.5 text-[13px] font-semibold", status.text)}>
                        <span className={cn("h-2 w-2 rounded-full", status.dot)} />
                        {status.label}
                      </div>
                    </div>

                    <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Expires</dt>
                        <dd className="mt-0.5 text-[13px] tabular-nums text-slate-800 dark:text-slate-200">{formatLedgerDate(row.expiryDate)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Leave used on</dt>
                        <dd className="mt-0.5 text-[13px] tabular-nums text-slate-800 dark:text-slate-200">{formatLedgerDate(row.leaveApplied)}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className={HEADER_CELL}>Duty date</th>
                    <th className={HEADER_CELL}>Duty performed</th>
                    <th className={HEADER_CELL}>Expires</th>
                    <th className={HEADER_CELL}>Source</th>
                    <th className={HEADER_CELL}>Leave used on</th>
                    <th className={HEADER_CELL}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const status = getStatus(row);

                    return (
                      <tr
                        key={`${row.sourceType}-${row.dutyDate || row.leaveApplied || index}`}
                        className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
                      >
                        <td className={cn(BODY_CELL, "whitespace-nowrap font-semibold tabular-nums text-slate-900 dark:text-white")}>
                          {formatLedgerDate(row.dutyDate)}
                        </td>
                        <td className={BODY_CELL}>{formatDutyPerformed(row.dutyPerformed)}</td>
                        <td className={cn(BODY_CELL, "whitespace-nowrap tabular-nums")}>{formatLedgerDate(row.expiryDate)}</td>
                        <td className={cn(BODY_CELL, "whitespace-nowrap")}>
                          <span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset", getSourceChipClass(row.sourceType))}>
                            {getSourceLabel(row.sourceType, row.sourceLabel)}
                          </span>
                        </td>
                        <td className={cn(BODY_CELL, "whitespace-nowrap tabular-nums")}>{formatLedgerDate(row.leaveApplied)}</td>
                        <td className={cn(BODY_CELL, "whitespace-nowrap")}>
                          <span className={cn("inline-flex items-center gap-2 font-semibold", status.text)}>
                            <span className={cn("h-2 w-2 shrink-0 rounded-full", status.dot)} />
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
