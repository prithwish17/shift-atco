import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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

// Query schedules with optional filters
export function useEmployeeSchedules(
    employeeCode?: string,
    startDate?: string,
    endDate?: string
) {
    return useQuery({
        queryKey: ['employee-schedules', employeeCode, startDate, endDate],
        queryFn: async () => {
            let query = supabase
                .from('employee_schedules' as any)
                .select('*')
                .order('duty_date');

            if (employeeCode) query = query.eq('employee_code', employeeCode);
            if (startDate) query = query.gte('duty_date', startDate);
            if (endDate) query = query.lte('duty_date', endDate);

            const { data, error } = await query;
            if (error) throw error;
            return (data || []) as unknown as EmployeeSchedule[];
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
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Not authenticated');

            const res = await fetch(
                `https://ilkrqlxrqaelflslbdnx.supabase.co/functions/v1/fetch-schedule`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `HTTP ${res.status}`);
            }
            return res.json();
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['employee-schedules'] });
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
            qc.invalidateQueries({ queryKey: ['employee-schedules'] });
        },
    });
}
