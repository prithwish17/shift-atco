/**
 * Shared colouring for the leave surfaces: the balance tiles at the top of the
 * page and the year strip further down read the same four leave types, so the
 * tone a type wears is defined once here rather than per component.
 */
export type LeaveTone = "casual" | "compOff" | "restricted" | "earned";

export const LEAVE_TONE_STYLES: Record<LeaveTone, { bar: string; cell: string[] }> = {
  // Three cell tints per tone: one day in the month, a couple, a lot.  The scale
  // is sequential on purpose — a month with more leave in it reads darker.
  casual: {
    bar: "bg-sky-500",
    cell: [
      "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-50",
      "bg-sky-200 text-sky-900 dark:bg-sky-900/70 dark:text-sky-50",
      "bg-sky-400 text-sky-950 dark:bg-sky-700 dark:text-white",
    ],
  },
  compOff: {
    bar: "bg-emerald-500",
    cell: [
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-50",
      "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-50",
      "bg-emerald-400 text-emerald-950 dark:bg-emerald-700 dark:text-white",
    ],
  },
  restricted: {
    bar: "bg-amber-500",
    cell: [
      "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-50",
      "bg-amber-200 text-amber-900 dark:bg-amber-900/70 dark:text-amber-50",
      "bg-amber-400 text-amber-950 dark:bg-amber-700 dark:text-white",
    ],
  },
  earned: {
    bar: "bg-violet-500",
    cell: [
      "bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-50",
      "bg-violet-200 text-violet-900 dark:bg-violet-900/70 dark:text-violet-50",
      "bg-violet-400 text-violet-950 dark:bg-violet-700 dark:text-white",
    ],
  },
};

/** Non-"left" bar segments carry the same meaning wherever the bar is drawn. */
export const LEAVE_SEGMENT_STYLES = {
  left: "",
  used: "bg-slate-300 dark:bg-slate-700",
  expired: "bg-rose-400 dark:bg-rose-500",
} as const;

export type LeaveBarSegment = {
  kind: keyof typeof LEAVE_SEGMENT_STYLES;
  value: number;
};
