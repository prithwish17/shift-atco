/**
 * The SARC charging engine (§1.4, §1.5).
 *
 * Verified against all 374 employees of the June–July 2026 reference period.
 * Twelve requirements differ from the sheet, every one of them a deliberate
 * correction recorded in §2; nobody's recovery percentage changes.
 *
 * Four departures from the sheet are worth knowing while reading this file:
 *
 *   1. The five-duty gate is scoped to the block that earned it. The sheet
 *      charged 0.5 for *any* `G` day as long as one 5-G run existed anywhere
 *      in the period, so an isolated general day inherited the rate from an
 *      unrelated block five weeks earlier (§2.3).
 *   2. A bridging day takes the rate of the span it sits inside, and the home
 *      rate outside. The sheet used a running streak counter that dropped a
 *      shift controller's leave to 0.5 the moment they touched a single `G`
 *      day (§2.4).
 *   3. The rating pro-rate admits a rating dated exactly on the period start.
 *      The sheet's strict `<` pushed it into the pro-rate branch and produced
 *      61:00 — above the 60:00 ceiling the cap exists to enforce (§2.6).
 *   4. Period lengths come from the period. The sheet hardcoded 28 days for
 *      the first month across five columns (§2.1).
 */

import {
    detectBlocks,
    hasQualifyingBlock,
    resolveSpans,
} from './blocks';
import { classifyDutyCode, isKnownDutyCode, normaliseDutyCode } from './codes';
import { HALF_HOUR, SECONDS_PER_HOUR, hours, roundToHalfHour, truncateToMinute } from './duration';
import {
    daysRemainingInPeriod,
    enumeratePeriodDates,
    parseIsoDate,
    periodDays,
    periodMonths,
} from './period';
import type {
    DayCharge,
    DayClass,
    HomeCategory,
    IamatcHours,
    PerformedSource,
    SarcEmployeeInput,
    SarcInput,
    SarcPeriod,
    SarcRow,
    Seconds,
} from './types';

/* ─── Rates and standards ─────────────────────────────────────────────────── */

/** General (office) duty accrues half an hour a day. */
export const GENERAL_RATE: Seconds = HALF_HOUR;

/** Shift (watch) duty accrues an hour a day. */
export const SHIFT_RATE: Seconds = SECONDS_PER_HOUR;

/** Entitlement ceiling per month at the shift rate. */
export const MONTHLY_STANDARD_SHIFT: Seconds = hours(30);

/** Entitlement ceiling per month at the general rate. */
export const MONTHLY_STANDARD_GENERAL: Seconds = hours(15);

/** Share of the period that must be `G` before an employee counts as general. */
export const GENERAL_MAJORITY_THRESHOLD = 0.5;

/**
 * Ceiling on the supportive half-weighted component of the IAMATC total.
 *
 * Undocumented in the extract — its column header reads
 * `(A+B+C+D+E)+(F+G+H)/2` with no mention of a cap — but 60 of the 317 rows
 * in the reference extract are only reproducible with it.
 */
export const SUPPORTIVE_CAP: Seconds = hours(15);

/* ─── IAMATC totals ───────────────────────────────────────────────────────── */

/** `TOTAL TIME-IN (A+B)` — the general branch of Hours Performed. */
export function totalTimeIn(performed: IamatcHours): Seconds {
    return performed.controlling + performed.ojtPractical;
}

/**
 * `(A+B+C+D+E) + MIN(truncateToMinute((F+G+H)/2), 15h)` — the shift branch.
 *
 * The halving truncates to the whole minute rather than rounding; four rows of
 * the reference extract are off by exactly thirty seconds otherwise. With both
 * the truncation and the cap this reproduces all 317 rows.
 */
export function weightedTotal(performed: IamatcHours): Seconds {
    const core =
        performed.controlling +
        performed.ojtPractical +
        performed.ojtiTheory +
        performed.wsoCmd +
        performed.instructorExaminer;

    const supportiveRaw =
        performed.unitSupervisor + performed.supportiveUnit + performed.alpha;
    const supportive = Math.min(
        truncateToMinute(Math.floor(supportiveRaw / 2)),
        SUPPORTIVE_CAP,
    );

    return core + supportive;
}

/* ─── Component rules ─────────────────────────────────────────────────────── */

/**
 * Team `G` is general; every other team, and an unknown one, is shift (§1.1).
 *
 * `GENERAL` is accepted alongside `G` because that is the literal value the
 * `shift_type` enum stores in `profiles.current_shift`. Reading a profile row
 * straight into `team` would otherwise charge every general officer at the
 * shift rate — double their requirement — and do it silently.
 */
