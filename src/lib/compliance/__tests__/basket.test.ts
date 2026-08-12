/**
 * Basket tests.
 *
 * The headline is "picks compound": with 13 RSRs on the Morning, releasing one to
 * the Afternoon is legal and releasing a second is not. Applied one at a time both
 * writes pass their own gate and the pair is a breach. Staged, the second is refused
 * — that is the whole reason the basket exists.
 */
import { describe, expect, it } from "vitest";

import { findAvailability } from "@/lib/availabilityEngine";
import {
  basketConflict,
  basketMutations,
  toBasketPick,
  validateBasket,
  type BasketPick,
} from "@/lib/compliance/basket";
import type { CoverOption } from "@/lib/compliance/ladder";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

import { ANCHOR, cohort, day, scheduleOf } from "./fixtures";

/** ANCHOR+5 — team C on M, team B on A, team A on N. */
const DATE = day(ANCHOR, 5);

/** Group 1 (RSR) needs 12 on a day shift. */
const roster = (morning: number, afternoon: number, extra: SummaryScheduleMember[] = []) => [
  ...cohort({ count: morning, prefix: "MOR", team: "C", rating: "RSR" }, DATE, 2),
  ...cohort({ count: afternoon, prefix: "AFT", team: "B", rating: "RSR" }, DATE, 2),
  ...extra,
];

const search = (members: SummaryScheduleMember[], pending: BasketPick[] = []) =>
  findAvailability({
    members,
    date: DATE,
    shift: "A",
    rating: 1,
    pending: basketMutations(pending),
  });

const swapsIn = (result: ReturnType<typeof search>) =>
  result.options.filter((o) => o.strategy === "SWAP_COUNTERPART");

const stage = (option: CoverOption): BasketPick => toBasketPick(option, DATE, "A");

describe("staged picks compound", () => {
  // 13 on the Morning against a minimum of 12: exactly one body to give.
  const members = roster(13, 10);

  it("offers every Morning donor while nothing is staged", () => {
    expect(swapsIn(search(members))).toHaveLength(13);
  });

  it("refuses the SECOND donor once the first is staged", () => {
    const first = stage(swapsIn(search(members))[0]);
    const after = search(members, [first]);

    // The Morning is now committed down to its minimum, so nobody else can leave it.
    expect(swapsIn(after)).toEqual([]);
    expect(after.blocked.filter((o) => o.strategy === "SWAP_COUNTERPART")).toHaveLength(12);
    expect(after.blocked[0].blockingFailures[0]).toMatchObject({
      ruleId: "COVER.SOURCE",
      observed: 11,
      threshold: 12,
    });
  });

  it("frees the donor again when the pick is dropped from the basket", () => {
    const basket = [stage(swapsIn(search(members))[0])];
    expect(swapsIn(search(members, basket))).toEqual([]);

    const dropped = basket.filter((p) => p.id !== basket[0].id);
    expect(swapsIn(search(members, dropped))).toHaveLength(13);
  });

  it("counts the staged body toward the shift it is filling", () => {
    const first = stage(swapsIn(search(members))[0]);
    const after = search(members, [first]);

    expect(after.dayManpower.byShift.A.cells.find((c) => c.group === "G1")?.available).toBe(10);
    expect(after.projectedManpower?.byShift.A.cells.find((c) => c.group === "G1")?.available).toBe(11);
    expect(after.projectedManpower?.byShift.M.cells.find((c) => c.group === "G1")?.available).toBe(12);
  });

  it("moves the staged controller's timeline, not just the head-count", () => {
    const first = stage(swapsIn(search(members))[0]);
    const after = search(members, [first]);

    // They are on the Afternoon now as far as the search is concerned, so they are
    // neither offered again nor re-validated against a Morning they no longer hold.
    expect(after.options.map((o) => o.employeeId)).not.toContain(first.employeeId);
    expect(after.alreadyCovering.find((m) => m.employeeId === first.employeeId)).toMatchObject({
      staged: true,
    });
  });

  it("marks only the staged arrivals, not the genuinely rostered ones", () => {
    const first = stage(swapsIn(search(members))[0]);
    const after = search(members, [first]);
    const rostered = after.alreadyCovering.filter((m) => !m.staged);

    expect(rostered).toHaveLength(10);
    expect(after.alreadyCovering.filter((m) => m.staged)).toHaveLength(1);
  });
});

