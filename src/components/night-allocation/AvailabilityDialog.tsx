/**
 * When someone is around tonight.
 *
 * Three ways to say it — all night, only between some times, or not between
 * some times — with as many periods as needed. Times can be picked, or typed
 * the way the roster writes them ("1730-1930, 2330-0130"), and a word in front
 * says which way round: "not 1730-1930", "only till 2130".
 *
 * Nothing here refuses. Duties that would fall in time away are listed, and
 * the checks panel and the next generate take it from there.
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
import { Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FIRST_HALF,
  MAX_AVAILABILITY_PERIODS,
  MIN_DUTY_MIN,
  NIGHT_SPAN_MIN,
  SECOND_HALF,
  SLOT_MIN,
  availableSpans,
  awayDuring,
  formatDuration,
  formatPickerLabel,
  formatRange,
  halfWindow,
  isAvailableAt,
  isFixedDuty,
  minutesAvailable,
  normalizeAvailability,
  parseAvailabilityText,
  slotRange,
  tidyPeriods,
  type NightAllocationState,
  type NightPerson,
  type PersonAvailability,
} from "@/domain/night-allocation";

type Mode = "all" | PersonAvailability["mode"];
type Span = [number, number];

const MODES: Array<{ value: Mode; label: string }> = [
  { value: "all", label: "All night" },
  { value: "only", label: "Only between" },
  { value: "except", label: "Not between" },
];

/** One-tap periods: the stretch before the halves, and each half. */
const PRESETS: Array<{ label: string; span: Span }> = [
  { label: formatRange(0, FIRST_HALF[0]), span: [0, FIRST_HALF[0]] },
  { label: `1st Half ${formatRange(FIRST_HALF[0], FIRST_HALF[1])}`, span: [FIRST_HALF[0], FIRST_HALF[1]] },
  { label: `2nd Half ${formatRange(SECOND_HALF[0], SECOND_HALF[1])}`, span: [SECOND_HALF[0], SECOND_HALF[1]] },
];

const START_TIMES = slotRange(0, NIGHT_SPAN_MIN - SLOT_MIN);
const END_TIMES = slotRange(SLOT_MIN, NIGHT_SPAN_MIN);

/** What saving these times would leave to sort out — said before it is saved. */
function consequencesOf(state: NightAllocationState, preview: NightPerson): string[] {
  const lines: string[] = [];
  for (const duty of state.duties) {
    if (duty.personKey !== preview.key || !awayDuring(preview, duty.startMin, duty.endMin).length) continue;
    const range = formatRange(duty.startMin, duty.endMin);
    lines.push(
      isFixedDuty(duty)
        ? `Their DB slot on ${duty.channelCode} ${range} falls in time away — it will need another instructor.`
        : `Their ${duty.channelCode} ${range} falls in time away — generate again, or reassign it.`,
    );
  }
  for (const channel of state.channels) {
    if (channel.inUse && channel.starterKey === preview.key && !isAvailableAt(preview, channel.openAt)) {
      lines.push(`They're set to start ${channel.code}, which opens while they're away. The starter will be cleared.`);
    }
  }
  if (preview.half) {
    const [from, to] = halfWindow(preview.half);
    if (minutesAvailable(preview, from, to) < MIN_DUTY_MIN) {
      lines.push(
        `They're ${preview.half === "1st" ? "1st" : "2nd"} Half but away for nearly all of it (${formatRange(from, to)}).`,
      );
    }
  }
  return lines;
}

interface AvailabilityDialogProps {
  state: NightAllocationState;
  /** Whose times are being edited, or null when the dialog is closed. */
  personKey: string | null;
  onClose: () => void;
  onSave: (personKey: string, availability: PersonAvailability | null) => void;
}

export function AvailabilityDialog({ state, personKey, onClose, onSave }: AvailabilityDialogProps) {
  const person = personKey ? state.people.find(entry => entry.key === personKey) : undefined;
  if (!person) return null;
  // Keyed, so each opening starts from that person's saved times.
  return <AvailabilityEditor key={person.key} state={state} person={person} onClose={onClose} onSave={onSave} />;
}

