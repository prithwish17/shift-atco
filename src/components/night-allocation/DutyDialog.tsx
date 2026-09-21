/**
 * The duty editor.
 *
 * Handovers are linked, so this dialog never edits one duty in isolation: it
 * previews the whole chain, lists what the change would break, and keeps Apply
 * disabled until nothing is broken. A refused change leaves the board alone.
 *
 * The channel of an existing duty is locked. Moving a duty to another position
 * would empty the one it came from; the way to change the other position is to
 * edit the duty that is on it.
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
import { CheckCircle2, ChevronDown } from "lucide-react";
import {
  MIN_DUTY_MIN,
  NIGHT_SPAN_MIN,
  SLOT_MIN,
  applyDutyChange,
  availablePeople,
  canTakeChannel,
  deleteDuty,
  findChannel,
  findPerson,
  formatDuration,
  isRefusedEdit,
  isUncappedChannel,
  formatMinutes,
  formatPickerLabel,
  neighboursOf,
  previewDutyChange,
  slotRange,
  splitDuty,
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
  const [refusal, setRefusal] = useState<string[]>([]);

  useEffect(() => {
    setWorking(draft ? { ...draft.duty } : null);
    setSplitAt(null);
    setSplitPerson("");
    setRefusal([]);
  }, [draft]);

  const original = useMemo(
    () => (draft && !draft.isNew ? state.duties.find(duty => duty.id === draft.duty.id) ?? null : null),
    [draft, state.duties],
  );

  const preview = useMemo(
    () => (working ? previewDutyChange(state, original, working) : { duties: [], problems: [], unresolved: [] }),
    [state, original, working],
  );

  if (!draft || !working) return null;

  const channel = findChannel(state, working.channelCode);
  const neighbours = original ? neighboursOf(state.duties, original) : { previous: undefined, next: undefined };
  const length = working.endMin - working.startMin;

  const problems = working.personKey ? preview.problems : ["Select a person."];
  const canApply = problems.length === 0;

  const peopleForChannel = state.people.filter(
    person => (person.available && canTakeChannel(person, working.channelCode)) || person.key === working.personKey,
  );
  const channelOptions = state.channels.filter(entry => entry.inUse || entry.code === working.channelCode);

  const takesOverFrom = neighbours.previous
    ? `Takes over from ${findPerson(state, neighbours.previous.personKey)?.name ?? "someone"} at ${formatMinutes(working.startMin)}.`
    : channel && working.startMin === channel.openAt
      ? `Opens ${working.channelCode} at ${formatMinutes(working.startMin)}.`
      : `Starts at ${formatMinutes(working.startMin)}.`;
  const handsOverTo = neighbours.next
    ? `Hands over to ${findPerson(state, neighbours.next.personKey)?.name ?? "someone"} at ${formatMinutes(working.endMin)}.`
    : channel && working.endMin === channel.closeAt
      ? `Covers ${working.channelCode} until it closes at ${formatMinutes(working.endMin)}.`
      : `Ends at ${formatMinutes(working.endMin)}.`;

  // The first duty's start and the last duty's end belong to the channel's own
  // open and close times, so they are not editable here.
  const startPinned = !!(original && !neighbours.previous && channel && original.startMin === channel.openAt);
  const endPinned = !!(original && !neighbours.next && channel && original.endMin === channel.closeAt);

  const canSplit = !!original && length >= 2 * MIN_DUTY_MIN;
  const splitTimes = canSplit
    ? slotRange(working.startMin + MIN_DUTY_MIN, working.endMin - MIN_DUTY_MIN)
    : [];
  const splitCandidates = availablePeople(state).filter(
    person => person.key !== working.personKey && canTakeChannel(person, working.channelCode),
  );

  const handleApply = () => {
    const result = applyDutyChange(state, working, original?.id ?? null);
    if (isRefusedEdit(result)) {
      setRefusal(result.problems);
      return;
    }
    onApply(result.state);
    onClose();
  };

  const handleDelete = () => {
    if (!original) return;
    const result = deleteDuty(state, original.id);
    if (isRefusedEdit(result)) {
      setRefusal(result.problems);
      return;
    }
    onApply(result.state, result.note);
    onClose();
  };

  const handleSplit = () => {
    if (!original) return;
    const at = splitAt ?? splitTimes[Math.floor(splitTimes.length / 2)];
    const result = splitDuty(state, original.id, at, splitPerson);
    if (isRefusedEdit(result)) {
      setRefusal(result.problems);
      return;
    }
    onApply(result.state, result.note);
    onClose();
  };

  const shown = refusal.length ? refusal : problems;
  // Problems these duties already had. They don't block the change — fixing
  // one of two broken duties side by side has to be possible — but the dialog
  // must not call them "no conflicts" either.
  const unresolved = refusal.length || !working.personKey ? [] : preview.unresolved;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{original ? `Change ${working.channelCode} duty` : "Add duty"}</DialogTitle>
          <DialogDescription>
            Handover times are linked: changing one end moves the duty next to it, so the position stays covered.
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
                {peopleForChannel.map(person => (
                  <SelectItem key={person.key} value={person.key}>
                    {person.name}
                    {!person.available
                      ? " (not available)"
                      : !canTakeChannel(person, working.channelCode)
                        ? " (not set for TSO)"
                        : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duty-channel">Channel</Label>
            <Select
              value={working.channelCode}
              disabled={!!original}
              onValueChange={value => {
                setRefusal([]);
                setWorking({ ...working, channelCode: value });
              }}
            >
              <SelectTrigger
                id="duty-channel"
                title={original ? "To use a different channel, change the duty on that channel instead." : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channelOptions.map(entry => (
                  <SelectItem key={entry.code} value={entry.code}>
                    {entry.code}
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
          <p className="mt-1 text-[0.78rem] leading-snug text-corp-text-muted">{`${takesOverFrom} ${handsOverTo}`}</p>
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
          {shown.length || unresolved.length ? null : (
            <li className="flex items-center gap-2 text-[0.82rem] font-medium text-status-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              No conflicts. The position stays continuous.
            </li>
          )}
        </ul>

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

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {original ? (
            <Button variant="outline" className="text-status-danger hover:text-status-danger" onClick={handleDelete}>
              Delete duty
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!canApply}>
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
