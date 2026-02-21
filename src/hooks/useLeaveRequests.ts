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
    wso_approved_by: string | null;
    wso_approved_at: string | null;
    wso_comments: string | null;
    supervisor_approved_by: string | null;
    supervisor_approved_at: string | null;
    supervisor_comments: string | null;
    created_at: string;
    updated_at: string;
    // Joined fields
    reviewer_profile?: { full_name: string } | null;
    wso_approver_profile?: { full_name: string } | null;
    supervisor_approver_profile?: { full_name: string } | null;
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
            const reviewerIds = [
                ...new Set(
                    requests
                        .flatMap((r) => [r.reviewed_by, r.wso_approved_by, r.supervisor_approved_by])
                        .filter(Boolean) as string[]
                ),
            ];
            if (reviewerIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .in('id', reviewerIds);
                const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
                for (const req of requests) {
                    req.reviewer_profile = req.reviewed_by ? (profileMap.get(req.reviewed_by) as any) || null : null;
                    req.wso_approver_profile = req.wso_approved_by ? (profileMap.get(req.wso_approved_by) as any) || null : null;
                    req.supervisor_approver_profile = req.supervisor_approved_by ? (profileMap.get(req.supervisor_approved_by) as any) || null : null;
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
                .in('status', ['Pending WSO', 'Pending Supervisor', 'Approved'])
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
                .in('status', ['Pending WSO', 'Pending Supervisor'])
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

/** Cancel an approved leave request (for supervisor / WSO) */
export function useCancelApprovedLeaveRequest() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            reviewed_by,
            actor_role,
            remarks,
        }: {
            id: string;
            reviewed_by: string;
            actor_role: 'wso' | 'supervisor';
            remarks?: string;
        }) => {
            const updateData: Record<string, any> = {
                status: 'Cancelled',
                reviewed_by,
                reviewed_at: new Date().toISOString(),
                remarks: remarks || null,
            };

            if (actor_role === 'wso') {
                updateData.wso_approved_by = reviewed_by;
                updateData.wso_approved_at = new Date().toISOString();
                updateData.wso_comments = remarks || null;
            } else {
                updateData.supervisor_approved_by = reviewed_by;
                updateData.supervisor_approved_at = new Date().toISOString();
                updateData.supervisor_comments = remarks || null;
            }

            const { data, error } = await supabase
                .from('leave_requests' as any)
                .update(updateData as any)
                .eq('id', id)
                .eq('status', 'Approved')
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
            action,
            actor_role,
            actor_id,
            remarks,
        }: {
            id: string;
            action: 'approve' | 'reject';
            actor_role: 'wso' | 'supervisor';
            actor_id: string;
            remarks?: string;
        }) => {
            const now = new Date().toISOString();
            const isApprove = action === 'approve';
            const updateData: Record<string, any> = {
                reviewed_by: actor_id,
                reviewed_at: now,
                remarks: remarks || null,
            };

            let expectedStatus = '';

            if (actor_role === 'wso') {
                expectedStatus = 'Pending WSO';
                updateData.status = isApprove ? 'Pending Supervisor' : 'Rejected';
                updateData.wso_approved_by = actor_id;
                updateData.wso_approved_at = now;
                updateData.wso_comments = remarks || null;
            } else {
                expectedStatus = 'Pending Supervisor';
                updateData.status = isApprove ? 'Approved' : 'Rejected';
                updateData.supervisor_approved_by = actor_id;
                updateData.supervisor_approved_at = now;
                updateData.supervisor_comments = remarks || null;
            }

            const { data, error } = await supabase
                .from('leave_requests' as any)
                .update(updateData as any)
                .eq('id', id)
                .eq('status', expectedStatus)
                .select()
                .single();
            if (error) throw error;
            if (!data) throw new Error('Request is no longer in a reviewable state.');
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