describe("what may not be staged", () => {
  const members = roster(20, 10);
  const options = swapsIn(search(members));

  it("refuses the same plan twice", () => {
    expect(basketConflict([stage(options[0])], options[0])).toMatch(/already staged/i);
  });

  it("refuses a second change to one controller on a day they already have one", () => {
    // Whichever landed second would carry a `from` read before the first and
    // silently undo it.
    const first = stage(options[0]);
    const sameDay = { ...options[0], id: `${options[0].id}::other` } as CoverOption;

    expect(basketConflict([first], sameDay)).toMatch(/already has a staged change on/);
  });

  it("allows the same controller on a different day", () => {
    const otherDay: CoverOption = {
      ...options[0],
      id: `${options[0].employeeId}::LATER`,
      mutations: [{ employeeId: options[0].employeeId, date: day(ANCHOR, 9), from: "M", to: "A" }],
    };

    expect(basketConflict([stage(options[0])], otherDay)).toBeNull();
  });

  it("allows different controllers on the same day", () => {
    expect(basketConflict([stage(options[0])], options[1])).toBeNull();
  });
});

describe("the re-check immediately before writing", () => {
  const members = roster(20, 10);
  const options = swapsIn(search(members));

  it("passes a basket that is still consistent with the roster", () => {
    const validation = validateBasket(members, [stage(options[0]), stage(options[1])]);

    expect(validation.safe).toBe(true);
    expect(validation.stale).toEqual([]);
    expect(validation.impact.breaches).toEqual([]);
    // 20 on the Morning, two leaving: 18 against a minimum of 12.
    expect(validation.impact.releases[0]).toMatchObject({ before: 20, after: 18, required: 12 });
  });

  it("catches a roster that moved under the basket", () => {
    // Someone edited MOR1's duty in another tab after the pick was staged.
    const moved = members.map((m) =>
      m.employee_id === "MOR1" && m.duty_date === DATE ? { ...m, duty_code: "CO" } : m,
    );
    const validation = validateBasket(moved, [stage(options[0])]);

    expect(validation.safe).toBe(false);
    expect(validation.stale[0]).toMatchObject({ date: DATE, expected: "M", actual: "CO" });
  });

  it("catches a combined breach even if each pick passed on its own", () => {
    // Both staged against a 13-strong Morning by a caller that skipped the running
    // gate. Individually each leaves 12; together they leave 11.
    const tight = roster(13, 10);
    const tightOptions = swapsIn(search(tight));
    const validation = validateBasket(tight, [stage(tightOptions[0]), stage(tightOptions[1])]);

    expect(validation.safe).toBe(false);
    expect(validation.impact.breaches).toHaveLength(1);
    expect(validation.impact.breaches[0]).toMatchObject({ before: 13, after: 11, required: 12 });
  });

  it("INVARIANT: every prefix of a properly-staged basket is safe on its own", () => {
    // This is what makes stopping half way through a commit acceptable rather than
    // corrupting: each pick was gated against the roster plus its predecessors.
    const board = roster(16, 10, scheduleOf({ id: "REST1", rating: "RSR" }, DATE, "CO CO"));
    const picks: BasketPick[] = [];

    for (let i = 0; i < 4; i++) {
      const next = swapsIn(search(board, picks))[0];
      expect(next).toBeDefined();
      picks.push(stage(next));

      for (let cut = 1; cut <= picks.length; cut++) {
        expect(validateBasket(board, picks.slice(0, cut)).safe).toBe(true);
      }
    }

    // Four released from 16 lands exactly on the minimum, and the fifth is refused.
    expect(validateBasket(board, picks).impact.releases[0]).toMatchObject({ after: 12 });
    expect(swapsIn(search(board, picks))).toEqual([]);
  });
});
