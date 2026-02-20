import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// ---------- Types ----------

export type LeaveRequest = {
    id: string;
    employee_id: string;
    employee_name: string;
    team: string | null;
    leave_type: string;
    start_date: string;
    end_date: string;
    total_days: number;
    reason: string | null;
    status: string;
    applied_at: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    remarks: string | null;
    created_at: string;
    updated_at: string;
    // Joined fields
    reviewer_profile?: { full_name: string } | null;
};

export type LeaveRequestInsert = {
    employee_id: string;
    employee_name: string;
    team?: string | null;
    leave_type: string;
    start_date: string;
    end_date: string;
    total_days: number;
    reason?: string | null;
};

export type LeaveRequestFilters = {
    team?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
};

// ---------- Hooks ----------

/** Fetch leave requests for a single employee (personal history) */
export function useMyLeaveRequests(userId?: string) {
    return useQuery({
        queryKey: ['leave-requests', 'mine', userId],
        queryFn: async () => {
            if (!userId) return [];
            const { data, error } = await supabase
                .from('leave_requests' as any)
                .select('*')
                .eq('employee_id', userId)
                .order('applied_at', { ascending: false });
            if (error) throw error;
            return (data || []) as LeaveRequest[];
        },
        enabled: !!userId,
        staleTime: 2 * 60 * 1000,
    });
}

/** Fetch all leave requests (for supervisor / WSO) with optional filters */
export function useAllLeaveRequests(filters?: LeaveRequestFilters) {
    return useQuery({
        queryKey: ['leave-requests', 'all', filters],
        queryFn: async () => {
            let query = supabase
                .from('leave_requests' as any)
                .select('*')
                .order('applied_at', { ascending: false });

            if (filters?.team) {
                query = query.eq('team', filters.team);
            }
            if (filters?.status) {
                query = query.eq('status', filters.status);
            }
            if (filters?.startDate) {
                query = query.gte('start_date', filters.startDate);
            }
            if (filters?.endDate) {
                query = query.lte('end_date', filters.endDate);
            }

            const { data, error } = await query;
            if (error) throw error;

            const requests = (data || []) as LeaveRequest[];

            // Enrich with reviewer profile
            const reviewerIds = [...new Set(requests.filter(r => r.reviewed_by).map(r => r.reviewed_by!))];
            if (reviewerIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', reviewerIds);
                const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
                for (const req of requests) {
                    req.reviewer_profile = req.reviewed_by ? (profileMap.get(req.reviewed_by) as any) || null : null;
                }
            }

            return requests;
        },
        staleTime: 1 * 60 * 1000,
    });
}

/** Create a new leave request with overlap validation */
export function useCreateLeaveRequest() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (request: LeaveRequestInsert) => {
            // Validate: check for overlapping dates
            const { data: existing } = await supabase
                .from('leave_requests' as any)
                .select('id, start_date, end_date, status')
                .eq('employee_id', request.employee_id)
                .in('status', ['Pending', 'Approved'])
                .or(`and(start_date.lte.${request.end_date},end_date.gte.${request.start_date})`);

            if (existing && (existing as any[]).length > 0) {
                throw new Error('You already have a leave request for overlapping dates.');
            }

            const { data, error } = await supabase
                .from('leave_requests' as any)
                .insert(request as any)
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leave-requests'] });
        },
    });
}

/** Cancel a pending leave request */
export function useCancelLeaveRequest() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            const { data, error } = await supabase
                .from('leave_requests' as any)
                .update({ status: 'Cancelled' } as any)
                .eq('id', id)
                .eq('status', 'Pending')
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leave-requests'] });
        },
    });
}

/** Approve or reject a leave request (for supervisor / WSO) */
export function useReviewLeaveRequest() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            status,
            reviewed_by,
            remarks,
        }: {
            id: string;
            status: 'Approved' | 'Rejected';
            reviewed_by: string;
            remarks?: string;
        }) => {
            const { data, error } = await supabase
                .from('leave_requests' as any)
                .update({
                    status,
                    reviewed_by,
                    reviewed_at: new Date().toISOString(),
                    remarks: remarks || null,
                } as any)
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leave-requests'] });
        },
    });
}

/** Get leave count summary for an employee */
export function useLeaveCountSummary(userId?: string) {
    return useQuery({
        queryKey: ['leave-requests', 'summary', userId],
        queryFn: async () => {
            if (!userId) return {};
            const { data, error } = await supabase
                .from('leave_requests' as any)
                .select('leave_type, status')
                .eq('employee_id', userId)
                .eq('status', 'Approved');
            if (error) throw error;

            const summary: Record<string, number> = {};
            for (const row of (data || []) as any[]) {
                summary[row.leave_type] = (summary[row.leave_type] || 0) + 1;
            }
            return summary;
        },
        enabled: !!userId,
        staleTime: 5 * 60 * 1000,
    });
}
