/**
 * The day-by-day working behind one employee's accrual.
 *
 * The spreadsheet's worst property was that no figure could be traced back to
 * the days that produced it — a controller asking "why is my requirement 53
 * hours" had no answer. Every cell here shows its duty code, what it charged,
 * and which rule set that charge.
 */

import { cn } from '@/lib/utils';
import { formatDuration } from '@/domain/sarc';
import type { ChargeReason, DayCharge, DutyBlock, SarcRow } from '@/domain/sarc';

const REASON_LABEL: Record<ChargeReason, string> = {
    skipped: 'Not on roster',
    span: 'Inside a qualifying block',
    home: 'Home rate',
    'fallback-general': 'No qualifying shift block — whole period at 0.5/day',
    'fallback-shift': 'No qualifying general block — whole period at 1.0/day',
};

function cellClass(day: DayCharge): string {
    if (day.dayClass === 'skipped') return 'bg-muted/40 text-muted-foreground border-dashed';
    if (day.span === 'general') return 'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-100 dark:border-sky-800';
    if (day.span === 'shift') return 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800';
    if (day.reason.startsWith('fallback')) return 'bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-950 dark:text-violet-100 dark:border-violet-800';
    return 'bg-background border-border';
}

function blockLabel(block: DutyBlock): string {
    const type = block.type === 'general' ? 'General' : 'Shift';
    return block.qualifies
        ? `${type} block — ${block.dutyCount} duties, charged at ${block.type === 'general' ? '0.5' : '1.0'}/day`
        : `${type} run — only ${block.dutyCount} ${block.dutyCount === 1 ? 'duty' : 'duties'}, does not qualify`;
}

export function SarcDayStrip({ row }: { row: SarcRow }) {
    const qualifying = row.blocks.filter((block) => block.qualifies);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                    Home rate:{' '}
                    <span className="font-medium">
                        {row.home === 'general' ? '0.5 hr/day (general)' : '1.0 hr/day (shift)'}
                    </span>
                </span>
                <span>
                    On roster: <span className="font-medium">{row.daysOnRoster} of {row.days.length} days</span>
                </span>
                <span>
                    Qualifying blocks: <span className="font-medium">{qualifying.length}</span>
                </span>
                {row.kolkataJoiningDate && (
                    <span>
                        Joined Kolkata: <span className="font-medium">{row.kolkataJoiningDate}</span>
                    </span>
                )}
                {row.oldestRatingDate ? (
                    <span>
                        Rating counted: <span className="font-medium">{row.oldestRatingDate}</span>
                    </span>
                ) : row.oldestRatingDateAnyStation ? (
                    <span className="text-muted-foreground">
                        Rated <span className="font-medium">{row.oldestRatingDateAnyStation}</span>,
                        before joining Kolkata
                    </span>
                ) : null}
            </div>

            <div className="flex flex-wrap gap-1">
                {row.days.map((day) => (
                    <div
                        key={day.date}
                        title={`${day.date} · ${day.code || 'no duty'} · ${formatDuration(day.charge)} · ${REASON_LABEL[day.reason]}`}
                        className={cn(
                            'flex w-14 flex-col items-center rounded border px-1 py-0.5 text-[10px] leading-tight',
                            cellClass(day),
                        )}
                    >
                        <span className="opacity-60">{day.date.slice(8)}</span>
                        <span className="truncate font-medium">{day.code || '—'}</span>
                        <span className="tabular-nums">{day.charge ? formatDuration(day.charge) : '·'}</span>
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <LegendSwatch className="bg-sky-100 border-sky-300 dark:bg-sky-950 dark:border-sky-800" label="General span — 0.5/day" />
                <LegendSwatch className="bg-amber-100 border-amber-300 dark:bg-amber-950 dark:border-amber-800" label="Shift span — 1.0/day" />
                <LegendSwatch className="bg-violet-100 border-violet-300 dark:bg-violet-950 dark:border-violet-800" label="Whole-period fallback" />
                <LegendSwatch className="bg-background border-border" label="Home rate" />
                <LegendSwatch className="bg-muted/40 border-dashed" label="Not on roster" />
            </div>

            {row.blocks.length > 0 && (
                <div className="space-y-1 text-sm">
                    <p className="font-medium">Blocks</p>
                    <ul className="space-y-0.5 text-muted-foreground">
                        {row.blocks.map((block, index) => (
                            <li key={`${block.type}-${block.startIndex}-${index}`}>
                                <span className="tabular-nums">
                                    {row.days[block.startIndex]?.date} → {row.days[block.endIndex]?.date}
                                </span>
                                {' · '}
                                {blockLabel(block)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {row.warnings.length > 0 && (
                <div className="space-y-1 text-sm">
                    <p className="font-medium">Notes</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                        {row.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
    return (
        <span className="flex items-center gap-1.5">
            <span className={cn('h-3 w-3 rounded border', className)} />
            {label}
        </span>
    );
}
