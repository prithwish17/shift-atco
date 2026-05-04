import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addMonths, format } from "date-fns";
import { CalendarRange, ChevronLeft, ChevronRight, Table2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { DashboardLayout } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchSupervisorScheduleMembers } from "@/hooks/useSupervisorScheduleMembers";
import {
  SUPERVISOR_GRID_LINE,
  SUPERVISOR_GRID_LINE_STRONG,
  SUPERVISOR_MONTH_PILL,
  SUPERVISOR_REPORT_AVAILABILITY_HEADER,
  SUPERVISOR_REPORT_AVAILABILITY_SUBHEADER,
  SUPERVISOR_REPORT_ROW_EVEN,
  SUPERVISOR_REPORT_ROW_ODD,
  SUPERVISOR_REPORT_SHORTAGE_HEADER,
  SUPERVISOR_REPORT_SHORTAGE_SUBHEADER,
  SUPERVISOR_REPORT_TEAM_CELL,
  SUPERVISOR_SCROLLBAR_FOOTER,
  SUPERVISOR_SCROLLBAR_THUMB,
  SUPERVISOR_SCROLLBAR_THUMB_DISABLED,
  SUPERVISOR_SCROLLBAR_TRACK,
  SUPERVISOR_STATUS_PANEL,
  SUPERVISOR_STATUS_SHELL_ERROR,
  SUPERVISOR_STATUS_SHELL_LOADING,
  SUPERVISOR_TABLE_PANEL,
  SUPERVISOR_TABLE_SECTION_DIVIDER,
  SUPERVISOR_TOOLBAR_GROUP,
  SUPERVISOR_TOOLBAR_ICON_BUTTON,
  SUPERVISOR_TOOLBAR_INFO,
  SUPERVISOR_TOOLBAR_SHELL,
  SUPERVISOR_EMPTY_STATE,
  getSupervisorLegendTone,
  getSupervisorShiftTone,
  getSupervisorSignedDeltaTone,
} from "@/lib/supervisorTableTheme";
import {
  buildMonthDateKeys,
  buildMonthlyAvailabilityReport,
  getSufficiencyColor,
  TOTAL_SHIFT_REQUIREMENTS,
  type AvailabilityShiftCode,
  type MonthlyAvailabilityReport,
  type AvailabilityReportRow,
  type AvailabilityShiftReportSection,
  type AvailabilityGroupReportCell,
  type GroupNum,
} from "@/lib/supervisorAvailability";

const SHIFT_ORDER: AvailabilityShiftCode[] = ["M", "A", "N"];

interface GridScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  trackWidth: number;
}

const REPORT_SECTION_TONES: Record<AvailabilityShiftCode, { header: string; subHeader: string; team: string; badge: string }> = {
  M: {
    header: "bg-cyan-200/95 text-cyan-950 border-cyan-300 shadow-inner dark:bg-cyan-900/70 dark:text-cyan-50 dark:border-cyan-700/80",
    subHeader: "bg-cyan-100/90 text-cyan-900 border-cyan-200 dark:bg-cyan-900/55 dark:text-cyan-100 dark:border-cyan-700/70",
    team: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950/90 dark:text-cyan-100",
    badge: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-800/70 dark:bg-cyan-900/30 dark:text-cyan-200",
  },
  A: {
    header: "bg-violet-200/95 text-violet-950 border-violet-300 shadow-inner dark:bg-violet-900/70 dark:text-violet-50 dark:border-violet-700/80",
    subHeader: "bg-violet-100/90 text-violet-900 border-violet-200 dark:bg-violet-900/55 dark:text-violet-100 dark:border-violet-700/70",
    team: "bg-violet-100 text-violet-900 dark:bg-violet-950/90 dark:text-violet-100",
    badge: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800/70 dark:bg-violet-900/30 dark:text-violet-200",
  },
  N: {
    header: getSupervisorShiftTone("N").header,
    subHeader: getSupervisorShiftTone("N").subHeader,
    team: getSupervisorShiftTone("N").team,
    badge: getSupervisorLegendTone("night"),
  },
};