export function homeCategory(team: string | null | undefined): HomeCategory {
    const value = (team ?? '').trim().toUpperCase();
    return value === 'G' || value === 'GENERAL' ? 'general' : 'shift';
}

export function homeRate(home: HomeCategory): Seconds {
    return home === 'general' ? GENERAL_RATE : SHIFT_RATE;
}

/**
 * The monthly-standard cap (§1.5).
 *
 * Expressed as a `min` so it can only ever cap. The sheet normalised by exact
 * match — `30:30 → 30:00`, `61:00 → 60:00` — which happens to work for a
 * 61-day period and would *raise* every requirement on a 59-day one.
 *
 * The general ceiling keys off how the hours were accrued rather than off the
 * `General` flag: 41 employees are flagged general, and a flag-based cap would
 * crush any of them who did substantial shift work.
 */
export function applyCap(
    required: Seconds,
    daysOnRoster: number,
    months: number,
): Seconds {
    const capped = Math.min(required, MONTHLY_STANDARD_SHIFT * months);
    const accruedWhollyAtGeneralRate = required === GENERAL_RATE * daysOnRoster;
    return accruedWhollyAtGeneralRate
        ? Math.min(capped, MONTHLY_STANDARD_GENERAL * months)
        : capped;
}

/**
 * The mid-period rating pro-rate (§1.5). Null means exempt.
 *
 * The two dates play different parts, and it matters:
 *
 *   The **endorsement date is a gate**. Both credentials must be on file — a
 *   controller with a rating but no endorsement carries no requirement at all.
 *   On the reference workbook nobody is in that state, so the gate never fires
 *   there; against live data it decides who is billed.
 *
 *   The **rating date is the anchor**. Proration always runs from it, even when
 *   the endorsement lands mid-period. Eleven employees were endorsed inside the
 *   reference period; the six whose rating predates it draw the full 60:00,
 *   which is only reproducible if the endorsement date never moves the start.
 *
 * The daily rate divides by **period days**, not by days the employee was
 * actually on roster. That is deliberate and matches the sheet: a joiner or
 * leaver who is also rated mid-period is therefore under-charged by roughly
 * half. Accepted as a known behaviour (§2.10) — of the eight partial-roster
 * employees in the reference period, none has a mid-period rating date, so the
 * two conditions have never yet collided.
 */
export function applyRatingProRate(
    adjusted: Seconds,
    period: SarcPeriod,
    oldestRatingDate: string | null,
    oldestEndorsementDate: string | null,
): Seconds | null {
    if (!oldestRatingDate || !oldestEndorsementDate) return null;

    const rating = parseIsoDate(oldestRatingDate);
    const start = parseIsoDate(period.start);
    const end = parseIsoDate(period.end);
    if (!rating || !start || !end) return null;

    if (rating > end) return null; // rated after the period — nothing to recover
    if (rating <= start) return adjusted; // rated throughout — full requirement

    const chargeableDays = daysRemainingInPeriod(period, oldestRatingDate);
    const perDay = roundToHalfHour(adjusted / periodDays(period));
    return chargeableDays * perDay;
}

/** Shortfall as a fraction of the requirement, floored at zero. */
export function recoveryFraction(
    requirement: Seconds | null,
    performed: Seconds | null,
): number | null {
    if (requirement == null || performed == null) return null;
    if (requirement <= 0) return 0;
    return Math.max(0, (requirement - performed) / requirement);
}

/* ─── Evaluation ──────────────────────────────────────────────────────────── */

