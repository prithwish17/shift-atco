/**
 * Night Channel Allocation — the shapes the rules, the solver, the API and the
 * board all agree on. Times are minutes from 13:30 throughout (see constants).
 */

/** Which half a person is in, or `null` for neither. Halves are optional. */
export type HalfKey = "1st" | "2nd" | null;

/**
 * A person on tonight's page.
 *
 * `key` is the module's own identifier, stable for one night. It is the profile
 * id where the roster line matched a profile, `name:<normalised name>` where it
 * did not, and `manual:<id>` for someone typed in by hand — so the board can
 * hold everyone actually on the shift, not only people with an account.
 */
export interface NightPerson {
  key: string;
  /** Profile id, when this person has an account. Null otherwise. */
  userId: string | null;
  name: string;
  /** Short code shown on the strips (employee code, or initials). */
  code: string;
  role: string;
  available: boolean;
  /** Snapshot of the TSO qualification for this night. */
  canTakeTso: boolean;
  half: HalfKey;
  /** True when added by hand rather than read from the roster. */
  manual: boolean;
  /** Index into the board palette. Stable across renders. */
  colorIndex: number;
}

/** One position for one night. */
export interface NightChannel {
  code: string;
  inUse: boolean;
  /** Minutes from 13:30. */
  openAt: number;
  /** Minutes from 13:30. */
  closeAt: number;
  /** Person key of whoever takes the opening duty, or null. */
  starterKey: string | null;
  /**
   * Code of the position this one folds into during `MERGE_WINDOW`, or null.
   * Set on CLD, pointing at the SMC in use. While set, CLD needs no cover of
   * its own in that window — whoever holds SMC holds both.
   */
  mergedInto?: string | null;
}

/** One stretch of one position held by one person. */
export interface NightDuty {
  id: string;
  channelCode: string;
  personKey: string;
  startMin: number;
  endMin: number;
}

export type AllocationStatus = "draft" | "final";

/** Everything about one night. The unit the API reads, validates and saves. */
export interface NightAllocationState {
  /** The 13:30 date, `YYYY-MM-DD`. */
  nightDate: string;
  /** 0 = auto, otherwise 30…120. */
  dutyLengthPref: number;
  status: AllocationStatus;
  /** Optimistic lock. 0 until the night has been saved once. */
  version: number;
  people: NightPerson[];
  channels: NightChannel[];
  duties: NightDuty[];
  savedByName: string | null;
  /** ISO timestamp of the last save, or null. */
  savedAt: string | null;
}

/**
 * One line in the checks panel. `dutyIds` lets the panel scroll to the duty at
 * fault; an issue about the night as a whole carries none.
 */
export interface RuleIssue {
  message: string;
  dutyIds: string[];
  /** Set on "channel X is uncovered" errors, which the edit dialog treats specially. */
  isGap?: boolean;
  /** Set on staffing-feasibility notices, which explain rather than suggest. */
  isStaffing?: boolean;
  /**
   * Set on issues about a person rather than any one duty — a half with no
   * duty in it — so an edit can tell whether it was the one that caused it.
   */
  personKeys?: string[];
}

export interface ValidationResult {
  /** Hard-rule breaches. Saving is blocked while any remain. */
  errors: RuleIssue[];
  /** Preferences and staffing notices. Never block saving. */
  warnings: RuleIssue[];
}

/**
 * What the solver returns. It emits a continuous plan or nothing at all.
 *
 * Success carries the **whole next state**, not just the duties. A plan may
 * depend on a setting the search chose for itself — folding CLD into SMC, say —
 * and a caller that took only the duties would end up with a board that does
 * not validate. Returning the state makes that impossible to get wrong.
 */
export type GenerateResult =
  | {
      ok: true;
      state: NightAllocationState;
      note?: string;
      /** Set when the plan was only possible by folding CLD into this position. */
      mergedInto?: string | null;
    }
  | { ok: false; error: string; reasons: string[] };