const SHIFT_SECTION_CONFIG: Array<{
  shiftCode: AvailabilityShiftCode;
  label: string;
  tone: string;
  subTone: string;
  teamTone: string;
  badgeTone: string;
}> = [
  {
    shiftCode: "M",
    label: "Morning Coverage",
    tone: REPORT_SECTION_TONES.M.header,
    subTone: REPORT_SECTION_TONES.M.subHeader,
    teamTone: REPORT_SECTION_TONES.M.team,
    badgeTone: REPORT_SECTION_TONES.M.badge,
  },
  {
    shiftCode: "A",
    label: "Afternoon Coverage",
    tone: REPORT_SECTION_TONES.A.header,
    subTone: REPORT_SECTION_TONES.A.subHeader,
    teamTone: REPORT_SECTION_TONES.A.team,
    badgeTone: REPORT_SECTION_TONES.A.badge,
  },
  {
    shiftCode: "N",
    label: "Night Coverage",
    tone: REPORT_SECTION_TONES.N.header,
    subTone: REPORT_SECTION_TONES.N.subHeader,
    teamTone: REPORT_SECTION_TONES.N.team,
    badgeTone: REPORT_SECTION_TONES.N.badge,
  },
];

function formatSignedDelta(delta: number) {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function isWeekendDayLabel(dayLabel: string) {
  return dayLabel === "SAT" || dayLabel === "SUN";
}

function getReportDateCellTone(dayLabel: string, rowIndex: number) {
  if (isWeekendDayLabel(dayLabel)) {
    return "bg-indigo-50 text-slate-900 dark:bg-indigo-950/45 dark:text-slate-50";
  }

  return rowIndex % 2 === 0
    ? "bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50"
    : "bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-50";
}

function getReportDayBadgeTone(dayLabel: string) {
  if (isWeekendDayLabel(dayLabel)) {
    return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/70 dark:text-indigo-100";
  }

  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

export default function SupervisorAvailabilityReport() {
  const [monthOffset, setMonthOffset] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const emptyStateRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const tableShellRef = useRef<HTMLDivElement>(null);
  const horizontalTrackRef = useRef<HTMLDivElement>(null);
  const [tableShellHeight, setTableShellHeight] = useState<number | null>(null);
  const [gridScrollMetrics, setGridScrollMetrics] = useState<GridScrollMetrics>({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
    trackWidth: 0,
  });

  const monthDate = useMemo(() => addMonths(new Date(), monthOffset), [monthOffset]);
  const selectedMonth = useMemo(() => format(monthDate, "yyyy-MM"), [monthDate]);

  /* ── Data fetching: RPC-first, fallback to old multi-request approach ── */
  const { data: report, isLoading, isError, refetch } = useQuery<MonthlyAvailabilityReport>({
    queryKey: ["daily-availability-report", selectedMonth],
    queryFn: async (): Promise<MonthlyAvailabilityReport> => {

      // ── Fast path: server-side RPC (~200ms) ──────────────────────────
      try {
        const { data: rpcData, error: rpcError } = await (supabase as any)
          .rpc("get_daily_availability", { p_month: selectedMonth });

        if (!rpcError && rpcData && rpcData.length > 0) {
          const rows: AvailabilityReportRow[] = rpcData.map((r: any) => {
            const parseShiftSection = (
              shiftJson: any,
              shiftCode: AvailabilityShiftCode,
            ): AvailabilityShiftReportSection => {
              const data = shiftJson || {};
              const groups: AvailabilityGroupReportCell[] = (data.groups || []).map((g: any) => ({
                group: g.group as GroupNum,
                label: g.label || "",
                available: g.available ?? 0,
                required: g.required ?? 0,
                net: g.net ?? 0,
                colorClass: getSufficiencyColor(g.available ?? 0, g.required ?? 0),
              }));
              return {
                shiftCode,
                teamCode: data.teamCode || shiftCode,
                totalAvailable: data.totalAvailable ?? 0,
                totalRequired: data.totalRequired ?? 0,
                net: data.net ?? 0,
                groups,
              };
            };

            return {
              isoDate: r.iso_date,
              dateLabel: r.date_label,
              dayLabel: r.day_label,
              availability: {
                M: r.avail_m ?? 0,
                A: r.avail_a ?? 0,
                N: r.avail_n ?? 0,
              },
              net: {
                M: r.net_m ?? 0,
                A: r.net_a ?? 0,
                N: r.net_n ?? 0,
              },
              shifts: {
                M: parseShiftSection(r.shift_m, "M"),
                A: parseShiftSection(r.shift_a, "A"),
                N: parseShiftSection(r.shift_n, "N"),
              },
            } satisfies AvailabilityReportRow;
          });

          return {
            monthLabel: format(monthDate, "MMMM yyyy"),
            rows,
            requirements: {
              totals: TOTAL_SHIFT_REQUIREMENTS,
              groups: [
                { group: 1 as GroupNum, label: "Group 1 — RSR", shortLabel: "RSR", morningAfternoon: 12, night: 16 },
                { group: 2 as GroupNum, label: "Group 2 — ASR", shortLabel: "ASR", morningAfternoon: 4, night: 4 },
                { group: 3 as GroupNum, label: "Group 3 — ACC/OCC", shortLabel: "ACC/OCC", morningAfternoon: 14, night: 16 },
                { group: 4 as GroupNum, label: "Group 4 — ADC/SMC", shortLabel: "ADC/SMC", morningAfternoon: 9, night: 9 },
                { group: 5 as GroupNum, label: "Group 5 — ALPHA", shortLabel: "ALPHA", morningAfternoon: 11, night: 10 },
              ],
            },
          };
        }
      } catch {
        // RPC not available — fall through to old approach
      }

      // ── Fallback: old multi-request approach (~1.5s) ─────────────────
      const monthDateKeys = buildMonthDateKeys(monthDate);
      const startDate = monthDateKeys[0];
      const endDate = monthDateKeys[monthDateKeys.length - 1];
      const scheduleMembers = await fetchSupervisorScheduleMembers(startDate, endDate);
      return buildMonthlyAvailabilityReport(monthDate, scheduleMembers);
    },
    staleTime: 2 * 60_000,
  });

  const safeReport = useMemo<MonthlyAvailabilityReport>(
    () =>
      report ?? {
        monthLabel: format(monthDate, "MMMM yyyy"),
        rows: [],
        requirements: { totals: TOTAL_SHIFT_REQUIREMENTS, groups: [] },
      },
    [monthDate, report],
  );
  const reportRows = safeReport.rows;

  const updateTableShellHeight = useCallback(() => {
    const shell = tableShellRef.current;
    if (!shell) return;

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const bottomPadding = window.matchMedia("(min-width: 768px)").matches ? 24 : 16;
    const nextHeight = Math.max(320, Math.floor(viewportHeight - shell.getBoundingClientRect().top - bottomPadding));

    setTableShellHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  const updateGridScrollMetrics = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    setGridScrollMetrics({
      scrollLeft: viewport.scrollLeft,
      scrollWidth: viewport.scrollWidth,
      clientWidth: viewport.clientWidth,
      trackWidth: horizontalTrackRef.current?.clientWidth || 0,
    });
  }, []);

  const setGridHorizontalScroll = useCallback(
    (nextScrollLeft: number) => {
      const viewport = scrollViewportRef.current;
      if (!viewport) return;

      const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const clampedScrollLeft = Math.max(0, Math.min(nextScrollLeft, maxScroll));

      viewport.scrollLeft = clampedScrollLeft;
      requestAnimationFrame(updateGridScrollMetrics);
    },
    [updateGridScrollMetrics],
  );

  const handleViewportScroll = useCallback(() => {
    updateGridScrollMetrics();
  }, [updateGridScrollMetrics]);

  useEffect(() => {
    updateGridScrollMetrics();
  }, [reportRows.length, updateGridScrollMetrics]);

  useEffect(() => {
    const onResize = () => {
      requestAnimationFrame(updateTableShellHeight);
    };

    onResize();

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => onResize())
      : null;

    if (toolbarRef.current) resizeObserver?.observe(toolbarRef.current);
    if (emptyStateRef.current) resizeObserver?.observe(emptyStateRef.current);
    if (tableShellRef.current) resizeObserver?.observe(tableShellRef.current);

    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
    };
  }, [reportRows.length, updateTableShellHeight]);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    const track = horizontalTrackRef.current;
    const table = tableRef.current;
    if (!viewport) return;

    updateGridScrollMetrics();

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => updateGridScrollMetrics())
      : null;

    resizeObserver?.observe(viewport);
    if (track) resizeObserver?.observe(track);
    if (table) resizeObserver?.observe(table);

    window.addEventListener("resize", updateGridScrollMetrics);

    return () => {
      window.removeEventListener("resize", updateGridScrollMetrics);
      resizeObserver?.disconnect();
    };
  }, [updateGridScrollMetrics]);

  const horizontalMaxScroll = Math.max(0, gridScrollMetrics.scrollWidth - gridScrollMetrics.clientWidth);
  const rawThumbWidth =
    horizontalMaxScroll <= 0 || gridScrollMetrics.trackWidth <= 0
      ? gridScrollMetrics.trackWidth
      : (gridScrollMetrics.clientWidth / gridScrollMetrics.scrollWidth) * gridScrollMetrics.trackWidth;
  const thumbWidth =
    gridScrollMetrics.trackWidth > 0
      ? Math.min(gridScrollMetrics.trackWidth, Math.max(96, rawThumbWidth))
      : 0;
  const renderedThumbWidth =
    gridScrollMetrics.trackWidth > 0
      ? Math.max(Math.min(thumbWidth || gridScrollMetrics.trackWidth, gridScrollMetrics.trackWidth), Math.min(56, gridScrollMetrics.trackWidth))
      : 0;
  const thumbTravel = Math.max(0, gridScrollMetrics.trackWidth - renderedThumbWidth);
  const thumbLeft =
    horizontalMaxScroll > 0 && thumbTravel > 0
      ? (gridScrollMetrics.scrollLeft / horizontalMaxScroll) * thumbTravel
      : 0;

  const handleHorizontalTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || horizontalMaxScroll <= 0) return;

      const track = horizontalTrackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const nextThumbLeft = Math.max(0, Math.min(clickX - renderedThumbWidth / 2, thumbTravel));
      const nextScrollLeft = thumbTravel > 0 ? (nextThumbLeft / thumbTravel) * horizontalMaxScroll : 0;

      setGridHorizontalScroll(nextScrollLeft);
    },
    [horizontalMaxScroll, renderedThumbWidth, setGridHorizontalScroll, thumbTravel],
  );

  const handleHorizontalThumbPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (horizontalMaxScroll <= 0 || thumbTravel <= 0) return;

      const startX = event.clientX;
      const startScrollLeft = scrollViewportRef.current?.scrollLeft || 0;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaScroll = (deltaX / thumbTravel) * horizontalMaxScroll;
        setGridHorizontalScroll(startScrollLeft + deltaScroll);
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };

      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [horizontalMaxScroll, setGridHorizontalScroll, thumbTravel],
  );

  const handleHorizontalScrollbarKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (horizontalMaxScroll <= 0) return;

      const step = Math.max(120, Math.round(gridScrollMetrics.clientWidth * 0.15));

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          setGridHorizontalScroll(gridScrollMetrics.scrollLeft - step);
          break;
        case "ArrowRight":
          event.preventDefault();
          setGridHorizontalScroll(gridScrollMetrics.scrollLeft + step);
          break;
        case "PageUp":
          event.preventDefault();
          setGridHorizontalScroll(gridScrollMetrics.scrollLeft - gridScrollMetrics.clientWidth);
          break;
        case "PageDown":
          event.preventDefault();
          setGridHorizontalScroll(gridScrollMetrics.scrollLeft + gridScrollMetrics.clientWidth);
          break;
        case "Home":
          event.preventDefault();
          setGridHorizontalScroll(0);
          break;
        case "End":
          event.preventDefault();
          setGridHorizontalScroll(horizontalMaxScroll);
          break;
        default:
          break;
      }
    },
    [gridScrollMetrics.clientWidth, gridScrollMetrics.scrollLeft, horizontalMaxScroll, setGridHorizontalScroll],
  );

  if (isLoading) {
    return (
      <DashboardLayout role="supervisor">
        <div className={SUPERVISOR_STATUS_SHELL_LOADING}>
          <div className="flex min-h-[calc(100vh-140px)] items-center justify-center p-5 md:p-8">
          <div className={SUPERVISOR_STATUS_PANEL}>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-cyan-200/80 bg-cyan-50 text-cyan-700 dark:border-cyan-800/70 dark:bg-cyan-950/60 dark:text-cyan-200">
              <CalendarRange className="h-6 w-6 animate-pulse" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">Loading availability report</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Preparing the monthly manpower availability report for supervisors.</p>
          </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (isError) {
    return (
      <DashboardLayout role="supervisor">
        <div className={SUPERVISOR_STATUS_SHELL_ERROR}>
          <div className="flex min-h-[calc(100vh-140px)] items-center justify-center p-5 md:p-8">
          <div className={SUPERVISOR_STATUS_PANEL}>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/60 dark:text-rose-200">
              <Table2 className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">Unable to load availability report</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">The report data could not be loaded right now.</p>
            <Button type="button" className="mt-5" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="supervisor">
      <div className="flex h-full min-h-0 flex-col gap-2">
          <div ref={toolbarRef} className={`${SUPERVISOR_TOOLBAR_SHELL} gap-2 sm:gap-3`}>
            <div className="min-w-0 flex-1">
              <div className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:block">Supervisor report</div>
              <div className="flex items-center gap-1.5 sm:mt-1 sm:flex-wrap sm:gap-2">
                <h1 className="text-base font-semibold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-lg">Monthly Availability Report</h1>
                <Badge className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0 text-[9px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:px-2 sm:py-0.5 sm:text-[10px]">
                  {reportRows.length} days
                </Badge>
              </div>
              <p className="mt-1 hidden text-sm text-slate-600 dark:text-slate-300 sm:block">
                Review daily availability totals, net balance against required staffing, and shift-group coverage for the full month.
              </p>
            </div>

            <div className={`${SUPERVISOR_TOOLBAR_GROUP} ml-auto w-auto shrink-0`}>
              <button
                type="button"
                onClick={() => setMonthOffset((current) => current - 1)}
                className={SUPERVISOR_TOOLBAR_ICON_BUTTON}
                aria-label="Previous month"
              >
                <ChevronLeft size={14} />
              </button>
              <div className={SUPERVISOR_MONTH_PILL}>
                {safeReport.monthLabel}
              </div>
              <button
                type="button"
                onClick={() => setMonthOffset((current) => current + 1)}
                className={SUPERVISOR_TOOLBAR_ICON_BUTTON}
                aria-label="Next month"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-slate-200/80 pt-1.5 dark:border-slate-800 sm:gap-2 sm:pt-2">
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:hidden">
                <CalendarRange className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <span>Avail M/A/N and net vs staffing</span>
              </div>

              <div className={`${SUPERVISOR_TOOLBAR_INFO} hidden sm:inline-flex`}>
                <CalendarRange className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <span><span className="font-semibold text-slate-900 dark:text-slate-100">Availability</span> = total ATCOs available on M / A / N</span>
              </div>

              <div className={`${SUPERVISOR_TOOLBAR_INFO} hidden sm:inline-flex`}>
                <span><span className="font-semibold text-slate-900 dark:text-slate-100">Net</span> = available minus total required staffing</span>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-1">
                <Badge className={`rounded-full px-1.5 py-0 text-[9px] font-medium sm:px-2 sm:py-0.5 sm:text-[10px] ${SHIFT_SECTION_CONFIG[0].badgeTone}`}>M</Badge>
                <Badge className={`rounded-full px-1.5 py-0 text-[9px] font-medium sm:px-2 sm:py-0.5 sm:text-[10px] ${SHIFT_SECTION_CONFIG[1].badgeTone}`}>A</Badge>
                <Badge className={`rounded-full px-1.5 py-0 text-[9px] font-medium sm:px-2 sm:py-0.5 sm:text-[10px] ${getSupervisorLegendTone("night")}`}>N</Badge>
                <Badge className={`rounded-full px-1.5 py-0 text-[9px] font-medium sm:px-2 sm:py-0.5 sm:text-[10px] ${getSupervisorLegendTone("short")}`}>Short</Badge>
                <Badge className={`hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${SHIFT_SECTION_CONFIG[0].badgeTone}`}>Morning block</Badge>
                <Badge className={`hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${SHIFT_SECTION_CONFIG[1].badgeTone}`}>Afternoon block</Badge>
                <Badge className={`hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${getSupervisorLegendTone("night")}`}>Night block</Badge>
                <Badge className={`hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${getSupervisorLegendTone("minimum")}`}>At minimum</Badge>
                <Badge className={`hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${getSupervisorLegendTone("comfortable")}`}>Comfortable</Badge>
              </div>
            </div>
          </div>

          {reportRows.length === 0 && !isLoading && (
            <div ref={emptyStateRef} className={SUPERVISOR_EMPTY_STATE}>
              No schedule rows were found for this month. The report is showing zero availability until schedule data is available.
            </div>
          )}

          <div
            ref={tableShellRef}
            className={`flex flex-col ${SUPERVISOR_TABLE_PANEL}`}
            style={{ height: tableShellHeight ? `${tableShellHeight}px` : undefined }}
          >
            <div
              id="availability-report-grid"
              ref={scrollViewportRef}
              onScroll={handleViewportScroll}
              className="custom-scrollbar min-h-0 flex-1 overflow-auto"
            >
              <table ref={tableRef} className="min-w-[1880px] border-collapse text-[12px] leading-snug">
                <thead className="sticky top-0 z-30">
                  <tr>
                    <th rowSpan={2} className={`sticky left-0 z-40 min-w-[140px] border-r bg-slate-900 px-3 py-2 text-left text-[12px] font-bold text-slate-50 dark:bg-slate-900 ${SUPERVISOR_GRID_LINE_STRONG}`}>
                      <div>Date</div>
                      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-300">Day</div>
                    </th>
                    <th colSpan={3} className={`border-r px-2 py-2 text-center text-[12px] font-bold ${SUPERVISOR_REPORT_AVAILABILITY_HEADER} ${SUPERVISOR_GRID_LINE_STRONG}`}>
                      Availability
                    </th>
                    <th colSpan={3} className={`border-r px-2 py-2 text-center text-[12px] font-bold ${SUPERVISOR_REPORT_SHORTAGE_HEADER} ${SUPERVISOR_GRID_LINE_STRONG} ${SUPERVISOR_TABLE_SECTION_DIVIDER}`}>
                      Net vs Requirement
                    </th>
                    {SHIFT_SECTION_CONFIG.map((section) => (
                      <th key={section.shiftCode} colSpan={7} className={`border-r px-2 py-2 text-center text-[12px] font-bold ${section.tone} ${SUPERVISOR_GRID_LINE_STRONG} ${SUPERVISOR_TABLE_SECTION_DIVIDER}`}>
                        {section.label}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {SHIFT_ORDER.map((shiftCode) => (
                      <th key={`availability-${shiftCode}`} className={`border-r px-2 py-1.5 text-center font-semibold ${SUPERVISOR_REPORT_AVAILABILITY_SUBHEADER} ${SUPERVISOR_GRID_LINE}`}>
                        {shiftCode}
                      </th>
                    ))}
                    {SHIFT_ORDER.map((shiftCode) => (
                      <th key={`net-${shiftCode}`} className={`border-r px-2 py-1.5 text-center font-semibold ${SUPERVISOR_REPORT_SHORTAGE_SUBHEADER} ${SUPERVISOR_GRID_LINE} ${shiftCode === "M" ? SUPERVISOR_TABLE_SECTION_DIVIDER : ""}`}>
                        {shiftCode}
                      </th>
                    ))}
                    {SHIFT_SECTION_CONFIG.map((section) => (
                      <Fragment key={section.shiftCode}>
                        <th key={`${section.shiftCode}-team`} className={`border-r px-2 py-1.5 text-center font-semibold ${section.subTone} ${SUPERVISOR_GRID_LINE} ${SUPERVISOR_TABLE_SECTION_DIVIDER}`}>
                          Team
                        </th>
                        <th key={`${section.shiftCode}-rsr`} className={`border-r px-2 py-1.5 text-center font-semibold ${section.subTone} ${SUPERVISOR_GRID_LINE}`}>
                          RSR
                        </th>
                        <th key={`${section.shiftCode}-asr`} className={`border-r px-2 py-1.5 text-center font-semibold ${section.subTone} ${SUPERVISOR_GRID_LINE}`}>
                          ASR
                        </th>
                        <th key={`${section.shiftCode}-accoocc`} className={`border-r px-2 py-1.5 text-center font-semibold ${section.subTone} ${SUPERVISOR_GRID_LINE}`}>
                          ACC/OCC
                        </th>
                        <th key={`${section.shiftCode}-adcsmc`} className={`border-r px-2 py-1.5 text-center font-semibold ${section.subTone} ${SUPERVISOR_GRID_LINE}`}>
                          ADC/SMC
                        </th>
                        <th key={`${section.shiftCode}-alpha`} className={`border-r px-2 py-1.5 text-center font-semibold ${section.subTone} ${SUPERVISOR_GRID_LINE}`}>
                          ALPHA
                        </th>
                        <th key={`${section.shiftCode}-total`} className={`border-r px-2 py-1.5 text-center font-semibold ${section.subTone} ${SUPERVISOR_GRID_LINE}`}>
                          Total
                        </th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row, rowIndex) => (
                    <tr key={row.isoDate} className={rowIndex % 2 === 0 ? SUPERVISOR_REPORT_ROW_EVEN : SUPERVISOR_REPORT_ROW_ODD}>
                      <td className={`sticky left-0 z-20 border-r border-b px-3 py-2 shadow-[6px_0_14px_-10px_rgba(15,23,42,0.24)] dark:shadow-[6px_0_16px_-10px_rgba(2,6,23,0.95)] ${SUPERVISOR_GRID_LINE} ${getReportDateCellTone(row.dayLabel, rowIndex)}`}>
                        <div className="font-semibold text-[13px] text-inherit">{row.dateLabel}</div>
                        <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${getReportDayBadgeTone(row.dayLabel)}`}>
                          {row.dayLabel}
                        </div>
                      </td>
                      {SHIFT_ORDER.map((shiftCode) => (
                        <td
                          key={`${row.isoDate}-availability-${shiftCode}`}
                          className={`border-r border-b px-2 py-2 text-center font-semibold tabular-nums text-slate-900 dark:text-white ${SUPERVISOR_GRID_LINE} ${getSufficiencyColor(row.availability[shiftCode], safeReport.requirements.totals[shiftCode])}`}
                        >
                          {row.availability[shiftCode]}
                        </td>
                      ))}
                      {SHIFT_ORDER.map((shiftCode) => (
                        <td
                          key={`${row.isoDate}-net-${shiftCode}`}
                          className={`border-r border-b px-2 py-2 text-center font-semibold tabular-nums ${SUPERVISOR_GRID_LINE} ${shiftCode === "M" ? SUPERVISOR_TABLE_SECTION_DIVIDER : ""} ${getSupervisorSignedDeltaTone(row.net[shiftCode])}`}
                        >
                          {formatSignedDelta(row.net[shiftCode])}
                        </td>
                      ))}
                      {SHIFT_SECTION_CONFIG.map((section) => {
                        const shiftData = row.shifts[section.shiftCode];
                        return (
                          <Fragment key={`${row.isoDate}-${section.shiftCode}`}>
                            <td key={`${row.isoDate}-${section.shiftCode}-team`} className={`border-r border-b px-2 py-2 text-center font-bold ${section.teamTone} ${SUPERVISOR_GRID_LINE} ${SUPERVISOR_TABLE_SECTION_DIVIDER}`}>
                              {shiftData.teamCode}
                            </td>
                            {shiftData.groups.map((group) => (
                              <td
                                key={`${row.isoDate}-${section.shiftCode}-${group.group}`}
                                className={`border-r border-b px-2 py-2 text-center font-semibold tabular-nums text-slate-900 dark:text-white ${SUPERVISOR_GRID_LINE} ${group.colorClass}`}
                              >
                                {group.available}
                              </td>
                            ))}
                            <td
                              key={`${row.isoDate}-${section.shiftCode}-total`}
                              className={`border-r border-b px-2 py-2 text-center font-semibold tabular-nums text-slate-900 dark:text-white ${SUPERVISOR_GRID_LINE} ${getSufficiencyColor(shiftData.totalAvailable, shiftData.totalRequired)}`}
                            >
                              {shiftData.totalAvailable}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={SUPERVISOR_SCROLLBAR_FOOTER}>
              <div
                ref={horizontalTrackRef}
                onPointerDown={handleHorizontalTrackPointerDown}
                className={SUPERVISOR_SCROLLBAR_TRACK}
              >
                <div
                  role="scrollbar"
                  aria-label="Availability report horizontal scroll"
                  aria-controls="availability-report-grid"
                  aria-orientation="horizontal"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(horizontalMaxScroll)}
                  aria-valuenow={Math.round(gridScrollMetrics.scrollLeft)}
                  aria-disabled={horizontalMaxScroll <= 0}
                  tabIndex={horizontalMaxScroll > 0 ? 0 : -1}
                  onKeyDown={handleHorizontalScrollbarKeyDown}
                  onPointerDown={handleHorizontalThumbPointerDown}
                  className={`absolute top-0.5 h-4 rounded-full border transition-[background-color,opacity,box-shadow] touch-none ${
                    horizontalMaxScroll > 0
                      ? SUPERVISOR_SCROLLBAR_THUMB
                      : SUPERVISOR_SCROLLBAR_THUMB_DISABLED
                  }`}
                  style={{
                    width: `${renderedThumbWidth}px`,
                    transform: `translateX(${thumbLeft}px)`,
                  }}
                />
              </div>
            </div>
          </div>
      </div>
    </DashboardLayout>
  );
}