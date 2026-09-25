/**
 * Adding or changing a DB slot.
 *
 * A DB slot reserves a position for training at a fixed time. It asks for the
 * instructor because the instructor is the one actually marked on the position
 * then — the roster shows their name with DB beside it — and every duty rule
 * applies to them as it would to anyone on that position.
 *
 * What is wrong with the slot itself stops it going down. Where it only clashes
 * with the current plan, it goes down anyway and the next generate plans around
 * it: the slot is the fixed point, the plan is what gives way.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";
import {
  DB_NOTE_MAX,
  NIGHT_SPAN_MIN,
  SLOT_MIN,
  awayDuring,
  canTakeChannel,
  formatDuration,
  formatPickerLabel,
  formatRange,
  isBreakExempt,
  isRefusedSlot,
  isUncappedChannel,
  placeDbSlot,
  removeDbSlot,
  reviewDbSlot,
  slotRange,
  type DbSlotDraft,
  type NightAllocationState,
} from "@/domain/night-allocation";

interface DbSlotDialogProps {
  state: NightAllocationState;
  /** The slot being edited or added, or null when the dialog is closed. */
  draft: DbSlotDraft | null;
  onClose: () => void;
  onApply: (next: NightAllocationState, note?: string) => void;
}

const START_TIMES = slotRange(0, NIGHT_SPAN_MIN - SLOT_MIN);
const END_TIMES = slotRange(SLOT_MIN, NIGHT_SPAN_MIN);

export function DbSlotDialog({ state, draft, onClose, onApply }: DbSlotDialogProps) {
  if (!draft) return null;
  // Keyed, so every opening starts from the slot it was opened for.
  return <DbSlotEditor key={draft.id ?? "new"} state={state} initial={draft} onClose={onClose} onApply={onApply} />;
}

