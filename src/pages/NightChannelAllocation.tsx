/**
 * Night Channel Allocation.
 *
 * A standalone module: it reads who is on tonight's shift from the roster, then
 * owns its own board, rules and saved state. Every signed-in employee has the
 * same rights here as the WSO — view, set halves, choose starters, generate,
 * edit, save and share. There is no request step and no approval step, and the
 * signed-in user is used only to identify "me" and to stamp who saved.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, ChevronLeft, ChevronRight, Loader2, RotateCcw, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUsers";
import { useNightAllocation } from "@/hooks/useNightAllocation";
import { useNightAllocationEnabled } from "@/hooks/useNightAllocationEnabled";
import { useToast } from "@/hooks/use-toast";
import {
  activeChannels,
  availablePeople,
  findChannel,
  formatNightDate,
  isGenerateFailure,
  makeDutyId,
  rosterSubtitle,
  uncoveredMinutes,
  type NightAllocationState,
  type NightDuty,
} from "@/domain/night-allocation";
import { AllocationBoard, type BoardView } from "@/components/night-allocation/AllocationBoard";
import { ChannelsPanel, HalvesPanel, PeoplePanel } from "@/components/night-allocation/SetupPanels";
import { ChecksPanel } from "@/components/night-allocation/ChecksPanel";
import { DutyDialog, type DutyDraft } from "@/components/night-allocation/DutyDialog";
import { ShareSheet } from "@/components/night-allocation/ShareSheet";
import * as actions from "@/components/night-allocation/stateActions";

type Role = "admin" | "supervisor" | "wso" | "employee";

const todayIso = () => format(new Date(), "yyyy-MM-dd");
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
  tone?: "neutral" | "good" | "bad";
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
  const nightDate = dateParam && DATE_PATTERN.test(dateParam) ? dateParam : todayIso();
  const role = normalizeRole(searchParams.get("portal") || userRole);

  const allocation = useNightAllocation(nightDate);
  // `update` and `setStatus` are stable, so the callbacks built from them are
  // too — the setup panels then re-render only when the night actually changes.
  const { state, status, validation, dirty, conflict, rosterStatus, teams, update, setStatus } = allocation;

  const [view, setView] = useState<BoardView>("channel");
  const [draft, setDraft] = useState<DutyDraft | null>(null);
  const [focusedDutyId, setFocusedDutyId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [generateArmed, setGenerateArmed] = useState(false);
  const [generateNote, setGenerateNote] = useState<{ text: string; reasons: string[]; tone: "neutral" | "error" } | null>(
    null,
  );

  // A two-step confirm that stays armed forever is a trap, not a safeguard.
  useEffect(() => {
    if (!resetArmed) return;
    const timer = window.setTimeout(() => setResetArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [resetArmed]);

  const setNightDate = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("date", next);
    setSearchParams(params, { replace: true });
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
      setGenerateArmed(false);
      if (note) setStatus({ text: note, tone: "neutral" });
    },
    [update, setStatus],
  );

  const applyBoard = useCallback(
    (next: NightAllocationState, note?: string) => {
      update(() => next, note);
      setGenerateArmed(false);
    },
    [update],
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

  const handleGenerate = () => {
    if (!state) return;
    if (state.duties.length && !generateArmed) {
      setGenerateArmed(true);
      setGenerateNote({
        text: "This replaces the duties on the board. Tap again to confirm.",
        reasons: [],
        tone: "neutral",
      });
      return;
    }
    setGenerateNote(null);
    allocation.generate.mutate(undefined, {
      onSuccess: result => {
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
      setResetArmed(true);
      setStatus({
        text: "Reset clears halves, channel settings, starters and all duties for this night. Tap again to confirm.",
        tone: "blocked",
      });
      return;
    }
    setResetArmed(false);
    setGenerateNote(null);
    allocation.reset.mutate();
  };

  const openNewDuty = (channelCode: string, startMin: number, personKey?: string) => {
    if (!state) return;
    const channel = findChannel(state, channelCode);
    const start = Math.max(startMin, channel?.openAt ?? 0);
    const end = Math.min(channel?.closeAt ?? 720, start + 90);
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
                    value={state.duties.length ? (uncovered ? `−${uncovered}m` : "Full") : "—"}
                    tone={state.duties.length ? (uncovered ? "bad" : "good") : "neutral"}
                  />
                  <Stat
                    label="Problems"
                    value={`${validation.errors.length}`}
                    tone={validation.errors.length ? "bad" : "good"}
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
                  {validation.errors.length && state?.duties.length ? (
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
                      Tap a duty to change it. Handovers are linked — relieving someone moves both duties together.
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
                </CardHeader>
                <CardContent className="p-0">
                  <AllocationBoard
                    state={state}
                    view={view}
                    problemDutyIds={problemDutyIds}
                    focusedDutyId={focusedDutyId}
                    onOpenDuty={(duty: NightDuty) => setDraft({ duty, isNew: false })}
                    onAddDuty={openNewDuty}
                  />
                  <p className="px-4 py-2.5 text-[0.72rem] text-corp-text-soft sm:px-5">
                    A duty runs 30 min to 2 h — TSO has no maximum — with at least 30 min break before the same
                    person's next one.
                  </p>
                </CardContent>
              </Card>

              <ChecksPanel
                validation={validation}
                hasDuties={state.duties.length > 0}
                onFocusDuty={focusDuty}
              />
            </div>
          </div>
        )}
      </div>

      {state ? (
        <>
          <DutyDialog state={state} draft={draft} onClose={() => setDraft(null)} onApply={applyBoard} />
          <ShareSheet
            open={shareOpen}
            onOpenChange={setShareOpen}
            state={state}
            teams={teams}
            blocked={validation.errors.length > 0}
            blockingCount={validation.errors.length}
            saved={state.version > 0 && !dirty}
          />
        </>
      ) : null}
    </DashboardLayout>
  );
}