function AvailabilityEditor({
  state,
  person,
  onClose,
  onSave,
}: {
  state: NightAllocationState;
  person: NightPerson;
  onClose: () => void;
  onSave: AvailabilityDialogProps["onSave"];
}) {
  const saved = person.availability ?? null;
  const [mode, setMode] = useState<Mode>(saved ? saved.mode : "all");
  const [periods, setPeriods] = useState<Span[]>(saved ? tidyPeriods(saved.periods) : []);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<{ problems: string[]; notes: string[] }>({ problems: [], notes: [] });

  const draft = mode === "all" ? null : normalizeAvailability({ mode, periods });
  const preview: NightPerson = { ...person, availability: draft };
  const around = availableSpans(preview);
  const aroundMinutes = around.reduce((sum, [start, end]) => sum + end - start, 0);
  const consequences = person.available ? consequencesOf(state, preview) : [];

  const modeLabel = (value: Mode) => MODES.find(entry => entry.value === value)?.label ?? "";

  const addPeriods = (incoming: Span[], nextMode: PersonAvailability["mode"], notes: string[] = []) => {
    // Periods only make sense one way round: switching which way replaces them.
    const switching = mode !== "all" && mode !== nextMode && periods.length > 0;
    const base = mode === nextMode ? periods : [];
    setMode(nextMode);
    setPeriods(tidyPeriods([...base, ...incoming]).slice(0, MAX_AVAILABILITY_PERIODS));
    setFeedback({
      problems: [],
      notes: switching ? [`Switched to “${modeLabel(nextMode)}”, which replaced the earlier periods.`, ...notes] : notes,
    });
  };

  const addFromText = () => {
    const fallback = mode === "all" ? "except" : mode;
    const parsed = parseAvailabilityText(text, fallback);
    if (parsed.clear) {
      setMode("all");
      setPeriods([]);
      setText("");
      setFeedback({ problems: [], notes: ["Set to all night."] });
      return;
    }
    if (parsed.periods.length) addPeriods(parsed.periods, parsed.mode ?? fallback, parsed.notes);
    if (parsed.problems.length) {
      setFeedback(current => ({ problems: parsed.problems, notes: parsed.periods.length ? current.notes : [] }));
      return;
    }
    setText("");
  };

  const addBlankPeriod = () => {
    const last = periods[periods.length - 1];
    const start = last && last[1] <= NIGHT_SPAN_MIN - 60 ? last[1] + 60 : FIRST_HALF[0];
    const safeStart = Math.min(start, NIGHT_SPAN_MIN - 60);
    setPeriods([...periods, [safeStart, Math.min(NIGHT_SPAN_MIN, safeStart + 120)]]);
    if (mode === "all") setMode("except");
  };

  const updatePeriod = (index: number, which: 0 | 1, value: number) => {
    setPeriods(current =>
      current.map((period, position) => {
        if (position !== index) return period;
        let [start, end] = period;
        if (which === 0) start = value;
        else end = value;
        // Keep it the right way round rather than refusing the pick.
        if (start >= end) {
          if (which === 0) end = Math.min(NIGHT_SPAN_MIN, start + 60);
          else start = Math.max(0, end - 60);
        }
        return [start, end];
      }),
    );
  };

  const canSave = mode === "all" || periods.length > 0;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>When is {person.name} around?</DialogTitle>
          <DialogDescription>
            Tonight runs 13:30 to 01:30. The generator only gives them duties inside the time they're around.
          </DialogDescription>
        </DialogHeader>

        <div
          className="inline-flex w-full overflow-hidden rounded-lg border border-corp-border-soft bg-surface"
          role="group"
          aria-label="Availability"
        >
          {MODES.map(option => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onClick={() => {
                setMode(option.value);
                setFeedback({ problems: [], notes: [] });
              }}
              className={cn(
                "min-h-[38px] flex-1 border-l border-corp-border-soft px-2 text-[0.8rem] font-semibold transition-colors first:border-l-0",
                mode === option.value
                  ? "bg-primary text-primary-foreground"
                  : "text-corp-text-muted hover:bg-elevated",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="availability-quick" className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Type the times
          </Label>
          <div className="flex gap-2">
            <Input
              id="availability-quick"
              value={text}
              onChange={event => setText(event.target.value)}
              onKeyDown={event => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addFromText();
              }}
              placeholder={mode === "only" ? "e.g. 1330-1730, 1930-2130" : "e.g. not 1730-1930, 2330-0130"}
              autoComplete="off"
              className="font-mono"
            />
            <Button type="button" variant="outline" onClick={addFromText} disabled={!text.trim()}>
              Add
            </Button>
          </div>
          <p className="text-[0.72rem] leading-snug text-corp-text-soft">
            Several at once is fine. Start with “not” or “only” to say which way round; “till 2130” and “after
            2330” work too.
          </p>
          {feedback.problems.length || feedback.notes.length ? (
            <ul className="space-y-1" aria-live="polite">
              {feedback.problems.map(problem => (
                <li
                  key={problem}
                  className="rounded-md border border-status-danger/25 bg-status-danger-soft/60 px-2.5 py-1.5 text-[0.78rem] text-corp-text-main"
                >
                  {problem}
                </li>
              ))}
              {feedback.notes.map(note => (
                <li key={note} className="text-[0.74rem] text-corp-text-muted">
                  {note}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {mode !== "all" ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-corp-text-soft">
                {mode === "only" ? "Around only" : "Away"}
              </span>
              <span className="text-[0.7rem] text-corp-text-soft">
                {periods.length}/{MAX_AVAILABILITY_PERIODS}
              </span>
            </div>

            {periods.length ? (
              <ul className="space-y-1.5">
                {periods.map(([start, end], index) => (
                  <li key={`${index}-${start}-${end}`} className="flex items-center gap-1.5">
                    <Select value={String(start)} onValueChange={value => updatePeriod(index, 0, Number(value))}>
                      <SelectTrigger className="h-9 flex-1 font-mono text-[0.8rem] tabular-nums" aria-label="From">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {START_TIMES.map(minute => (
                          <SelectItem key={minute} value={String(minute)} className="font-mono text-[0.8rem]">
                            {formatPickerLabel(minute)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-[0.72rem] text-corp-text-soft">to</span>
                    <Select value={String(end)} onValueChange={value => updatePeriod(index, 1, Number(value))}>
                      <SelectTrigger className="h-9 flex-1 font-mono text-[0.8rem] tabular-nums" aria-label="To">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {END_TIMES.map(minute => (
                          <SelectItem key={minute} value={String(minute)} className="font-mono text-[0.8rem]">
                            {formatPickerLabel(minute)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => setPeriods(current => current.filter((_, position) => position !== index))}
                      aria-label={`Remove ${formatRange(start, end)}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-corp-text-soft transition-colors hover:bg-status-danger-soft hover:text-status-danger"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.78rem] text-corp-text-soft">
                Add a period — type it above, pick one below, or use a shortcut.
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addBlankPeriod}
                disabled={periods.length >= MAX_AVAILABILITY_PERIODS}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add period
              </Button>
              {PRESETS.map(preset => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="font-mono text-[0.74rem]"
                  onClick={() => addPeriods([preset.span], mode)}
                  disabled={periods.length >= MAX_AVAILABILITY_PERIODS}
                >
                  + {preset.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-corp-border-soft bg-elevated/50 px-3 py-2.5 text-[0.8rem] leading-snug">
          {!person.available ? (
            <span className="text-corp-text-muted">
              Marked not available tonight — these times apply once they're switched back on.
            </span>
          ) : around.length ? (
            <span className="text-corp-text-main">
              Around{" "}
              <span className="font-mono tabular-nums">
                {around.map(([start, end]) => formatRange(start, end)).join(", ")}
              </span>{" "}
              <span className="text-corp-text-soft">· {formatDuration(aroundMinutes)}</span>
            </span>
          ) : (
            <span className="text-status-danger">Away the whole night. Mark them not available instead.</span>
          )}
        </div>

        {consequences.length ? (
          <ul className="space-y-1" aria-live="polite">
            {consequences.map(line => (
              <li
                key={line}
                className="rounded-lg border border-status-warning/30 bg-status-warning-soft px-3 py-2 text-[0.8rem] leading-snug text-corp-text-main"
              >
                {line}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!canSave ? (
            <span className="text-[0.74rem] text-corp-text-soft">Add a period, or choose All night.</span>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(person.key, draft);
              onClose();
            }}
            disabled={!canSave}
          >
            Save times
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
