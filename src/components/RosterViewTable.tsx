import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { ExtraDutyCombobox } from "@/components/ExtraDutyCombobox";
import {
  SUPERVISOR_COLUMN_END_DIVIDER,
  SUPERVISOR_COLUMN_START_DIVIDER,
  SUPERVISOR_GRID_LINE,
  SUPERVISOR_GRID_LINE_STRONG,
  SUPERVISOR_SCROLLBAR_FOOTER,
  SUPERVISOR_SCROLLBAR_THUMB,
  SUPERVISOR_SCROLLBAR_THUMB_DISABLED,
  SUPERVISOR_SCROLLBAR_TRACK,
  SUPERVISOR_TABLE_PANEL,
  SUPERVISOR_WEEKEND_DATE_HEADER,
  SUPERVISOR_WEEKEND_SHIFT_HEADER,
  SUPERVISOR_WEEKEND_TEAM_HEADER,
  getSupervisorDefaultCellBg,
  getSupervisorOpaqueRowBg,
  getSupervisorRowBg,
  getSupervisorShiftTone,
  getSupervisorUnitTextTone,
} from "@/lib/supervisorTableTheme";
import type { RosterMatrixData } from "@/lib/rosterMatrix";

interface Props {
  data: RosterMatrixData;
  searchTerm: string;
  selectedDate: string;
  mobileScale?: number;
  extraDutyCandidates?: Map<string, string[]>;
  onAddExtraDuty?: (cellKey: string, name: string) => void;
  onRemoveExtraDuty?: (cellKey: string, name: string) => void;
}

interface GridScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  trackWidth: number;
}

type StickySectionKey = "AVAIL. ATCOs" | "Group 1" | "Group 2" | "Group 3" | "Group 4";
const EXTRA_DUTY_HEADER_UNIT = "EXTRA DUTY";
const SHIFT_CODES = ["M", "A", "N"] as const;
const STICKY_SECTION_ORDER: StickySectionKey[] = ["AVAIL. ATCOs", "Group 1", "Group 2", "Group 3", "Group 4"];

function getStickySectionKey(unit: string, rowType: string): StickySectionKey | null {
  if (unit === "AVAIL. ATCOs") return "AVAIL. ATCOs";
  if (rowType !== "header") return null;

  const match = unit.match(/^Group [1-4]/);
  if (!match) return null;

  return match[0] as StickySectionKey;
}

const isWeekend = (day: string) => {
  const normalizedDay = day.toLowerCase();
  return normalizedDay === "saturday" || normalizedDay === "sunday";
};

const getShiftLabel = (shiftName: string) => {
  if (shiftName === "Morning") return "Morning";
  if (shiftName === "Afternoon") return "Afternoon";
  if (shiftName === "Night") return "Night";
  return shiftName;
};

