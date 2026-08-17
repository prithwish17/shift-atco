/**
 * The single duty-code vocabulary (§1.2).
 *
 * The sheet carried three divergent classifications of the same codes: `CO`
 * and `SL` were neutral for the G-streak but charged as full operational duty
 * by the hours engine; `GH`/`RH` counted as leave to the engine but broke the
 * G run; `M+A` was a recognised duty but `A+M` was not, despite both appearing
 * in the roster (§2.8). Every classifier now reads this table.
 */

import type { DayClass } from './types';

/**
 * General (office) duty.
 *
 * `GO` — "General Oscar" in the app's own duty legend — is general duty, not a
 * watch. It shares `G`'s 0940 start time, and it is the *more* common of the
 * two on the live roster: 1,332 cells against 734 for `G` over June–July.
 * Classifying it by fall-through charged every one of them at the watch rate.
 */
export const GENERAL_DUTY_CODES: ReadonlySet<string> = new Set(['G', 'GO', 'T', 'TR']);

/**
 * Codes that bridge a block without counting toward the five.
 *
 * Training (`T` and `TR`) is deliberately absent. In Stress Recovery it is
 * general duty: it contributes to the five-duty general block threshold and
 * therefore accrues at 0.5 hours per day once that threshold is met.
 *
 * `NH` (National Holiday) sits with `CH`.
 *
 * `NO` is deliberately absent — the night-off is the tail of the night cycle
 * and counts as shift duty, as it always has.
 */
export const BRIDGING_CODES: ReadonlySet<string> = new Set([
    'LEAVE', 'SAT', 'SUN', 'CH', 'GH', 'RH', 'NH', 'SL', 'CO',
]);

/**
 * Shift (watch) duty codes seen in the roster.
 *
 * Not exhaustive by design: an unrecognised code is still treated as shift
 * duty, because that is what the sheet's fall-through did and silently
 * reclassifying a code would move money. `isKnownDutyCode` lets the importer
 * warn about it instead.
 */
export const KNOWN_SHIFT_DUTY_CODES: ReadonlySet<string> = new Set([
    'M', 'A', 'N', 'NO',
    'M+A', 'A+M', 'NO+N', 'CO+M', 'CO+A', 'CO+N',
    'SAT+N', 'SAT+NO', 'SUN+N', 'SUN+M', 'SUN+A', 'SUN+NO',
]);

/**
 * Codes that mean "not on the roster that day", as distinct from "no duty".
 *
 * Skipped days accrue nothing and neither build nor break a block.
 *
 * `NA` — "Not Available" in the app's duty legend — is the live roster's way of
 * saying the controller was not posted at all: not yet joined, already
 * transferred out, or otherwise off the strength. It is the second most common
 * code in the period after the watch cycle itself (1,675 cells over June–July),
 * and falling through to shift duty charged every one of them a full hour.
 *
 * `#N/A` is the same idea from the other direction: a failed lookup in the
 * upstream export rather than a deliberate marking. 750 cells of the reference
 * period, all on junk rows that never match a live employee — but the sheet
 * charged those as operational duty too, for want of matching anything (§2.9).
 */
export const SKIPPED_CODES: ReadonlySet<string> = new Set(['', 'NA', '#N/A', 'N/A', '-']);

/** Upper-case and trim. All comparisons in this module use the normalised form. */
export function normaliseDutyCode(raw: string | null | undefined): string {
    return (raw ?? '').trim().toUpperCase();
}

export function classifyDutyCode(raw: string | null | undefined): DayClass {
    const code = normaliseDutyCode(raw);
    if (SKIPPED_CODES.has(code)) return 'skipped';
    if (GENERAL_DUTY_CODES.has(code)) return 'general';
    if (BRIDGING_CODES.has(code)) return 'bridging';
    return 'shift';
}

/** False for a code that lands in `shift` only by fall-through. */
export function isKnownDutyCode(raw: string | null | undefined): boolean {
    const code = normaliseDutyCode(raw);
    return (
        SKIPPED_CODES.has(code) ||
        GENERAL_DUTY_CODES.has(code) ||
        BRIDGING_CODES.has(code) ||
        KNOWN_SHIFT_DUTY_CODES.has(code)
    );
}
