/**
 * Turning app data into engine inputs.
 *
 * Pure and DB-shape-free: the repository reads Supabase and hands the plain
 * shapes below to `assembleEmployees`. Keeping the derivations here — earliest
 * rating date, earliest endorsement date, home category — means they are
 * covered by the same tests as the rest of the domain rather than only being
 * exercised through a live query.
 */

import { classifyDutyCode } from './codes';
import type { HomeCategory, IamatcHours, SarcEmployeeInput } from './types';

/* ─── Rating records ──────────────────────────────────────────────────────── */

/** One rating as `employee_training_records.rating_data` stores it. */
export interface RatingEntry {
    rating_date?: string | null;
    endorsement_date?: string | null;
    [key: string]: unknown;
}

export interface RatingDates {
    /** Oldest rating on or after the Kolkata joining date. Null means exempt. */
    oldestRatingDate: string | null;
    oldestEndorsementDate: string | null;
    /** Oldest rating at any station — context for an exemption, never arithmetic. */
    oldestRatingDateAnyStation: string | null;
}

/**
 * Normalise a stored date to ISO `YYYY-MM-DD`, or null if it is not a date.
 *
 * The rating sync does not speak one format. The source workbook carries rating
 * dates as `25-08-2008` and endorsement dates as `2019-11-21` — day-first and
 * ISO, in adjacent columns, because they arrive from two different import tabs.
 * Accepting only ISO turns every day-first date into null, which exempts the
 * employee and shows up as a statement where nobody owes anything.
 *
 * Day-first is the only reading applied to `dd-mm-yyyy`: this is an Indian ATC
 * roster and both the workbook and the upstream extract are unambiguous about
 * it. A value that could only be month-first (`13-25-2020`) is rejected rather
 * than guessed at.
 */
