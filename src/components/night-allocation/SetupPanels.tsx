/**
 * The three setup cards beside the board: who is on tonight, the halves, and
 * the positions.
 *
 * Every control here is available to every signed-in person. The current user
 * is used only for the two self-service buttons in Halves — there is no
 * approval step anywhere in this module.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DUTY_LENGTH_CHOICES,
  FIRST_HALF,
  MERGE_SOURCE_CHANNEL,
  MERGE_WINDOW,
  NIGHT_SPAN_MIN,
  SECOND_HALF,
  SLOT_MIN,
  availablePeople,
  canTakeChannel,
  formatDuration,
  formatPickerLabel,
  formatRange,
  minutesOnDuty,
  personShortLabel,
  slotRange,
  type HalfKey,
  type NightAllocationState,
  type NightPerson,
} from "@/domain/night-allocation";
import { HALF_COLORS, channelSwatch, personSwatch, swatchVars } from "./palette";
import { AddPersonPicker } from "./AddPersonPicker";
import { mergeToggle } from "./stateActions";
import type { ShiftCandidate } from "@/data-access/night-allocation.api";

/** A card header that reads as a section, with an optional count on the right. */
function SectionTitle({ title, hint, badge }: { title: string; hint: string; badge?: string }) {
  return (
    <CardHeader className="gap-1 pb-3">
      <div className="flex items-center justify-between gap-3">
        <CardTitle className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-corp-text-muted">
          {title}
        </CardTitle>
        {badge ? (
          <span className="rounded-full bg-elevated px-2 py-0.5 font-mono text-[0.68rem] tabular-nums text-corp-text-muted">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="text-[0.8rem] leading-snug text-corp-text-soft">{hint}</p>
    </CardHeader>
  );
}

// ── Available tonight ───────────────────────────────────────────────────────

interface PeoplePanelProps {
  state: NightAllocationState;
  /** Why the crew list is empty. `null` when the night came from a save. */
  rosterStatus: "missing" | "empty" | "filled" | null;
  onSetAvailability: (personKey: string, available: boolean) => void;
  onSetHalf: (personKey: string, half: HalfKey) => void;
  onToggleTso: (personKey: string) => void;
  onAddFromShift: (candidate: ShiftCandidate) => void;
  onAddPerson: (name: string) => void;
  onRemovePerson: (personKey: string) => void;
}

export function PeoplePanel({
  state,
  rosterStatus,
  onSetAvailability,
  onSetHalf,
  onToggleTso,
  onAddFromShift,
  onAddPerson,
  onRemovePerson,
}: PeoplePanelProps) {
  const available = availablePeople(state).length;

  return (
    <Card className="overflow-hidden border-corp-border-soft bg-surface shadow-sm">
      <SectionTitle
        title="Crew tonight"
        hint="From the night shift roster — whoever is marked on TWR, SMC, CLD, TSO and TWR-A/AIMS."
        badge={state.people.length ? `${available}/${state.people.length}` : undefined}
      />
      <CardContent className="space-y-3 pb-5">
        {state.people.length === 0 ? (
          <p className="rounded-lg border border-status-warning/30 bg-status-warning-soft px-3 py-2.5 text-[0.82rem] leading-snug text-corp-text-main">
            {/* The two empty cases call for different things, so say which. */}
            {rosterStatus === "missing"
              ? "The shift roster has no night rows for this date yet. Add whoever is on tonight's shift below, or sync the roster."
              : rosterStatus === "empty"
                ? "The night shift roster for this date has nobody on TWR, SMC, CLD, TSO or TWR-A/AIMS. Add the crew from tonight's shift below."
                : "Nobody is on tonight's list yet. Add the crew from tonight's shift below."}
          </p>
        ) : null}

        <ul className="-mx-1 divide-y divide-corp-border-soft">
          {state.people.map(person => (
            <PersonRow
              key={person.key}
              state={state}
              person={person}
              onSetAvailability={onSetAvailability}
              onSetHalf={onSetHalf}
              onToggleTso={onToggleTso}
              onRemovePerson={onRemovePerson}
            />
          ))}
        </ul>

        <AddPersonPicker
          nightDate={state.nightDate}
          existingKeys={state.people.map(person => person.key)}
          onAddFromShift={onAddFromShift}
          onAddByName={onAddPerson}
        />
      </CardContent>
    </Card>
  );
}

function PersonRow({
  state,
  person,
  onSetAvailability,
  onSetHalf,
  onToggleTso,
  onRemovePerson,
}: {
  state: NightAllocationState;
  person: NightPerson;
} & Omit<PeoplePanelProps, "state" | "rosterStatus" | "onAddPerson" | "onAddFromShift">) {
  const swatch = personSwatch(person.colorIndex);
  const minutes = minutesOnDuty(state, person.key);
  const starts = state.channels
    .filter(channel => channel.inUse && channel.starterKey === person.key)
    .map(channel => channel.code);

  return (
    <li className={cn("px-1 py-2.5 transition-opacity", !person.available && "opacity-55")}>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          style={swatchVars(swatch)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-black/[0.06] bg-[var(--strip-fill)] font-mono text-[0.68rem] font-bold text-[color:var(--strip-text)] dark:border-white/[0.08] dark:bg-[var(--strip-fill-dark)] dark:text-[color:var(--strip-text-dark)]"
        >
          {personShortLabel(person)}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-[0.86rem] font-medium leading-tight text-corp-text-main",
              !person.available && "line-through",
            )}
          >
            {person.name}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {/* `role` carries the night-grid position for seeded people. */}
            {person.role && person.role !== "Employee" ? (
              <span className="rounded bg-elevated px-1.5 py-px text-[0.65rem] font-medium text-corp-text-muted">
                {person.role}
              </span>
            ) : null}
            {minutes ? (
              <span className="font-mono text-[0.65rem] tabular-nums text-corp-text-soft">
                {formatDuration(minutes)}
              </span>
            ) : null}
            {starts.length ? (
              <span className="text-[0.65rem] text-corp-text-soft">starts {starts.join(", ")}</span>
            ) : null}
          </span>
        </span>

        <Switch
          checked={person.available}
          onCheckedChange={checked => onSetAvailability(person.key, checked === true)}
          aria-label={`${person.name} available tonight`}
        />

        {person.manual ? (
          <button
            type="button"
            onClick={() => onRemovePerson(person.key)}
            aria-label={`Remove ${person.name} from tonight's shift`}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-corp-text-soft transition-colors hover:bg-status-danger-soft hover:text-status-danger"
          >
            <span aria-hidden className="text-sm leading-none">×</span>
          </button>
        ) : null}
      </div>

      {person.available ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[2.625rem]">
          <span
            className="inline-flex overflow-hidden rounded-lg border border-corp-border-soft bg-surface"
            role="group"
            aria-label={`Half for ${person.name}`}
          >
            {([null, "1st", "2nd"] as HalfKey[]).map(half => {
              const active = person.half === half;
              const tint =
                half === "1st" ? HALF_COLORS.first.text : half === "2nd" ? HALF_COLORS.second.text : "#334155";
              return (
                <button
                  key={half ?? "none"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSetHalf(person.key, half)}
                  style={active ? { background: tint } : undefined}
                  className={cn(
                    "min-h-[34px] min-w-[46px] border-l border-corp-border-soft px-2.5 text-[0.76rem] font-semibold transition-colors first:border-l-0",
                    active ? "text-white" : "text-corp-text-muted hover:bg-elevated",
                  )}
                >
                  {half === null ? "None" : half === "1st" ? "1st" : "2nd"}
                </button>
              );
            })}
          </span>

          <button
            type="button"
            aria-pressed={person.canTakeTso}
            aria-label={`${person.name} can take TSO`}
            onClick={() => onToggleTso(person.key)}
            style={person.canTakeTso ? { background: HALF_COLORS.second.text } : undefined}
            className={cn(
              "min-h-[34px] rounded-lg border px-3 text-[0.76rem] font-semibold transition-colors",
              person.canTakeTso
                ? "border-transparent text-white"
                : "border-corp-border-soft text-corp-text-muted hover:bg-elevated",
            )}
          >
            {person.canTakeTso ? "✓ TSO" : "TSO"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

// ── Halves ──────────────────────────────────────────────────────────────────

export function HalvesPanel({
  state,
  currentPersonKey,
  onSetHalf,
}: {
  state: NightAllocationState;
  /** The signed-in person, when they are on tonight's list. */
  currentPersonKey: string | null;
  onSetHalf: (personKey: string, half: HalfKey) => void;
}) {
  const me = currentPersonKey ? state.people.find(person => person.key === currentPersonKey) : undefined;

  const renderHalf = (half: Exclude<HalfKey, null>) => {
    const window = half === "1st" ? FIRST_HALF : SECOND_HALF;
    const colors = half === "1st" ? HALF_COLORS.first : HALF_COLORS.second;
    const members = state.people.filter(person => person.half === half);
    const label = half === "1st" ? "1st Half" : "2nd Half";

    const buttonText = !me
      ? null
      : !me.available
        ? "Mark yourself available to join a half"
        : me.half === half
          ? `Remove me from ${label}`
          : me.half === null
            ? `Add me to ${label}`
            : `Move me to ${label}`;

    return (
      <div className="rounded-lg border border-corp-border-soft bg-elevated/50 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[0.82rem] font-semibold" style={{ color: colors.text }}>
            <span className="dark:hidden">{label}</span>
            <span className="hidden dark:inline" style={{ color: colors.textDark }}>
              {label}
            </span>
          </span>
          <span className="font-mono text-[0.68rem] tabular-nums text-corp-text-soft">
            {formatRange(window[0], window[1])}
          </span>
        </div>
        <p
          className={cn(
            "mt-1 text-[0.82rem] leading-snug",
            members.length ? "text-corp-text-main" : "text-corp-text-soft",
          )}
        >
          {members.length ? members.map(person => person.name).join(", ") : "Nobody yet"}
        </p>
        {buttonText ? (
          <Button
            variant="link"
            className="mt-1 h-auto p-0 text-[0.78rem]"
            disabled={!me?.available}
            onClick={() => onSetHalf(me!.key, me!.half === half ? null : half)}
          >
            {buttonText}
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <Card className="overflow-hidden border-corp-border-soft bg-surface shadow-sm">
      <SectionTitle
        title="Halves"
        hint="Optional. Nobody can be in both, and everyone in a half needs a duty inside it."
      />
      <CardContent className="space-y-2.5 pb-5">
        {renderHalf("1st")}
        {renderHalf("2nd")}
      </CardContent>
    </Card>
  );
}

// ── Channels ────────────────────────────────────────────────────────────────

interface ChannelsPanelProps {
  state: NightAllocationState;
  generating: boolean;
  generateArmed: boolean;
  generateNote: { text: string; reasons: string[]; tone: "neutral" | "error" } | null;
  onSetInUse: (code: string, inUse: boolean) => void;
  onSetWindow: (code: string, value: number, moved: "open" | "close") => void;
  onSetStarter: (code: string, starterKey: string | null) => void;
  onSetDutyLength: (minutes: number) => void;
  onSetMerge: (merged: boolean) => void;
  onGenerate: () => void;
}

const NO_STARTER = "__none__";

export function ChannelsPanel({
  state,
  generating,
  generateArmed,
  generateNote,
  onSetInUse,
  onSetWindow,
  onSetStarter,
  onSetDutyLength,
  onSetMerge,
  onGenerate,
}: ChannelsPanelProps) {
  const openTimes = slotRange(0, NIGHT_SPAN_MIN - SLOT_MIN);
  const closeTimes = slotRange(SLOT_MIN, NIGHT_SPAN_MIN);
  const inUse = state.channels.filter(channel => channel.inUse).length;
  const merge = mergeToggle(state);

  return (
    <Card className="overflow-hidden border-corp-border-soft bg-surface shadow-sm">
      <SectionTitle
        title="Positions"
        hint="Untick one that isn't needed. Set when it's open and who takes the first duty."
        badge={`${inUse}/${state.channels.length}`}
      />
      <CardContent className="space-y-4 pb-5">
        <div className="divide-y divide-corp-border-soft">
          {state.channels.map(channel => {
            const swatch = channelSwatch(channel.code);
            const eligible = availablePeople(state).filter(person => canTakeChannel(person, channel.code));
            // Someone who has stopped being eligible — marked unavailable, or
            // had their TSO flag turned off — stays listed while they are still
            // the chosen starter, so the select never goes silently blank.
            const currentStarter = channel.starterKey
              ? state.people.find(person => person.key === channel.starterKey)
              : undefined;
            const starterOptions =
              currentStarter && !eligible.some(person => person.key === currentStarter.key)
                ? [...eligible, currentStarter]
                : eligible;

            return (
              <div key={channel.code} className={cn("py-3", !channel.inUse && "opacity-55")}>
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-6 w-1 shrink-0 rounded-full"
                    style={{ background: channel.inUse ? swatch.edge : "var(--corp-border-strong)" }}
                  />
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={channel.inUse}
                      onCheckedChange={checked => onSetInUse(channel.code, checked === true)}
                      aria-label={`${channel.code} in use tonight`}
                    />
                    <span
                      className={cn(
                        "truncate text-[0.88rem] font-semibold tracking-tight text-corp-text-main",
                        !channel.inUse && "line-through",
                      )}
                    >
                      {channel.code}
                    </span>
                  </label>
                  {!channel.inUse ? (
                    <span className="text-[0.72rem] text-corp-text-soft">Not needed</span>
                  ) : null}
                </div>

                {channel.inUse ? (
                  <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 pl-[1.375rem]">
                    <span className="text-[0.7rem] uppercase tracking-wide text-corp-text-soft">Open</span>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={String(channel.openAt)}
                        onValueChange={value => onSetWindow(channel.code, Number(value), "open")}
                      >
                        <SelectTrigger className="h-9 flex-1 font-mono text-[0.78rem] tabular-nums" aria-label={`${channel.code} opens`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {openTimes.map(minute => (
                            <SelectItem key={minute} value={String(minute)} className="font-mono text-[0.8rem]">
                              {formatPickerLabel(minute)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-[0.72rem] text-corp-text-soft">to</span>
                      <Select
                        value={String(channel.closeAt)}
                        onValueChange={value => onSetWindow(channel.code, Number(value), "close")}
                      >
                        <SelectTrigger className="h-9 flex-1 font-mono text-[0.78rem] tabular-nums" aria-label={`${channel.code} closes`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {closeTimes.map(minute => (
                            <SelectItem key={minute} value={String(minute)} className="font-mono text-[0.8rem]">
                              {formatPickerLabel(minute)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <span className="text-[0.7rem] uppercase tracking-wide text-corp-text-soft">Starts</span>
                    <Select
                      value={channel.starterKey ?? NO_STARTER}
                      onValueChange={value => onSetStarter(channel.code, value === NO_STARTER ? null : value)}
                    >
                      <SelectTrigger className="h-9 text-[0.8rem]" aria-label={`Who starts ${channel.code}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value={NO_STARTER}>
                          {eligible.length ? "Select person" : `Nobody can take ${channel.code} yet`}
                        </SelectItem>
                        {starterOptions.map(person => (
                          <SelectItem key={person.key} value={person.key}>
                            {person.name}
                            {!person.available
                              ? " (not available)"
                              : !canTakeChannel(person, channel.code)
                                ? " (not set for TSO)"
                                : person.half === "1st"
                                  ? " (1st Half)"
                                  : person.half === "2nd"
                                    ? " (2nd Half)"
                                    : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <label className="flex items-start justify-between gap-3 rounded-lg border border-corp-border-soft bg-elevated/50 p-3">
          <span className="min-w-0">
            <span className="block text-[0.8rem] font-medium text-corp-text-main">
              Merge {MERGE_SOURCE_CHANNEL} into {merge.targetCode ?? "SMC"}
            </span>
            <span className="mt-0.5 block text-[0.72rem] leading-snug text-corp-text-soft">
              {formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1])} — one person holds both. For a 1st Half too thin
              to work them apart.
            </span>
          </span>
          <Switch
            checked={merge.on}
            disabled={!merge.enabled}
            onCheckedChange={checked => onSetMerge(checked === true)}
            aria-label={`Merge ${MERGE_SOURCE_CHANNEL} into ${merge.targetCode ?? "SMC"}`}
          />
        </label>

        <div className="space-y-2 rounded-lg border border-corp-border-soft bg-elevated/50 p-3">
          <Label htmlFor="night-duty-length" className="text-[0.7rem] uppercase tracking-wide text-corp-text-soft">
            Usual duty length
          </Label>
          <Select value={String(state.dutyLengthPref)} onValueChange={value => onSetDutyLength(Number(value))}>
            <SelectTrigger id="night-duty-length" className="h-9 w-full text-[0.82rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DUTY_LENGTH_CHOICES.map(minutes => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes === 0 ? "Auto — fitted to staffing" : formatDuration(minutes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[0.72rem] leading-snug text-corp-text-soft">
            Duties run 30 min to 2 h — except TSO, which has no maximum. The generator aims for 1 h, 1 h 30 m or
            2 h, and uses 30 or 45 min only when nothing longer keeps every position covered.
          </p>

          <Button className="mt-1 w-full" onClick={onGenerate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Working out handovers…
              </>
            ) : generateArmed ? (
              "Replace current allocation"
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate allocation
              </>
            )}
          </Button>
        </div>

        {generateNote ? (
          <div
            role="status"
            className={cn(
              "rounded-lg border px-3 py-2.5 text-[0.8rem] leading-snug",
              generateNote.tone === "error"
                ? "border-status-danger/30 bg-status-danger-soft text-corp-text-main"
                : "border-corp-border-soft bg-elevated/60 text-corp-text-muted",
            )}
          >
            <p className={cn(generateNote.tone === "error" && "font-medium")}>{generateNote.text}</p>
            {generateNote.reasons.length ? (
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                {generateNote.reasons.map(reason => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
