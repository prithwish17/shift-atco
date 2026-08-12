/**
 * compliance/basket.ts
 * ---------------------------------------------------------------------------
 * Staging for cover plans a supervisor has chosen but not yet written.
 *
 * Filling one gap usually opens the next one, and the two decisions are not
 * independent: pulling a body off the Morning to cover the Afternoon changes what
 * the Morning can afford to give up an hour later. Applying picks one at a time
 * hides that — each write is safe in isolation and the pair is not.
 *
 * A basket makes the coupling explicit. Staged picks are fed back into the search
 * as `pending`, so every later suggestion is generated, gated and ranked against
 * the roster AS IT WILL BE. Two consequences worth stating:
 *
 *  - Every prefix of the basket is independently safe. Pick 1 was gated against the
 *    live roster, pick 2 against the roster plus pick 1, and so on. That is what
 *    makes stopping half way through a commit an acceptable outcome rather than a
 *    corrupt one.
 *  - The incremental gating and the combined re-check in `validateBasket` are the
 *    same arithmetic over the same base, so the second can only ever disagree with
 *    the first if the underlying roster moved — which is exactly what it is for.
 */
import {
  buildCoverageBase,
  dedupeRoster,
  mergeDeltas,
  mutationDelta,
  type CellKey,
} from "./coverage";
import type { CoverOption, StrategyId } from "./ladder";
import { planImpact, type PlanImpact } from "./manpower";
import type { DutyMutation } from "./planValidator";
import type { ShiftCode } from "./rosterState";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

export interface BasketPick {
  /** The option id — `employeeId::strategy`, unique per person and approach. */
  id: string;
  employeeId: string;
  name: string;
  strategy: StrategyId;
  strategyLabel: string;
  rung: number;
  /** The gap this pick was chosen to fill. A basket may span several. */
  targetDate: string;
  targetShift: ShiftCode;
  targetDutyCode: string;
  createsOpe: boolean;
  mutations: DutyMutation[];
  /** The chart effect recorded when the pick was staged. */
  impact: PlanImpact;
}

export function toBasketPick(
  option: CoverOption,
  targetDate: string,
  targetShift: ShiftCode,
): BasketPick {
  return {
    id: option.id,
    employeeId: option.employeeId,
    name: option.name,
    strategy: option.strategy,
    strategyLabel: option.strategyLabel,
    rung: option.rung,
    targetDate,
    targetShift,
    targetDutyCode: option.targetDutyCode,
    createsOpe: option.createsOpe,
    mutations: option.mutations,
    impact: option.impact,
  };
}

/** Every staged mutation, in the order the picks were made. */
export function basketMutations(picks: BasketPick[]): DutyMutation[] {
  return picks.flatMap((p) => p.mutations);
}

const key = (id: string) => id.trim().toUpperCase();

/**
 * Why an option cannot join the basket, or null if it can.
 *
 * Only one rule matters, and it is about the same person twice: two staged changes
 * to one controller's day would each carry a `from` read off the roster before the
 * other, so whichever was written second would silently undo the first. Different
 * controllers cannot collide this way — their interaction is manpower, and the
 * running gate already covers that.
 */
export function basketConflict(picks: BasketPick[], option: CoverOption): string | null {
  if (picks.some((p) => p.id === option.id)) return "This exact change is already staged.";

  const staged = new Set(
    picks
      .filter((p) => key(p.employeeId) === key(option.employeeId))
      .flatMap((p) => p.mutations.map((m) => m.date)),
  );
  const clash = option.mutations.find((m) => staged.has(m.date));
  if (clash) {
    return `${option.name} already has a staged change on ${clash.date}. Remove it first, or pick someone else.`;
  }
  return null;
}

export interface StalePick {
  pick: BasketPick;
  date: string;
  expected: string | null;
  actual: string | null;
}

export interface BasketValidation {
  /** Combined head-count change across every staged pick. */
  delta: Map<CellKey, number>;
  /** The chart effect of the basket as a whole. */
  impact: PlanImpact;
  /**
   * Picks whose recorded `from` no longer matches the roster — someone edited the
   * duty in another tab or another page while this basket sat on screen. The server
   * refuses these too, but catching it here means saying so before any write lands.
   */
  stale: StalePick[];
  /** True when the basket is safe to commit as it stands. */
  safe: boolean;
}

/**
 * Re-check the whole basket against the CURRENT roster, immediately before writing.
 *
 * Each pick was gated when it was staged. This exists for the gap between then and
 * now: a refetch, another supervisor, a hand edit in Duty Management. It re-derives
 * the combined delta from the mutations rather than accumulating one as picks are
 * added, so the number checked here cannot have drifted from the plans it describes.
 */
export function validateBasket(
  members: SummaryScheduleMember[],
  picks: BasketPick[],
): BasketValidation {
  const mutations = basketMutations(picks);
  const dates = [...new Set(mutations.map((m) => m.date))].sort();
  const base = buildCoverageBase(members, dates);

  const live = new Map<string, string | null>();
  for (const member of dedupeRoster(members, dates)) {
    live.set(`${key(member.employee_id)}::${member.duty_date}`, member.duty_code ?? null);
  }

  const stale: StalePick[] = [];
  const deltas: Map<CellKey, number>[] = [];

  for (const pick of picks) {
    const member = members.find((m) => key(m.employee_id) === key(pick.employeeId));
    if (member) deltas.push(mutationDelta(member, pick.mutations));

    for (const mutation of pick.mutations) {
      const actual = live.get(`${key(pick.employeeId)}::${mutation.date}`) ?? null;
      if ((actual ?? "") !== (mutation.from ?? "")) {
        stale.push({ pick, date: mutation.date, expected: mutation.from, actual });
      }
    }
  }

  const delta = mergeDeltas(deltas);
  const impact = planImpact(base, delta);

  return { delta, impact, stale, safe: stale.length === 0 && impact.breaches.length === 0 };
}
