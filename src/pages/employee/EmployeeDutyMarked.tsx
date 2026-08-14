import { useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Skeleton } from '@/components/ui/skeleton';
import {
    ClipboardCheck,
    CalendarDays,
    MapPin,
    Sunrise,
    Sun,
    Moon,
    Coffee,
    Plane,
    GraduationCap,
    CircleSlash,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import { addDays, format, isSameDay, startOfDay, subDays } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUsers';
import { useMySchedule, DUTY_DESCRIPTIONS } from '@/hooks/useEmployeeSchedules';
import { useMyRoster } from '@/hooks/useRosters';
import { toIsoRosterDate } from '@/lib/rosterDate';

// Last 7 days + today + tomorrow.
const DAYS_BACK = 7;
const DAYS_FORWARD = 1;

interface RosterDuty {
    date: string;
    shift: string;
    team: string;
    unit: string;
    position: string;
}

type ShiftKind = 'morning' | 'afternoon' | 'night' | 'rest' | 'leave' | 'training' | 'other';

/**
 * Visual treatment per shift kind. Class strings are written out in full — Tailwind
 * cannot see dynamically assembled class names.
 */
const SHIFT_STYLES: Record<ShiftKind, {
    icon: typeof Sun;
    accent: string;
    soft: string;
    text: string;
    chip: string;
    iconWrap: string;
    border: string;
    pill: string;
}> = {
    morning: {
        icon: Sunrise,
        accent: 'bg-amber-400',
        soft: 'bg-amber-100 dark:bg-amber-900/30',
        text: 'text-amber-700 dark:text-amber-400',
        chip: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
        iconWrap: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
        border: 'border-amber-400 dark:border-amber-700',
        pill: 'bg-amber-500 shadow-amber-500/40',
    },
    afternoon: {
        icon: Sun,
        accent: 'bg-sky-400',
        soft: 'bg-sky-100 dark:bg-sky-900/30',
        text: 'text-sky-700 dark:text-sky-400',
        chip: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800',
        iconWrap: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
        border: 'border-sky-400 dark:border-sky-700',
        pill: 'bg-sky-500 shadow-sky-500/40',
    },
    night: {
        icon: Moon,
        accent: 'bg-indigo-500',
        soft: 'bg-indigo-100 dark:bg-indigo-900/30',
        text: 'text-indigo-700 dark:text-indigo-400',
        chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:ring-indigo-800',
        iconWrap: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400',
        border: 'border-indigo-400 dark:border-indigo-700',
        pill: 'bg-indigo-500 shadow-indigo-500/40',
    },
    rest: {
        icon: Coffee,
        accent: 'bg-emerald-400',
        soft: 'bg-emerald-100 dark:bg-emerald-900/30',
        text: 'text-emerald-700 dark:text-emerald-400',
        chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800',
        iconWrap: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
        border: 'border-emerald-400 dark:border-emerald-700',
        pill: 'bg-emerald-500 shadow-emerald-500/40',
    },
    leave: {
        icon: Plane,
        accent: 'bg-rose-400',
        soft: 'bg-rose-100 dark:bg-rose-900/30',
        text: 'text-rose-700 dark:text-rose-400',
        chip: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800',
        iconWrap: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
        border: 'border-rose-400 dark:border-rose-700',
        pill: 'bg-rose-500 shadow-rose-500/40',
    },
    training: {
        icon: GraduationCap,
        accent: 'bg-purple-400',
        soft: 'bg-purple-100 dark:bg-purple-900/30',
        text: 'text-purple-700 dark:text-purple-400',
        chip: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:ring-purple-800',
        iconWrap: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400',
        border: 'border-purple-400 dark:border-purple-700',
        pill: 'bg-purple-500 shadow-purple-500/40',
    },
    other: {
        icon: CircleSlash,
        accent: 'bg-slate-300 dark:bg-slate-600',
        soft: 'bg-slate-100 dark:bg-slate-800',
        text: 'text-slate-600 dark:text-slate-300',
        chip: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
        iconWrap: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
        border: 'border-slate-300 dark:border-slate-600',
        pill: 'bg-slate-500 shadow-slate-500/40',
    },
};

/** Duty codes are composite ("NO+N", "SUN+M"); classify on the working part. */
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
    isFuture: boolean;
}

/** `list` arrives in ascending date order, so consecutive runs are the months. */
function groupByMonth(list: DayEntry[]) {
    const groups: { key: string; label: string; days: DayEntry[] }[] = [];
    for (const day of list) {
        const key = day.key.substring(0, 7);
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.days.push(day);
        else groups.push({ key, label: format(day.date, 'MMMM').toUpperCase(), days: [day] });
    }
    return groups;
}

