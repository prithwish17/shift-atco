export type SupervisorShiftCode = "M" | "A" | "N";

export const SUPERVISOR_GRID_LINE = "border-slate-300 dark:border-slate-600";
export const SUPERVISOR_GRID_LINE_STRONG = "border-slate-500 dark:border-slate-400";
export const SUPERVISOR_TABLE_SECTION_DIVIDER = "border-l-[4px] border-l-slate-700 dark:border-l-slate-200";
export const SUPERVISOR_COLUMN_START_DIVIDER = "border-l-[3px] border-l-slate-400 dark:border-l-slate-300";
export const SUPERVISOR_COLUMN_END_DIVIDER = "border-r-[3px] border-r-slate-400 dark:border-r-slate-300";

export const SUPERVISOR_TOOLBAR_SHELL = "flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950";
export const SUPERVISOR_TOOLBAR_GROUP = "inline-flex items-center gap-0.5 rounded-full border border-slate-200/80 bg-slate-50/90 p-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-900";
export const SUPERVISOR_TOOLBAR_INFO = "inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
export const SUPERVISOR_TOOLBAR_ICON_BUTTON = "flex h-7 w-7 items-center justify-center rounded-full text-slate-600 transition hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white";
export const SUPERVISOR_MONTH_PILL = "rounded-full bg-slate-900 px-3 py-1.5 text-center text-[13px] font-semibold text-white shadow-sm dark:bg-slate-100 dark:text-slate-950";
export const SUPERVISOR_EMPTY_STATE = "shrink-0 rounded-2xl border border-dashed border-slate-300 bg-slate-50/90 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300";
export const SUPERVISOR_EMPTY_STATE_LARGE = "flex min-h-[420px] items-center justify-center rounded-[24px] border border-dashed border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-slate-100/70 px-6 py-10 dark:border-slate-700 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900";

export const SUPERVISOR_STATUS_SHELL_LOADING = "relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-cyan-50/70 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.08),transparent_26%),linear-gradient(180deg,rgba(2,6,23,0.98)_0%,rgba(15,23,42,0.98)_100%)]";
export const SUPERVISOR_STATUS_SHELL_ERROR = "relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-rose-50/70 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_right,rgba(251,113,133,0.08),transparent_24%),linear-gradient(180deg,rgba(2,6,23,0.98)_0%,rgba(15,23,42,0.98)_100%)]";
export const SUPERVISOR_STATUS_PANEL = "flex w-full max-w-lg flex-col items-center gap-6 rounded-[26px] border border-white/70 bg-white/88 px-6 py-10 text-center shadow-[0_30px_80px_-46px_rgba(15,23,42,0.5)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95";
export const SUPERVISOR_STATUS_SUBPANEL = "flex w-full flex-col gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 text-left dark:border-slate-700 dark:bg-slate-950/80";
export const SUPERVISOR_STATUS_BADGE_LOADING = "inline-flex items-center gap-2 rounded-full border border-cyan-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-700 shadow-sm dark:border-cyan-800/60 dark:bg-cyan-950/60 dark:text-cyan-200";

export const SUPERVISOR_TABLE_PANEL = "min-h-[320px] shrink-0 overflow-hidden rounded-[24px] border border-slate-300 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.96)_38%,rgba(241,245,249,0.94)_100%)] shadow-[0_26px_80px_-46px_rgba(15,23,42,0.55)] ring-1 ring-white/70 dark:border-slate-700 dark:bg-[linear-gradient(180deg,rgba(2,6,23,0.96)_0%,rgba(15,23,42,0.96)_45%,rgba(15,23,42,0.92)_100%)] dark:ring-white/5";
export const SUPERVISOR_SCROLLBAR_FOOTER = "shrink-0 border-t border-slate-300 bg-slate-100/95 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95";
export const SUPERVISOR_SCROLLBAR_TRACK = "relative h-5 rounded-full bg-slate-200/90 shadow-[inset_0_1px_3px_rgba(15,23,42,0.14)] touch-none dark:bg-slate-800";
export const SUPERVISOR_SCROLLBAR_THUMB = "cursor-grab border-slate-600/80 bg-slate-700 shadow-[0_6px_18px_rgba(15,23,42,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:border-slate-300/70 dark:bg-slate-200 dark:shadow-[0_6px_18px_rgba(2,6,23,0.38)]";
export const SUPERVISOR_SCROLLBAR_THUMB_DISABLED = "cursor-default border-slate-300/80 bg-slate-300/90 opacity-70 dark:border-slate-700 dark:bg-slate-700/90";

