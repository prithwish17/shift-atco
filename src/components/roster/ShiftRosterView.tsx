import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addDays, format, isSameDay, isToday, parseISO } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, List, Search, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import RosterGrid from "@/components/roster/RosterGrid";
import { useShiftRoster } from "@/hooks/useShiftRoster";
import { buildRosterGrid, countMatches, type RosterGridModel } from "@/lib/rosterGrid";
import {
  filterShiftRosterDay,
  getCurrentShiftCode,
  getOffDutyTeamsForDate,
  getShiftTeamsForDate,
  SHIFT_SLOTS,
  type ShiftCode,
  type ShiftRosterGroup,
  type ShiftRosterMember,
} from "@/lib/shiftRoster";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "list";

/**
 * ShiftRosterView — the shared "who is on duty" view for supervisor, employee
 * and WSO.
 *
 * A user selects two things: a date and a shift.  The team is never selected —
 * it comes from the same duty-rotation rule the supervisor side uses
 * (`teamDutyRotation`), which says which team is on M/A/N for any given date.
 *
 * One shift is shown at a time so the same layout works on a phone and on a
 * desktop; the roster itself flows into more columns as the screen widens.
 */

interface Props {
  /**
   * Rendered in the header — e.g. the WSO/supervisor "Fetch Latest" button.
   * Receives the selected date so a sync can target the day on screen.
   */
  actions?: (context: { isoDate: string }) => ReactNode;
  /** Extra line under the title, for role-specific wording. */
  description?: string;
}

/** Tone per shift, kept muted so the names stay the loudest thing on screen. */
const SHIFT_TONE: Record<ShiftCode, { header: string; badge: string; dot: string }> = {
  M: {
    header: "bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900/60",
    badge: "bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100",
    dot: "bg-amber-500",
  },
  A: {
    header: "bg-sky-50 border-sky-200 dark:bg-sky-950/40 dark:border-sky-900/60",
    badge: "bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100",
    dot: "bg-sky-500",
  },
  N: {
    header: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900/60",
    badge: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/60 dark:text-indigo-100",
    dot: "bg-indigo-500",
  },
};

const DAY_STRIP_RADIUS = 3;

/** Names flow into more columns as the screen widens, rather than one long list. */
const MEMBER_GRID = "grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3";

/**
 * Name on top, the duty (ACC, ALPHA, …) underneath it, and the operational
 * position in the badge on the right.
 *
 * `member.duty` is the roster's `position` column (position/mark/remark/half)
 * and `member.position` is its `unit` column — the two are named for what they
 * mean operationally, not for the column they came from.
 */
function MemberRow({ member }: { member: ShiftRosterMember }) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{member.name || "—"}</p>
        {member.duty && (
          <p className="truncate text-xs text-muted-foreground leading-tight">{member.duty}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {member.isOffTeam && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
            {member.team}
          </Badge>
        )}
        {member.position && (
          <Badge variant="secondary" className="h-5 max-w-[7rem] truncate px-1.5 text-[10px] font-medium">
            {member.position}
          </Badge>
        )}
      </div>
    </li>
  );
}

function MemberSection({ title, members }: { title: string; members: ShiftRosterMember[] }) {
  if (members.length === 0) return null;

  return (
    <div className="border-t pt-2">
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {members.length}
      </p>
      <ul className={MEMBER_GRID}>
        {members.map((member) => (
          <MemberRow key={member.key} member={member} />
        ))}
      </ul>
    </div>
  );
}

/**
 * `teams` is passed in rather than read off `group` so the team on duty comes
 * straight from the rotation rule for the selected date — it must never depend
 * on whether roster rows have loaded.
 */
