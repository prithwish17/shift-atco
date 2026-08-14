import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEAVE_TONE_STYLES, type LeaveTone } from "@/components/leave/leaveTones";
import { MONTH_INITIALS, MONTH_NAMES, formatShortLeaveDay } from "@/utils/leaveYearSummary";
import { cn } from "@/lib/utils";

export type LeaveYearRow = {
  key: string;
  label: string;
  tone: LeaveTone;
  /** Days taken in each month of the year, index 0 = January. */
  monthDays: string[][];
  /**
   * The dates themselves, already formatted and in order — "4 Mar", or
   * "15–19 Jun" where the leave is stored as a range.  Printed in full under
   * every row: this page is read by people who will not think to tap a chart to
   * find out when they took their leave, so nothing here hides behind a click.
   */
  dateLabels: string[];
};

function getCellToneIndex(dayCount: number): number {
  if (dayCount >= 3) return 2;
  if (dayCount === 2) return 1;
  return 0;
}

function MonthCell({ monthIndex, days, tone, label }: {
  monthIndex: number;
  days: string[];
  tone: LeaveTone;
  label: string;
}) {
  const monthName = MONTH_NAMES[monthIndex];

  if (days.length === 0) {
    return (
      <div
        className="h-6 rounded-[3px] bg-slate-100 dark:bg-slate-800/60 sm:h-7"
        title={`${monthName}: none`}
        aria-label={`${monthName}: no ${label.toLowerCase()}`}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex h-6 items-center justify-center rounded-[3px] text-[11px] font-semibold sm:h-7 sm:text-sm",
        LEAVE_TONE_STYLES[tone].cell[getCellToneIndex(days.length)],
      )}
      title={`${monthName}: ${days.map((day) => formatShortLeaveDay(day) || day).join(", ")}`}
      aria-label={`${monthName}: ${days.length} day${days.length === 1 ? "" : "s"} of ${label.toLowerCase()}`}
    >
      {days.length}
    </div>
  );
}

function LeaveRow({ row }: { row: LeaveYearRow }) {
  const total = row.monthDays.reduce((sum, days) => sum + days.length, 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-bold text-slate-900 dark:text-slate-100 sm:text-base">{row.label}</span>
        <span className="text-xs text-muted-foreground sm:text-sm">
          {total} day{total === 1 ? "" : "s"} this year
        </span>
      </div>

      <div className="mt-2 grid grid-cols-12 gap-[3px]">
        {row.monthDays.map((days, monthIndex) => (
          <MonthCell
            key={monthIndex}
            monthIndex={monthIndex}
            days={days}
            tone={row.tone}
            label={row.label}
          />
        ))}
      </div>
      <div className="mt-1 grid grid-cols-12 gap-[3px]">
        {MONTH_INITIALS.map((initial, monthIndex) => (
          <div key={monthIndex} className="text-center text-[10px] text-muted-foreground sm:text-xs">
            {initial}
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="shrink-0 font-semibold text-slate-600 dark:text-slate-400">Taken on:</span>
        {row.dateLabels.length > 0 ? (
          <span className="text-slate-900 dark:text-slate-100">{row.dateLabels.join("  ·  ")}</span>
        ) : (
          <span className="text-muted-foreground">none</span>
        )}
      </div>
    </div>
  );
}

export function LeaveYearStrip({ rows }: { rows: LeaveYearRow[] }) {
  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="px-3 py-2.5 sm:px-6 sm:py-4">
        <CardTitle className="text-sm sm:text-lg">When you took leave</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-slate-200 px-3 pb-3 pt-0 dark:divide-slate-800 sm:px-6 sm:pb-5">
        {rows.map((row, index) => (
          <div key={row.key} className={index === 0 ? "pb-5" : "py-5 last:pb-0"}>
            <LeaveRow row={row} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
