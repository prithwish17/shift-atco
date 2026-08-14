/**
 * SARC — Stress Allowance Recovery Calculator, domain types.
 *
 * Ported from the "SARC" Google Sheet. The authoritative specification is
 * SARC_IMPLEMENTATION_PLAN.md §1; every rule below cites the section it
 * implements. Where this module departs from the sheet, §2 of that document
 * records the reason and the measured impact.
 *
 * Durations are whole seconds throughout. The source data is `h:mm:ss`, the
 * charging rules move in half-hours, and the IAMATC weighted total truncates
 * to the minute — integers make all three exact and keep float drift out of a
 * calculation that decides pay.
 */

/** A duration in whole seconds. */
export type Seconds = number;

/** How a single day's duty code is treated by the charging rules (§1.2). */
export type DayClass =
    /** Blank or `#N/A`. Contributes nothing and does not break a block. */
    | 'skipped'
    /** `G`. */
    | 'general'
    /** `M`, `A`, `N`, `NO`, compounds — anything not otherwise classified. */
    | 'shift'
    /** Leave, weekends, holidays and training. Bridges a block without counting toward the 5. */
    | 'bridging';

/** Which rate an employee falls back to outside any qualifying block (§1.1). */
export type HomeCategory = 'general' | 'shift';

/** Why a given day was charged what it was — drives the UI drill-down. */
export type ChargeReason =
    /** Skipped day, charged nothing. */
    | 'skipped'
    /** Inside a qualifying block span; charged at that span's rate. */
    | 'span'
    /** Outside every qualifying span; charged at the employee's home rate. */
    | 'home'
    /** No qualifying shift block in the period — whole period at 0.5/day. */
    | 'fallback-general'
    /** No qualifying general block in the period — whole period at 1.0/day. */
    | 'fallback-shift';

/** The reporting period, inclusive at both ends. ISO `YYYY-MM-DD`. */
export interface SarcPeriod {
    start: string;
    end: string;
}

/**
 * Time on position for one employee, from the IAMATC extract.
 *
 * Letters match the extract's own column headers so the file importer's
 * mapping stays legible against the spreadsheet an operator is looking at.
 */
export interface IamatcHours {
    /** Controlling (A). */
    controlling: Seconds;
    /** OJT Practical (B). */
    ojtPractical: Seconds;
    /** OJTI Theory/Sim (C). */
    ojtiTheory: Seconds;
    /** WSO/CMD (D). */
    wsoCmd: Seconds;
    /** Instructor/Examiner duty (E). */
    instructorExaminer: Seconds;
    /** Unit Supervisor (F). */
    unitSupervisor: Seconds;
    /** Supportive Unit (G). */
    supportiveUnit: Seconds;
    /** Alpha (H). */
    alpha: Seconds;
}

/** One employee's inputs for a period. */
export interface SarcEmployeeInput {
    empId: string;
    name: string;
    designation: string | null;

    /**
     * Roster team. `G` is the general team; `A`–`E` are shift teams (§1.1).
     * A null or unrecognised team falls back to shift, matching the sheet's
     * `IF(TRIM(team)="G", 1, 0)`.
     */
    team: string | null;

    /**
     * Home category, overriding whatever `team` implies.
     *
     * Set when the team had to be resolved some other way — the roster team is
     * carried on `profiles`, which only exists for employees with an app
     * account, so for everyone else it is inferred from the duty-code mix. An
     * explicit category avoids inventing a fake team letter to stand for
     * "a shift team, but we do not know which".
     */
    home?: HomeCategory;

    /**
     * Duty code per ISO `YYYY-MM-DD` date. Dates absent from the map are
     * skipped days, which is how roster drift handles itself: an employee
     * missing from one month's sheet simply has no keys for it (§2.10).
     */
    dutyCodes: Readonly<Record<string, string | null>>;

    /**
     * Earliest rating date **that counts for Kolkata** — the oldest rating on
     * or after `kolkataJoiningDate`. A rating earned at a previous station is
     * not a Kolkata rating, so it does not anchor a requirement here. Null
     * means exempt: no rating, no qualifying rating, or no joining date.
     */
    oldestRatingDate: string | null;

