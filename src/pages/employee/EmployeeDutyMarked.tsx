import { useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Sunrise,
    Sun,
    Moon,
    Coffee,
    Plane,
    GraduationCap,
    CircleSlash,
    ChevronDown,
} from 'lucide-react';
import { addDays, format, isSameDay, startOfDay, subDays } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUsers';
import { useMySchedule, DUTY_DESCRIPTIONS } from '@/hooks/useEmployeeSchedules';
import { useMyRoster } from '@/hooks/useRosters';
import { toIsoRosterDate } from '@/lib/rosterDate';

// Reverse chronological timeline starting from Tomorrow (+1) and going back into past.
const DAYS_FORWARD = 1;
const DEFAULT_DAYS_BACK = 14;

interface RosterDuty {
    date: string;
    shift: string;
    team: string;
    unit: string;
    position: string;
}

type ShiftKind = 'morning' | 'afternoon' | 'night' | 'rest' | 'leave' | 'training' | 'other';

const SHIFT_STYLES: Record<ShiftKind, {
    icon: typeof Sun;
    accent: string;
    soft: string;
    text: string;
    border: string;
    dot: string;
}> = {
    morning: {
        icon: Sunrise,
        accent: 'bg-amber-400',
        soft: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
        text: 'text-amber-700 dark:text-amber-400',
        border: 'border-amber-200 dark:border-amber-800/50',
        dot: 'bg-amber-500',
    },
    afternoon: {
        icon: Sun,
        accent: 'bg-sky-400',
        soft: 'bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
        text: 'text-sky-700 dark:text-sky-400',
        border: 'border-sky-200 dark:border-sky-800/50',
        dot: 'bg-sky-500',
    },
    night: {
        icon: Moon,
        accent: 'bg-indigo-500',
        soft: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300',
        text: 'text-indigo-700 dark:text-indigo-400',
        border: 'border-indigo-200 dark:border-indigo-800/50',
        dot: 'bg-indigo-500',
    },
    rest: {
        icon: Coffee,
        accent: 'bg-emerald-400',
        soft: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
        text: 'text-emerald-700 dark:text-emerald-400',
        border: 'border-emerald-200 dark:border-emerald-800/50',
        dot: 'bg-emerald-500',
    },
    leave: {
        icon: Plane,
        accent: 'bg-rose-400',
        soft: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
        text: 'text-rose-700 dark:text-rose-400',
        border: 'border-rose-200 dark:border-rose-800/50',
        dot: 'bg-rose-500',
    },
    training: {
        icon: GraduationCap,
        accent: 'bg-purple-400',
        soft: 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300',
        text: 'text-purple-700 dark:text-purple-400',
        border: 'border-purple-200 dark:border-purple-800/50',
        dot: 'bg-purple-500',
    },
    other: {
        icon: CircleSlash,
        accent: 'bg-slate-400',
        soft: 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        text: 'text-slate-600 dark:text-slate-300',
        border: 'border-slate-200 dark:border-slate-800',
        dot: 'bg-slate-400',
    },
};

/** Classify shift kind based on duty code. */
function shiftKind(code: string): ShiftKind {
    const c = (code || '').trim().toUpperCase();
    if (!c) return 'other';
    if (c === 'T' || c === 'TR') return 'training';
    if (c === 'LEAVE' || c === 'SL') return 'leave';
    const parts = c.split('+');
    if (parts.includes('N')) return 'night';
    if (parts.includes('A')) return 'afternoon';
    if (parts.includes('M')) return 'morning';
    if (parts.includes('G') || parts.includes('GO')) return 'morning';
    if (parts.some(p => ['NO', 'CO', 'SAT', 'SUN', 'CH', 'NH'].includes(p))) return 'rest';
    return 'other';
}

function shiftLabel(dutyCode?: string, dutyDescription?: string) {
    const code = (dutyCode || '').trim();
    if (!code) return dutyDescription || '';
    return DUTY_DESCRIPTIONS[code] || dutyDescription || code;
}