export default function EmployeeDutyMarked() {
    const { user } = useAuth();
    const { profile, isLoading: profileLoading } = useUserProfile(user?.id);
    // The past week is the point of this page, so it starts expanded.
    const [showPast, setShowPast] = useState(true);

    const today = startOfDay(new Date());
    const rangeStart = subDays(today, DAYS_BACK);
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

    // Both queries stay disabled until the profile lands, and a disabled query
    // reports isLoading === false — without `!profile` the timeline would render
    // "No roster duty marked" for every day while the profile is still in flight.
    const isLoading = profileLoading || !profile || schedulesLoading || rosterLoading;

    const days = useMemo<DayEntry[]>(() => {
        const scheduleByDate = new Map(schedules.map(s => [s.duty_date, s]));

        // Roster rows may still carry a legacy date format, so normalise to ISO
        // before bucketing them by day.
        const rosterByDate = new Map<string, RosterDuty[]>();
        for (const duty of rosterDuties) {
            const key = toIsoRosterDate(duty.date);
            if (!key) continue;
            if (!rosterByDate.has(key)) rosterByDate.set(key, []);
            rosterByDate.get(key)!.push(duty);
        }

        const total = DAYS_BACK + DAYS_FORWARD + 1;
        // Oldest first — the timeline splits this into past / upcoming below.
        return Array.from({ length: total }, (_, i) => {
            const date = addDays(rangeStart, i);
            const key = format(date, 'yyyy-MM-dd');
            const schedule = scheduleByDate.get(key);
            const code = schedule?.duty_code || '';
            return {
                date,
                key,
                shift: shiftLabel(code, schedule?.duty_description),
                dutyCode: code,
                kind: shiftKind(code),
                duties: rosterByDate.get(key) || [],
                isToday: isSameDay(date, today),
                isFuture: date > today,
            };
        });
    }, [schedules, rosterDuties, rangeStart, today]);

    const { pastDays, upcomingDays } = useMemo(() => {
        const past: DayEntry[] = [], upcoming: DayEntry[] = [];
        for (const day of days) (day.isToday || day.isFuture ? upcoming : past).push(day);
        return { pastDays: past, upcomingDays: upcoming };
    }, [days]);

    const upcomingGroups = groupByMonth(upcomingDays);
    const pastGroups = groupByMonth(pastDays);

    const stats = useMemo(() => ({
        rostered: days.filter(d => d.duties.length > 0).length,
        duties: days.reduce((n, d) => n + d.duties.length, 0),
        rest: days.filter(d => d.kind === 'rest').length,
    }), [days]);

    // ── Timeline Card ──
    const TimelineCard = ({ day, highlight }: { day: DayEntry; highlight: boolean }) => {
        const style = SHIFT_STYLES[day.kind];
        const Icon = style.icon;
        const dayName = format(day.date, 'EEEE').toUpperCase();
        const borderColor = highlight ? style.border : 'border-slate-200 dark:border-neutral-800';

        return (
            <div className={`relative ${highlight ? 'mt-4' : ''}`}>
                <div className="absolute -left-[23px] top-1/2 -translate-y-1/2 w-4 h-[1px] bg-slate-200 dark:bg-neutral-800" />

                {highlight && (
                    <div className="absolute -top-3 left-3 z-20">
                        <span className={`flex items-center gap-1.5 px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-full leading-none text-white shadow-lg ${style.pill}`}>
                            {day.isToday ? "Today's Duty" : 'Tomorrow'}
                        </span>
                    </div>
                )}

                <div className={`relative flex min-h-[80px] overflow-hidden rounded-[16px] border-2 transition-all ${borderColor} ${day.isFuture ? 'border-dashed' : ''} bg-white dark:bg-neutral-900`}>
                    <div className="flex w-[74px] shrink-0 flex-col items-center justify-center py-2">
                        <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${style.text}`}>
                            {format(day.date, 'MMM').toUpperCase()}
                        </span>
                        <span className="text-xl font-bold leading-none tracking-tighter text-slate-900 dark:text-white">
                            {format(day.date, 'dd')}
                        </span>
                    </div>
                    <div className="my-auto h-8 w-[1.5px] shrink-0 bg-slate-200 dark:bg-neutral-700" />

                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-4 py-2.5">
                        <div className="flex items-center gap-2">
                            <div className={`flex size-6 shrink-0 items-center justify-center rounded-md ${style.iconWrap}`}>
                                <Icon className="size-3.5" />
                            </div>
                            <h3 className="truncate text-sm font-bold leading-tight text-slate-900 dark:text-white">
                                {day.shift || 'No shift recorded'}
                            </h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                            <div className={`rounded-full px-2 py-0.5 ${style.soft}`}>
                                <span className={`text-[8px] font-bold uppercase tracking-wider ${style.text}`}>{dayName}</span>
                            </div>
                            {day.dutyCode && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                                    {day.dutyCode}
                                </span>
                            )}
                        </div>

                        {/* Duties — unit + position reaches ~43 chars, so chips
                            wrap and break instead of overflowing the row. */}
                        {day.duties.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {day.duties.map((duty, idx) => (
                                    <span
                                        key={`${day.key}-${idx}`}
                                        className={`inline-flex max-w-full items-start gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${style.chip}`}
                                    >
                                        <MapPin className="mt-[2px] size-3 shrink-0 opacity-70" />
                                        <span className="min-w-0 break-words">
                                            {duty.unit || '—'}
                                            {duty.position && <span className="opacity-70"> · {duty.position}</span>}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <span className="text-[11px] italic text-slate-400 dark:text-neutral-500">
                                No roster duty marked
                            </span>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const MonthHeader = ({ label, count, past }: { label: string; count: number; past: boolean }) => (
        <div className={`flex items-center relative mb-3 ${past ? '' : 'sticky top-0 z-20 bg-background/95 backdrop-blur-sm -mx-2 px-2 py-2 rounded-lg'}`}>
            <div className={`absolute -left-[31px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${past
                ? 'bg-slate-400 dark:bg-neutral-600 ring-4 ring-slate-100/80 dark:ring-neutral-900/80'
                : 'bg-blue-500 ring-4 ring-white dark:ring-neutral-950'
                }`} />
            <span className={`text-xs font-bold uppercase tracking-[0.15em] ${past ? 'text-slate-500 dark:text-neutral-400' : 'text-slate-400 dark:text-neutral-500'}`}>
                {label} <span className="mx-1 text-slate-300 dark:text-neutral-700">/</span> {count} {count === 1 ? 'DAY' : 'DAYS'}
            </span>
        </div>
    );

    return (
        <DashboardLayout role="employee">
            <div className="max-w-4xl mx-auto space-y-5">
                {/* ── Header ── */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400 md:size-10">
                            <ClipboardCheck className="size-4 md:size-5" />
                        </div>
                        <div>
                            <h1 className="text-lg font-black tracking-tight text-gray-900 dark:text-gray-100 md:text-2xl">
                                Duty Marked
                            </h1>
                            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground md:text-sm">
                                <CalendarDays className="size-3.5 shrink-0" />
                                <span>
                                    {format(rangeStart, 'd MMM')} – {format(rangeEnd, 'd MMM yyyy')}
                                </span>
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {[
                            { label: 'Rostered', value: stats.rostered },
                            { label: 'Duties', value: stats.duties },
                            { label: 'Off days', value: stats.rest },
                        ].map(s => (
                            <div
                                key={s.label}
                                className="flex items-baseline gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 dark:border-gray-700 dark:bg-gray-800"
                            >
                                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                    {isLoading ? '–' : s.value}
                                </span>
                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                    {s.label}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ══════════════════════════════════════ */}
                {/* ── TIMELINE ── */}
                {/* ══════════════════════════════════════ */}
                {isLoading ? (
                    <div className="relative pb-8">
                        <div className="absolute left-[3px] top-0 bottom-0 w-[1px] bg-slate-200 dark:bg-neutral-800" />
                        <div className="space-y-3 pl-8">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="h-[80px] w-full rounded-[16px]" />
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="relative pb-8">
                        <div className="absolute left-[3px] top-0 bottom-0 w-[1px] bg-slate-200 dark:bg-neutral-800" />

                        {/* Today */}
                        <div className="relative pl-8 mb-8 flex items-center">
                            <div className="absolute -left-[5px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-indigo-500 ring-4 ring-indigo-500/20 z-10" />
                            <div className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800/30 flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">
                                    Today • {format(today, 'dd MMM yyyy')}
                                </span>
                            </div>
                        </div>

                        {/* Today + tomorrow */}
                        {upcomingGroups.map((group, groupIdx) => (
                            <div key={group.key} className="pb-8 relative pl-8">
                                <MonthHeader label={group.label} count={group.days.length} past={false} />
                                <div className="space-y-3">
                                    {group.days.map((day, idx) => (
                                        <TimelineCard key={day.key} day={day} highlight={groupIdx === 0 && idx === 0} />
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Past week */}
                        {pastDays.length > 0 && (
                            <div className="relative mt-4 bg-slate-100/50 dark:bg-black/20 -mx-4 px-4 pt-6 pb-6 border-t border-slate-200 dark:border-neutral-800/50 rounded-b-xl">
                                <div className="absolute left-[7px] top-0 bottom-0 w-[1px] bg-slate-300 dark:bg-neutral-800" />
                                <div className="flex items-center justify-end pb-4">
                                    <button
                                        onClick={() => setShowPast(!showPast)}
                                        className="flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest hover:underline"
                                    >
                                        ({pastDays.length} Past Days) {showPast ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    </button>
                                </div>
                                {showPast && pastGroups.map(group => (
                                    <div key={group.key} className="pb-6 relative pl-8">
                                        <MonthHeader label={group.label} count={group.days.length} past />
                                        <div className="space-y-3 opacity-80">
                                            {group.days.map(day => (
                                                <TimelineCard key={day.key} day={day} highlight={false} />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Legend */}
                {!isLoading && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/40">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                            Shift
                        </span>
                        {([
                            ['morning', 'Morning'],
                            ['afternoon', 'Afternoon'],
                            ['night', 'Night'],
                            ['rest', 'Off / Rest'],
                            ['leave', 'Leave'],
                            ['training', 'Training'],
                        ] as [ShiftKind, string][]).map(([kind, label]) => (
                            <span key={kind} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
                                <span className={`size-2 rounded-full ${SHIFT_STYLES[kind].accent}`} />
                                {label}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
