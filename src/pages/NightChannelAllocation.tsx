/**
 * Night Channel Allocation.
 *
 * A standalone module: it reads who is on tonight's shift from the roster, then
 * owns its own board, rules and saved state. Every signed-in employee has the
 * same rights here as the WSO — view, set halves, choose starters, generate,
 * edit, save and share. There is no request step and no approval step, and the
 * signed-in user is used only to identify "me" and to stamp who saved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/DashboardLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, ChevronLeft, ChevronRight, Loader2, RotateCcw, Share2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useNightAllocation, type NightAllocationStatus } from "@/hooks/useNightAllocation";
import { useNightAllocationEnabled } from "@/hooks/useNightAllocationEnabled";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_DB_SLOT,
  activeChannels,
  availablePeople,
  blankMinutes,
  eveningRestShortfalls,
  findChannel,
  formatDuration,
  formatNightDate,
  isBlank,
  isFixedDuty,
  isGenerateFailure,
  isNightDate,
  isPlanned,
  makeDutyId,
  nightDateAt,
  rosterSubtitle,
  uncoveredMinutes,
  type DbSlotDraft,
  type NightAllocationState,
  type NightDuty,
} from "@/domain/night-allocation";
import { AllocationBoard, type BoardView } from "@/components/night-allocation/AllocationBoard";
import { ChannelsPanel, DbSlotsPanel, HalvesPanel, PeoplePanel } from "@/components/night-allocation/SetupPanels";
import { ChecksPanel } from "@/components/night-allocation/ChecksPanel";
import { DutyDialog, type DutyDraft } from "@/components/night-allocation/DutyDialog";
import { BlankDialog } from "@/components/night-allocation/BlankDialog";
import { DbSlotDialog } from "@/components/night-allocation/DbSlotDialog";
import { AvailabilityDialog } from "@/components/night-allocation/AvailabilityDialog";
import { ShareSheet } from "@/components/night-allocation/ShareSheet";
import * as actions from "@/components/night-allocation/stateActions";

type Role = "admin" | "supervisor" | "wso" | "employee";

/** How long a two-step confirm stays armed before it quietly stands down. */
const CONFIRM_WINDOW_MS = 5000;
const GENERATE_ARMED_TEXT =
  "This replaces the duties and blanks on the board — DB slots stay. Tap again to confirm.";
const RESET_ARMED_TEXT =
  "Reset clears halves, everyone's times, channel settings, starters, DB slots and all duties for this night. " +
  "Tap again to confirm.";
/** The same, for a night that has been saved: the reset replaces what everyone sees. */
const RESET_SAVED_ARMED_TEXT =
  "Reset clears halves, everyone's times, channel settings, starters, DB slots and all duties, and saves the " +
  "fresh night in place of the saved one — for everyone. Tap again to confirm.";
const CLEAR_ARMED_TEXT =
  "Clear takes every duty and blank off the board. The crew, halves, everyone's times, channel settings, " +
  "starters and DB slots stay. Tap again to confirm.";

/** The DB dialog's starting point for a slot already on the board. */
function draftFromSlot(slot: NightDuty): DbSlotDraft {
  return {
    id: slot.id,
    channelCode: slot.channelCode,
    personKey: slot.personKey,
    startMin: slot.startMin,
    endMin: slot.endMin,
    note: slot.note ?? "",
  };
}

/**
 * Which shell to render in. This page is shared by every role, so it follows
 * the same `?portal=` convention as Settings: the link says which portal it was
 * opened from, and only falls back to the signed-in role when it doesn't.
 * Without it, a supervisor opening the page from the employee dashboard would
 * be dropped into the supervisor portal.
 */
function normalizeRole(role: string | null | undefined): Role {
  if (role === "admin" || role === "supervisor" || role === "wso" || role === "employee") return role;
  return "employee";
}

/** One figure in the command bar's read-out. */
function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad" | "warn";
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-corp-text-soft">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[0.95rem] font-semibold tabular-nums leading-tight",
          tone === "good" && "text-status-success",
          tone === "bad" && "text-status-danger",
          tone === "warn" && "text-status-warning",
          tone === "neutral" && "text-corp-text-main",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** `2026-09-20` shifted by whole days, without touching the local timezone. */
