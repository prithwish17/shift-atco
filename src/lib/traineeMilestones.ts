import { differenceInCalendarDays, format, startOfDay } from 'date-fns';

export type TraineeStatus =
    | 'status_pending'
    | 'training_continue'
    | 'training_not_continue'
    | 'preboard_complete'
    | 'preboard_not_complete'
    | 'preboard_date_fixed'
    | 'board_date_fixed'
    | 'training_completed';

export type TraineeDateField = 'preboard_completed_on' | 'preboard_scheduled_on' | 'board_scheduled_on';

export interface TraineeMilestoneSnapshot {
    unit: string | null;
    hours_required: number | null;
    status: TraineeStatus | null;
    preboard_completed_on: string | null;
    preboard_scheduled_on: string | null;
    board_scheduled_on: string | null;
}

export const TRAINEE_STATUS_OPTIONS: Array<{ value: TraineeStatus; label: string }> = [
    { value: 'status_pending', label: 'Status Pending' },
    { value: 'training_continue', label: 'Training Ongoing' },
    { value: 'training_not_continue', label: 'Training Discontinued' },
    { value: 'preboard_complete', label: 'Pre-Board Completed' },
    { value: 'preboard_not_complete', label: 'Pre-Board Pending' },
    { value: 'preboard_date_fixed', label: 'Pre-Board Scheduled' },
    { value: 'board_date_fixed', label: 'Board Scheduled' },
    { value: 'training_completed', label: 'Training Completed' },
];

export const EMPTY_TRAINEE_STATUS_VALUE = '__none__';

function getString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value : null;
}

function getNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function getObject(value: unknown) {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseDate(value: string | null | undefined) {
    if (!value) return null;
    const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getTraineeStatusLabel(value: TraineeStatus | null | undefined) {
    if (!value) return 'Status Pending';
    return TRAINEE_STATUS_OPTIONS.find((option) => option.value === value)?.label || 'Status Pending';
}

export function getTraineeStatusBadgeClass(value: TraineeStatus | null | undefined) {
    switch (value) {
        case 'status_pending':
            return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/70 dark:text-slate-200 dark:border-slate-700';
        case 'training_continue':
            return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/60';
        case 'training_not_continue':
            return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/60';
        case 'preboard_complete':
        case 'preboard_date_fixed':
            return 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-200 dark:border-sky-900/60';
        case 'preboard_not_complete':
            return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/60';
        case 'board_date_fixed':
            return 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-200 dark:border-violet-900/60';
        case 'training_completed':
            return 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700';
        default:
            return 'bg-muted text-muted-foreground border-border';
    }
}

export function formatTraineeDate(value: string | null | undefined) {
    const parsed = parseDate(value);
    if (!parsed) return value || '—';
    return format(parsed, 'dd MMM yyyy');
}

export function getRequiredTraineeDateField(status: TraineeStatus | null | undefined): TraineeDateField | null {
    switch (status) {
        case 'preboard_complete':
            return 'preboard_completed_on';
        case 'preboard_date_fixed':
            return 'preboard_scheduled_on';
        case 'board_date_fixed':
            return 'board_scheduled_on';
        default:
            return null;
    }
}

export function extractTraineeMilestone(record: Record<string, unknown> | null | undefined): TraineeMilestoneSnapshot | null {
    const source = getObject(record);
    const rawPayload = getObject(source.raw_payload);

    const snapshot: TraineeMilestoneSnapshot = {
        unit: getString(source.trainee_unit) ?? getString(rawPayload.trainee_unit),
        hours_required: getNumber(source.trainee_hours_required) ?? getNumber(rawPayload.trainee_hours_required),
        status: (getString(source.trainee_status) ?? getString(source.trainee_hr_grade) ?? getString(rawPayload.trainee_status) ?? getString(rawPayload.trainee_hr_grade)) as TraineeStatus | null,
        preboard_completed_on: getString(source.trainee_preboard_completed_on) ?? getString(rawPayload.trainee_preboard_completed_on),
        preboard_scheduled_on: getString(source.trainee_preboard_scheduled_on) ?? getString(rawPayload.trainee_preboard_scheduled_on),
        board_scheduled_on: getString(source.trainee_board_scheduled_on) ?? getString(rawPayload.trainee_board_scheduled_on),
    };

    if (!snapshot.unit && snapshot.hours_required === null && !snapshot.status && !snapshot.preboard_completed_on && !snapshot.preboard_scheduled_on && !snapshot.board_scheduled_on) {
        return null;
    }

    return snapshot;
}

export function getScheduledTraineeMilestone(snapshot: Pick<TraineeMilestoneSnapshot, 'status' | 'preboard_scheduled_on' | 'board_scheduled_on'> | null | undefined) {
    if (!snapshot) return null;

    const dateValue = snapshot.status === 'preboard_date_fixed'
        ? snapshot.preboard_scheduled_on
        : snapshot.status === 'board_date_fixed'
            ? snapshot.board_scheduled_on
            : null;

    if (!dateValue) return null;

    const parsed = parseDate(dateValue);
    if (!parsed) return null;

    const daysRemaining = differenceInCalendarDays(startOfDay(parsed), startOfDay(new Date()));
    const countdownLabel = daysRemaining === 0 ? 'Today' : daysRemaining > 0 ? `${daysRemaining}d left` : `${Math.abs(daysRemaining)}d overdue`;
    const countdownClass = daysRemaining < 0
        ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
        : snapshot.status === 'board_date_fixed'
            ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200'
            : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200';

    return {
        label: snapshot.status === 'board_date_fixed' ? 'Board Scheduled' : 'Pre-Board Scheduled',
        dateValue,
        formattedDate: format(parsed, 'dd MMM yyyy'),
        daysRemaining,
        countdownLabel,
        countdownClass,
    };
}