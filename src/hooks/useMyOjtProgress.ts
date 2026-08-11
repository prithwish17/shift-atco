import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { computeProgress } from '@/domain/ojt';
import type { MyOjtProgressRecord } from '@/domain/ojt';

export const MY_OJT_PROGRESS_QUERY_KEY = ['my-ojt-progress'];

interface MyOjtProgressRow {
    emp_id: string | null;
    unit: string | null;
    employee_name: string | null;
    designation: string | null;
    required_hours: number | null;
    required_days: number | null;
    performed_hours: number | null;
    performed_days: number | null;
    start_date: string | null;
    marking_date: string | null;
    deadline: string | null;
    sheet_synced_at: string | null;
}

/**
 * The employee's own OJT cycles.
 *
 * get_my_ojt_progress() resolves the caller's employee_id from their auth
 * session server-side and filters on it, so this hook has no way to request
 * another employee's rows.
 */
export function useMyOjtProgress(enabled = true) {
    return useQuery<MyOjtProgressRecord[]>({
        queryKey: MY_OJT_PROGRESS_QUERY_KEY,
        enabled,
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_my_ojt_progress' as never);
            if (error) throw error;

            return ((data || []) as unknown as MyOjtProgressRow[])
                .filter((row) => Boolean(row.emp_id) && Boolean(row.unit))
                .map((row) => ({
                    ...computeProgress({
                        requiredHours: row.required_hours,
                        requiredDays: row.required_days,
                        performedHours: row.performed_hours,
                        performedDays: row.performed_days,
                        startDate: row.start_date,
                    }),
                    empId: row.emp_id || '',
                    unit: row.unit || '',
                    employeeName: row.employee_name || '',
                    designation: row.designation,
                    requiredHours: row.required_hours,
                    requiredDays: row.required_days,
                    performedHours: row.performed_hours,
                    performedDays: row.performed_days,
                    startDate: row.start_date,
                    markingDate: row.marking_date,
                    sheetSyncedAt: row.sheet_synced_at,
                }));
        },
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
}