    /**
     * Date the controller joined Kolkata, ISO. From the ATCO master list.
     *
     * Absent means exempt — and a reported error, not a silent pass: without it
     * there is no way to tell which of their ratings were earned here.
     */
    kolkataJoiningDate?: string | null;

    /**
     * Earliest rating at any station, ignoring the joining date. Never used in
     * the arithmetic; it is what lets the UI say "rated 2016, joined Kolkata
     * 2026" instead of a bare "exempt".
     */
    oldestRatingDateAnyStation?: string | null;

    /**
     * Earliest endorsement date, ISO. Its *presence* gates the requirement;
     * the value itself never enters the arithmetic (§1.5, §2.11).
     */
    oldestEndorsementDate: string | null;

    /** Time on position, or null when the employee is absent from the extract. */
    performed: IamatcHours | null;

    /**
     * False excludes the employee from the Annexure while still computing
     * their row — the master-data check (§2.11). Defaults to true.
     */
    included?: boolean;
}

export interface SarcInput {
    period: SarcPeriod;
    employees: readonly SarcEmployeeInput[];
}

/**
 * A maximal run of one duty type (§1.3).
 *
 * A run survives bridging and skipped days and terminates on a duty of the
 * other type, so spans of the two types can never overlap and a bridging day
 * belongs to at most one span.
 */
export interface DutyBlock {
    type: 'general' | 'shift';
    /** Index of the run's first duty of this type, into the period's date list. */
    startIndex: number;
    /** Index of the run's last duty of this type. The span is [start, end]. */
    endIndex: number;
    /** Duties of this type inside the run — bridging days are not counted. */
    dutyCount: number;
    /** True at `dutyCount >= 5`. Only qualifying blocks set a rate. */
    qualifies: boolean;
}

/** One day of the period, with the rate it drew and why. */
export interface DayCharge {
    date: string;
    code: string | null;
    dayClass: DayClass;
    charge: Seconds;
    /** The qualifying span this day sat inside, if any. */
    span: 'general' | 'shift' | null;
    reason: ChargeReason;
}

/** Which IAMATC column supplied an employee's performed hours (§1.5). */
export type PerformedSource = 'totalTimeIn' | 'weightedTotal';

/** A fully evaluated employee. */
export interface SarcRow {
    empId: string;
    name: string;
    designation: string | null;
    included: boolean;

    home: HomeCategory;
    /** True when more than half the period's days are `G` (§1.5). */
    isGeneral: boolean;
    /** Days with a duty code — the period length minus skipped days. */
    daysOnRoster: number;

    blocks: readonly DutyBlock[];
    days: readonly DayCharge[];

    /** Sum of the daily charges, before the cap (§1.4). */
    required: Seconds;
    /** After the monthly-standard cap (§1.5). */
    adjusted: Seconds;

    oldestRatingDate: string | null;
    oldestEndorsementDate: string | null;
    kolkataJoiningDate: string | null;
    /** Earliest rating at any station — context for an exemption, never arithmetic. */
    oldestRatingDateAnyStation: string | null;

    /**
     * The requirement actually recovered against, after the mid-period rating
     * pro-rate. Null means exempt — no rating date, no endorsement date, or a
     * rating that postdates the period (§1.5).
     */
    requirement: Seconds | null;

    performed: Seconds | null;
    performedSource: PerformedSource | null;

    /**
     * Shortfall as a fraction of the requirement, floored at 0. Null when the
     * employee is exempt, or when they are missing from the IAMATC extract —
     * absence is not the same as having performed nothing, and must not be
     * reported as 100% recovery.
     */
    recovery: number | null;

    /** Data problems worth an operator's attention. Never blocks calculation. */
    warnings: string[];
}

/** One line of the Annexure-2 statement. */
export interface AnnexureRow {
    empId: string;
    name: string;
    designation: string | null;
    /** Null renders as blank — the employee is exempt. */
    requirement: Seconds | null;
    performed: Seconds | null;
    recovery: number | null;
}

export interface AnnexureReport {
    title: string;
    period: SarcPeriod;
    rows: readonly AnnexureRow[];
    /** Employees excluded by the master-data check, in roster order. */
    excluded: readonly SarcRow[];
}
