/**
 * CoverBasket
 * ---------------------------------------------------------------------------
 * The staged picks, their combined effect on the chart, and the one button that
 * writes them.
 *
 * The combined view is the reason this exists. Two picks that each leave a shift
 * exactly on its minimum are individually legal and jointly a breach; read one row
 * at a time that is invisible, so the basket leads with the total and puts the
 * per-pick rows underneath it.
 */
import { format, parseISO } from "date-fns";
import { AlertTriangle, ArrowRight, Loader2, ShoppingBasket, Trash2, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlanImpactTable, SafetyMarginBadge } from "@/components/availability/PlanImpactTable";
import type { BasketPick, BasketValidation } from "@/lib/compliance/basket";
import { SHIFT_LABEL } from "@/lib/compliance/manpower";

function PickRow({
  pick,
  index,
  onRemove,
  disabled,
}: {
  pick: BasketPick;
  index: number;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="tabular-nums">
            {index + 1}
          </Badge>
          <span className="font-medium">{pick.name}</span>
          <Badge variant="outline">{pick.strategyLabel}</Badge>
          {pick.createsOpe && (
            <Badge className="border-violet-500/40 bg-violet-500/15 text-violet-700 hover:bg-violet-500/15 dark:text-violet-300">
              Extra duty (OPE)
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            covers {SHIFT_LABEL[pick.targetShift]} · {format(parseISO(pick.targetDate), "d MMM")}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {pick.mutations.map((m) => (
            <span
              key={`${m.date}-${m.to}`}
              className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-xs"
            >
              <span className="text-muted-foreground">{format(parseISO(m.date), "d MMM")}</span>
              <span className="font-mono">{m.from ?? "—"}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono font-semibold">{m.to}</span>
            </span>
          ))}
          <SafetyMarginBadge impact={pick.impact} />
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 self-start text-muted-foreground hover:text-foreground"
        onClick={() => onRemove(pick.id)}
        disabled={disabled}
        aria-label={`Remove ${pick.name} from the basket`}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function CoverBasket({
  picks,
  validation,
  committing,
  onRemove,
  onClear,
  onCommit,
}: {
  picks: BasketPick[];
  /** Combined re-check against the live roster; null while the roster is loading. */
  validation: BasketValidation | null;
  committing: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onCommit: () => void;
}) {
  if (picks.length === 0) return null;

  const gaps = new Set(picks.map((p) => `${p.targetDate}::${p.targetShift}`)).size;
  const blocked = validation !== null && !validation.safe;

  return (
    <Card className="border-primary/40 bg-primary/[0.03]">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <ShoppingBasket className="h-5 w-5 shrink-0 text-primary" />
          Staged changes ({picks.length})
          {validation && <SafetyMarginBadge impact={validation.impact} />}
        </CardTitle>
        <CardDescription>
          Nothing here is written yet. Every suggestion below is already being ranked and
          checked against the roster with these in place, so the next pick sees the shift
          these leave behind — {gaps === 1 ? "one gap" : `${gaps} gaps`} covered so far.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {validation && validation.stale.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>The roster changed under these picks</AlertTitle>
            <AlertDescription>
              <ul className="space-y-0.5">
                {validation.stale.map((s, i) => (
                  <li key={i}>
                    {s.pick.name} on {format(parseISO(s.date), "d MMM")} is now{" "}
                    <span className="font-mono">{s.actual ?? "(none)"}</span>, not{" "}
                    <span className="font-mono">{s.expected ?? "(none)"}</span>.
                  </li>
                ))}
              </ul>
              Re-run the search so these are re-checked before anything is written.
            </AlertDescription>
          </Alert>
        )}

        {validation && validation.impact.breaches.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Together, these picks break a minimum</AlertTitle>
            <AlertDescription>
              Each was safe on its own against the roster at the time it was staged. Combined
              against the roster now, they are not — remove one and try again.
            </AlertDescription>
          </Alert>
        )}

        {validation && (
          <div className="space-y-1 rounded-md border bg-muted/20 p-2">
            <span className="text-xs font-medium text-muted-foreground">
              Combined manpower effect of all {picks.length} changes
            </span>
            <PlanImpactTable impact={validation.impact} />
          </div>
        )}

        <div className="space-y-2">
          {picks.map((pick, index) => (
            <PickRow
              key={pick.id}
              pick={pick}
              index={index}
              onRemove={onRemove}
              disabled={committing}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onCommit} disabled={committing || blocked || !validation}>
            {committing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShoppingBasket className="mr-2 h-4 w-4" />
            )}
            Apply all {picks.length}
          </Button>
          <Button variant="ghost" onClick={onClear} disabled={committing}>
            <Trash2 className="mr-2 h-4 w-4" />
            Discard
          </Button>
          <span className="text-xs text-muted-foreground">
            Written in the order staged. If one fails the rest stay here.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
