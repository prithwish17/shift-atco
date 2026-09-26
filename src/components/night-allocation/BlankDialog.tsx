/**
 * Filling a blank.
 *
 * A blank is a stretch of a position left with nobody on it on purpose. This
 * puts someone on it — all of it, or part of it, in which case the rest stays
 * blank — or hands the time to the duty next to it, which is how a blank is
 * taken back off the board. Like the duty editor, it previews what the change
 * would break and keeps the button disabled until nothing is.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2 } from "lucide-react";
import {
  SLOT_MIN,
  absorbingNeighbour,
  awayDuring,
  canTakeChannel,
  deleteDuty,
  dutiesOf,
  fillBlank,
  formatDuration,
  formatPickerLabel,
  formatRange,
  isRefusedEdit,
  overlaps,
  personName,
  previewFillBlank,
  slotRange,
  type EditResult,
  type NightAllocationState,
  type NightDuty,
} from "@/domain/night-allocation";

interface BlankDialogProps {
  state: NightAllocationState;
  /** The blank being filled, or null when the dialog is closed. */
  blank: NightDuty | null;
  onClose: () => void;
  onApply: (next: NightAllocationState, note?: string) => void;
}

/** What the dialog is filling in, for the blank it was opened on. */
interface FillForm {
  blankId: string | null;
  personKey: string;
  startMin: number;
  endMin: number;
  refusal: string[];
}

const EMPTY_FORM: FillForm = { blankId: null, personKey: "", startMin: 0, endMin: 0, refusal: [] };

export function BlankDialog({ state, blank, onClose, onApply }: BlankDialogProps) {
  const [form, setForm] = useState<FillForm>(EMPTY_FORM);
  // A form left over from another blank is never shown, not even for a frame:
  // until it is edited, the dialog reads the whole of the blank it is on.
  const current: FillForm =
    blank && form.blankId !== blank.id
      ? { blankId: blank.id, personKey: "", startMin: blank.startMin, endMin: blank.endMin, refusal: [] }
      : form;
  const { personKey, startMin, endMin, refusal } = current;
  const edit = (change: Partial<FillForm>) => setForm({ ...current, refusal: [], ...change });

  const preview = useMemo(
    () => (blank ? previewFillBlank(state, blank.id, personKey, startMin, endMin) : null),
    [state, blank, personKey, startMin, endMin],
  );

  if (!blank || !preview) return null;

  const range = formatRange(blank.startMin, blank.endMin);
  const partial = startMin > blank.startMin || endMin < blank.endMin;
  const people = state.people.filter(person => person.available && canTakeChannel(person, blank.channelCode));
  const takesTheTime = absorbingNeighbour(state.duties, blank);

  const problems = refusal.length ? refusal : personKey ? preview.problems : [];
  const preferences = refusal.length || !personKey ? [] : preview.preferences;
  const unresolved = refusal.length || !personKey ? [] : preview.unresolved;

  // Closed is closed: opening the same blank again starts from the whole of it.
  const close = () => {
    setForm(EMPTY_FORM);
    onClose();
  };

  const finish = (result: EditResult) => {
    if (isRefusedEdit(result)) {
      setForm({ ...current, refusal: result.problems });
      return;
    }
    onApply(result.state, result.note);
    close();
  };

  return (
    <Dialog open onOpenChange={open => !open && close()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Fill blank on {blank.channelCode}</DialogTitle>
          <DialogDescription>
            Nobody is on {blank.channelCode} {range}. Put someone on all of it, or on part of it — the rest stays
            blank.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="blank-person">Person</Label>
            <Select
              value={personKey}
              onValueChange={value => edit({ personKey: value })}
            >
              <SelectTrigger id="blank-person">
                <SelectValue placeholder="Select person" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {people.map(person => {
                  const away = awayDuring(person, startMin, endMin);
                  const busy = dutiesOf(state, person.key).find(duty => overlaps(duty, startMin, endMin));
                  return (
                    <SelectItem key={person.key} value={person.key}>
                      {person.name}
                      {away.length
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
            <Label htmlFor="blank-start">From</Label>
            <Select
              value={String(startMin)}
              onValueChange={value => {
                const next = Number(value);
                edit({ startMin: next, endMin: endMin <= next ? Math.min(blank.endMin, next + SLOT_MIN) : endMin });
              }}
            >
              <SelectTrigger id="blank-start">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {slotRange(blank.startMin, blank.endMin - SLOT_MIN).map(minute => (
                  <SelectItem key={minute} value={String(minute)}>
                    {formatPickerLabel(minute)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="blank-end">To</Label>
            <Select
              value={String(endMin)}
              onValueChange={value => edit({ endMin: Number(value) })}
            >
              <SelectTrigger id="blank-end">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {slotRange(startMin + SLOT_MIN, blank.endMin).map(minute => (
                  <SelectItem key={minute} value={String(minute)}>
                    {formatPickerLabel(minute)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="rounded-lg border border-corp-border-soft bg-elevated/50 px-3 py-2.5 text-[0.78rem] leading-snug text-corp-text-muted">
          <span className="font-mono tabular-nums text-corp-text-main">{formatDuration(endMin - startMin)}</span>{" "}
          {partial
            ? `on ${blank.channelCode} ${formatRange(startMin, endMin)}; the rest of ${range} stays blank.`
            : `on ${blank.channelCode}, the whole blank.`}
        </p>

        <ul aria-live="polite" className="space-y-1 text-sm">
          {problems.map(problem => (
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
          {personKey && !problems.length && !unresolved.length ? (
            <li className="flex items-center gap-2 text-[0.82rem] font-medium text-status-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              No conflicts.
            </li>
          ) : null}
        </ul>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {takesTheTime ? (
            <Button
              variant="ghost"
              className="text-corp-text-muted"
              title={`Remove the blank. ${personName(state, takesTheTime.personKey)}'s duty next to it takes the time over.`}
              onClick={() => finish(deleteDuty(state, blank.id))}
            >
              Give it to {personName(state, takesTheTime.personKey).split(" ")[0]}
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => finish(fillBlank(state, blank.id, personKey, startMin, endMin))}
              disabled={!personKey || problems.length > 0}
            >
              Put on
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