function DbSlotEditor({
  state,
  initial,
  onClose,
  onApply,
}: {
  state: NightAllocationState;
  initial: DbSlotDraft;
  onClose: () => void;
  onApply: DbSlotDialogProps["onApply"];
}) {
  const [working, setWorking] = useState<DbSlotDraft>(initial);
  const [refusal, setRefusal] = useState<string[]>([]);
  const isNew = !initial.id;

  const review = reviewDbSlot(state, working);
  const length = working.endMin - working.startMin;
  const channels = state.channels.filter(channel => channel.inUse || channel.code === working.channelCode);
  const instructors = state.people.filter(
    person =>
      (person.available && canTakeChannel(person, working.channelCode)) || person.key === working.personKey,
  );

  const change = (patch: Partial<DbSlotDraft>) => {
    setRefusal([]);
    setWorking(current => ({ ...current, ...patch }));
  };

  const setTime = (which: "start" | "end", value: number) => {
    let { startMin, endMin } = working;
    if (which === "start") startMin = value;
    else endMin = value;
    // Keep it the right way round rather than refusing the pick.
    if (startMin >= endMin) {
      if (which === "start") endMin = Math.min(NIGHT_SPAN_MIN, startMin + 60);
      else startMin = Math.max(0, endMin - 60);
    }
    change({ startMin, endMin });
  };

  const handleSave = () => {
    const result = placeDbSlot(state, working);
    if (isRefusedSlot(result)) {
      setRefusal(result.problems);
      return;
    }
    onApply(result.state, result.note);
    onClose();
  };

  const handleRemove = () => {
    if (!initial.id) return;
    const result = removeDbSlot(state, initial.id);
    onApply(result.state, result.note);
    onClose();
  };

  const problems = refusal.length ? refusal : review.problems;
  const lengthHint =
    length <= 0
      ? "end time must be after the start"
      : isUncappedChannel(working.channelCode)
        ? `${working.channelCode} has no maximum — 30 min minimum`
        : "of the 30 min – 2 h a duty may run";

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "Add DB slot" : `DB slot on ${initial.channelCode}`}</DialogTitle>
          <DialogDescription>
            The position is kept for the DB at this time. The instructor holds it, with DB beside their name, and
            the generator plans everyone else around it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="db-position">Position</Label>
            <Select value={working.channelCode} onValueChange={value => change({ channelCode: value })}>
              <SelectTrigger id="db-position">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channels.map(channel => (
                  <SelectItem key={channel.code} value={channel.code}>
                    {channel.code}
                    {!channel.inUse ? " (not in use)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="db-instructor">Instructor</Label>
            <Select value={working.personKey || ""} onValueChange={value => change({ personKey: value })}>
              <SelectTrigger id="db-instructor">
                <SelectValue placeholder="Select instructor" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {instructors.map(person => {
                  const away = awayDuring(person, working.startMin, working.endMin);
                  return (
                    <SelectItem key={person.key} value={person.key}>
                      {person.name}
                      {!person.available
                        ? " (not available)"
                        : !canTakeChannel(person, working.channelCode)
                          ? " (not set for TSO)"
                          : away.length
                            ? ` (away ${formatRange(away[0][0], away[0][1])})`
                            : person.half === "1st"
                              ? " (1st Half)"
                              : person.half === "2nd"
                                ? " (2nd Half)"
                                : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="db-start">From</Label>
            <Select value={String(working.startMin)} onValueChange={value => setTime("start", Number(value))}>
              <SelectTrigger id="db-start" className="font-mono tabular-nums">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {START_TIMES.map(minute => (
                  <SelectItem key={minute} value={String(minute)} className="font-mono">
                    {formatPickerLabel(minute)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="db-end">To</Label>
            <Select value={String(working.endMin)} onValueChange={value => setTime("end", Number(value))}>
              <SelectTrigger id="db-end" className="font-mono tabular-nums">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {END_TIMES.map(minute => (
                  <SelectItem key={minute} value={String(minute)} className="font-mono">
                    {formatPickerLabel(minute)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="db-trainee">
              Trainee <span className="font-normal text-corp-text-soft">(optional)</span>
            </Label>
            <Input
              id="db-trainee"
              value={working.note}
              maxLength={DB_NOTE_MAX}
              onChange={event => change({ note: event.target.value })}
              placeholder="Who is being trained"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="rounded-lg border border-corp-border-soft bg-elevated/50 px-3 py-2.5">
          <p className="font-mono text-[0.8rem] tabular-nums text-corp-text-main">
            {length > 0 ? formatDuration(length) : "—"}
            <span className="ml-2 font-sans text-[0.72rem] text-corp-text-soft">{lengthHint}</span>
          </p>
          <p className="mt-1 text-[0.76rem] leading-snug text-corp-text-muted">
            {isBreakExempt(working.channelCode)
              ? `${working.channelCode} needs no break either side, so the instructor can come straight from another position or go straight to one.`
              : "The instructor needs a 30 min break either side of it, like any duty — except straight onto or off TSO."}
          </p>
        </div>

        <ul aria-live="polite" className="space-y-1 text-sm">
          {problems.map(problem => (
            <li
              key={problem}
              className="rounded-lg border border-status-danger/25 bg-status-danger-soft/60 px-3 py-2 text-[0.82rem] leading-snug text-corp-text-main"
            >
              {problem}
            </li>
          ))}
          {problems.length
            ? null
            : [...review.clashes, ...review.notices].map(line => (
                <li
                  key={line}
                  className="rounded-lg border border-status-warning/30 bg-status-warning-soft px-3 py-2 text-[0.82rem] leading-snug text-corp-text-main"
                >
                  {line}
                </li>
              ))}
          {!problems.length && review.clashes.length ? (
            <li className="text-[0.76rem] leading-snug text-corp-text-muted">
              These clash with the plan on the board, not with the slot. Save, then generate again and the plan will
              work around it.
            </li>
          ) : null}
          {problems.length || review.clashes.length || review.notices.length ? null : (
            <li className="flex items-center gap-2 text-[0.82rem] font-medium text-status-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {working.channelCode} is kept for the DB {formatRange(working.startMin, working.endMin)}.
            </li>
          )}
        </ul>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {!isNew ? (
            <Button variant="outline" className="text-status-danger hover:text-status-danger" onClick={handleRemove}>
              Remove slot
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={problems.length > 0}>
            {isNew ? "Add slot" : "Save slot"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
