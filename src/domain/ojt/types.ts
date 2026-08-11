/**
 * OJT progress domain types.
 *
 * The SQL mirror of this model is public.v_ojt_progress
 * (supabase/migrations/20260811120000_ojt_progress_rpcs.sql). The two are held
 * in lockstep by the golden-fixture test in ./__tests__/progress.test.ts.
 */

/**
 * Evaluation order matters. DEADLINE_PASSED is resolved before any ratio
 * comparison because a deadline in the past yields a negative days_left, and a
 * negative ratio would otherwise satisfy `ratio <= 0.4` and read as on track.
 */
export type OjtBand =
    | 'AWAITING_START_DATE'
    | 'HOURS_COMPLETE'
    | 'DEADLINE_PASSED'
    | 'ON_TRACK'
    | 'WATCH'
    | 'CRITICAL';

/** Which side of the sheet/app split supplied the effective start date. */
export type OjtStartDateSource = 'app' | 'sheet' | null;

export interface OjtProgressInput {
    /** Total OJT hours required for this unit. */
    requiredHours: number | null;
    /** Duty days required — a session count, unrelated to days-to-deadline. */
    requiredDays: number | null;
    /** Decimal hours performed so far (86.5, not "86:30"). */
    performedHours: number | null;
    /** Duty days performed — a session count. */
    performedDays: number | null;
    /** Resolved start of OJT, ISO `YYYY-MM-DD`. App override wins over sheet. */
    startDate: string | null;
    /** Set only once a GM (ATM) extension has been approved. */
    deadlineOverride?: string | null;
}

export interface OjtProgress {
    requiredMonths: number | null;
    /** ISO `YYYY-MM-DD`, or null while the start date is unknown. */
    deadline: string | null;
    /** max(0, required − performed). Never negative, never wrapped at 24h. */
    hoursLeft: number | null;
    /** Calendar days to the deadline. Negative once the deadline has passed. */
    daysLeft: number | null;
    /** Hours per day needed to finish on time. Null once daysLeft <= 0. */
    ratio: number | null;
    band: OjtBand;
    /** No hours logged yet. A flag, never a substitute for the band. */
    notStarted: boolean;
    daysRequirementMet: boolean;
    /** Fewer than 15 days left and burning above 1 h/day — escalate to GM (ATM). */
    requiresGmExtension: boolean;
}

/** One OJT cycle as returned by get_ojt_progress_records(). */
export interface OjtProgressRecord extends OjtProgress {
    empId: string;
    unit: string;
    employeeName: string;
    designation: string | null;
    requiredHours: number | null;
    requiredDays: number | null;
    performedHours: number | null;
    performedDays: number | null;
    startDate: string | null;
    startDateSource: OjtStartDateSource;
    markingDate: string | null;
    deadlineIsOverridden: boolean;
    profileLinked: boolean;
    currentStation: string | null;
    highestRating: string | null;

    /** Raw sheet side, so the UI can show "Sheet: 58:30 · you entered 61:00". */
    sheetRequiredHours: number | null;
    sheetRequiredDays: number | null;
    sheetPerformedHours: number | null;
    sheetPerformedDays: number | null;
    sheetStartDate: string | null;
    sheetSyncedAt: string | null;

    /** Raw override side — null means "this field follows the sheet". */
    overrideRequiredHours: number | null;
    overrideRequiredDays: number | null;
    overridePerformedHours: number | null;
    overridePerformedDays: number | null;
    overrideStartDate: string | null;
    overrideUpdatedAt: string | null;
    overrideUpdatedByName: string | null;
    overrideNote: string | null;

    /**
     * Milestone from Trainee Details. 'training_continue' is filtered out
     * server-side — it is the default "still going" value and tells a
     * supervisor nothing they could act on.
     */
    traineeStatus: string | null;
    /** The date belonging to that milestone, ISO `YYYY-MM-DD`. */
    traineeStatusDate: string | null;
}

/** The employee-facing subset — no sheet internals, no editor identity. */
export interface MyOjtProgressRecord extends OjtProgress {
    empId: string;
    unit: string;
    employeeName: string;
    designation: string | null;
    requiredHours: number | null;
    requiredDays: number | null;
    performedHours: number | null;
    performedDays: number | null;
    startDate: string | null;
    markingDate: string | null;
    sheetSyncedAt: string | null;
}

/** Payload accepted by the update-ojt-progress edge function. */
export interface OjtOverrideUpdate {
    override_start_date?: string | null;
    override_required_hours?: number | null;
    override_required_days?: number | null;
    override_performed_hours?: number | null;
    override_performed_days?: number | null;
    override_note?: string | null;
}
