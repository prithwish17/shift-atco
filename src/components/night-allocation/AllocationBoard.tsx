/**
 * The channel board.
 *
 * A timeline, not a spreadsheet: rows are positions (or people), the axis runs
 * 13:30 → 01:30, and each duty is a strip you can read at a glance — who, which
 * position, and the times. Handovers line up vertically, which is the whole
 * point, and an uncovered stretch is drawn as a hatched red band rather than
 * being left as absence for the eye to notice.
 *
 * Times are set in the app's mono face. On a board where the reader compares
 * 14:45 against 14:30 down a column, figures that share a width are worth more
 * than figures that look tidy in a sentence.
 *
 * On a phone it scrolls horizontally with the row labels pinned, rather than
 * squeezing twelve hours into 30-pixel columns.
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  FIRST_HALF,
  MERGE_WINDOW,
  MIDNIGHT_MIN,
  MIN_BREAK_MIN,
  NIGHT_SPAN_MIN,
  NIGHT_START_MIN,
  SECOND_HALF,
  findChannel,
  findPerson,
  formatMinutes,
  formatRange,
  formatDuration,
  activeMerge,
  gapsForChannel,
  mergedAwayWindow,
  minutesOnDuty,
  personShortLabel,
  snapToSlot,
  type NightAllocationState,
  type NightChannel,
  type NightDuty,
} from "@/domain/night-allocation";
import { cn } from "@/lib/utils";
import { HALF_COLORS, channelSwatch, personSwatch, swatchVars, type HalfColors } from "./palette";

export type BoardView = "channel" | "person";

interface AllocationBoardProps {
  state: NightAllocationState;
  view: BoardView;
  /** Ids of duties a hard rule complains about. */
  problemDutyIds: Set<string>;
  /** Scrolled into view and highlighted when the checks panel points at it. */
  focusedDutyId: string | null;
  onOpenDuty: (duty: NightDuty) => void;
  onAddDuty: (channelCode: string, startMin: number, personKey?: string) => void;
}

interface BoardRow {
  key: string;
  title: string;
  subtitle: string;
  duties: NightDuty[];
  channel?: NightChannel;
  /** Uncovered stretches, drawn on the lane. Channel rows only. */
  gaps: Array<[number, number]>;
  /** The stretch this position is folded into another one for. */
  mergedAway?: { window: readonly [number, number]; intoCode: string } | null;
}

const AXIS_HEIGHT = 46;
const ROW_HEIGHT = 62;

