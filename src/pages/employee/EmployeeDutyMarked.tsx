import { useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ClipboardCheck, CalendarDays, MapPin } from 'lucide-react';
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
            return {
                date,
                key,
                shift: shiftLabel(schedule?.duty_code, schedule?.duty_description),
                dutyCode: schedule?.duty_code || '',
                duties: rosterByDate.get(key) || [],
                isToday: isSameDay(date, today),
                isFuture: date > today,
            };
        });
    }, [schedules, rosterDuties, rangeStart, today]);

    return (
        <DashboardLayout>
            <div className="space-y-4 md:space-y-6">
                <div className="flex items-center gap-3">
                    <div className="size-9 md:size-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                        <ClipboardCheck className="size-4 md:size-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-lg md:text-2xl font-semibold text-gray-900 dark:text-gray-100">
                            Duty Marked
                        </h1>
                        <p className="text-[11px] md:text-sm text-gray-500 dark:text-gray-400">
                            Last {DAYS_BACK} days, today and tomorrow
                        </p>
                    </div>
                </div>

                <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-sm md:text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <CalendarDays className="size-4 text-gray-500 dark:text-gray-400" />
                            {format(rangeStart, 'd MMM')} – {format(rangeEnd, 'd MMM yyyy')}
                        </CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-2">
                        {isLoading && (
                            <div className="space-y-2">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                                ))}
                            </div>
                        )}

                        {!isLoading && days.map(day => (
                            <div
                                key={day.key}
                                className={`rounded-lg border p-3 md:p-4 transition-colors ${
                                    day.isToday
                                        ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-900/20'
                                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60'
                                }`}
                            >
                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                                    {/* Date */}
                                    <div className="flex items-center gap-3 shrink-0 sm:w-44">
                                        <div className="text-center leading-tight w-11 shrink-0">
                                            <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                                {format(day.date, 'EEE')}
                                            </div>
                                            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                                                {format(day.date, 'd')}
                                            </div>
                                            <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                                {format(day.date, 'MMM')}
                                            </div>
                                        </div>
                                        {day.isToday && (
                                            <Badge className="bg-indigo-600 hover:bg-indigo-600 text-white border-0 text-[10px]">
                                                Today
                                            </Badge>
                                        )}
                                        {!day.isToday && day.isFuture && (
                                            <Badge variant="outline" className="text-[10px] text-gray-600 dark:text-gray-300">
                                                Tomorrow
                                            </Badge>
                                        )}
                                    </div>

                                    {/* Shift + duties */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                                {day.shift || 'No shift recorded'}
                                            </span>
                                            {day.dutyCode && (
                                                <Badge variant="secondary" className="text-[10px] font-mono">
                                                    {day.dutyCode}
                                                </Badge>
                                            )}
                                        </div>

                                        {day.duties.length > 0 ? (
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {day.duties.map((duty, idx) => (
                                                    <span
                                                        key={`${day.key}-${idx}`}
                                                        className="inline-flex items-center gap-1 rounded-md bg-gray-100 dark:bg-gray-700/60 px-2 py-1 text-[11px] text-gray-700 dark:text-gray-200"
                                                    >
                                                        <MapPin className="size-3 text-gray-500 dark:text-gray-400" />
                                                        <span className="font-medium">{duty.unit || '—'}</span>
                                                        {duty.position && (
                                                            <span className="text-gray-500 dark:text-gray-400">
                                                                · {duty.position}
                                                            </span>
                                                        )}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                                                No roster duty marked — shift only
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
