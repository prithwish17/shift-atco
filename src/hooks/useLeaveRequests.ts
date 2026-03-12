import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { eachDayOfInterval, format, isValid, parseISO } from 'date-fns';
import { scheduleKeys } from '@/lib/scheduleQueryConfig';

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
    direct_supervisor_approved?: boolean;
    direct_supervisor_approved_by?: string | null;
    direct_supervisor_approved_at?: string | null;
    direct_supervisor_comments?: string | null;
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

type EmployeeScheduleRow = {
    id: string;
    employee_code: string;
    employee_name: string;
    duty_date: string;
    duty_code: string;
    duty_description: string;
};

async function resolveScheduleIdentity(employeeAuthId: string, fallbackName?: string | null) {
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('employee_id, full_name')
        .eq('id', employeeAuthId)
        .maybeSingle();
    if (error) throw error;
    if (!profile?.employee_id) {
        throw new Error('Employee profile is missing employee_id required for schedule sync.');
    }
    return {
        employee_code: profile.employee_id as string,
        employee_name: (profile.full_name as string) || fallbackName || '',
    };
}

async function applyApprovedLeaveToSchedule(request: LeaveRequest) {
    const { employee_code, employee_name } = await resolveScheduleIdentity(request.employee_id, request.employee_name);
    const start = parseISO(request.start_date);
    const end = parseISO(request.end_date);
    if (!isValid(start) || !isValid(end)) {
        throw new Error('Invalid leave date range for schedule sync.');
    }
    const leaveDays = eachDayOfInterval({ start, end });

    for (const day of leaveDays) {
        const dutyDate = format(day, 'yyyy-MM-dd');

        const { data: existingSchedule, error: existingError } = await supabase
            .from('employee_schedules' as any)
            .select('id, employee_code, employee_name, duty_date, duty_code, duty_description')
            .eq('employee_code', employee_code)
            .eq('duty_date', dutyDate)
            .maybeSingle();
        if (existingError) throw existingError;

        const existing = (existingSchedule as EmployeeScheduleRow | null) || null;
        const snapshotPayload = {
            leave_request_id: request.id,
            employee_id: request.employee_id,
            duty_date: dutyDate,
            had_schedule: !!existing,
            original_employee_code: existing?.employee_code || employee_code,
            original_employee_name: existing?.employee_name || employee_name,
            original_duty_code: existing?.duty_code || null,
            original_duty_description: existing?.duty_description || null,
        };

        const { error: snapshotError } = await supabase
            .from('leave_schedule_snapshots' as any)
            .upsert(snapshotPayload as any, { onConflict: 'leave_request_id,duty_date' });
        if (snapshotError) throw snapshotError;

        const { error: scheduleUpsertError } = await supabase
            .from('employee_schedules' as any)
            .upsert(
                {
                    employee_code,
                    employee_name,
                    duty_date: dutyDate,
                    duty_code: 'LEAVE',
                    duty_description: request.leave_type
                        ? `Approved Leave (${request.leave_type})`
                        : 'Approved Leave',
                } as any,
                { onConflict: 'employee_code,duty_date' }
            );
        if (scheduleUpsertError) throw scheduleUpsertError;
    }
}

async function hasOtherApprovedLeaveOnDate(employeeId: string, leaveRequestId: string, dutyDate: string) {
    const { data, error } = await supabase
        .from('leave_requests' as any)
        .select('id')
        .eq('employee_id', employeeId)
        .eq('status', 'Approved')
        .neq('id', leaveRequestId)
        .lte('start_date', dutyDate)
        .gte('end_date', dutyDate)
        .limit(1);
    if (error) throw error;
    return (data || []).length > 0;
}