export const SUPERVISOR_WEEKEND_DATE_HEADER = "bg-indigo-950 text-indigo-100 border-indigo-800 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)] dark:bg-indigo-900 dark:text-indigo-50 dark:border-indigo-700";
export const SUPERVISOR_WEEKEND_SHIFT_HEADER = "bg-indigo-100/95 text-indigo-900 border-indigo-200 dark:bg-indigo-900/80 dark:text-indigo-100 dark:border-indigo-700/80";
export const SUPERVISOR_WEEKEND_TEAM_HEADER = "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/95 dark:text-indigo-100 dark:border-indigo-700/80";
export const SUPERVISOR_WEEKEND_CELL = "bg-indigo-50/70 dark:bg-indigo-950/35";

export const SUPERVISOR_REPORT_AVAILABILITY_HEADER = "bg-violet-600/95 text-white dark:bg-violet-900/85 dark:text-violet-50 dark:border-violet-700/80";
export const SUPERVISOR_REPORT_AVAILABILITY_SUBHEADER = "bg-violet-100/95 text-violet-900 dark:bg-violet-950/70 dark:text-violet-100 dark:border-violet-800/80";
export const SUPERVISOR_REPORT_SHORTAGE_HEADER = "bg-rose-600/95 text-white dark:bg-rose-900/85 dark:text-rose-50 dark:border-rose-700/80";
export const SUPERVISOR_REPORT_SHORTAGE_SUBHEADER = "bg-rose-100/95 text-rose-900 dark:bg-rose-950/70 dark:text-rose-100 dark:border-rose-800/80";
export const SUPERVISOR_REPORT_ROW_EVEN = "bg-white/98 dark:bg-slate-950/96";
export const SUPERVISOR_REPORT_ROW_ODD = "bg-slate-50/98 dark:bg-slate-900/92";
export const SUPERVISOR_REPORT_TEAM_CELL = "bg-slate-100/90 text-slate-700 dark:bg-slate-800/95 dark:text-slate-100";

const SHIFT_TONES: Record<SupervisorShiftCode, { header: string; subHeader: string; team: string; cell: string; badge: string }> = {
  M: {
    header: "bg-emerald-200/95 text-emerald-950 border-emerald-300 shadow-inner dark:bg-emerald-900/70 dark:text-emerald-50 dark:border-emerald-700/80",
    subHeader: "bg-emerald-100/90 text-emerald-900 border-emerald-200 dark:bg-emerald-900/55 dark:text-emerald-100 dark:border-emerald-700/70",
    team: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/90 dark:text-emerald-100",
    cell: "bg-emerald-50/60 dark:bg-emerald-950/28",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-900/30 dark:text-emerald-200",
  },
  A: {
    header: "bg-amber-200/95 text-amber-950 border-amber-300 shadow-inner dark:bg-amber-900/70 dark:text-amber-50 dark:border-amber-700/80",
    subHeader: "bg-amber-100/90 text-amber-900 border-amber-200 dark:bg-amber-900/55 dark:text-amber-100 dark:border-amber-700/70",
    team: "bg-amber-100 text-amber-900 dark:bg-amber-950/90 dark:text-amber-100",
    cell: "bg-amber-50/60 dark:bg-amber-950/28",
    badge: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/30 dark:text-amber-200",
  },
  N: {
    header: "bg-sky-200/95 text-sky-950 border-sky-300 shadow-inner dark:bg-sky-900/70 dark:text-sky-50 dark:border-sky-700/80",
    subHeader: "bg-sky-100/90 text-sky-900 border-sky-200 dark:bg-sky-900/55 dark:text-sky-100 dark:border-sky-700/70",
    team: "bg-sky-100 text-sky-900 dark:bg-sky-950/90 dark:text-sky-100",
    cell: "bg-sky-50/60 dark:bg-sky-950/28",
    badge: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-900/30 dark:text-sky-200",
  },
};

export function getSupervisorShiftTone(shiftCode: SupervisorShiftCode | number) {
  if (typeof shiftCode === "number") {
    return SHIFT_TONES[["M", "A", "N"][shiftCode] as SupervisorShiftCode];
  }

  return SHIFT_TONES[shiftCode];
}