interface DayEntry {
    date: Date;
    key: string;
    shift: string;
    dutyCode: string;
    kind: ShiftKind;
    duties: RosterDuty[];
    isToday: boolean;
    isTomorrow: boolean;
    isYesterday: boolean;
    isFuture: boolean;
}


export default function EmployeeDutyMarked() {
    const { user } = useAuth();
    const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
    const [daysBack, setDaysBack] = useState(DEFAULT_DAYS_BACK);
    const [expandedDuties, setExpandedDuties] = useState<Set<string>>(new Set());

    const toggleDutyExpand = (dutyKey: string) => {
        setExpandedDuties(prev => {
            const next = new Set(prev);
            if (next.has(dutyKey)) {
                next.delete(dutyKey);
            } else {
                next.add(dutyKey);
            }
            return next;
        });
    };

    const today = startOfDay(new Date());
    const rangeStart = subDays(today, daysBack);
    const rangeEnd = addDays(today, DAYS_FORWARD);
    const startStr = format(rangeStart, 'yyyy-MM-dd');
    const endStr = format(rangeEnd, 'yyyy-MM-dd');

    const { data: schedules = [], isLoading: schedulesLoading } = useMySchedule(
        profile?.employee_id,
        startStr,
        endStr,
    );
    const { data: rosterDuties = [], isLoading: rosterLoading } = useMyRoster(
        profile?.full_name,
        startStr,
        endStr,
    );

    const isLoading = profileLoading || !profile || schedulesLoading || rosterLoading;

    // Timeline items in reverse chronological order: Tomorrow -> Today -> Yesterday -> Day before yesterday -> ...
    const timelineDays = useMemo<DayEntry[]>(() => {
        const scheduleByDate = new Map(schedules.map(s => [s.duty_date, s]));

        const rosterByDate = new Map<string, RosterDuty[]>();
        for (const duty of rosterDuties) {
            const key = toIsoRosterDate(duty.date);
            if (!key) continue;
            if (!rosterByDate.has(key)) rosterByDate.set(key, []);
            rosterByDate.get(key)!.push(duty);
        }

        const list: DayEntry[] = [];
        // From Tomorrow (+1) descending to -daysBack
        for (let offset = DAYS_FORWARD; offset >= -daysBack; offset--) {
            const date = addDays(today, offset);
            const key = format(date, 'yyyy-MM-dd');
            const schedule = scheduleByDate.get(key);
            const code = schedule?.duty_code || '';
            const isTomorrow = isSameDay(date, addDays(today, 1));
            const isCurrentDay = isSameDay(date, today);
            const isYesterday = isSameDay(date, subDays(today, 1));

            list.push({
                date,
                key,
                shift: shiftLabel(code, schedule?.duty_description),
                dutyCode: code,
                kind: shiftKind(code),
                duties: rosterByDate.get(key) || [],
                isToday: isCurrentDay,
                isTomorrow,
                isYesterday,
                isFuture: date > today,
            });
        }
        return list;
    }, [schedules, rosterDuties, today, daysBack]);

    return (
        <DashboardLayout role="employee" title="Duty Marked">
            <div className="max-w-3xl mx-auto space-y-6 pb-12 pt-2 sm:pt-4">

                {/* ══════════════════════════════════════ */}
                {/* ── MINIMALIST TIMELINE ── */}
                {/* ══════════════════════════════════════ */}
                {isLoading ? (
                    <div className="relative space-y-4 before:absolute before:left-[21px] sm:before:left-[23px] before:top-4 before:bottom-4 before:w-[2px] before:bg-slate-200 dark:before:bg-neutral-800">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="relative flex items-start gap-3 sm:gap-4">
                                <div className="relative z-10 shrink-0 w-11 sm:w-12 h-12 sm:h-14 rounded-xl bg-slate-100 dark:bg-neutral-800/80 animate-pulse border border-slate-200 dark:border-neutral-800" />
                                <Skeleton className="h-20 flex-1 rounded-xl" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="relative space-y-3.5 before:absolute before:left-[21px] sm:before:left-[23px] before:top-4 before:bottom-4 before:w-[2px] before:bg-slate-200 dark:before:bg-neutral-800">
                        {timelineDays.map((entry) => {
                            const shiftDisplay = entry.shift || 'Scheduled Shift';
                            const shiftCodeTag = entry.dutyCode && !shiftDisplay.includes(entry.dutyCode) ? ` (${entry.dutyCode})` : '';

                            // Card border and background style based on relative day
                            let cardStyle = 'border-slate-200/80 bg-white dark:border-neutral-800 dark:bg-neutral-900/50 hover:border-slate-300 dark:hover:border-neutral-700';
                            let nodeBg = 'bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 text-slate-800 dark:text-neutral-200 shadow-xs';
                            let monthClass = 'text-slate-400 dark:text-neutral-500';
                            let dayNumClass = 'text-slate-900 dark:text-white';
                            let pill = null;

                            if (entry.isTomorrow) {
                                cardStyle = 'border-sky-200/90 bg-sky-50/40 dark:border-sky-900/40 dark:bg-sky-950/20 shadow-sm';
                                nodeBg = 'bg-sky-500 text-white ring-4 ring-sky-500/20 border-sky-400 shadow-sm shadow-sky-500/25';
                                monthClass = 'text-sky-100';
                                dayNumClass = 'text-white';
                                pill = (
                                    <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700 dark:bg-sky-900/60 dark:text-sky-300 shrink-0">
                                        Tomorrow
                                    </span>
                                );
                            } else if (entry.isToday) {
                                cardStyle = 'border-indigo-300 bg-indigo-50/40 dark:border-indigo-900/60 dark:bg-indigo-950/30 shadow-sm';
                                nodeBg = 'bg-indigo-600 text-white ring-4 ring-indigo-500/25 border-indigo-500 shadow-md shadow-indigo-500/30';
                                monthClass = 'text-indigo-100';
                                dayNumClass = 'text-white';
                                pill = (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 shrink-0">
                                        <span className="size-1 rounded-full bg-indigo-600 animate-pulse" />
                                        Today
                                    </span>
                                );
                            } else if (entry.isYesterday) {
                                cardStyle = 'border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/60';
                                pill = (
                                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600 dark:bg-neutral-800 dark:text-neutral-400 shrink-0">
                                        Yesterday
                                    </span>
                                );
                            }

                            return (
                                <div key={entry.key} className="relative flex items-start gap-3 sm:gap-4 group">
                                    {/* Timeline Date Node */}
                                    <div className="relative z-10 shrink-0">
                                        <div
                                            className={`w-11 sm:w-12 h-12 sm:h-14 rounded-xl flex flex-col items-center justify-center transition-all select-none ${nodeBg}`}
                                            title={format(entry.date, 'EEEE, d MMMM yyyy')}
                                        >
                                            <span className={`text-[8px] sm:text-[9px] font-bold uppercase tracking-wider leading-none ${monthClass}`}>
                                                {format(entry.date, 'MMM')}
                                            </span>
                                            <span className={`text-sm sm:text-base font-extrabold leading-none mt-1 tracking-tight ${dayNumClass}`}>
                                                {format(entry.date, 'dd')}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Minimalist Timeline Item */}
                                    <div className={`flex-1 min-w-0 rounded-xl border transition-all p-3 sm:p-4 ${cardStyle}`}>
                                        <div className="flex items-start justify-between gap-2 sm:gap-3">
                                            <div className="space-y-1 min-w-0 flex-1">
                                                {/* ── HIGHLIGHT: The Duty Marked ── */}
                                                {entry.duties.length > 0 ? (
                                                    <div className="space-y-1">
                                                        {entry.duties.map((duty, idx) => {
                                                            const assignment = [duty.unit, duty.position].filter(Boolean).join(' · ');
                                                            const dutyKey = `${entry.key}-${idx}`;
                                                            const isExpanded = expandedDuties.has(dutyKey);

                                                            return (
                                                                <button
                                                                    type="button"
                                                                    key={idx}
                                                                    onClick={() => toggleDutyExpand(dutyKey)}
                                                                    title={assignment ? `${assignment} (click to ${isExpanded ? 'collapse' : 'expand'})` : undefined}
                                                                    className={`flex items-center gap-1.5 min-w-0 max-w-full text-left cursor-pointer group/duty transition-all ${
                                                                        isExpanded ? 'flex-wrap' : ''
                                                                    }`}
                                                                >
                                                                    <span
                                                                        className={`text-[15px] sm:text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 group-hover/duty:text-indigo-600 dark:group-hover/duty:text-indigo-400 transition-colors ${
                                                                            isExpanded ? 'break-words whitespace-normal' : 'truncate'
                                                                        }`}
                                                                    >
                                                                        {assignment || 'Duty Assigned'}
                                                                    </span>
                                                                    {duty.team && (
                                                                        <span className="text-[9px] sm:text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-neutral-300 shrink-0 whitespace-nowrap">
                                                                            Team {duty.team}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (
                                                    <div className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
                                                        {entry.kind === 'rest' ? (
                                                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                                                {entry.shift || 'Clear Off'}
                                                            </span>
                                                        ) : entry.kind === 'leave' ? (
                                                            <span className="text-rose-700 dark:text-rose-400 font-semibold">
                                                                {entry.shift || 'On Leave'}
                                                            </span>
                                                        ) : entry.kind === 'training' ? (
                                                            <span className="text-purple-700 dark:text-purple-400 font-semibold">
                                                                {entry.shift || 'Training Duty'}
                                                            </span>
                                                        ) : (
                                                            <span className="text-slate-400 dark:text-neutral-500 font-normal italic text-sm sm:text-base">
                                                                No Duty Marked
                                                            </span>
                                                        )}
                                                    </div>
                                                )}

                                                {/* ── SUBTITLE: Shift & Date ── */}
                                                <p className="text-xs sm:text-sm text-slate-500 dark:text-neutral-400 flex items-center gap-1.5 font-normal truncate">
                                                    <span className="font-medium text-slate-700 dark:text-neutral-300">
                                                        {shiftDisplay}{shiftCodeTag}
                                                    </span>
                                                    <span className="text-slate-300 dark:text-neutral-600">•</span>
                                                    <span>
                                                        {format(entry.date, 'd MMM')}
                                                    </span>
                                                </p>
                                            </div>

                                            {/* Tag / Indicator */}
                                            {pill && (
                                                <div className="shrink-0 pt-0.5">
                                                    {pill}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Load more past days */}
                        <div className="pt-2 text-center">
                            <button
                                onClick={() => setDaysBack(prev => prev + 14)}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline px-3 py-1.5 rounded-lg transition-colors"
                            >
                                <ChevronDown className="size-3.5" />
                                <span>Load earlier duty history (+14 days)</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Minimalist Legend ── */}
                {!isLoading && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-slate-100 dark:border-neutral-800/80 text-[11px] text-slate-500 dark:text-neutral-400">
                        <span className="font-medium">Shift Types:</span>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {([
                                ['morning', 'Morning'],
                                ['afternoon', 'Afternoon'],
                                ['night', 'Night'],
                                ['rest', 'Rest / Off'],
                                ['leave', 'Leave'],
                                ['training', 'Training'],
                            ] as [ShiftKind, string][]).map(([kind, label]) => (
                                <span key={kind} className="inline-flex items-center gap-1.5">
                                    <span className={`size-2 rounded-full ${SHIFT_STYLES[kind].accent}`} />
                                    <span>{label}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