function shiftDate(nightDate: string, days: number): string {
  const [year, month, day] = nightDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export default function NightChannelAllocation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, userRole } = useAuth();
  // `useUserProfile` returns a widened row shape because the generated Supabase
  // types are out of date; the same cast is used wherever the app reads a name.
  const { profile } = useUserProfile(user?.id) as { profile?: { full_name?: string } };
  const { toast } = useToast();
  const { enabled, isLoading: flagLoading } = useNightAllocationEnabled();

  const dateParam = searchParams.get("date");
  // With no date given, the night in progress — which after midnight is still
  // yesterday's, until it ends at 01:30.
  const nightDate = dateParam && isNightDate(dateParam) ? dateParam : nightDateAt(new Date());
  const nightDateRef = useRef(nightDate);
  nightDateRef.current = nightDate;
  const role = normalizeRole(searchParams.get("portal") || userRole);

  const allocation = useNightAllocation(nightDate);
  // `update` and `setStatus` are stable, so the callbacks built from them are
  // too — the setup panels then re-render only when the night actually changes.
  const { state, status, validation, dirty, conflict, rosterStatus, teams, update, setStatus } = allocation;

  const [view, setView] = useState<BoardView>("channel");
  const [draft, setDraft] = useState<DutyDraft | null>(null);
  /** The blank open in the fill dialog. */
  const [blankDraft, setBlankDraft] = useState<NightDuty | null>(null);
  const [slotDraft, setSlotDraft] = useState<DbSlotDraft | null>(null);
  /** Whose times are open in the availability dialog. */
  const [timesFor, setTimesFor] = useState<string | null>(null);
  const [focusedDutyId, setFocusedDutyId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [generateArmed, setGenerateArmed] = useState(false);
  const [generateNote, setGenerateNote] = useState<{ text: string; reasons: string[]; tone: "neutral" | "error" } | null>(
    null,
  );
  /**
   * The board Clear was armed on. The second tap clears only while that is
   * still the board on screen: an edit, a generate, a reset or another night in
   * between stands it down, so it never clears a board nobody confirmed.
   */
  const [clearArmedFor, setClearArmedFor] = useState<NightAllocationState | null>(null);
  const clearArmed = clearArmedFor !== null && clearArmedFor === state;
  /** A night asked for while this one has unsaved changes, awaiting a decision. */
  const [pendingNight, setPendingNight] = useState<string | null>(null);
  /** What the status line said before Reset was armed, to put back if it stands down. */
  const statusBeforeReset = useRef<NightAllocationStatus | null>(null);

  const disarmGenerate = useCallback(() => {
    setGenerateArmed(false);
    setGenerateNote(note => (note?.text === GENERATE_ARMED_TEXT ? null : note));
  }, []);

  // A two-step confirm that stays armed forever is a trap, not a safeguard.
  useEffect(() => {
    if (!resetArmed) return;
    const timer = window.setTimeout(() => {
      setResetArmed(false);
      const before = statusBeforeReset.current;
      if (before) {
        setStatus(current =>
          current.text === RESET_ARMED_TEXT || current.text === RESET_SAVED_ARMED_TEXT ? before : current,
        );
      }
    }, CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [resetArmed, setStatus]);

  useEffect(() => {
    if (!generateArmed) return;
    const timer = window.setTimeout(disarmGenerate, CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [generateArmed, disarmGenerate]);

  useEffect(() => {
    if (!clearArmedFor) return;
    const timer = window.setTimeout(() => setClearArmedFor(null), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [clearArmedFor]);

  // Closing or reloading the tab would throw unsaved work away without a word.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const goToNight = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("date", next);
    setSearchParams(params, { replace: true });
  };

  /** Another night, unless that would silently discard this one's changes. */
  const setNightDate = (next: string) => {
    if (next === nightDate) return;
    if (dirty) {
      setPendingNight(next);
      return;
    }
    goToNight(next);
  };

  /** Every setup control funnels through here so the status line stays honest. */
  const apply = useCallback(
    (action: (state: NightAllocationState) => actions.Applied) => {
      let note = "";
      update(current => {
        const result = action(current);
        note = result.note;
        return result.state;
      }, undefined);
      disarmGenerate();
      if (note) setStatus({ text: note, tone: "neutral" });
    },
    [update, setStatus, disarmGenerate],
  );

  const applyBoard = useCallback(
    (next: NightAllocationState, note?: string) => {
      update(() => next, note);
      disarmGenerate();
    },
    [update, disarmGenerate],
  );

  const myKey = useMemo(() => {
    if (!state || !user) return null;
    return state.people.find(person => person.userId === user.id)?.key ?? null;
  }, [state, user]);

  const problemDutyIds = useMemo(
    () => new Set(validation.errors.flatMap(issue => issue.dutyIds)),
    [validation.errors],
  );

  const uncovered = useMemo(() => (state ? uncoveredMinutes(state) : 0), [state]);
  const blank = useMemo(() => (state ? blankMinutes(state) : 0), [state]);
  /** Who is without 4 hours in a row off from 16:30 — marked on the by-person board. */
  const eveningRestShort = useMemo(
    () => new Set(state ? eveningRestShortfalls(state).map(shortfall => shortfall.person.key) : []),
    [state],
  );

  const handleGenerate = () => {
    if (!state) return;
    // DB slots survive a generate, so a board holding only those has nothing
    // to lose and needs no second tap.
    if (isPlanned(state) && !generateArmed) {
      setGenerateArmed(true);
      setGenerateNote({ text: GENERATE_ARMED_TEXT, reasons: [], tone: "neutral" });
      return;
    }
    setGenerateNote(null);
    // The answer belongs to this night. If the person has moved on by the time
    // it arrives, it must not replace the board they are looking at now.
    const requestedFor = nightDate;
    allocation.generate.mutate(undefined, {
      onSuccess: result => {
        if (nightDateRef.current !== requestedFor) return;
        setGenerateArmed(false);
        if (isGenerateFailure(result)) {
          // The board is deliberately left exactly as it was.
          setGenerateNote({ text: result.error, reasons: result.reasons, tone: "error" });
          return;
        }
        // The solver returns the whole board, including anything it chose for
        // itself — folding CLD into SMC, say — so it is applied wholesale.
        update(() => result.state);
        setGenerateNote({
          text: result.note ?? "Continuous plan made with staggered handovers. Every duty stays editable.",
          reasons: [],
          tone: "neutral",
        });
      },
      onError: error => {
        if (nightDateRef.current !== requestedFor) return;
        setGenerateArmed(false);
        setGenerateNote({ text: (error as Error).message, reasons: [], tone: "error" });
      },
    });
  };

  const handleSave = () => {
    if (!state) return;
    if (validation.errors.length) {
      setStatus({
        text: `Fix ${validation.errors.length} ${validation.errors.length === 1 ? "problem" : "problems"} before saving.`,
        tone: "blocked",
      });
      document.getElementById("night-allocation-checks")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    allocation.save.mutate(undefined, {
      onSuccess: () => toast({ title: "Allocation saved", description: "Everyone on tonight's page sees it now." }),
    });
  };

  const handleReset = () => {
    if (!resetArmed) {
      statusBeforeReset.current = status;
      setResetArmed(true);
      setStatus({ text: state?.version ? RESET_SAVED_ARMED_TEXT : RESET_ARMED_TEXT, tone: "blocked" });
      return;
    }
    setResetArmed(false);
    setGenerateNote(null);
    allocation.reset.mutate();
  };

  /** Every duty off the board, and nothing else — the rest of the night stays as it is. */
  const handleClearBoard = () => {
    if (!state || !isPlanned(state)) return;
    if (!clearArmed) {
      setClearArmedFor(state);
      return;
    }
    setClearArmedFor(null);
    // A note about the last plan describes duties that are gone now. A refusal
    // is about the settings, which haven't changed, so it stays.
    setGenerateNote(current => (current?.tone === "error" ? current : null));
    const { state: next, note } = actions.clearBoard(state);
    applyBoard(next, note);
  };

  const openNewDuty = (channelCode: string, startMin: number, personKey?: string, endMin?: number) => {
    if (!state) return;
    const channel = findChannel(state, channelCode);
    const start = Math.max(startMin, channel?.openAt ?? 0);
    const end = Math.min(channel?.closeAt ?? 720, endMin ?? start + 90);
    setDraft({
      isNew: true,
      duty: {
        id: makeDutyId(),
        channelCode,
        personKey: personKey ?? "",
        startMin: start,
        endMin: end,
      },
    });
  };

  const focusDuty = (dutyId: string) => {
    setFocusedDutyId(dutyId);
    window.setTimeout(() => setFocusedDutyId(current => (current === dutyId ? null : current)), 1800);
  };

  /** A DB slot and a blank each open in a dialog of their own; everything else in the duty editor. */
  const openDuty = (duty: NightDuty) => {
    if (isFixedDuty(duty)) setSlotDraft(draftFromSlot(duty));
    else if (isBlank(duty)) setBlankDraft(duty);
    else setDraft({ duty, isNew: false });
  };

  const openNewSlot = () => {
    if (!state) return;
    // TWR 17:30–19:30 is the usual one, so that is where a new slot starts.
    const channel =
      state.channels.find(entry => entry.inUse && entry.code === "TWR") ??
      state.channels.find(entry => entry.inUse) ??
      state.channels[0];
    if (!channel) return;
    const startMin = Math.max(channel.openAt, Math.min(DEFAULT_DB_SLOT[0], channel.closeAt - 60));
    setSlotDraft({
      channelCode: channel.code,
      personKey: "",
      startMin,
      endMin: Math.min(channel.closeAt, startMin + (DEFAULT_DB_SLOT[1] - DEFAULT_DB_SLOT[0])),
      note: "",
    });
  };

  if (!flagLoading && !enabled) {
    return (
      <DashboardLayout role={role} title="Night Channel Allocation">
        <Card className="border-corp-border-soft bg-surface">
          <CardContent className="pt-6">
            <p className="text-sm text-corp-text-muted">
              Night Channel Allocation is switched off for this station. An administrator can turn it on in System
              Settings.
            </p>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      role={role}
      title="Night Channel Allocation"
      subtitle="13:30 to 01:30 next day"
    >
      <div className="space-y-4">
        <Card className="overflow-hidden border-corp-border-soft bg-surface shadow-sm">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
              {/* Night identity — the one thing that must never be ambiguous. */}
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-corp-text-muted"
                  aria-label="Previous night"
                  onClick={() => setNightDate(shiftDate(nightDate, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="min-w-0 rounded-lg px-2 py-1 text-left transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[1.15rem] font-semibold tracking-tight text-corp-text-main sm:text-[1.3rem]">
                          {formatNightDate(nightDate)}
                        </span>
                        <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-corp-text-soft" />
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[0.72rem] font-semibold text-primary">
                          {rosterSubtitle(teams)}
                        </span>
                        <span className="font-mono text-[0.7rem] tabular-nums text-corp-text-soft">
                          13:30 → 01:30 <span className="text-corp-text-soft/70">(+1)</span>
                        </span>
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={new Date(`${nightDate}T00:00:00`)}
                      onSelect={date => date && setNightDate(format(date, "yyyy-MM-dd"))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-corp-text-muted"
                  aria-label="Next night"
                  onClick={() => setNightDate(shiftDate(nightDate, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Read-out: the four numbers that say whether tonight is sorted. */}
              {state ? (
                <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-3">
                  <Stat label="Crew" value={`${availablePeople(state).length}/${state.people.length}`} />
                  <Stat label="Positions" value={`${activeChannels(state).length}`} />
                  <Stat
                    label="Cover"
                    value={
                      !isPlanned(state)
                        ? "—"
                        : uncovered
                          ? `−${uncovered}m`
                          : blank
                            ? `${formatDuration(blank)} blank`
                            : "Full"
                    }
                    tone={!isPlanned(state) ? "neutral" : uncovered ? "bad" : blank ? "warn" : "good"}
                  />
                  <Stat
                    label="Problems"
                    value={`${validation.errors.length}`}
                    // An empty board breaks no rule, but it isn't "good" either.
                    tone={validation.errors.length ? "bad" : isPlanned(state) ? "good" : "neutral"}
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShareOpen(true)} disabled={!state}>
                  <Share2 className="mr-1.5 h-3.5 w-3.5" />
                  Share
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    resetArmed &&
                      "border-status-danger bg-status-danger text-white hover:bg-status-danger hover:text-white",
                  )}
                  onClick={handleReset}
                  disabled={!state || allocation.reset.isPending}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  {resetArmed ? "Tap again" : "Reset"}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={!state || allocation.save.isPending}>
                  {allocation.save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Save
                  {validation.errors.length && state && isPlanned(state) ? (
                    <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-[0.7rem] font-semibold tabular-nums">
                      {validation.errors.length}
                    </span>
                  ) : null}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-corp-border-soft pt-3">
              <p
                role="status"
                aria-live="polite"
                className={cn(
                  "flex min-h-[1.25rem] items-center gap-1.5 text-[0.78rem]",
                  status.tone === "saved"
                    ? "text-status-success"
                    : status.tone === "blocked"
                      ? "text-status-danger"
                      : "text-corp-text-muted",
                )}
              >
                {status.text ? (
                  <span
                    aria-hidden
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      status.tone === "saved"
                        ? "bg-status-success"
                        : status.tone === "blocked"
                          ? "bg-status-danger"
                          : "bg-status-neutral",
                    )}
                  />
                ) : null}
                {status.text}
                {dirty && status.tone === "saved" ? " Unsaved changes since." : ""}
              </p>

              <span className="ml-auto text-[0.72rem] text-corp-text-soft">
                Editing as <span className="font-medium text-corp-text-muted">{profile?.full_name ?? "you"}</span>
                {myKey ? "" : " · not on tonight's crew"}
              </span>
            </div>

            {conflict ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-status-warning/30 bg-status-warning-soft px-3 py-2.5 text-[0.82rem] text-corp-text-main">
                <span>{conflict.state.savedByName ?? "Someone"} saved this night while you were editing.</span>
                <Button size="sm" variant="outline" onClick={allocation.acceptServerVersion}>
                  Load their version
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {allocation.error ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-red-700 dark:text-red-400">{allocation.error.message}</p>
              <Button variant="outline" className="mt-3" onClick={() => allocation.refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!state ? (
          <div className="grid gap-4 [grid-template-columns:minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)]">
            <Skeleton className="h-[420px] w-full rounded-xl" />
            <Skeleton className="h-[420px] w-full rounded-xl" />
          </div>
        ) : (
          /* minmax(0,…) on both breakpoints: the board is a fixed-width
             timeline inside its own scroller, and an `auto` grid minimum lets
             that width stretch the whole page on a phone. */
          <div className="grid items-start gap-4 [grid-template-columns:minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <PeoplePanel
                state={state}
                rosterStatus={rosterStatus}
                onSetAvailability={(key, available) => apply(current => actions.setAvailability(current, key, available))}
                onEditTimes={setTimesFor}
                onSetHalf={(key, half) => apply(current => actions.setHalf(current, key, half))}
                onToggleTso={key => apply(current => actions.toggleTso(current, key))}
                onAddFromShift={candidate => apply(current => actions.addShiftPerson(current, candidate))}
                onAddPerson={name => apply(current => actions.addPerson(current, name))}
                onRemovePerson={key => apply(current => actions.removePerson(current, key))}
              />
              <HalvesPanel
                state={state}
                currentPersonKey={myKey}
                onSetHalf={(key, half) => apply(current => actions.setHalf(current, key, half))}
              />
              <DbSlotsPanel
                state={state}
                errors={validation.errors}
                onAdd={openNewSlot}
                onEdit={slot => setSlotDraft(draftFromSlot(slot))}
              />
              <ChannelsPanel
                state={state}
                generating={allocation.generate.isPending}
                generateArmed={generateArmed}
                generateNote={generateNote}
                onSetInUse={(code, inUse) => apply(current => actions.setChannelInUse(current, code, inUse))}
                onSetWindow={(code, value, moved) => apply(current => actions.setChannelWindow(current, code, value, moved))}
                onSetStarter={(code, key) => apply(current => actions.setChannelStarter(current, code, key))}
                onSetDutyLength={minutes => apply(current => actions.setDutyLengthPreference(current, minutes))}
                onSetMerge={merged => apply(current => actions.setMergeSmcCld(current, merged))}
                onGenerate={handleGenerate}
              />
            </div>

            <div className="min-w-0 space-y-4">
              <Card className="overflow-hidden border-corp-border-soft bg-surface shadow-sm">
                <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0 p-4 pb-3 sm:p-5 sm:pb-3">
                  <div className="mr-auto min-w-0">
                    <CardTitle className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-corp-text-muted">
                      Channel board
                    </CardTitle>
                    <p className="mt-1 text-[0.78rem] leading-snug text-corp-text-soft">
                      Tap a duty to change it, move it to another position, swap it or leave it blank. Handovers are
                      linked — relieving someone moves both duties together.
                    </p>
                  </div>
                  <div
                    className="inline-flex overflow-hidden rounded-lg border border-corp-border-soft"
                    role="group"
                    aria-label="Board view"
                  >
                    {(["channel", "person"] as BoardView[]).map(option => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={view === option}
                        onClick={() => setView(option)}
                        className={cn(
                          "min-h-[34px] px-3 text-[0.78rem] font-medium transition-colors",
                          view === option
                            ? "bg-primary text-primary-foreground"
                            : "text-corp-text-muted hover:bg-elevated",
                        )}
                      >
                        {option === "channel" ? "Position" : "Person"}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const channel = state.channels.find(entry => entry.inUse) ?? state.channels[0];
                      if (channel) openNewDuty(channel.code, channel.openAt);
                    }}
                  >
                    Add duty
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      clearArmed &&
                        "border-status-danger bg-status-danger text-white hover:bg-status-danger hover:text-white",
                    )}
                    onClick={handleClearBoard}
                    // Nothing to clear on a board of DB slots alone, and a generate or
                    // reset in flight is about to replace the board anyway.
                    disabled={!isPlanned(state) || allocation.generate.isPending || allocation.reset.isPending}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {/* Both labels share one cell, so arming it never changes its
                        width and moves it out from under the second tap. */}
                    <span className="grid">
                      <span className={cn("col-start-1 row-start-1", clearArmed && "invisible")}>Clear board</span>
                      <span className={cn("col-start-1 row-start-1", !clearArmed && "invisible")}>Tap again</span>
                    </span>
                  </Button>
                  {/* Clear's confirm goes under the buttons, where it can't push
                      them about, rather than in the status line, a screen away on
                      a phone. Always in the DOM so screen readers announce it. */}
                  <p
                    aria-live="polite"
                    className={cn(
                      clearArmed ? "basis-full text-[0.78rem] font-medium leading-snug text-status-danger" : "sr-only",
                    )}
                  >
                    {clearArmed ? CLEAR_ARMED_TEXT : ""}
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <AllocationBoard
                    state={state}
                    view={view}
                    problemDutyIds={problemDutyIds}
                    focusedDutyId={focusedDutyId}
                    onOpenDuty={openDuty}
                    onAddDuty={openNewDuty}
                    eveningRestShort={eveningRestShort}
                  />
                  <p className="px-4 py-2.5 text-[0.72rem] text-corp-text-soft sm:px-5">
                    A duty runs 30 min to 2 h — TSO has no maximum — with at least 30 min break before the same
                    person's next one, except straight onto or off TSO, which needs none. Everyone should also get
                    4 h off in a row starting between 16:30 and 23:30 (TSO doesn't count); an amber dot in the
                    Person view marks who doesn't. Striped strips marked DB are fixed slots; the generator plans
                    around them. Red outlines marked BLANK have nobody on them — tap one to fill it.
                  </p>
                </CardContent>
              </Card>

              <ChecksPanel
                validation={validation}
                hasDuties={isPlanned(state)}
                blanks={state.duties.filter(isBlank).length}
                onFocusDuty={focusDuty}
              />
            </div>
          </div>
        )}
      </div>

      {state ? (
        <>
          <DutyDialog state={state} draft={draft} onClose={() => setDraft(null)} onApply={applyBoard} />
          <BlankDialog state={state} blank={blankDraft} onClose={() => setBlankDraft(null)} onApply={applyBoard} />
          <DbSlotDialog state={state} draft={slotDraft} onClose={() => setSlotDraft(null)} onApply={applyBoard} />
          <AvailabilityDialog
            state={state}
            personKey={timesFor}
            onClose={() => setTimesFor(null)}
            onSave={(key, availability) => apply(current => actions.setPersonAvailability(current, key, availability))}
          />
          <ShareSheet
            open={shareOpen}
            onOpenChange={setShareOpen}
            state={state}
            teams={teams}
            errorCount={validation.errors.length}
            dirty={dirty}
          />
        </>
      ) : null}

      <AlertDialog open={!!pendingNight} onOpenChange={open => !open && setPendingNight(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes to {formatNightDate(nightDate)} haven't been saved. Opening another night throws them
              away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="bg-status-danger text-white hover:bg-status-danger/90"
              onClick={() => {
                if (pendingNight) goToNight(pendingNight);
                setPendingNight(null);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