export function evaluateEmployee(
    employee: SarcEmployeeInput,
    period: SarcPeriod,
): SarcRow {
    const dates = enumeratePeriodDates(period);
    const totalDays = dates.length;
    const months = periodMonths(period);

    const warnings: string[] = [];
    const unknownCodes = new Set<string>();

    const codes = dates.map((date) => employee.dutyCodes[date] ?? null);
    const classes: DayClass[] = codes.map((code) => {
        if (code != null && !isKnownDutyCode(code)) unknownCodes.add(normaliseDutyCode(code));
        return classifyDutyCode(code);
    });

    const blocks = detectBlocks(classes);
    const spans = resolveSpans(blocks, totalDays);
    const home = employee.home ?? homeCategory(employee.team);

    const qualifiedGeneral = hasQualifyingBlock(blocks, 'general');
    const qualifiedShift = hasQualifyingBlock(blocks, 'shift');

    // The global fallback (§1.4) is evaluated ahead of the per-block rates: an
    // employee who never reaches five consecutive duties of one type spends the
    // whole period on the other type's rate, regardless of home team.
    const fallback: Seconds | null = !qualifiedShift
        ? GENERAL_RATE
        : !qualifiedGeneral
          ? SHIFT_RATE
          : null;
    const fallbackReason = fallback === GENERAL_RATE ? 'fallback-general' : 'fallback-shift';

    const days: DayCharge[] = dates.map((date, index) => {
        const dayClass = classes[index];
        const code = codes[index];

        if (dayClass === 'skipped') {
            return { date, code, dayClass, charge: 0, span: null, reason: 'skipped' };
        }

        const span = spans[index];

        if (fallback != null) {
            return { date, code, dayClass, charge: fallback, span, reason: fallbackReason };
        }

        if (span === 'general') {
            return { date, code, dayClass, charge: GENERAL_RATE, span, reason: 'span' };
        }
        if (span === 'shift') {
            return { date, code, dayClass, charge: SHIFT_RATE, span, reason: 'span' };
        }
        return { date, code, dayClass, charge: homeRate(home), span: null, reason: 'home' };
    });

    const daysOnRoster = days.filter((day) => day.dayClass !== 'skipped').length;
    const required = days.reduce((sum, day) => sum + day.charge, 0);
    const adjusted = applyCap(required, daysOnRoster, months);

    const generalDays = classes.filter((dayClass) => dayClass === 'general').length;
    const isGeneral = totalDays > 0 && generalDays / totalDays > GENERAL_MAJORITY_THRESHOLD;

    const requirement = applyRatingProRate(
        adjusted,
        period,
        employee.oldestRatingDate,
        employee.oldestEndorsementDate,
    );

    const performedSource: PerformedSource | null = employee.performed
        ? isGeneral
            ? 'totalTimeIn'
            : 'weightedTotal'
        : null;
    const performed = employee.performed
        ? isGeneral
            ? totalTimeIn(employee.performed)
            : weightedTotal(employee.performed)
        : null;

    if (unknownCodes.size > 0) {
        warnings.push(
            `Unrecognised duty code${unknownCodes.size > 1 ? 's' : ''} charged as shift duty: ${[...unknownCodes].sort().join(', ')}`,
        );
    }
    if (employee.home == null && !(employee.team ?? '').trim()) {
        warnings.push('No roster team — defaulted to the shift rate.');
    }
    if (daysOnRoster < totalDays) {
        warnings.push(
            `On roster for ${daysOnRoster} of ${totalDays} days; absent days accrue nothing.`,
        );
    }
    if (requirement != null && employee.performed == null) {
        warnings.push('Absent from the IAMATC extract — recovery cannot be computed.');
    }
    if (!employee.kolkataJoiningDate) {
        warnings.push(
            'No Kolkata joining date on file, so no rating can be confirmed as earned ' +
            'here and no requirement is raised. This is a data gap, not an exemption.',
        );
    } else if (!employee.oldestRatingDate && employee.oldestRatingDateAnyStation) {
        warnings.push(
            `Rated ${employee.oldestRatingDateAnyStation} but joined Kolkata ` +
            `${employee.kolkataJoiningDate} — no rating was earned here, so no requirement is raised.`,
        );
    }

    if (employee.oldestRatingDate && !employee.oldestEndorsementDate) {
        warnings.push(
            'Rated but no endorsement date on file, so no requirement is raised. ' +
            'Check whether the endorsement is genuinely outstanding or simply unsynced.',
        );
    }

    return {
        empId: employee.empId,
        name: employee.name,
        designation: employee.designation,
        included: employee.included ?? true,
        home,
        isGeneral,
        daysOnRoster,
        blocks,
        days,
        required,
        adjusted,
        oldestRatingDate: employee.oldestRatingDate,
        oldestEndorsementDate: employee.oldestEndorsementDate,
        kolkataJoiningDate: employee.kolkataJoiningDate ?? null,
        oldestRatingDateAnyStation: employee.oldestRatingDateAnyStation ?? null,
        requirement,
        performed,
        performedSource,
        recovery: recoveryFraction(requirement, performed),
        warnings,
    };
}

/** Evaluate every employee, preserving input order. */
export function evaluate(input: SarcInput): SarcRow[] {
    return input.employees.map((employee) => evaluateEmployee(employee, input.period));
}
