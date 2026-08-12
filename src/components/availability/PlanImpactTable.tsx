/**
 * PlanImpactTable
 * ---------------------------------------------------------------------------
 * What a cover plan does to the availability chart, both directions, per rating
 * group: the cell it reinforces and — the point of the whole thing — every cell it
 * takes a body OUT of, with that cell's own minimum and what is left after.
 *
 * "Removing them drops RSR Morning to 11 (minimum 12)" is the sentence the gate
 * blocks on. Showing the arithmetic even when it passes is what makes the gate
 * trustworthy: the supervisor sees the Morning was checked and held, not just that
 * nothing objected.
 */
import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, CheckCircle2, ShieldAlert, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CellImpact, ImpactStatus, PlanImpact } from "@/lib/compliance/manpower";

const STATUS_TONE: Record<ImpactStatus, string> = {
  breach: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "at-minimum": "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  surplus: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

function releaseNote(cell: CellImpact): string {
  if (cell.status === "breach") return `${Math.abs(cell.headroomAfter)} below minimum`;
  if (cell.status === "at-minimum") return "exactly at minimum";
  return `${cell.headroomAfter} spare`;
}

function ImpactRow({ cell, direction }: { cell: CellImpact; direction: "release" | "reinforce" }) {
  const Icon = direction === "release" ? ArrowDown : ArrowUp;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded border px-2 py-1 text-xs",
        direction === "release" ? STATUS_TONE[cell.status] : STATUS_TONE.surplus,
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="font-medium">
          {cell.label} · {cell.shiftLabel}
        </span>
        <span className="opacity-70">{format(parseISO(cell.date), "d MMM")}</span>
      </span>
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className="opacity-70">{cell.before}</span>
        <span aria-hidden>→</span>
        <span className="font-semibold">{cell.after}</span>
        <span className="opacity-70">/ min {cell.required}</span>
        {direction === "release" && <span className="opacity-80">· {releaseNote(cell)}</span>}
      </span>
    </div>
  );
}

/** Badge summarising how much room the plan leaves in its most stretched donor. */
export function SafetyMarginBadge({ impact }: { impact: PlanImpact }) {
  if (impact.breaches.length > 0) {
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldAlert className="h-3 w-3" />
        Breaks {impact.breaches.length === 1 ? "a minimum" : `${impact.breaches.length} minimums`}
      </Badge>
    );
  }

  if (impact.safetyMargin === null) {
    return (
      <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        Takes nobody off another shift
      </Badge>
    );
  }

  if (impact.safetyMargin === 0) {
    return (
      <Badge className="gap-1 border-amber-500/40 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300">
        <TriangleAlert className="h-3 w-3" />
        Source shift left at exactly its minimum
      </Badge>
    );
  }

  return (
    <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
      <CheckCircle2 className="h-3 w-3" />
      {impact.safetyMargin} spare in the source shift
    </Badge>
  );
}

export function PlanImpactTable({ impact }: { impact: PlanImpact }) {
  const hasRows = impact.releases.length > 0 || impact.reinforcements.length > 0;
  if (!hasRows) {
    return <p className="text-xs text-muted-foreground">No rating group changes head-count.</p>;
  }

  return (
    <div className="space-y-1">
      {impact.reinforcements.map((cell) => (
        <ImpactRow key={`in-${cell.cell}`} cell={cell} direction="reinforce" />
      ))}
      {impact.releases.map((cell) => (
        <ImpactRow key={`out-${cell.cell}`} cell={cell} direction="release" />
      ))}
      {impact.releases.length === 0 && (
        <p className="pt-0.5 text-xs text-muted-foreground">
          Nothing is taken from another shift — no source minimum is at risk.
        </p>
      )}
    </div>
  );
}
