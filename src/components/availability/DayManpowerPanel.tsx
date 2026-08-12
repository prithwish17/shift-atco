/**
 * DayManpowerPanel
 * ---------------------------------------------------------------------------
 * The Daily Availability Chart column for one date — all three shifts, every rating
 * group — plus the day's extra-duty, General, leave and rest populations.
 *
 * The finder used to show only the shift being filled. That is half the decision:
 * every plan that covers a shift takes the body off another one, and a supervisor
 * cannot judge whether that is wise without seeing where it comes from. The donor
 * shift is right here, next to the target, with its own margin.
 */
import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DayManpower, ManpowerCell, RosterEntry, ShiftManpower } from "@/lib/compliance/manpower";
import type { ShiftCode } from "@/lib/compliance/rosterState";

/** Rose when short, amber when sitting exactly on the minimum, emerald when spare. */
function cellTone(cell: Pick<ManpowerCell, "deficit" | "net">) {
  if (cell.deficit > 0) return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (cell.net === 0) return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

/** `+3`, `0` or `−2` — the margin, in the sign convention the chart uses. */
function netLabel(net: number) {
  if (net > 0) return `+${net}`;
  if (net < 0) return `−${Math.abs(net)}`;
  return "0";
}

function ShiftColumn({
  shift,
  projected,
  highlighted,
}: {
  shift: ShiftManpower;
  projected?: ShiftManpower;
  highlighted: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        highlighted ? "border-primary/60 bg-primary/[0.04] ring-1 ring-primary/30" : "bg-card",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {shift.label}
          {highlighted && (
            <Badge variant="default" className="h-4 px-1.5 text-[10px] leading-none">
              filling
            </Badge>
          )}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {shift.headcount} on duty
          {shift.extraDuty.length > 0 && ` · ${shift.extraDuty.length} OPE`}
        </span>
      </div>

      <div className="space-y-1">
        {shift.cells.map((cell, index) => {
          const after = projected?.cells[index];
          const moved = after && after.available !== cell.available;
          return (
            <div
              key={cell.group}
              className={cn("flex items-center justify-between rounded border px-2 py-1", cellTone(after ?? cell))}
            >
              <span className="text-xs font-medium">{cell.label}</span>
              <span className="flex items-baseline gap-1.5 text-xs tabular-nums">
                {moved && <span className="text-muted-foreground line-through">{cell.available}</span>}
                <span className="font-semibold">{(after ?? cell).available}</span>
                <span className="opacity-60">/{cell.required}</span>
                <span className="w-6 text-right font-medium">{netLabel((after ?? cell).net)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RosterList({ entries }: { entries: RosterEntry[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-2">
      {entries.map((entry) => (
        <span
          key={entry.employeeId}
          className="inline-flex items-center gap-1.5 rounded border bg-muted/40 px-1.5 py-0.5 text-xs"
        >
          <span className="font-medium">{entry.name}</span>
          {entry.rating && <span className="text-muted-foreground">{entry.rating}</span>}
          <span className="rounded bg-background px-1 font-mono text-[10px]">{entry.dutyCode ?? "—"}</span>
        </span>
      ))}
    </div>
  );
}

function PopulationChip({
  label,
  entries,
  tone,
}: {
  label: string;
  entries: RosterEntry[];
  tone?: string;
}) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
        {label} <span className="font-semibold tabular-nums">0</span>
      </span>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-auto gap-1.5 px-2 py-1 text-xs font-normal", tone)}
        >
          {label}
          <span className="font-semibold tabular-nums">{entries.length}</span>
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <RosterList entries={entries} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DayManpowerPanel({
  day,
  projected,
  focusShift,
}: {
  day: DayManpower;
  /** The same day with the picks accepted in this sitting folded in. */
  projected?: DayManpower | null;
  focusShift: ShiftCode;
}) {
  if (!day.rostered) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
        No roster published for this date — every group reads as zero, so the minimums are
        not meaningful yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {day.shifts.map((shift) => (
          <ShiftColumn
            key={shift.shift}
            shift={shift}
            projected={projected?.byShift[shift.shift]}
            highlighted={shift.shift === focusShift}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {day.totals.rostered} rostered
        </span>
        <PopulationChip
          label="Extra duty (OPE)"
          entries={day.extraDuty}
          // The outline button variant hovers to `accent-foreground` (white here),
          // so the hover colour has to be restated or the label vanishes on hover.
          tone={cn(
            "border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20",
            "text-violet-700 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-300",
          )}
        />
        <PopulationChip label="General" entries={day.general} />
        <PopulationChip label="On leave" entries={day.onLeave} />
        <PopulationChip label="Resting" entries={day.resting} />
      </div>
    </div>
  );
}
