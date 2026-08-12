import { CalendarClock, Clock, MapPin, Pencil, TimerReset } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
    formatDaysLeft,
    formatOjtHours,
    formatOjtRatio,
    getOjtBandClass,
    getOjtBandLabel,
    getOjtCompletionPercent,
    getOjtRatioTextClass,
} from '@/domain/ojt';
import type { OjtProgress } from '@/domain/ojt';

import { GmExtensionAlert } from './GmExtensionAlert';
import { TraineeMilestoneChip } from './TraineeMilestoneChip';
import { formatOjtDate } from './formatOjtDate';

export interface OjtCardRecord extends OjtProgress {
    empId: string;
    unit: string;
    employeeName: string;
    designation: string | null;
    requiredHours: number | null;
    requiredDays: number | null;
    performedHours: number | null;
    performedDays: number | null;
    startDate: string | null;
    currentStation?: string | null;
    startDateSource?: 'app' | 'sheet' | null;
    profileLinked?: boolean;
    /** Milestone carried over from Trainee Details, when one is set. */
    traineeStatus?: string | null;
    traineeStatusDate?: string | null;
}

export function OjtProgressCard({
    record,
    audience,
    onEdit,
}: {
    record: OjtCardRecord;
    audience: 'employee' | 'supervisor';
    onEdit?: (record: OjtCardRecord) => void;
}) {
    const percent = getOjtCompletionPercent(record.requiredHours, record.performedHours);
    const showRatio = record.ratio !== null;
    // Nothing logged yet: the countdown has not begun, so every derived figure
    // on this card is deliberately blank rather than zero.
    const notStarted = record.band === 'NOT_STARTED';

    return (
        <Card className="overflow-hidden">
            <CardContent className="space-y-3 p-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                            {audience === 'employee' ? `${record.unit} OJT` : record.employeeName}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            {audience === 'supervisor' && (
                                <>
                                    <span className="font-mono">{record.empId}</span>
                                    <span aria-hidden>·</span>
                                    <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-medium">
                                        {record.unit}
                                    </Badge>
                                </>
                            )}
                            {record.designation && <span>{record.designation}</span>}
                            {record.currentStation && (
                                <span className="inline-flex items-center gap-0.5">
                                    <MapPin className="h-3 w-3" />
                                    {record.currentStation}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant="outline" className={`rounded-full text-[10px] ${getOjtBandClass(record.band)}`}>
                            {getOjtBandLabel(record.band)}
                        </Badge>
                        {onEdit && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => onEdit(record)}
                                aria-label={`Edit OJT record for ${record.employeeName} in ${record.unit}`}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                        )}
                    </div>
                </div>

                {/* Hours progress */}
                <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between text-xs">
                        <span className="text-muted-foreground">Hours</span>
                        <span className="font-medium tabular-nums">
                            {formatOjtHours(record.performedHours)} / {formatOjtHours(record.requiredHours)}
                        </span>
                    </div>
                    <Progress
                        value={percent}
                        className="h-1.5"
                        indicatorClassName="bg-emerald-500 dark:bg-emerald-400"
                    />
                    <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
                        <span>{Math.round(percent)}% complete</span>
                        <span className="tabular-nums">
                            {notStarted ? 'Not started' : `${formatOjtHours(record.hoursLeft)} left`}
                        </span>
                    </div>
                </div>

                {/* Ratio + deadline */}
                <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3">
                    <div className="space-y-0.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Required rate</p>
                        {showRatio ? (
                            <>
                                <p className={`text-xl font-semibold tabular-nums ${getOjtRatioTextClass(record.band)}`}>
                                    {formatOjtRatio(record.ratio)}
                                </p>
                                <p className="text-[10px] text-muted-foreground">hrs / day</p>
                            </>
                        ) : (
                            <p className="pt-1 text-sm font-medium text-muted-foreground">
                                {record.band === 'HOURS_COMPLETE' && 'Requirement met'}
                                {record.band === 'NOT_STARTED' && 'Not started'}
                                {record.band !== 'HOURS_COMPLETE' && record.band !== 'NOT_STARTED' && 'Not applicable'}
                            </p>
                        )}
                    </div>

                    <div className="space-y-0.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Deadline</p>
                        <p className="text-sm font-medium">{formatOjtDate(record.deadline)}</p>
                        <p
                            className={`text-[11px] tabular-nums ${
                                record.daysLeft !== null && record.daysLeft < 0
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-muted-foreground'
                            }`}
                        >
                            {notStarted ? 'Not counted yet' : formatDaysLeft(record.daysLeft)}
                        </p>
                    </div>
                </div>

                {/* Facts */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <CalendarClock className="h-3 w-3" />
                        Started {formatOjtDate(record.startDate)}
                        {record.startDateSource === 'app' && (
                            <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400">(app)</span>
                        )}
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <TimerReset className="h-3 w-3" />
                        Duty days {record.performedDays ?? '—'} / {record.requiredDays ?? '—'}
                    </span>
                </div>

                {/* Pre-board / board milestone, when Trainee Details has one */}
                {record.traineeStatus && (
                    <div className="flex items-center gap-1.5 border-t pt-2">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Milestone</span>
                        <TraineeMilestoneChip status={record.traineeStatus} date={record.traineeStatusDate} />
                    </div>
                )}

                {/* Flags — never a replacement for the band */}
                {((record.notStarted && !notStarted) || record.daysRequirementMet || record.profileLinked === false) && (
                    <div className="flex flex-wrap gap-1.5">
                        {/* Only when the band says something else; otherwise it repeats it. */}
                        {record.notStarted && !notStarted && (
                            <Badge variant="outline" className="rounded-full border-slate-300 text-[10px] font-normal text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                <Clock className="mr-1 h-3 w-3" />
                                No hours logged
                            </Badge>
                        )}
                        {record.daysRequirementMet && (
                            <Badge variant="outline" className="rounded-full border-emerald-300 text-[10px] font-normal text-emerald-700 dark:border-emerald-900 dark:text-emerald-300">
                                Duty days met
                            </Badge>
                        )}
                        {record.profileLinked === false && (
                            <Badge variant="outline" className="rounded-full border-amber-300 text-[10px] font-normal text-amber-700 dark:border-amber-900 dark:text-amber-300">
                                No app account
                            </Badge>
                        )}
                    </div>
                )}

                {record.requiresGmExtension && <GmExtensionAlert progress={record} audience={audience} />}
            </CardContent>
        </Card>
    );
}