export default function RosterViewTable({ data, searchTerm, selectedDate, mobileScale = 1, extraDutyCandidates, onAddExtraDuty, onRemoveExtraDuty }: Props) {
  const isMobile = useIsMobile();
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const horizontalTrackRef = useRef<HTMLDivElement>(null);
  const stickyRowRefs = useRef<Partial<Record<StickySectionKey, HTMLTableRowElement | null>>>({});
  const [headerHeight, setHeaderHeight] = useState(0);
  const [stickyRowHeights, setStickyRowHeights] = useState<Partial<Record<StickySectionKey, number>>>({});
  const [gridScrollMetrics, setGridScrollMetrics] = useState<GridScrollMetrics>({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
    trackWidth: 0,
  });
  const totalShiftCols = data.dates.length * 3;

  const getCellKey = (dateIdx: number, shiftIdx: number): string => {
    const isoDate = data.dates[dateIdx]?.isoDate ?? "";
    const code = SHIFT_CODES[shiftIdx] ?? "";
    return `${isoDate}::${code}`;
  };

  const filteredRows = useMemo(() => {
    if (!searchTerm) return data.rows;

    const normalizedTerm = searchTerm.toLowerCase();
    return data.rows.filter((row) =>
      row.rowType === "summary" ||
      row.rowType === "header" ||
      row.unit.toLowerCase().includes(normalizedTerm) ||
      row.slNo.toLowerCase().includes(normalizedTerm) ||
      row.cells.some((cell) => cell.toLowerCase().includes(normalizedTerm)),
    );
  }, [data.rows, searchTerm]);

  // Measure the primary thead so section rows can stick directly beneath it.
  useEffect(() => {
    const thead = theadRef.current;
    if (!thead) return;

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => setHeaderHeight(thead.offsetHeight))
        : null;

    setHeaderHeight(thead.offsetHeight);
    observer?.observe(thead);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const updateStickyRowHeights = () => {
      const nextHeights: Partial<Record<StickySectionKey, number>> = {};
      STICKY_SECTION_ORDER.forEach((key) => {
        const row = stickyRowRefs.current[key];
        if (row) {
          nextHeights[key] = row.getBoundingClientRect().height;
        }
      });
      setStickyRowHeights(nextHeights);
    };

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateStickyRowHeights())
        : null;

    updateStickyRowHeights();
    STICKY_SECTION_ORDER.forEach((key) => {
      const row = stickyRowRefs.current[key];
      if (row) observer?.observe(row);
    });

    return () => observer?.disconnect();
  }, [filteredRows]);

  const stickySectionOffsets = useMemo(() => {
    const visibleStickyKeys = new Set<StickySectionKey>();
    filteredRows.forEach((row) => {
      const key = getStickySectionKey(row.unit, row.rowType);
      if (key) visibleStickyKeys.add(key);
    });

    let currentTop = headerHeight;
    const offsets: Partial<Record<StickySectionKey, number>> = {};

    STICKY_SECTION_ORDER.forEach((key) => {
      if (!visibleStickyKeys.has(key)) return;
      offsets[key] = currentTop;
      currentTop += stickyRowHeights[key] ?? 0;
    });

    return offsets;
  }, [filteredRows, headerHeight, stickyRowHeights]);

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
    if (!selectedDate || !scrollViewportRef.current) return;

    const dateIdx = data.dates.findIndex((dateColumn) => dateColumn.date === selectedDate);
    if (dateIdx < 0) return;

    const colOffset = 2 + dateIdx * 3;
    const cell = scrollViewportRef.current.querySelector(`[data-col="${colOffset}"]`);
    if (cell) {
      cell.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    }
  }, [selectedDate, data.dates]);

  useEffect(() => {
    updateGridScrollMetrics();
  }, [filteredRows.length, data.dates.length, updateGridScrollMetrics]);

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

  return (
    <div
      className={`flex h-[calc(100dvh-9rem)] min-h-[360px] flex-col ${SUPERVISOR_TABLE_PANEL}`}
      style={isMobile && mobileScale < 1 ? { height: `calc((100dvh - 9rem) / ${mobileScale})` } : undefined}
    >
      <div
        id="live-roster-distribution-grid"
        ref={scrollViewportRef}
        onScroll={handleViewportScroll}
        className="custom-scrollbar min-h-0 flex-1 overflow-auto"
      >
        <table ref={tableRef} className="border-collapse text-[13px] leading-snug">
        <thead ref={theadRef} className="sticky top-0 z-30">
          <tr>
            <th className={`sticky left-0 z-40 bg-slate-900 px-3 py-2 text-center text-[12px] font-bold text-slate-50 shadow-[inset_0_-1px_0_rgba(255,255,255,0.08)] dark:bg-slate-900 ${SUPERVISOR_GRID_LINE_STRONG} min-w-[56px] border-r`}>
              SL.
            </th>
            <th className={`sticky left-[56px] z-40 bg-slate-900 px-3 py-2 text-center text-[12px] font-bold text-slate-50 shadow-[inset_0_-1px_0_rgba(255,255,255,0.08)] dark:bg-slate-900 ${SUPERVISOR_GRID_LINE_STRONG} min-w-[170px] border-r`}>
              UNITS
            </th>
            {data.dates.map((dateColumn, index) => (
              <th
                key={dateColumn.date}
                colSpan={3}
                data-col={2 + index * 3}
                className={`border-r px-2.5 py-2 text-center text-[12px] font-bold whitespace-nowrap ${
                  isWeekend(dateColumn.day)
                    ? SUPERVISOR_WEEKEND_DATE_HEADER
                    : "bg-slate-800 text-slate-100 border-slate-700 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]"
                } ${index > 0 ? SUPERVISOR_COLUMN_START_DIVIDER : ""}`}
              >
                <div className="font-bold">{dateColumn.day}</div>
                <div className="text-[11px] opacity-75 tracking-[0.02em]">{dateColumn.date}</div>
              </th>
            ))}
          </tr>
          <tr>
            <th className={`sticky left-0 z-40 h-7 border-r bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95 ${SUPERVISOR_GRID_LINE}`} />
            <th className={`sticky left-[56px] z-40 h-7 border-r bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95 ${SUPERVISOR_GRID_LINE}`} />
            {data.dates.map((dateColumn) =>
              dateColumn.shifts.map((shiftName, shiftIndex) => (
                <th
                  key={`${dateColumn.date}-${shiftIndex}`}
                  className={`border-r px-2.5 py-1.5 text-center text-[12.5px] font-semibold whitespace-nowrap ${
                    isWeekend(dateColumn.day)
                      ? SUPERVISOR_WEEKEND_SHIFT_HEADER
                      : getSupervisorShiftTone(SHIFT_CODES[shiftIndex]).header
                  } ${shiftIndex === 0 ? SUPERVISOR_COLUMN_START_DIVIDER : ""} ${shiftIndex === 2 ? SUPERVISOR_COLUMN_END_DIVIDER : ""}`}
                >
                  {getShiftLabel(shiftName)}
                </th>
              )),
            )}
          </tr>
          <tr>
            <th className={`sticky left-0 z-40 h-5 border-r border-b bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95 ${SUPERVISOR_GRID_LINE}`} />
            <th className={`sticky left-[56px] z-40 h-5 border-r border-b bg-slate-100/95 backdrop-blur-sm dark:bg-slate-900/95 ${SUPERVISOR_GRID_LINE}`} />
            {data.dates.map((dateColumn) =>
              dateColumn.shiftCodes.map((shiftCode, shiftIndex) => (
                <th
                  key={`${dateColumn.date}-code-${shiftIndex}`}
                  className={`border-r border-b px-2.5 py-1 text-center text-[12px] font-bold ${
                    isWeekend(dateColumn.day)
                      ? SUPERVISOR_WEEKEND_TEAM_HEADER
                      : getSupervisorShiftTone(SHIFT_CODES[shiftIndex]).team
                  } ${shiftIndex === 0 ? SUPERVISOR_COLUMN_START_DIVIDER : ""} ${shiftIndex === 2 ? SUPERVISOR_COLUMN_END_DIVIDER : ""}`}
                >
                  {`Team ${shiftCode}`}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row, rowIndex) => {
            const isSummaryNum = row.rowType === "summary";
            const rowKey = `${row.rowType}-${row.slNo || "blank"}-${row.unit}-${rowIndex}`;
            const stickySectionKey = getStickySectionKey(row.unit, row.rowType);
            const stickySectionRow = headerHeight > 0 && stickySectionKey !== null;
            const stickySectionStyle = stickySectionRow
              ? {
                  position: "sticky" as const,
                  top: stickySectionOffsets[stickySectionKey] ?? headerHeight,
                }
              : undefined;
            return (
              <tr
                key={rowKey}
                ref={stickySectionKey ? (node) => {
                  stickyRowRefs.current[stickySectionKey] = node;
                } : undefined}
                className={`${getSupervisorRowBg(row.rowType, rowIndex)} ${row.rowType === "header" ? "border-y-2 border-slate-500 dark:border-slate-400" : ""} hover:brightness-[0.985] dark:hover:brightness-110 transition-[filter,background-color] duration-150`}
              >
                <td
                  className={`sticky left-0 ${stickySectionRow ? "z-30" : "z-20"} border-r border-b px-2.5 py-1.5 text-center font-mono text-[12px] ${SUPERVISOR_GRID_LINE} ${getSupervisorOpaqueRowBg(row.rowType, rowIndex)} ${isSummaryNum ? "font-bold shadow-[inset_-1px_0_0_rgba(148,163,184,0.18)]" : ""}`}
                  style={stickySectionStyle}
                >
                  {row.slNo}
                </td>
                <td
                  className={`sticky left-[56px] ${stickySectionRow ? "z-30" : "z-20"} min-w-[170px] max-w-[230px] whitespace-normal break-words border-r border-b px-2.5 py-1.5 text-[12px] ${SUPERVISOR_GRID_LINE} ${getSupervisorOpaqueRowBg(row.rowType, rowIndex)} ${getSupervisorUnitTextTone(row.rowType)}`}
                  style={stickySectionStyle}
                >
                  {row.unit}
                </td>
                {row.cells.map((cell, cellIndex) => {
                  const dateIdx = Math.floor(cellIndex / 3);
                  const shiftIdx = cellIndex % 3;
                  const weekend = dateIdx < data.dates.length && isWeekend(data.dates[dateIdx].day);
                  const value = cell.trim();
                  const isNum = /^\d+$/.test(value);
                  const isLeave = ["L", "Ex", "CO", "T", "Tr", "N", "NO", "SUN", "SAT", "G"].includes(value);
                  const isHeaderRow = row.rowType === "header";
                  const isSingleName = !isSummaryNum && !isHeaderRow && !isLeave && !isNum && !!value;
                  const colorOverride = row.cellColors?.[cellIndex] ?? "";

                  // Determine cell content based on row type
                  const isExtraDutyHeader = row.rowType === "header" && row.unit === EXTRA_DUTY_HEADER_UNIT;
                  const isExtraRow = row.rowType === "extra";
                  const cellKey = (isExtraDutyHeader || isExtraRow) ? getCellKey(dateIdx, shiftIdx) : "";

                  let cellContent: React.ReactNode;
                  if (isExtraDutyHeader && onAddExtraDuty) {
                    const candidates = extraDutyCandidates?.get(cellKey) ?? [];
                    cellContent = (
                      <ExtraDutyCombobox
                        cellKey={cellKey}
                        candidates={candidates}
                        onAdd={onAddExtraDuty}
                      />
                    );
                  } else if (isExtraRow && value && onRemoveExtraDuty) {
                    cellContent = (
                      <div className={isSingleName ? "flex items-start justify-between gap-0.5 whitespace-normal break-words leading-normal" : undefined}>
                        <span>{value}</span>
                        <button
                          type="button"
                          title={`Remove ${value}`}
                          onClick={() => onRemoveExtraDuty(cellKey, value)}
                          className="ml-0.5 flex-shrink-0 rounded text-orange-400 opacity-60 transition hover:opacity-100 dark:text-orange-300"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    );
                  } else {
                    cellContent = <div className={isSingleName ? "whitespace-normal break-words leading-normal" : undefined}>{value || ""}</div>;
                  }

                  return (
                    <td
                      key={`${row.slNo}-${cellIndex}`}
                      className={`${stickySectionRow ? "sticky z-10" : ""} min-w-[150px] max-w-[230px] border-r border-b px-2.5 py-1.5 text-[12px] align-top ${SUPERVISOR_GRID_LINE} ${
                        shiftIdx === 0 ? SUPERVISOR_COLUMN_START_DIVIDER : ""
                      } ${
                        shiftIdx === 2 ? SUPERVISOR_COLUMN_END_DIVIDER : ""
                      } ${colorOverride || getSupervisorDefaultCellBg(row.rowType, SHIFT_CODES[shiftIdx], weekend)} ${
                        (isSummaryNum || isHeaderRow) && isNum ? "font-bold text-[13px] text-center" : isSingleName ? "text-left" : "text-center"
                      } ${
                        isLeave ? "text-red-500 dark:text-rose-300 font-semibold italic" : value ? "text-[hsl(var(--cell-occupied))]" : "text-[hsl(var(--cell-empty))]"
                      }`}
                      style={stickySectionStyle}
                      title={value}
                    >
                      {cellContent}
                    </td>
                  );
                })}
                {row.cells.length < totalShiftCols &&
                  Array.from({ length: totalShiftCols - row.cells.length }).map((_, padIndex) => (
                    <td
                      key={`pad-${row.slNo}-${padIndex}`}
                      className={`${stickySectionRow ? "sticky z-10" : ""} border-r border-b ${SUPERVISOR_GRID_LINE} ${getSupervisorOpaqueRowBg(row.rowType, rowIndex)}`}
                      style={stickySectionStyle}
                    />
                  ))}
              </tr>
            );
          })}
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
            aria-label="Live roster horizontal scroll"
            aria-controls="live-roster-distribution-grid"
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
  );
}