function ShiftPanel({
  slot,
  teams,
  group,
  viewMode,
  gridModel,
  search,
}: {
  slot: (typeof SHIFT_SLOTS)[number];
  teams: string[];
  group: ShiftRosterGroup | null;
  viewMode: ViewMode;
  gridModel: RosterGridModel | null;
  search: string;
}) {
  const tone = SHIFT_TONE[slot.code];
  const onDutyCount = group
    ? group.members.length + group.extraDuty.length + group.dutyChange.length
    : 0;

  return (
    <Card className="overflow-hidden">
      <div className={cn("border-b px-3 py-3", tone.header)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold leading-tight">{slot.name} shift</p>
              <p className="text-xs text-muted-foreground leading-tight">{slot.window}</p>
            </div>
          </div>

          {/* The team is derived, never chosen — it is the headline of the panel. */}
          <div className="flex shrink-0 items-center gap-2">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
                On duty
              </p>
              {teams.length > 0 ? (
                <p className={cn("rounded-md px-2 py-0.5 text-base font-bold leading-tight", tone.badge)}>
                  Team {teams.join(" / ")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No team</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <CardContent className="space-y-2 p-2">
        {!group ? (
          <div className="space-y-2 p-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="mr-1 inline h-3 w-3" />
              {onDutyCount} on duty
            </p>

            {/* The grid is the roster as published; the list is the flattened
                fallback for dates that only exist as duty codes. */}
            {viewMode === "grid" && gridModel ? (
              <RosterGrid model={gridModel} search={search} />
            ) : group.members.length === 0 && onDutyCount === 0 && group.onLeave.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No entries for this shift
              </p>
            ) : (
              <ul className={MEMBER_GRID}>
                {group.members.map((member) => (
                  <MemberRow key={member.key} member={member} />
                ))}
              </ul>
            )}

            {/* The grid carries its own Extra Duty / Duty Change bands, so
                these would be a second copy of the same names. */}
            {!(viewMode === "grid" && gridModel) && (
              <>
                <MemberSection title="Extra duty" members={group.extraDuty} />
                <MemberSection title="Duty change" members={group.dutyChange} />
                <MemberSection title="On leave" members={group.onLeave} />
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ShiftRosterView({ actions, description }: Props) {
  const today = useMemo(() => new Date(), []);
  const [selectedDate, setSelectedDate] = useState(() => format(today, "yyyy-MM-dd"));
  const [anchorDate, setAnchorDate] = useState(() => today);
  const [search, setSearch] = useState("");
  // Opens on the shift that is actually running, so the first thing shown is
  // the shift in progress rather than always Morning.
  const [selectedShift, setSelectedShift] = useState<ShiftCode>(() => getCurrentShiftCode());
  // The grid is the roster as it is actually published, so it is the default.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const { data, isLoading, isFetching } = useShiftRoster(selectedDate);

  const dayStrip = useMemo(
    () =>
      Array.from({ length: DAY_STRIP_RADIUS * 2 + 1 }, (_, index) =>
        addDays(anchorDate, index - DAY_STRIP_RADIUS),
      ),
    [anchorDate],
  );

  // Team on duty comes straight from the rotation rule, so it is correct the
  // instant a date is picked and stays correct if the roster query is slow,
  // empty or failing.  Reading it off the fetched day made the selector show
  // the previously-viewed date's teams while the new date loaded.
  const shiftTeams = useMemo(() => getShiftTeamsForDate(selectedDate), [selectedDate]);
  const offDuty = useMemo(() => getOffDutyTeamsForDate(selectedDate), [selectedDate]);

  // Roster rows for a different date must never be shown under this date's
  // header, so anything not matching the selection counts as still loading.
  const dayForSelectedDate = data && data.isoDate === selectedDate ? data : null;
  // The list filters on search; the grid highlights instead, because dropping
  // rows out of a matrix destroys the adjacency that gives it its meaning.
  const day = useMemo(() => {
    if (!dayForSelectedDate) return null;
    return viewMode === "list" ? filterShiftRosterDay(dayForSelectedDate, search) : dayForSelectedDate;
  }, [dayForSelectedDate, search, viewMode]);
  const activeSlot = SHIFT_SLOTS.find((slot) => slot.code === selectedShift) ?? SHIFT_SLOTS[0];
  const activeGroup = day?.groups.find((group) => group.code === selectedShift) ?? null;

  // Built from the raw rows, whose `unit` and `position` still carry the sheet's
  // row and column coordinates.  Null when this date only exists as duty codes,
  // which have no coordinates — the view then stays on the list.
  const gridModel = useMemo(() => {
    if (!dayForSelectedDate || dayForSelectedDate.rows.length === 0) return null;
    const model = buildRosterGrid(
      dayForSelectedDate.rows,
      selectedDate,
      selectedShift,
      activeSlot.name,
      shiftTeams[selectedShift],
    );
    return model.total > 0 ? model : null;
  }, [dayForSelectedDate, selectedDate, selectedShift, activeSlot.name, shiftTeams]);

  const gridMatches = useMemo(
    () => (gridModel && search.trim() ? countMatches(gridModel, search) : 0),
    [gridModel, search],
  );

  const selectedDateObj = useMemo(() => parseISO(selectedDate), [selectedDate]);

  // The strip is wider than a phone, so keep the selected day in view instead
  // of leaving it clipped behind the next-week arrow.  Deferred a frame because
  // on first mount the strip has not been laid out yet and the scroll is a
  // no-op, which left the selected day stuck at the edge.
  const selectedDayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      selectedDayRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedDate, anchorDate]);

  const goToToday = () => {
    setAnchorDate(today);
    setSelectedDate(format(today, "yyyy-MM-dd"));
  };

  return (
    <div className="space-y-3">
      {/* ── Title ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight sm:text-3xl">Shift Roster</h1>
          <p className="text-sm text-muted-foreground">
            {description || "Pick a date and a shift — the team on duty comes from the duty rotation."}
          </p>
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap gap-2">{actions({ isoDate: selectedDate })}</div>
        )}
      </div>

      {/* ── Selection: date ── */}
      <Card>
        <CardContent className="space-y-2 p-2 sm:p-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setAnchorDate((current) => addDays(current, -7))}
              aria-label="Previous week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <div className="flex flex-1 gap-1.5 overflow-x-auto pb-0.5">
              {dayStrip.map((date) => {
                const dateKey = format(date, "yyyy-MM-dd");
                const isSelected = dateKey === selectedDate;
                const marksToday = isToday(date);

                return (
                  <button
                    key={dateKey}
                    ref={isSelected ? selectedDayRef : undefined}
                    type="button"
                    onClick={() => setSelectedDate(dateKey)}
                    className={cn(
                      "flex min-w-[58px] shrink-0 flex-col items-center rounded-lg border px-2 py-1 transition",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted",
                      !isSelected && marksToday && "border-primary text-primary",
                    )}
                  >
                    <span className="text-[10px] font-normal opacity-75">{format(date, "EEE")}</span>
                    <span className="text-sm font-semibold leading-tight">{format(date, "d MMM")}</span>
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setAnchorDate((current) => addDays(current, 7))}
              aria-label="Next week"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Full width on a phone: sharing the row with the date picker
                squeezed the field down to a single character. */}
            <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, unit, position"
                className="h-8 pl-8 pr-8 text-sm"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <label className="relative shrink-0">
              <span className="sr-only">Jump to date</span>
              <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!next) return;
                  setSelectedDate(next);
                  setAnchorDate(parseISO(next));
                }}
                className="h-8 rounded-md border border-input bg-background pl-8 pr-2 text-sm"
              />
            </label>

            <Button
              type="button"
              variant={isSameDay(selectedDateObj, today) ? "secondary" : "outline"}
              size="sm"
              className="h-8 shrink-0"
              onClick={goToToday}
            >
              Today
            </Button>

            {/* Only offered when a grid can actually be built for this date. */}
            {gridModel && (
              <ToggleGroup
                type="single"
                value={viewMode}
                onValueChange={(value) => value && setViewMode(value as ViewMode)}
                variant="outline"
                size="sm"
                className="shrink-0"
              >
                <ToggleGroupItem value="grid" aria-label="Grid view" className="h-8 px-2">
                  <LayoutGrid className="h-3.5 w-3.5" />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List view" className="h-8 px-2">
                  <List className="h-3.5 w-3.5" />
                </ToggleGroupItem>
              </ToggleGroup>
            )}

            {viewMode === "grid" && search.trim() && (
              <Badge variant="secondary" className="h-6 shrink-0">
                {gridMatches} {gridMatches === 1 ? "match" : "matches"}
              </Badge>
            )}

            {isFetching && !isLoading && (
              <Badge variant="secondary" className="h-6 shrink-0">
                Refreshing
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Selection: shift.  Each option shows the team the rotation puts on
             it for the selected date, so the team is visible before choosing. ── */}
      <ToggleGroup
        type="single"
        value={selectedShift}
        onValueChange={(value) => value && setSelectedShift(value as ShiftCode)}
        variant="outline"
        className="grid grid-cols-3 gap-1.5"
      >
        {SHIFT_SLOTS.map((slot) => {
          const teamLabel = shiftTeams[slot.code].join(" / ") || "—";
          return (
            <ToggleGroupItem
              key={slot.code}
              value={slot.code}
              aria-label={`${slot.name} shift, Team ${teamLabel}`}
              className="h-auto flex-col gap-0 py-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              <span className="text-xs font-semibold sm:text-sm">{slot.name}</span>
              <span className="text-[10px] opacity-80 sm:text-xs">Team {teamLabel}</span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {/* ── The selected shift.  The header renders immediately from the
             rotation rule; only the roster list waits on data. ── */}
      <ShiftPanel
        slot={activeSlot}
        teams={shiftTeams[activeSlot.code]}
        group={activeGroup}
        viewMode={viewMode}
        gridModel={gridModel}
        search={search}
      />

      {/* ── Context line ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
        {offDuty.nightOffTeams.length > 0 && (
          <span>
            Night off:{" "}
            <span className="font-medium text-foreground">Team {offDuty.nightOffTeams.join(", ")}</span>
          </span>
        )}
        {offDuty.clearOffTeams.length > 0 && (
          <span>
            Clear off:{" "}
            <span className="font-medium text-foreground">Team {offDuty.clearOffTeams.join(", ")}</span>
          </span>
        )}
        {day && <span>{day.totalMembers} entries across all shifts</span>}
        {day?.source === "schedules" && (
          <span className="text-amber-600 dark:text-amber-400">
            Derived from duty schedules — no published roster for this date
          </span>
        )}
        {day?.source === "empty" && !search && <span>No roster published for this date</span>}
      </div>
    </div>
  );
}