export function toIsoDate(raw: string | null | undefined): string | null {
    const value = (raw ?? '').trim();
    if (!value) return null;

    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    const dayFirst = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value);

    let year: number;
    let month: number;
    let day: number;

    if (iso) {
        year = Number(iso[1]);
        month = Number(iso[2]);
        day = Number(iso[3]);
    } else if (dayFirst) {
        day = Number(dayFirst[1]);
        month = Number(dayFirst[2]);
        year = Number(dayFirst[3]);
    } else {
        return null;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    // Reject a day that does not exist in that month, e.g. 31-02-2020.
    if (new Date(year, month - 1, day).getDate() !== day) return null;

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}`;
}

/** Earliest of a set of stored dates. ISO sorts lexicographically once normalised. */
function earliest(values: readonly (string | null | undefined)[]): string | null {
    let best: string | null = null;
    for (const value of values) {
        const iso = toIsoDate(value);
        if (iso && (best == null || iso < best)) best = iso;
    }
    return best;
}

/**
 * Earliest rating and endorsement date across every rating an employee holds.
 *
 * Mirrors the sheet's two import columns: `RATING_DATES_IMPORT` sorted
 * ascending and taking the first, and `MIN()` over `ENDORSEMENT_DATES_IMPORT`.
 * Both ignore blanks, and the two are independent — an employee's earliest
 * endorsement need not belong to their earliest rating.
 *
 * **Ratings are filtered to Kolkata.** Only a rating dated on or after the
 * controller joined Kolkata anchors a requirement — one earned at a previous
 * station is not a Kolkata rating. On or after, not strictly after: a rating
 * issued the day someone joins is a Kolkata rating.
 *
 * With no joining date on file, nothing qualifies and the employee is exempt.
 * That is deliberately loud rather than lenient — pre-flight raises it as a
 * blocking error, because a missing joining date is a sync gap, not a fact
 * about the controller.
 */
export function ratingDatesFrom(
    ratingData: Record<string, RatingEntry> | null | undefined,
    kolkataJoiningDate?: string | null,
): RatingDates {
    const entries = Object.values(ratingData ?? {});
    const joined = toIsoDate(kolkataJoiningDate);

    const ratingDates = entries.map((entry) => entry?.rating_date);
    const qualifying = joined
        ? ratingDates.filter((value) => {
              const iso = toIsoDate(value);
              return iso != null && iso >= joined;
          })
        : [];

    return {
        oldestRatingDate: earliest(qualifying),
        oldestEndorsementDate: earliest(entries.map((entry) => entry?.endorsement_date)),
        oldestRatingDateAnyStation: earliest(ratingDates),
    };
}

/* ─── Home category ───────────────────────────────────────────────────────── */

/** `profiles.current_shift` values, per the `shift_type` enum. */
export function homeFromCurrentShift(
    currentShift: string | null | undefined,
): HomeCategory | null {
    const value = (currentShift ?? '').trim().toLowerCase();
    if (!value) return null;
    if (value === 'general' || value === 'g') return 'general';
    return 'shift';
}

/**
 * Fall back to the duty-code mix when no profile carries a team.
 *
 * `profiles` requires an app account, but the roster covers everyone, so a
 * sizeable share of employees would otherwise default to the shift rate on no
 * evidence. A general-majority roster is strong evidence of a `G` team; the
 * inference is recorded on the assembled row so the UI can show it as inferred
 * rather than known.
 *
 * Only actual duties are counted. Leave, weekends and training are excluded
 * from the denominator, because a general-team officer who took a fortnight off
 * would otherwise be misread as a shift controller. Note this is a *different*
 * denominator from the `isGeneral` flag in §1.5, which divides by period days
 * because that is what the sheet does — the two answer different questions.
 */
export function inferHome(
    dutyCodes: Iterable<string | null | undefined>,
): HomeCategory | null {
    let general = 0;
    let duties = 0;

    for (const code of dutyCodes) {
        const dayClass = classifyDutyCode(code);
        if (dayClass !== 'general' && dayClass !== 'shift') continue;
        duties += 1;
        if (dayClass === 'general') general += 1;
    }

    if (duties === 0) return null;
    return general / duties > 0.5 ? 'general' : 'shift';
}

export type HomeSource = 'profile' | 'inferred' | 'unknown';

/* ─── Assembly ────────────────────────────────────────────────────────────── */

/** A roster member as the schedule table describes them. */
export interface RosterMember {
    empId: string;
    name: string;
    /** Duty code per ISO date. */
    dutyCodes: Record<string, string>;
}

/** What `profiles` and `employee_training_records` add, when they have a row. */
export interface EmployeeMetadata {
    name?: string | null;
    designation?: string | null;
    /** `profiles.current_shift`. */
    currentShift?: string | null;
    ratingData?: Record<string, RatingEntry> | null;
    /** `employee_training_records.kolkata_joining_date`. */
    kolkataJoiningDate?: string | null;
}

export interface AssembledEmployee extends SarcEmployeeInput {
    /** Where the home category came from — shown in the UI, not used by the engine. */
    homeSource: HomeSource;
}

export interface AssembleOptions {
    roster: readonly RosterMember[];
    metadata: ReadonlyMap<string, EmployeeMetadata>;
    /** Time on position, keyed by employee ID. Absent means absent from the extract. */
    performed: ReadonlyMap<string, IamatcHours>;
    /** Employees held back from the statement by the master-data check. */
    excluded?: ReadonlySet<string>;
}

export function assembleEmployees(options: AssembleOptions): AssembledEmployee[] {
    const { roster, metadata, performed, excluded } = options;

    return roster.map((member) => {
        const meta = metadata.get(member.empId);
        const kolkataJoiningDate = toIsoDate(meta?.kolkataJoiningDate);
        const dates = ratingDatesFrom(meta?.ratingData, kolkataJoiningDate);

        const fromProfile = homeFromCurrentShift(meta?.currentShift);
        const inferred = fromProfile ?? inferHome(Object.values(member.dutyCodes));
        const homeSource: HomeSource = fromProfile
            ? 'profile'
            : inferred
              ? 'inferred'
              : 'unknown';

        return {
            empId: member.empId,
            name: (meta?.name ?? '').trim() || member.name,
            designation: (meta?.designation ?? '').trim() || null,
            team: fromProfile === 'general' ? 'G' : null,
            home: inferred ?? undefined,
            homeSource,
            dutyCodes: member.dutyCodes,
            oldestRatingDate: dates.oldestRatingDate,
            oldestEndorsementDate: dates.oldestEndorsementDate,
            oldestRatingDateAnyStation: dates.oldestRatingDateAnyStation,
            kolkataJoiningDate,
            performed: performed.get(member.empId) ?? null,
            included: !excluded?.has(member.empId),
        };
    });
}
