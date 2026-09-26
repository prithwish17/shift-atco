/**
 * The duty editor.
 *
 * Handovers are linked, so this dialog never edits one duty in isolation: it
 * previews the whole chain, lists what the change would break, and keeps Apply
 * disabled until nothing is broken. A refused change leaves the board alone.
 *
 * Everything a manual edit needs is here. Change the person, or the position:
 * a duty moved to another position leaves its old stretch blank and takes the
 * new one outright. Swap with whoever is on another position at the same time.
 * Leave the duty — or part of it — blank: the person comes off and the stretch
 * stays on the board with nobody on it, rather than being handed to a
 * neighbour. Or delete it and let the neighbour take the time, as before.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeftRight, CheckCircle2, ChevronDown } from "lucide-react";
import {
  MIN_DUTY_MIN,
  NIGHT_SPAN_MIN,
  SLOT_MIN,
  absorbingNeighbour,
  applyDutyChange,
  availablePeople,
  awayDuring,
  canTakeChannel,
  deleteDuty,
  describeMove,
  dutiesOf,
  formatRange,
  isBlank,
  isFixedDuty,
  isMove,
  findChannel,
  findPerson,
  formatDuration,
  isRefusedEdit,
  isUncappedChannel,
  formatMinutes,
  formatPickerLabel,
  leaveBlank,
  neighboursOf,
  overlaps,
  personName,
  previewDutyChange,
  slotRange,
  splitDuty,
  swapCandidates,
  swapPeople,
  type EditResult,
  type NightAllocationState,
  type NightDuty,
} from "@/domain/night-allocation";

export interface DutyDraft {
  duty: NightDuty;
  /** True when this duty is not on the board yet. */
  isNew: boolean;
}

interface DutyDialogProps {
  state: NightAllocationState;
  draft: DutyDraft | null;
  onClose: () => void;
  onApply: (next: NightAllocationState, note?: string) => void;
}