async function restoreScheduleAfterLeaveCancellation(request: LeaveRequest) {
    const { data: snapshots, error: snapshotsError } = await supabase
        .from('leave_schedule_snapshots' as any)
        .select('*')
        .eq('leave_request_id', request.id)
        .order('duty_date', { ascending: true });
    if (snapshotsError) throw snapshotsError;

    for (const snapshot of (snapshots || []) as any[]) {
        const dutyDate = snapshot.duty_date as string;
        const keepAsLeave = await hasOtherApprovedLeaveOnDate(request.employee_id, request.id, dutyDate);
        if (keepAsLeave) continue;

        if (snapshot.had_schedule) {
            const { error: restoreError } = await supabase
                .from('employee_schedules' as any)
                .upsert(
                    {
                        employee_code: snapshot.original_employee_code,
                        employee_name: snapshot.original_employee_name || request.employee_name || '',
                        duty_date: dutyDate,
                        duty_code: snapshot.original_duty_code || '',
                        duty_description: snapshot.original_duty_description || '',
                    } as any,
                    { onConflict: 'employee_code,duty_date' }
                );
            if (restoreError) throw restoreError;
        } else {
            const employeeCode = snapshot.original_employee_code || (await resolveScheduleIdentity(request.employee_id, request.employee_name)).employee_code;
            const { error: deleteError } = await supabase
                .from('employee_schedules' as any)
                .delete()
                .eq('employee_code', employeeCode)
                .eq('duty_date', dutyDate);
            if (deleteError) throw deleteError;
        }
    }

    const { error: markRestoredError } = await supabase
        .from('leave_schedule_snapshots' as any)
        .update({ restored_at: new Date().toISOString() } as any)
        .eq('leave_request_id', request.id)
        .is('restored_at', null);
    if (markRestoredError) throw markRestoredError;
}

async function safeApplyApprovedLeaveToSchedule(request: LeaveRequest) {
    try {
        await applyApprovedLeaveToSchedule(request);
    } catch (err) {
        // Do not block approval status transition if schedule sync fails.
        console.error('leave schedule sync failed after approval', err);
    }
}

async function safeRestoreScheduleAfterLeaveCancellation(request: LeaveRequest) {
    try {
        await restoreScheduleAfterLeaveCancellation(request);
    } catch (err) {
        // Do not block cancellation status transition if schedule restore fails.
        console.error('leave schedule restore failed after cancellation', err);
    }
}

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
            await safeRestoreScheduleAfterLeaveCancellation(data as LeaveRequest);
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leave-requests'] });
            qc.invalidateQueries({ queryKey: scheduleKeys.all });
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
            direct_approval,
        }: {
            id: string;
            action: 'approve' | 'reject';
            actor_role: 'wso' | 'supervisor';
            actor_id: string;
            remarks?: string;
            direct_approval?: boolean;
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
                updateData.wso_comments = remarks || null;
                if (isApprove) {
                    updateData.wso_approved_by = actor_id;
                    updateData.wso_approved_at = now;
                } else {
                    updateData.wso_approved_by = null;
                    updateData.wso_approved_at = null;
                }
            } else {
                expectedStatus = direct_approval ? 'Pending WSO' : 'Pending Supervisor';
                updateData.status = isApprove ? 'Approved' : 'Rejected';
                updateData.supervisor_comments = remarks || null;
                if (isApprove) {
                    updateData.supervisor_approved_by = actor_id;
                    updateData.supervisor_approved_at = now;
                    if (direct_approval) {
                        updateData.direct_supervisor_approved = true;
                        updateData.direct_supervisor_approved_by = actor_id;
                        updateData.direct_supervisor_approved_at = now;
                        updateData.direct_supervisor_comments = remarks || null;
                    } else {
                        updateData.direct_supervisor_approved = false;
                        updateData.direct_supervisor_approved_by = null;
                        updateData.direct_supervisor_approved_at = null;
                        updateData.direct_supervisor_comments = null;
                    }
                } else {
                    updateData.supervisor_approved_by = null;
                    updateData.supervisor_approved_at = null;
                    updateData.direct_supervisor_approved = false;
                    updateData.direct_supervisor_approved_by = null;
                    updateData.direct_supervisor_approved_at = null;
                    updateData.direct_supervisor_comments = null;
                }
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
            if ((data as LeaveRequest).status === 'Approved') {
                await safeApplyApprovedLeaveToSchedule(data as LeaveRequest);
            }
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leave-requests'] });
            qc.invalidateQueries({ queryKey: scheduleKeys.all });
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
