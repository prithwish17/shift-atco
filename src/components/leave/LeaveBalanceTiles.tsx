import { Clock } from "lucide-react";
import { LEAVE_SEGMENT_STYLES, LEAVE_TONE_STYLES, type LeaveBarSegment, type LeaveTone } from "@/components/leave/leaveTones";
import { formatShortLeaveDay } from "@/utils/leaveYearSummary";
import { cn } from "@/lib/utils";

export type LeaveBalanceTile = {
  key: string;
  label: string;
  tone: LeaveTone;
  /** Headline figure, e.g. "8". */
  value: string;
  /** What the figure means, e.g. "of 12 left". */
  valueLabel: string;
  /** Omitted where there is no entitlement to draw against, as for Earned Leave. */
  segments?: LeaveBarSegment[];
};

function BalanceTile({ tile }: { tile: LeaveBalanceTile }) {
  const segments = (tile.segments || []).filter((segment) => segment.value > 0);
  const hasBar = segments.length > 0;

  return (
    <div className="flex flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:px-4 sm:py-3">
      <div className="text-[11px] font-bold leading-tight text-slate-700 dark:text-slate-300 sm:text-xs">
        {tile.label}
      </div>

      <div className="leading-none">
        <span className="text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
          {tile.value}
        </span>
        <span className="ml-1 text-[10px] text-muted-foreground sm:text-xs">{tile.valueLabel}</span>
      </div>

      {/* The track stays even when a type has no bar, so the four tiles line up. */}
      <div className="flex h-1.5 gap-px overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        {hasBar &&
          segments.map((segment) => (
            <div
              key={segment.kind}
              className={cn(
                segment.kind === "left" ? LEAVE_TONE_STYLES[tile.tone].bar : LEAVE_SEGMENT_STYLES[segment.kind],
              )}
              style={{ flexGrow: segment.value }}
            />
          ))}
      </div>
    </div>
  );
}

export type CompOffExpiryNotice = {
  count: number;
  earliestDate: string | null;
  withinDays: number;
};

/**
 * The comp-off expiry warning.  It sits with the tiles rather than beside the
 * dates further down because it is the one thing on this page that is worth
 * acting on today — every entry already carried its 89-day expiry, but nothing
 * ever said so, and a comp-off could lapse with no signal anywhere.
 */
export function CompOffExpiryRail({ expiry, onView }: {
  expiry: CompOffExpiryNotice;
  onView?: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 border-l-4 border-amber-500 bg-amber-50 px-3 py-3 dark:bg-amber-950/40">
      <Clock className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="min-w-0 flex-1 text-xs text-amber-900 dark:text-amber-100 sm:text-sm">
        <span className="font-bold">
          {expiry.count} comp-off{expiry.count === 1 ? "" : "s"} expire
          {expiry.count === 1 ? "s" : ""} within {expiry.withinDays} days
        </span>
        {expiry.earliestDate && (
          <span className="text-amber-800/90 dark:text-amber-200/90">
            {" "}· earliest {formatShortLeaveDay(expiry.earliestDate)}
          </span>
        )}
      </div>
      {onView && (
        <button
          type="button"
          onClick={onView}
          className="shrink-0 border-b border-amber-700/60 text-xs font-bold text-amber-900 hover:border-amber-900 dark:border-amber-300/60 dark:text-amber-100 sm:text-sm"
        >
          View
        </button>
      )}
    </div>
  );
}

export function LeaveBalanceTiles({ tiles }: { tiles: LeaveBalanceTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <BalanceTile key={tile.key} tile={tile} />
      ))}
    </div>
  );
}
