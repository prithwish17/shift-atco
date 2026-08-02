import { useMemo } from 'react';
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
} from 'lucide-react';
import { addDays, format, isSameDay, startOfDay, subDays } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUsers';
import { useMySchedule, DUTY_DESCRIPTIONS } from '@/hooks/useEmployeeSchedules';
import { getRosterDateQueryValues, toIsoRosterDate } from '@/lib/rosterDate';

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
    chip: string;
    iconWrap: string;
}> = {
    morning: {
        icon: Sunrise,
        accent: 'bg-amber-400',
        chip: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
        iconWrap: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
    },
    afternoon: {
        icon: Sun,
        accent: 'bg-sky-400',
        chip: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800',
        iconWrap: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400',
    },
    night: {
        icon: Moon,
        accent: 'bg-indigo-500',
        chip: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:ring-indigo-800',
        iconWrap: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400',
    },
    rest: {
        icon: Coffee,
        accent: 'bg-emerald-400',
        chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800',
        iconWrap: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
    },
    leave: {
        icon: Plane,
        accent: 'bg-rose-400',
        chip: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800',
        iconWrap: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
    },
    training: {
        icon: GraduationCap,
        accent: 'bg-purple-400',
        chip: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:ring-purple-800',
        iconWrap: 'bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400',
    },
    other: {
        icon: CircleSlash,
        accent: 'bg-slate-300 dark:bg-slate-600',
        chip: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
        iconWrap: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
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

/** Roster duties for one employee across a date range. */
function useMyRosterRange(employeeName?: string, from?: string, to?: string) {
    return useQuery({
        queryKey: ['duty-marked-roster', employeeName, from, to],
        enabled: !!employeeName && !!from && !!to,
        staleTime: 60_000,
        queryFn: async () => {
            // rosters.date is canonical ISO, but older rows may still carry one of
            // the webapp's legacy formats — query every variant for each day.
            const dateValues = new Set<string>();
            let cursor = new Date(`${from}T00:00:00`);
            const end = new Date(`${to}T00:00:00`);
            while (cursor <= end) {
                getRosterDateQueryValues(format(cursor, 'yyyy-MM-dd')).forEach(v => dateValues.add(v));
                cursor = addDays(cursor, 1);
            }

            const { data, error } = await (supabase.from('rosters' as any) as any)
                .select('date, shift, team, unit, position, employee_name')
                .ilike('employee_name', employeeName!)
                .in('date', Array.from(dateValues));

            if (error) throw error;
            return (data || []) as RosterDuty[];
        },
    });
}

function shiftLabel(dutyCode?: string, dutyDescription?: string) {
    const code = (dutyCode || '').trim();
    if (!code) return dutyDescription || '';
    return DUTY_DESCRIPTIONS[code] || dutyDescription || code;
}

export default function EmployeeDutyMarked() {
    const { user } = useAuth();
    const { profile, isLoading: profileLoading } = useUserProfile(user?.id);

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
    const { data: rosterDuties = [], isLoading: rosterLoading } = useMyRosterRange(
        profile?.full_name,
        startStr,
        endStr,
    );

    const isLoading = profileLoading || schedulesLoading || rosterLoading;

    const days = useMemo(() => {
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

    const stats = useMemo(() => ({
        rostered: days.filter(d => d.duties.length > 0).length,
        duties: days.reduce((n, d) => n + d.duties.length, 0),
        rest: days.filter(d => d.kind === 'rest').length,
    }), [days]);

    return (
        <DashboardLayout>
            <div className="space-y-4 md:space-y-6">
                {/* Hero */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-sky-600 via-cyan-500 to-teal-500 p-5 md:p-7 shadow-sm">
                    <div className="absolute -right-8 -top-10 size-40 rounded-full bg-white/10" />
                    <div className="absolute -bottom-14 right-20 size-32 rounded-full bg-white/5" />

                    <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-3 md:gap-4">
                            <div className="flex size-11 md:size-12 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                                <ClipboardCheck className="size-5 md:size-6 text-white" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-white">
                                    Duty Marked
                                </h1>
                                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] md:text-sm text-white/80">
                                    <CalendarDays className="size-3.5 shrink-0" />
                                    <span className="truncate">
                                        {format(rangeStart, 'd MMM')} – {format(rangeEnd, 'd MMM yyyy')}
                                    </span>
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 md:gap-3">
                            {[
                                { label: 'Rostered', value: stats.rostered },
                                { label: 'Duties', value: stats.duties },
                                { label: 'Off days', value: stats.rest },
                            ].map(s => (
                                <div
                                    key={s.label}
                                    className="rounded-xl bg-white/15 px-3 py-2 text-center backdrop-blur-sm md:min-w-[76px]"
                                >
                                    <div className="text-lg md:text-xl font-bold leading-none text-white">
                                        {isLoading ? '–' : s.value}
                                    </div>
                                    <div className="mt-1 text-[10px] md:text-[11px] font-medium uppercase tracking-wide text-white/75">
                                        {s.label}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Timeline */}
                {isLoading ? (
                    <div className="space-y-2.5">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {days.map(day => {
                            const style = SHIFT_STYLES[day.kind];
                            const Icon = style.icon;
                            return (
                                <div
                                    key={day.key}
                                    className={`group relative flex overflow-hidden rounded-xl border bg-white shadow-sm transition-all dark:bg-gray-800 ${
                                        day.isToday
                                            ? 'border-sky-300 ring-1 ring-sky-200 dark:border-sky-700 dark:ring-sky-900'
                                            : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                                    } ${day.isFuture ? 'border-dashed' : ''}`}
                                >
                                    {/* Shift accent */}
                                    <div className={`w-1 shrink-0 ${style.accent}`} aria-hidden />

                                    <div className="flex flex-1 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4 md:p-4">
                                        {/* Date block */}
                                        <div className="flex items-center gap-3 sm:w-[132px] sm:shrink-0">
                                            <div className="w-10 shrink-0 text-center leading-none">
                                                <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                                    {format(day.date, 'EEE')}
                                                </div>
                                                <div className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">
                                                    {format(day.date, 'd')}
                                                </div>
                                                <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                                                    {format(day.date, 'MMM')}
                                                </div>
                                            </div>
                                            {day.isToday && (
                                                <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                                                    Today
                                                </span>
                                            )}
                                            {day.isFuture && (
                                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                                                    Tomorrow
                                                </span>
                                            )}
                                        </div>

                                        {/* Shift */}
                                        <div className="flex min-w-0 items-center gap-2.5 sm:w-[190px] sm:shrink-0">
                                            <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${style.iconWrap}`}>
                                                <Icon className="size-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                    {day.shift || 'No shift recorded'}
                                                </div>
                                                {day.dutyCode && (
                                                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                                        {day.dutyCode}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Duties */}
                                        <div className="min-w-0 flex-1 sm:border-l sm:border-gray-100 sm:pl-4 sm:dark:border-gray-700">
                                            {day.duties.length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {day.duties.map((duty, idx) => (
                                                        <span
                                                            key={`${day.key}-${idx}`}
                                                            className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${style.chip}`}
                                                        >
                                                            <MapPin className="size-3 shrink-0 opacity-70" />
                                                            <span>{duty.unit || '—'}</span>
                                                            {duty.position && (
                                                                <span className="opacity-70">· {duty.position}</span>
                                                            )}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-[11px] italic text-gray-400 dark:text-gray-500">
                                                    No roster duty marked
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
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
