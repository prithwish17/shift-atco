import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import {
    buildCompOffAllocationCandidates,
    type CompOffAllocationCandidate,
} from '@/lib/compOffAllocation';

/**
 * Earned comp-off entries for one employee, carrying their REAL
 * employee_leave_records ids.
 *
 * This deliberately queries employee_leave_records directly rather than reading
 * the normalized `compOffEntries` that useLeaveData produces: that view
 * synthesizes ids of the form `${sourceType}-${dutyDate}-...-${index}`, which
 * cannot be handed to allocate_comp_off_for_leave. It mirrors the query
 * syncApprovedCompOffUsage() already uses at approval time, so what the picker
 * offers is exactly what the allocator can consume.
 */
export function useCompOffCandidates(empCode?: string | null) {
    return useQuery({
        queryKey: ['comp-off-candidates', empCode],
        enabled: !!empCode,
        staleTime: 2 * 60 * 1000,
        queryFn: async (): Promise<CompOffAllocationCandidate[]> => {
            if (!empCode) return [];

            const { data, error } = await supabase
                .from('employee_leave_records')
                .select(
                    'id, leave_category, source_event_type, leave_date, leave_used_on, duty_code, raw_leave_used_value, metadata, raw_event',
                )
                .eq('emp_id', empCode)
                .in('leave_category', ['COMP_OFF', 'COMP_OFF_EARNED', 'LAST_YEAR_CH_DUTY', 'OPE'])
                .order('leave_date', { ascending: true });

            if (error) throw error;
            return buildCompOffAllocationCandidates((data || []) as any[]);
        },
    });
}

/**
 * True when an entry was consumed outside the app: the sheet recorded a
 * `leave_used_on` but no in-app request owns it. Selecting one of these is the
 * conflict the supervisor has to resolve deliberately.
 */
export function isConsumedOutsideApp(candidate: CompOffAllocationCandidate): boolean {
    return candidate.used && !candidate.metadata?.leave_request_id;
}