export function AllocationBoard({
  state,
  view,
  problemDutyIds,
  focusedDutyId,
  onOpenDuty,
  onAddDuty,
}: AllocationBoardProps) {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.innerWidth < 700);
  const [nowMin, setNowMin] = useState<number | null>(null);
  const stripRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The live "now" marker, but only while the board is showing the night it
  // belongs to — a line labelled "now" on next Tuesday's board is a lie.
  useEffect(() => {
    const tick = () => setNowMin(currentMinuteOfNight(state.nightDate));
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [state.nightDate]);

  const pxPerMin = compact ? 1.35 : 1.7;
  // Fits "SMC-S" plus its coverage dot without truncating; the lane scrolls
  // horizontally anyway, so a wider label costs nothing but pixels.
  const labelWidth = compact ? 96 : 104;
  const boardWidth = NIGHT_SPAN_MIN * pxPerMin;

  useEffect(() => {
    if (!focusedDutyId) return;
    stripRefs.current.get(focusedDutyId)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }, [focusedDutyId]);

  const rows = useMemo<BoardRow[]>(() => {
    if (view === "channel") {
      const codes = state.channels
        .filter(channel => channel.inUse || state.duties.some(duty => duty.channelCode === channel.code))
        .map(channel => channel.code);
      for (const duty of state.duties) if (!codes.includes(duty.channelCode)) codes.push(duty.channelCode);

      return codes.map(code => {
        const channel = findChannel(state, code);
        const partial = channel && (channel.openAt > 0 || channel.closeAt < NIGHT_SPAN_MIN);
        const window = mergedAwayWindow(state, code);
        return {
          key: code,
          channel,
          title: code,
          subtitle: !channel?.inUse ? "not in use" : partial ? formatRange(channel.openAt, channel.closeAt) : "",
          duties: state.duties.filter(duty => duty.channelCode === code),
          gaps:
            channel?.inUse && state.duties.length
              ? gapsForChannel(state.duties, channel, window)
              : [],
          mergedAway: window && channel?.mergedInto ? { window, intoCode: channel.mergedInto } : null,
        };
      });
    }

    return state.people
      .filter(person => person.available || state.duties.some(duty => duty.personKey === person.key))
      .map(person => ({
        key: person.key,
        title: personShortLabel(person),
        subtitle: `${person.half === "1st" ? "1st · " : person.half === "2nd" ? "2nd · " : ""}${formatDuration(
          minutesOnDuty(state, person.key),
        )}`,
        duties: state.duties.filter(duty => duty.personKey === person.key),
        gaps: [],
        mergedAway: null,
      }));
  }, [state, view]);

  const firstOpenChannel = state.channels.find(channel => channel.inUse) ?? state.channels[0];

  const handleLaneClick = (row: BoardRow, event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const minute = snapToSlot((event.clientX - bounds.left) / pxPerMin);
    const startMin = Math.min(minute, NIGHT_SPAN_MIN - 30);
    if (view === "channel") onAddDuty(row.key, startMin);
    else if (firstOpenChannel) onAddDuty(firstOpenChannel.code, startMin, row.key);
  };

  return (
    <div
      className="overflow-x-auto overscroll-x-contain border-y border-corp-border-soft"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="relative w-max min-w-full">
        <Axis
          state={state}
          labelWidth={labelWidth}
          pxPerMin={pxPerMin}
          boardWidth={boardWidth}
          compact={compact}
        />

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-sm text-corp-text-muted">
            No channels in use. Tick at least one in Channels.
          </p>
        ) : (
          rows.map(row => (
            <div
              key={row.key}
              className="flex border-b border-corp-border-soft last:border-b-0"
              style={{ height: ROW_HEIGHT }}
            >
              <RowLabel row={row} view={view} width={labelWidth} />

              <div
                className="relative shrink-0 cursor-copy bg-elevated/40 transition-colors hover:bg-elevated/70"
                style={{
                  width: boardWidth,
                  backgroundImage:
                    "repeating-linear-gradient(to right, var(--corp-border-soft) 0 1px, transparent 1px var(--night-hour))",
                  ["--night-hour" as string]: `${60 * pxPerMin}px`,
                }}
                onClick={event => handleLaneClick(row, event)}
              >
                {row.channel?.inUse && row.channel.openAt > 0 ? (
                  <ClosedBand left={0} width={row.channel.openAt * pxPerMin} />
                ) : null}
                {row.channel?.inUse && row.channel.closeAt < NIGHT_SPAN_MIN ? (
                  <ClosedBand
                    left={row.channel.closeAt * pxPerMin}
                    width={(NIGHT_SPAN_MIN - row.channel.closeAt) * pxPerMin}
                  />
                ) : null}

                {row.mergedAway ? (
                  <MergedBand
                    left={row.mergedAway.window[0] * pxPerMin}
                    width={(row.mergedAway.window[1] - row.mergedAway.window[0]) * pxPerMin}
                    intoCode={row.mergedAway.intoCode}
                  />
                ) : null}

                {row.gaps.map(([start, end]) => (
                  <GapBand
                    key={`${start}-${end}`}
                    left={start * pxPerMin}
                    width={(end - start) * pxPerMin}
                    label={formatRange(start, end)}
                  />
                ))}

                {row.duties.map(duty => (
                  <DutyStrip
                    key={duty.id}
                    ref={element => {
                      if (element) stripRefs.current.set(duty.id, element);
                      else stripRefs.current.delete(duty.id);
                    }}
                    state={state}
                    duty={duty}
                    view={view}
                    pxPerMin={pxPerMin}
                    hasProblem={problemDutyIds.has(duty.id)}
                    isFocused={focusedDutyId === duty.id}
                    onOpen={() => onOpenDuty(duty)}
                  />
                ))}

                {view === "person" ? <ShortBreakMarkers duties={row.duties} pxPerMin={pxPerMin} /> : null}
              </div>
            </div>
          ))
        )}

        <Bands labelWidth={labelWidth} pxPerMin={pxPerMin} nowMin={nowMin} />
      </div>
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/** Minutes from 13:30 right now, or null when today is not the night's date. */
function currentMinuteOfNight(nightDate: string): number | null {
  const now = new Date();
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  // Before midnight the night's own date applies; after it, the next date does.
  if (today === nightDate && minuteOfDay >= NIGHT_START_MIN) return minuteOfDay - NIGHT_START_MIN;

  const [year, month, day] = nightDate.split("-").map(Number);
  if (!year) return null;
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  if (today === nextDay && minuteOfDay <= NIGHT_SPAN_MIN - (1440 - NIGHT_START_MIN)) {
    return minuteOfDay + (1440 - NIGHT_START_MIN);
  }
  return null;
}