export function getSupervisorLegendTone(kind: "morning" | "afternoon" | "night" | "weekend" | "short" | "minimum" | "comfortable") {
  switch (kind) {
    case "morning":
      return SHIFT_TONES.M.badge;
    case "afternoon":
      return SHIFT_TONES.A.badge;
    case "night":
      return SHIFT_TONES.N.badge;
    case "weekend":
      return "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/70 dark:bg-indigo-900/30 dark:text-indigo-200";
    case "short":
      return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/70 dark:bg-rose-900/30 dark:text-rose-200";
    case "minimum":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-900/30 dark:text-amber-200";
    case "comfortable":
      return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-900/30 dark:text-emerald-200";
  }
}

export function getSupervisorRowBg(type: string, idx: number) {
  switch (type) {
    case "header":
      return "bg-slate-200/95 dark:bg-slate-800/95";
    case "ownTeam":
      return idx % 2 === 0 ? "bg-slate-50/92 dark:bg-slate-900/94" : "bg-slate-100/88 dark:bg-slate-800/92";
    case "extra":
      return idx % 2 === 0 ? "bg-orange-50/92 dark:bg-orange-950/30" : "bg-orange-100/84 dark:bg-orange-900/35";
    case "normal":
      return idx % 2 === 0 ? "bg-white dark:bg-slate-950" : "bg-slate-50/92 dark:bg-slate-900/94";
    case "general":
      return idx % 2 === 0 ? "bg-teal-50/92 dark:bg-teal-950/30" : "bg-teal-100/84 dark:bg-teal-900/35";
    case "summary":
      return idx % 2 === 0 ? "bg-slate-50 dark:bg-slate-900" : "bg-slate-100 dark:bg-slate-800";
    default:
      return "bg-white dark:bg-slate-950";
  }
}

export function getSupervisorOpaqueRowBg(type: string, idx: number) {
  switch (type) {
    case "header":
      return "bg-slate-200 dark:bg-slate-800";
    case "ownTeam":
      return idx % 2 === 0 ? "bg-slate-50 dark:bg-slate-900" : "bg-slate-100 dark:bg-slate-800";
    case "extra":
      return idx % 2 === 0 ? "bg-orange-50 dark:bg-orange-950" : "bg-orange-100 dark:bg-orange-900";
    case "normal":
      return idx % 2 === 0 ? "bg-white dark:bg-slate-950" : "bg-slate-50 dark:bg-slate-900";
    case "general":
      return idx % 2 === 0 ? "bg-teal-50 dark:bg-teal-950" : "bg-teal-100 dark:bg-teal-900";
    case "summary":
      return idx % 2 === 0 ? "bg-slate-50 dark:bg-slate-900" : "bg-slate-100 dark:bg-slate-800";
    default:
      return "bg-white dark:bg-slate-950";
  }
}

export function getSupervisorUnitTextTone(type: string) {
  switch (type) {
    case "header":
      return "text-slate-900 dark:text-slate-50 font-bold text-[11px] uppercase tracking-wide";
    case "ownTeam":
      return "text-slate-700 dark:text-slate-100 font-semibold";
    case "extra":
      return "text-orange-950 dark:text-orange-100 font-semibold";
    case "normal":
      return "text-slate-700 dark:text-slate-200";
    case "general":
      return "text-teal-950 dark:text-teal-100 font-semibold";
    case "summary":
      return "text-slate-800 dark:text-slate-50 font-bold";
    default:
      return "text-slate-600 dark:text-slate-300";
  }
}

export function getSupervisorDefaultCellBg(rowType: string, shiftCode: SupervisorShiftCode, weekend: boolean) {
  if (rowType === "summary") {
    return weekend ? "bg-slate-100 dark:bg-slate-800" : "bg-slate-50 dark:bg-slate-900";
  }

  return weekend ? SUPERVISOR_WEEKEND_CELL : getSupervisorShiftTone(shiftCode).cell;
}

export function getSupervisorSignedDeltaTone(delta: number) {
  if (delta < 0) {
    return "bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/60 dark:text-rose-100 dark:ring-rose-700/50";
  }

  if (delta === 0) {
    return "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/55 dark:text-amber-100 dark:ring-amber-700/50";
  }

  return "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/60 dark:text-emerald-100 dark:ring-emerald-700/50";
}