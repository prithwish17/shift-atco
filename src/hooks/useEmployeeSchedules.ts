import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { eachDayOfInterval, format, isAfter, isBefore, parseISO } from 'date-fns';
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from '@/lib/scheduleQueryConfig';

// Duty code legend from Google Sheet
export const DUTY_CODES = [
    'M', 'A', 'N', 'NO', 'CO', 'M+A', 'NO+N', 'LEAVE',
    'SAT', 'SUN', 'G', 'T', 'CH', 'NH', 'SAT+NO', 'NA',
    'SUN+N', 'SUN+M', 'SUN+A', 'SUN+NO', 'SAT+N', 'CO+N',
    'SL', 'Tr', 'CO+A', 'CO+M', 'GO', 'A+M',
] as const;

export type DutyCode = (typeof DUTY_CODES)[number];

// Duty code descriptions
export const DUTY_DESCRIPTIONS: Record<string, string> = {
    M: 'Morning Shift',
    A: 'Afternoon Shift',
    N: 'Night Shift',
    NO: 'Night Off',
    CO: 'Comp Off',
    'M+A': 'Morning + Afternoon',
    'NO+N': 'Night Off + Night',
    LEAVE: 'Leave',
    SAT: 'Saturday',
    SUN: 'Sunday',
    G: 'General',
    T: 'Training',
    CH: 'Compensatory Holiday',
    NH: 'National Holiday',
    'SAT+NO': 'Saturday + Night Off',
    NA: 'Not Available',
    'SUN+N': 'Sunday + Night',
    'SUN+M': 'Sunday + Morning',
    'SUN+A': 'Sunday + Afternoon',
    'SUN+NO': 'Sunday + Night Off',
    'SAT+N': 'Saturday + Night',
    'CO+N': 'Comp Off + Night',
    SL: 'Sick Leave',
    Tr: 'Transfer',
    'CO+A': 'Comp Off + Afternoon',
    'CO+M': 'Comp Off + Morning',
    GO: 'Gazette Off',
    'A+M': 'Afternoon + Morning',
};

export interface EmployeeSchedule {
    id: string;
    employee_code: string;
    employee_name: string;
    duty_date: string;
    duty_code: string;
    duty_description: string;
    created_at: string;
    updated_at: string;
}

type ApprovedLeaveRange = {
    id: string;
    start_date: string;
    end_date: string;
    leave_type: string;
};

// Query schedules with optional filters
export function useEmployeeSchedules(
    employeeCode?: string,
    startDate?: string,
    endDate?: string
) {
    return useQuery({
        queryKey: scheduleKeys.employee(employeeCode, startDate, endDate),
        ...SCHEDULE_QUERY_OPTIONS,
        queryFn: async () => {
            let query = supabase
                .from('employee_schedules' as any)
                .select('*')
                .order('duty_date');

            if (employeeCode) query = query.eq('employee_code', employeeCode);
            if (startDate) query = query.gte('duty_date', startDate);
            if (endDate) query = query.lte('duty_date', endDate);

            const { data, error } = await query;
            if (error) {
                throw error;
            }
            const schedules = (data || []) as unknown as EmployeeSchedule[];

            // Resolve auth user id from employee code so leave_requests can be joined.
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('id, full_name')
                .eq('employee_id', employeeCode)
                .maybeSingle();

            if (profileError) {
                // Non-fatal: continue without leave overlay
            }

            if (!profile?.id) {
                return schedules;
            }

            // Keep leave query bounded to the same date window as schedule query.
            let leaveStart = startDate || null;
            let leaveEnd = endDate || null;
            if (!leaveStart && schedules.length > 0) leaveStart = schedules[0].duty_date;
            if (!leaveEnd && schedules.length > 0) leaveEnd = schedules[schedules.length - 1].duty_date;

            let leaveQuery = supabase
                .from('leave_requests' as any)
                .select('id, start_date, end_date, leave_type')
                .eq('employee_id', profile.id)
                .eq('status', 'Approved')
                .order('start_date', { ascending: true });

            if (leaveStart) leaveQuery = leaveQuery.lte('start_date', leaveEnd || leaveStart);
            if (leaveEnd) leaveQuery = leaveQuery.gte('end_date', leaveStart || leaveEnd);

            const { data: leaves, error: leavesError } = await leaveQuery;
            if (leavesError) {
                // Don't throw — return schedules without leave overlay
                return schedules;
            }

            const approvedLeaves = (leaves || []) as unknown as ApprovedLeaveRange[];
            if (approvedLeaves.length === 0) {
                return schedules;
            }

            const scheduleByDate = new Map<string, EmployeeSchedule>(
                schedules.map((s) => [s.duty_date, s])
            );

            for (const leave of approvedLeaves) {
                const leaveFrom = parseISO(leave.start_date);
                const leaveTo = parseISO(leave.end_date);
                if (isAfter(leaveFrom, leaveTo)) continue;

                let from = leaveFrom;
                let to = leaveTo;

                if (leaveStart) {
                    const boundedFrom = parseISO(leaveStart);
                    if (isBefore(from, boundedFrom)) from = boundedFrom;
                }
                if (leaveEnd) {
                    const boundedTo = parseISO(leaveEnd);
                    if (isAfter(to, boundedTo)) to = boundedTo;
                }
                if (isAfter(from, to)) continue;

                const leaveDays = eachDayOfInterval({ start: from, end: to });
                for (const day of leaveDays) {
                    const dutyDate = format(day, 'yyyy-MM-dd');
                    const existing = scheduleByDate.get(dutyDate);
                    scheduleByDate.set(dutyDate, {
                        id: existing?.id || `leave-${leave.id}-${dutyDate}`,
                        employee_code: existing?.employee_code || employeeCode,
                        employee_name: existing?.employee_name || profile.full_name || '',
                        duty_date: dutyDate,
                        duty_code: 'LEAVE',
                        duty_description: leave.leave_type
                            ? `Approved Leave (${leave.leave_type})`
                            : 'Approved Leave',
                        created_at: existing?.created_at || '',
                        updated_at: existing?.updated_at || '',
                    });
                }
            }

            return Array.from(scheduleByDate.values()).sort((a, b) =>
                a.duty_date.localeCompare(b.duty_date)
            );
        },
        enabled: !!employeeCode,
    });
}

// Convenience hook: get schedule for the current logged-in user
export function useMySchedule(employeeId?: string, startDate?: string, endDate?: string) {
    return useEmployeeSchedules(employeeId, startDate, endDate);
}

// Trigger the edge function to fetch schedules from Google Sheets
export function useFetchSchedule() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.functions.invoke('fetch-schedule', { body: {} });
            if (!error) return data;

            // In some local networks, direct calls to *.supabase.co Edge Functions fail.
            // Retry via deployed Vercel proxy in dev as a fallback.
            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw error;

                const base =
                    import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL ||
                    'https://shift-atco.vercel.app';

                const res = await fetch(`${base}/api/functions/fetch-schedule`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                });

                if (res.ok) return res.json();

                const errBody = await res.json().catch(() => ({}));
                throw new Error(
                    errBody.error ||
                    error.message ||
                    `Edge function failed via proxy: HTTP ${res.status}`
                );
            }

            throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: scheduleKeys.all });
        },
    });
}

// Update a single schedule entry (duty code)
export function useUpdateSchedule() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            duty_code,
            duty_description,
        }: {
            id: string;
            duty_code: string;
            duty_description: string;
        }) => {
            const { error } = await supabase
                .from('employee_schedules' as any)
                .update({ duty_code, duty_description } as any)
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: scheduleKeys.all });
        },
    });
}