function RowLabel({ row, view, width }: { row: BoardRow; view: BoardView; width: number }) {
  const covered = view === "channel" && row.channel?.inUse ? row.gaps.length === 0 : null;

  return (
    <div
      className="sticky left-0 z-20 flex shrink-0 flex-col justify-center overflow-hidden border-r border-corp-border-soft bg-surface px-3"
      style={{ width }}
    >
      <span className="flex items-center gap-1.5">
        {covered === null ? null : (
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              covered ? "bg-status-success" : "bg-status-danger",
            )}
          />
        )}
        <span className="truncate whitespace-nowrap text-[0.88rem] font-semibold tracking-tight text-corp-text-main sm:text-[1rem]">
          {row.title}
        </span>
      </span>
      {row.subtitle ? (
        <span className="truncate whitespace-nowrap font-mono text-[0.65rem] tabular-nums text-corp-text-soft">
          {row.subtitle}
        </span>
      ) : null}
    </div>
  );
}

function Axis({
  state,
  labelWidth,
  pxPerMin,
  boardWidth,
  compact,
}: {
  state: NightAllocationState;
  labelWidth: number;
  pxPerMin: number;
  boardWidth: number;
  compact: boolean;
}) {
  // Every hour on a wide board, every two on a phone — hourly labels overlap
  // below about 1.5 px per minute.
  const step = compact ? 120 : 60;
  const ticks: number[] = [];
  for (let minute = 0; minute <= NIGHT_SPAN_MIN; minute += step) ticks.push(minute);

  const names = (half: "1st" | "2nd") => {
    const people = state.people.filter(person => person.half === half);
    return people.length ? people.map(person => person.name.split(" ")[0]).join(", ") : "nobody yet";
  };

  return (
    <div
      className="sticky top-0 z-30 flex border-b border-corp-border-soft bg-surface/95 backdrop-blur"
      style={{ height: AXIS_HEIGHT }}
    >
      <div
        className="sticky left-0 z-10 flex shrink-0 items-end border-r border-corp-border-soft bg-surface px-3 pb-1"
        style={{ width: labelWidth }}
      >
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-corp-text-soft">
          {compact ? "Pos" : "Position"}
        </span>
      </div>

      <div className="relative shrink-0" style={{ width: boardWidth }}>
        <span
          className="absolute top-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[0.62rem] font-semibold"
          style={{ left: FIRST_HALF[0] * pxPerMin + 4, color: HALF_COLORS.first.text }}
        >
          <span className="dark:hidden">1st Half · {names("1st")}</span>
          <span className="hidden dark:inline" style={{ color: HALF_COLORS.first.textDark }}>
            1st Half · {names("1st")}
          </span>
        </span>
        <span
          className="absolute top-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[0.62rem] font-semibold"
          style={{ left: SECOND_HALF[0] * pxPerMin + 4, color: HALF_COLORS.second.text }}
        >
          <span className="dark:hidden">2nd Half · {names("2nd")}</span>
          <span className="hidden dark:inline" style={{ color: HALF_COLORS.second.textDark }}>
            2nd Half · {names("2nd")}
          </span>
        </span>

        {ticks.map(minute => (
          <span
            key={minute}
            className={cn(
              "absolute bottom-1 font-mono text-[0.68rem] tabular-nums",
              minute === MIDNIGHT_MIN
                ? "font-semibold text-corp-text-main"
                : "text-corp-text-soft",
              minute === 0 ? "" : "-translate-x-1/2",
            )}
            style={{ left: minute * pxPerMin + (minute === 0 ? 4 : 0) }}
          >
            {formatMinutes(minute)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The half bands, midnight, and the live "now" line, drawn over every row. */
function Bands({
  labelWidth,
  pxPerMin,
  nowMin,
}: {
  labelWidth: number;
  pxPerMin: number;
  nowMin: number | null;
}) {
  const band = (from: number, to: number, colors: HalfColors) => (
    <>
      <div
        className="pointer-events-none absolute bottom-0 z-0 dark:hidden"
        style={{
          top: AXIS_HEIGHT,
          left: labelWidth + from * pxPerMin,
          width: (to - from) * pxPerMin,
          background: colors.band,
          borderLeft: `1.5px solid ${colors.text}33`,
        }}
      />
      <div
        className="pointer-events-none absolute bottom-0 z-0 hidden dark:block"
        style={{
          top: AXIS_HEIGHT,
          left: labelWidth + from * pxPerMin,
          width: (to - from) * pxPerMin,
          background: colors.bandDark,
          borderLeft: `1.5px solid ${colors.textDark}33`,
        }}
      />
    </>
  );

  return (
    <>
      {band(FIRST_HALF[0], FIRST_HALF[1], HALF_COLORS.first)}
      {band(SECOND_HALF[0], SECOND_HALF[1], HALF_COLORS.second)}

      <div
        className="pointer-events-none absolute bottom-0 z-[5] border-l border-dashed border-corp-border-strong"
        style={{ top: AXIS_HEIGHT, left: labelWidth + MIDNIGHT_MIN * pxPerMin }}
      />

      {nowMin === null ? null : (
        <div
          className="pointer-events-none absolute bottom-0 z-[25]"
          style={{ top: AXIS_HEIGHT - 6, left: labelWidth + nowMin * pxPerMin }}
        >
          <span className="absolute -left-[3px] top-0 h-1.5 w-1.5 rounded-full bg-status-danger" />
          <span className="absolute bottom-0 top-1.5 border-l border-status-danger" />
        </div>
      )}
    </>
  );
}

function ClosedBand({ left, width }: { left: number; width: number }) {
  return (
    <span
      className="absolute inset-y-0 z-[2] flex items-center justify-center overflow-hidden whitespace-nowrap text-[0.65rem] uppercase tracking-wide text-corp-text-soft"
      style={{
        left,
        width,
        backgroundImage:
          "repeating-linear-gradient(135deg, var(--corp-border-soft) 0 5px, transparent 5px 9px)",
      }}
    >
      {width > 64 ? "Closed" : ""}
    </span>
  );
}

/**
 * A stretch folded into another position. Not a gap and not closed: somebody is
 * on it, just not on this row — so it reads as a pointer, not as absence.
 */
function MergedBand({ left, width, intoCode }: { left: number; width: number; intoCode: string }) {
  return (
    <span
      title={`Covered by whoever holds ${intoCode}`}
      className="absolute inset-y-1.5 z-[2] flex items-center justify-center overflow-hidden rounded-md border border-dashed border-primary/40 bg-primary/[0.06] text-[0.65rem] font-semibold uppercase tracking-wide text-primary"
      style={{ left, width: Math.max(4, width) }}
    >
      {width > 86 ? `with ${intoCode}` : width > 30 ? "merged" : ""}
    </span>
  );
}

/** An uncovered stretch of an open channel — the thing the board exists to show. */
function GapBand({ left, width, label }: { left: number; width: number; label: string }) {
  return (
    <span
      title={`Nobody on duty ${label}`}
      className="absolute inset-y-1.5 z-[2] flex items-center justify-center overflow-hidden rounded-md border border-dashed border-status-danger/70 text-[0.65rem] font-semibold uppercase tracking-wide text-status-danger"
      style={{
        left,
        width: Math.max(4, width),
        backgroundImage:
          "repeating-linear-gradient(135deg, var(--corp-danger-soft) 0 6px, transparent 6px 11px)",
      }}
    >
      {width > 74 ? "Uncovered" : ""}
    </span>
  );
}

interface DutyStripProps {
  state: NightAllocationState;
  duty: NightDuty;
  view: BoardView;
  pxPerMin: number;
  hasProblem: boolean;
  isFocused: boolean;
  onOpen: () => void;
}

// forwardRef rather than a `ref` prop: this project is on React 18, where a
// plain function component never receives one.
const DutyStrip = forwardRef<HTMLButtonElement, DutyStripProps>(function DutyStrip(
  { state, duty, view, pxPerMin, hasProblem, isFocused, onOpen },
  ref,
) {
  const person = findPerson(state, duty.personKey);
  const swatch = view === "channel" ? personSwatch(person?.colorIndex ?? 0) : channelSwatch(duty.channelCode);
  const left = Math.max(0, duty.startMin) * pxPerMin;
  const width = Math.max(16, (Math.min(NIGHT_SPAN_MIN, duty.endMin) - Math.max(0, duty.startMin)) * pxPerMin);
  const heading = view === "channel" ? personShortLabel(person) : duty.channelCode;
  const firstName = person ? person.name.split(" ")[0] : "Removed";
  // A duty on the absorbing position covers both for the merge window.
  const merge = activeMerge(state);
  const absorbs =
    merge &&
    duty.channelCode === merge.targetCode &&
    duty.startMin < MERGE_WINDOW[1] &&
    duty.endMin > MERGE_WINDOW[0]
      ? merge.source.code
      : null;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      style={{ ...swatchVars(swatch), left, width }}
      className={cn(
        "group absolute inset-y-1.5 z-10 flex flex-col items-start justify-center gap-px overflow-hidden rounded-md px-2 text-left",
        "border border-black/[0.06] dark:border-white/[0.08]",
        "bg-[var(--strip-fill)] text-[color:var(--strip-text)]",
        "dark:bg-[var(--strip-fill-dark)] dark:text-[color:var(--strip-text-dark)]",
        "shadow-[0_1px_2px_rgba(15,23,42,0.08)]",
        "transition-[transform,box-shadow] duration-150 motion-safe:hover:-translate-y-px",
        "hover:shadow-[0_4px_10px_rgba(15,23,42,0.14)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        hasProblem && "ring-2 ring-status-danger ring-offset-1 ring-offset-surface",
        isFocused && "ring-2 ring-ring ring-offset-2 ring-offset-surface",
      )}
      aria-label={`${duty.channelCode}${absorbs ? ` with ${absorbs}` : ""}, ${person?.name ?? "removed person"}, ${formatRange(
        duty.startMin,
        duty.endMin,
      )}${hasProblem ? ", has a problem" : ""}. Change this duty.`}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] rounded-l-md"
        style={{ background: "var(--strip-edge)" }}
      />
      <span className="flex w-full items-baseline gap-1.5 pl-1">
        {/* The initials never truncate — they are what identifies the strip.
            The name beside them absorbs the squeeze instead. */}
        <span className="shrink-0 text-[0.78rem] font-bold leading-none tracking-tight">{heading}</span>
        {absorbs && width >= 76 ? (
          <span className="shrink-0 rounded-sm bg-black/[0.08] px-1 text-[0.6rem] font-bold leading-[1.4] dark:bg-white/[0.12]">
            +{absorbs}
          </span>
        ) : null}
        {width >= 92 && view === "channel" ? (
          <span className="truncate text-[0.7rem] leading-none opacity-80">{firstName}</span>
        ) : null}
      </span>
      {width >= 62 ? (
        <span className="truncate pl-1 font-mono text-[0.63rem] tabular-nums leading-none opacity-75">
          {formatRange(duty.startMin, duty.endMin)}
        </span>
      ) : null}
      {hasProblem ? (
        <span
          aria-hidden
          className="absolute right-1 top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-status-danger text-[0.6rem] font-bold leading-none text-white"
        >
          !
        </span>
      ) : null}
    </button>
  );
});

/** In the by-person view, mark any break under 30 minutes. */
function ShortBreakMarkers({ duties, pxPerMin }: { duties: NightDuty[]; pxPerMin: number }) {
  const sorted = duties.slice().sort((a, b) => a.startMin - b.startMin);
  const markers: Array<{ key: string; left: number; width: number; gap: number }> = [];
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index].startMin - sorted[index - 1].endMin;
    if (gap < 0 || gap >= MIN_BREAK_MIN) continue;
    markers.push({
      key: sorted[index].id,
      left: sorted[index - 1].endMin * pxPerMin - (gap === 0 ? 3 : 0),
      width: Math.max(6, gap * pxPerMin),
      gap,
    });
  }

  return (
    <>
      {markers.map(marker => (
        <span
          key={marker.key}
          title={`${marker.gap} min break — at least 30 needed`}
          className="pointer-events-none absolute z-[15] rounded-sm border border-status-danger bg-status-danger-soft"
          style={{ top: 20, height: 22, left: marker.left, width: marker.width }}
        />
      ))}
    </>
  );
}