export function DutyDialog({ state, draft, onClose, onApply }: DutyDialogProps) {
  const [working, setWorking] = useState<NightDuty | null>(null);
  const [splitAt, setSplitAt] = useState<number | null>(null);
  const [splitPerson, setSplitPerson] = useState<string>("");
  const [blankFrom, setBlankFrom] = useState<number | null>(null);
  const [blankTo, setBlankTo] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string[]>([]);

  useEffect(() => {
    setWorking(draft ? { ...draft.duty } : null);
    setSplitAt(null);
    setSplitPerson("");
    setBlankFrom(null);
    setBlankTo(null);
    setRefusal([]);
  }, [draft]);

  const original = useMemo(
    () => (draft && !draft.isNew ? state.duties.find(duty => duty.id === draft.duty.id) ?? null : null),
    [draft, state.duties],
  );

  const preview = useMemo(
    () =>
      working
        ? previewDutyChange(state, original, working)
        : { duties: [], problems: [], unresolved: [], preferences: [] },
    [state, original, working],
  );

  /**
   * Who this duty could swap with, each already tried: a swap that would break
   * a rule is shown with the reason rather than offered and then refused.
   */
  const swaps = useMemo(
    () =>
      original && !isBlank(original)
        ? swapCandidates(state, original).map(other => {
            const result = swapPeople(state, original.id, other.id);
            return { other, result, refused: isRefusedEdit(result) ? result.problems[0] : null };
          })
        : [],
    [state, original],
  );

  if (!draft || !working) return null;

  const channel = findChannel(state, working.channelCode);
  const moving = isMove(original, working);
  const neighbours = original && !moving ? neighboursOf(state.duties, original) : { previous: undefined, next: undefined };
  const length = working.endMin - working.startMin;

  const problems = working.personKey ? preview.problems : ["Select a person."];
  const canApply = problems.length === 0;

  const peopleForChannel = state.people.filter(
    person => (person.available && canTakeChannel(person, working.channelCode)) || person.key === working.personKey,
  );
  const channelOptions = state.channels.filter(entry => entry.inUse || entry.code === working.channelCode);

  /** What else someone is on while this duty runs — so a swap can be spotted before Apply refuses. */
  const busyWith = (personKey: string) =>
    dutiesOf(state, personKey).find(
      duty => duty.id !== original?.id && overlaps(duty, working.startMin, working.endMin),
    );

  const holderName = (duty: NightDuty) => findPerson(state, duty.personKey)?.name ?? "someone";
  const takesOverFrom = neighbours.previous
    ? isBlank(neighbours.previous)
      ? `Starts at ${formatMinutes(working.startMin)}, after a blank — an earlier start fills part of it.`
      : `Takes over from ${holderName(neighbours.previous)} at ${formatMinutes(working.startMin)}.`
    : channel && working.startMin === channel.openAt
      ? `Opens ${working.channelCode} at ${formatMinutes(working.startMin)}.`
      : `Starts at ${formatMinutes(working.startMin)}.`;
  const handsOverTo = neighbours.next
    ? isBlank(neighbours.next)
      ? `Ends at ${formatMinutes(working.endMin)}, before a blank — a later end fills part of it.`
      : `Hands over to ${holderName(neighbours.next)} at ${formatMinutes(working.endMin)}.`
    : channel && working.endMin === channel.closeAt
      ? `Covers ${working.channelCode} until it closes at ${formatMinutes(working.endMin)}.`
      : `Ends at ${formatMinutes(working.endMin)}.`;
  const moveLines = original && moving ? describeMove(state, original, working) : [];

  // The first duty's start and the last duty's end belong to the channel's own
  // open and close times, so they are not editable here — and a handover with
  // a DB slot belongs to the slot, which doesn't move. A duty being moved has
  // no handovers on its new position yet, so nothing is pinned.
  const slotBefore = !!(neighbours.previous && isFixedDuty(neighbours.previous));
  const slotAfter = !!(neighbours.next && isFixedDuty(neighbours.next));
  const startPinned =
    !moving &&
    (!!(original && !neighbours.previous && channel && original.startMin === channel.openAt) || slotBefore);
  const endPinned =
    !moving && (!!(original && !neighbours.next && channel && original.endMin === channel.closeAt) || slotAfter);

  const canSplit = !!original && !moving && length >= 2 * MIN_DUTY_MIN;
  const splitTimes = canSplit
    ? slotRange(working.startMin + MIN_DUTY_MIN, working.endMin - MIN_DUTY_MIN)
    : [];
  const splitCandidates = availablePeople(state).filter(
    person => person.key !== working.personKey && canTakeChannel(person, working.channelCode),
  );

  const takesTheTime = original && !moving ? absorbingNeighbour(state.duties, original) : undefined;

  const from = blankFrom ?? original?.startMin ?? 0;
  const to = blankTo ?? original?.endMin ?? 0;
  const blankStarts = original ? slotRange(original.startMin, original.endMin - SLOT_MIN) : [];
  const blankEnds = original ? slotRange(from + SLOT_MIN, original.endMin) : [];

  /** Apply what an action returned, or show why it was refused. */
  const finish = (result: EditResult) => {
    if (isRefusedEdit(result)) {
      setRefusal(result.problems);
      return;
    }
    onApply(result.state, result.note);
    onClose();
  };

  const handleApply = () => finish(applyDutyChange(state, working, original?.id ?? null));
  const handleDelete = () => original && finish(deleteDuty(state, original.id));
  const handleLeaveBlank = (fromMin?: number, toMin?: number) =>
    original && finish(leaveBlank(state, original.id, fromMin, toMin));

  const handleSplit = () => {
    if (!original) return;
    const at = splitAt ?? splitTimes[Math.floor(splitTimes.length / 2)];
    finish(splitDuty(state, original.id, at, splitPerson));
  };

  const shown = refusal.length ? refusal : problems;
  // Problems these duties already had. They don't block the change — fixing
  // one of two broken duties side by side has to be possible — but the dialog
  // must not call them "no conflicts" either.
  const unresolved = refusal.length || !working.personKey ? [] : preview.unresolved;
  // Preferences the change would stop being met. Never a reason to refuse it.
  const preferences = refusal.length || !working.personKey ? [] : preview.preferences;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {!original
              ? "Add duty"
              : moving
                ? `Move to ${working.channelCode}`
                : `Change ${working.channelCode} duty`}
          </DialogTitle>
          <DialogDescription>
            {original
              ? "Handover times are linked: changing one end moves the duty next to it. Pick another position to " +
                "move this duty there — the stretch it leaves is left blank."
              : "Handover times are linked: changing one end moves the duty next to it, so the position stays covered."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="duty-person">Person</Label>
            <Select
              value={working.personKey || ""}
              onValueChange={value => {
                setRefusal([]);
                setWorking({ ...working, personKey: value });
              }}
            >
              <SelectTrigger id="duty-person">
                <SelectValue placeholder="Select person" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {peopleForChannel.map(person => {
                  const away = awayDuring(person, working.startMin, working.endMin);
                  const busy = person.key === working.personKey ? undefined : busyWith(person.key);
                  return (
                    <SelectItem key={person.key} value={person.key}>
                      {person.name}
                      {!person.available
                        ? " (not available)"
                        : !canTakeChannel(person, working.channelCode)
                          ? " (not set for TSO)"
                          : away.length
                            ? ` (away ${formatRange(away[0][0], away[0][1])})`
                            : busy
                              ? ` (on ${busy.channelCode} ${formatRange(busy.startMin, busy.endMin)})`
                              : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duty-channel">Position</Label>
            <Select
              value={working.channelCode}
              onValueChange={value => {
                setRefusal([]);
                setWorking({ ...working, channelCode: value });
              }}
            >
              <SelectTrigger id="duty-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channelOptions.map(entry => (
                  <SelectItem key={entry.code} value={entry.code}>
                    {entry.code}
                    {original && entry.code !== original.channelCode ? " — move here" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duty-start">Start</Label>
            <Select
              value={String(working.startMin)}
              disabled={startPinned}
              onValueChange={value => {
                setRefusal([]);
                setWorking({ ...working, startMin: Number(value) });
              }}
            >
              <SelectTrigger id="duty-start">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {slotRange(0, NIGHT_SPAN_MIN - SLOT_MIN).map(minute => (
                  <SelectItem key={minute} value={String(minute)}>
                    {formatPickerLabel(minute)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duty-end">End</Label>
            <Select
              value={String(working.endMin)}
              disabled={endPinned}
              onValueChange={value => {
                setRefusal([]);
                setWorking({ ...working, endMin: Number(value) });
              }}
            >
              <SelectTrigger id="duty-end">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {slotRange(SLOT_MIN, NIGHT_SPAN_MIN).map(minute => (
                  <SelectItem key={minute} value={String(minute)}>
                    {formatPickerLabel(minute)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border border-corp-border-soft bg-elevated/50 px-3 py-2.5">
          <p className="font-mono text-[0.8rem] tabular-nums text-corp-text-main">
            {length > 0 ? `${formatDuration(length)}` : "—"}
            <span className="ml-2 font-sans text-[0.72rem] text-corp-text-soft">
              {length <= 0
                ? "end time must be after the start"
                : isUncappedChannel(working.channelCode)
                  ? `${working.channelCode} has no maximum — 30 min minimum`
                  : "of the 30 min – 2 h allowed"}
            </span>
          </p>
          {moving ? (
            <ul className="mt-1 space-y-0.5 text-[0.78rem] leading-snug text-corp-text-muted">
              {moveLines.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[0.78rem] leading-snug text-corp-text-muted">{`${takesOverFrom} ${handsOverTo}`}</p>
          )}
          {slotBefore || slotAfter ? (
            <p className="mt-1 text-[0.74rem] leading-snug text-corp-text-soft">
              {slotBefore && slotAfter
                ? "Both handovers are with DB slots, which don't move."
                : slotBefore
                  ? "The start is the handover from a DB slot, which doesn't move."
                  : "The end is the handover to a DB slot, which doesn't move."}
            </p>
          ) : null}
        </div>

        <ul aria-live="polite" className="space-y-1 text-sm">
          {shown.map(problem => (
            <li
              key={problem}
              className="rounded-lg border border-status-danger/25 bg-status-danger-soft/60 px-3 py-2 text-[0.82rem] leading-snug text-corp-text-main"
            >
              {problem}
            </li>
          ))}
          {unresolved.map(problem => (
            <li
              key={`unresolved-${problem}`}
              className="rounded-lg border border-status-warning/30 bg-status-warning-soft px-3 py-2 text-[0.82rem] leading-snug text-corp-text-main"
            >
              <span className="font-medium">Already a problem, not changed by this: </span>
              {problem}
            </li>
          ))}
          {preferences.map(note => (
            <li
              key={`preference-${note}`}
              className="rounded-lg border border-status-warning/30 bg-status-warning-soft/60 px-3 py-2 text-[0.82rem] leading-snug text-corp-text-main"
            >
              <span className="font-medium">Preference: </span>
              {note}
            </li>
          ))}
          {shown.length || unresolved.length ? null : (
            <li className="flex items-center gap-2 text-[0.82rem] font-medium text-status-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {moving ? "No conflicts. Both positions stay covered or blank." : "No conflicts. The position stays continuous."}
            </li>
          )}
        </ul>

        {swaps.length && !moving ? (
          <Collapsible className="border-t border-corp-border-soft pt-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-[0.82rem] font-medium text-primary">
              Swap with another position
              <ChevronDown className="h-4 w-4" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-3">
              <p className="text-[0.74rem] leading-snug text-corp-text-soft">
                The two people change places, each taking the other's times. Swapping with a blank moves{" "}
                {personName(state, working.personKey)} there and leaves this stretch blank.
              </p>
              <ul className="space-y-1.5">
                {swaps.map(({ other, result, refused }) => (
                  <li key={other.id}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto w-full flex-wrap justify-start gap-x-2 gap-y-0.5 whitespace-normal py-2 text-left"
                      disabled={!!refused}
                      onClick={() => finish(result)}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-mono text-[0.74rem] tabular-nums">
                        {other.channelCode} {formatRange(other.startMin, other.endMin)}
                      </span>
                      <span className={isBlank(other) ? "font-semibold text-status-danger" : ""}>
                        {isBlank(other) ? "Blank" : personName(state, other.personKey)}
                      </span>
                      {refused ? (
                        <span className="basis-full pl-5 text-[0.72rem] font-normal leading-snug text-corp-text-soft">
                          {refused.replace(/^Can't swap: /, "")}
                        </span>
                      ) : null}
                    </Button>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {canSplit ? (
          <Collapsible className="border-t border-corp-border-soft pt-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-[0.82rem] font-medium text-primary">
              Hand over part of this duty
              <ChevronDown className="h-4 w-4" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="split-at">Hand over at</Label>
                  <Select
                    value={String(splitAt ?? splitTimes[Math.floor(splitTimes.length / 2)] ?? "")}
                    onValueChange={value => setSplitAt(Number(value))}
                  >
                    <SelectTrigger id="split-at">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {splitTimes.map(minute => (
                        <SelectItem key={minute} value={String(minute)}>
                          {formatPickerLabel(minute)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="split-person">To</Label>
                  <Select value={splitPerson} onValueChange={setSplitPerson}>
                    <SelectTrigger id="split-person">
                      <SelectValue placeholder="Select person" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {splitCandidates.map(person => (
                        <SelectItem key={person.key} value={person.key}>
                          {person.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button variant="outline" onClick={handleSplit} disabled={!splitPerson}>
                Split duty
              </Button>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {original && !moving ? (
          <Collapsible className="border-t border-corp-border-soft pt-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-[0.82rem] font-medium text-primary">
              Leave part of it blank
              <ChevronDown className="h-4 w-4" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              <p className="text-[0.74rem] leading-snug text-corp-text-soft">
                {personName(state, working.personKey)} comes off that part and keeps the rest. Nobody is put on the
                blank; tap it on the board later to fill it.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="blank-from">Blank from</Label>
                  <Select
                    value={String(from)}
                    onValueChange={value => {
                      const next = Number(value);
                      setRefusal([]);
                      setBlankFrom(next);
                      if (to <= next) setBlankTo(Math.min(original.endMin, next + SLOT_MIN));
                    }}
                  >
                    <SelectTrigger id="blank-from">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {blankStarts.map(minute => (
                        <SelectItem key={minute} value={String(minute)}>
                          {formatPickerLabel(minute)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="blank-to">To</Label>
                  <Select
                    value={String(to)}
                    onValueChange={value => {
                      setRefusal([]);
                      setBlankTo(Number(value));
                    }}
                  >
                    <SelectTrigger id="blank-to">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {blankEnds.map(minute => (
                        <SelectItem key={minute} value={String(minute)}>
                          {formatPickerLabel(minute)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button variant="outline" onClick={() => handleLeaveBlank(from, to)}>
                Leave {formatRange(from, to)} blank
              </Button>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {original && !moving ? (
            <>
              <Button
                variant="outline"
                className="text-status-danger hover:text-status-danger"
                title={`Take ${personName(state, original.personKey)} off and keep ${original.channelCode} ` +
                  `${formatRange(original.startMin, original.endMin)} on the board with nobody on it.`}
                onClick={() => handleLeaveBlank()}
              >
                Leave blank
              </Button>
              {takesTheTime ? (
                <Button
                  variant="ghost"
                  className="text-corp-text-muted"
                  title={`Delete this duty. ${personName(state, takesTheTime.personKey)}'s duty next to it takes the time over.`}
                  onClick={handleDelete}
                >
                  Delete — {personName(state, takesTheTime.personKey).split(" ")[0]} takes it
                </Button>
              ) : null}
            </>
          ) : null}
          {/* Grouped, so on a narrow screen they wrap together and stay on the right. */}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={!canApply}>
              {moving ? "Move" : "Apply"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
