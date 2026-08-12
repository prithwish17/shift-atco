/**
 * useCoverBasket
 * ---------------------------------------------------------------------------
 * Holds the cover plans a supervisor has chosen but not yet written, and commits
 * them as one deliberate act.
 *
 * Commit order is the order they were staged, and that is load-bearing rather than
 * cosmetic: each pick was gated against the roster plus every pick before it, so
 * every PREFIX of the basket is independently safe (see compliance/basket.ts). A
 * failure part way through therefore leaves the roster in a state the gate did
 * sanction — we stop, keep what landed, and hand the rest back still staged. The
 * alternative, unwinding successful writes because a later one failed, means more
 * writes that can themselves fail, to undo changes that were never unsafe.
 */
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { applyDutyPlan } from "@/data-access/schedule.repository";
import { useAuth } from "@/contexts/AuthContext";
import { useLogDecision } from "@/hooks/useComplianceAudit";
import { useToast } from "@/hooks/use-toast";
import {
  basketConflict,
  basketMutations,
  toBasketPick,
  validateBasket,
  type BasketPick,
} from "@/lib/compliance/basket";
import type { CoverOption } from "@/lib/compliance/ladder";
import { describeImpact } from "@/lib/compliance/manpower";
import type { ShiftCode } from "@/lib/compliance/rosterState";
import type { RatingFilter } from "@/lib/availabilityEngine";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

export interface CommitOutcome {
  applied: BasketPick[];
  /** The pick that failed and why, or null when everything landed. */
  failed: { pick: BasketPick; message: string } | null;
  /** Writes that succeeded but whose audit entry did not. */
  unaudited: BasketPick[];
}

export function useCoverBasket() {
  const [picks, setPicks] = useState<BasketPick[]>([]);
  const [committing, setCommitting] = useState(false);

  const { user } = useAuth();
  const { toast } = useToast();
  const logDecision = useLogDecision();
  const queryClient = useQueryClient();

  const mutations = useMemo(() => basketMutations(picks), [picks]);

  /** Stage a plan. Returns the reason it was refused, or null on success. */
  const add = useCallback(
    (option: CoverOption, targetDate: string, targetShift: ShiftCode): string | null => {
      const conflict = basketConflict(picks, option);
      if (conflict) return conflict;
      setPicks((current) => [...current, toBasketPick(option, targetDate, targetShift)]);
      return null;
    },
    [picks],
  );

  const remove = useCallback((id: string) => {
    setPicks((current) => current.filter((p) => p.id !== id));
  }, []);

  const clear = useCallback(() => setPicks([]), []);

  const commit = useCallback(
    async (members: SummaryScheduleMember[], rating: RatingFilter): Promise<CommitOutcome | null> => {
      if (picks.length === 0) return null;

      // Last check before anything is written. Everything here passed when it was
      // staged; this catches the roster moving underneath the basket since.
      const validation = validateBasket(members, picks);
      if (!validation.safe) {
        const reason = validation.stale.length
          ? `${validation.stale[0].pick.name}'s duty on ${validation.stale[0].date} is now ` +
            `${validation.stale[0].actual ?? "(none)"}, not ${validation.stale[0].expected ?? "(none)"}.`
          : validation.impact.breaches
              .map((b) => `${b.label} on the ${b.shiftLabel} of ${b.date} would fall to ${b.after}/${b.required}`)
              .join("; ");
        toast({
          title: "Not applied — the roster has moved",
          description: `${reason} Re-run the search so the basket is checked against the current roster.`,
          variant: "destructive",
        });
        return null;
      }

      setCommitting(true);
      const applied: BasketPick[] = [];
      const unaudited: BasketPick[] = [];
      let failed: CommitOutcome["failed"] = null;

      try {
        for (const pick of picks) {
          const summary = pick.mutations.map((m) => `${m.date}: ${m.from ?? "—"} → ${m.to}`).join(", ");
          try {
            await applyDutyPlan({ mutations: pick.mutations, employeeName: pick.name });
          } catch (error) {
            failed = { pick, message: error instanceof Error ? error.message : "Unknown error" };
            break;
          }
          applied.push(pick);

          // The duty is written. A failed audit entry must be reported, but it is
          // not grounds for undoing a legitimate roster change.
          try {
            await logDecision.mutateAsync({
              action: "apply_cover_plan",
              actor_id: user?.id ?? null,
              actor_name: user?.email ?? null,
              target_date: pick.targetDate,
              shift: pick.targetShift,
              rating: rating === "ALL" ? "ALL" : String(rating),
              employee_id: pick.employeeId,
              employee_name: pick.name,
              score: pick.rung,
              reason:
                `${pick.strategyLabel} (rung ${pick.rung}) — ${summary} · ${describeImpact(pick.impact)} ` +
                `· staged pick ${applied.length} of ${picks.length}`,
              snapshot: {
                strategy: pick.strategy,
                rung: pick.rung,
                mutations: pick.mutations,
                createsOpe: pick.createsOpe,
                impact: pick.impact,
                batch: { size: picks.length, position: applied.length },
              },
            });
          } catch {
            unaudited.push(pick);
          }
        }
      } finally {
        setCommitting(false);
      }

      // Whatever did not land stays staged, so the supervisor can retry or drop it.
      const appliedIds = new Set(applied.map((p) => p.id));
      setPicks((current) => current.filter((p) => !appliedIds.has(p.id)));

      if (applied.length > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["supervisor-schedule-members"] }),
          queryClient.invalidateQueries({ queryKey: ["employee-history"] }),
        ]);
      }

      if (failed) {
        toast({
          title: `Applied ${applied.length} of ${picks.length}, then stopped`,
          description: `${failed.pick.name} could not be written: ${failed.message} — that pick and the ones after it are still staged.`,
          variant: "destructive",
        });
      } else if (unaudited.length > 0) {
        toast({
          title: `Applied ${applied.length} duty ${applied.length === 1 ? "change" : "changes"}`,
          description: `${unaudited.length} could not be written to the audit log — record ${unaudited.length === 1 ? "it" : "them"} manually.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `Applied ${applied.length} duty ${applied.length === 1 ? "change" : "changes"}`,
          description: applied.map((p) => p.name).join(", "),
        });
      }

      return { applied, failed, unaudited };
    },
    [picks, logDecision, queryClient, toast, user],
  );

  return { picks, mutations, committing, add, remove, clear, commit };
}
