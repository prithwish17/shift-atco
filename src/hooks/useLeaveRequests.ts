import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { eachDayOfInterval, format, isValid, parseISO } from 'date-fns';
import { scheduleKeys } from '@/lib/scheduleQueryConfig';
import { allocateCompOffCandidates, buildCompOffAllocationCandidates } from '@/lib/compOffAllocation';
import { logCriticalEvent, captureError } from '@/lib/sentryHelpers';
import { logSupervisorEdit } from '@/lib/supervisorAuditLog';

// ---------- Types ----------

export type LeaveRequest = {
    id: string;
    employee_id: string;
    employee_name: string;
    team: string | null;
    sap_applied: boolean | null;
    sap_updated: boolean | null;
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
    ch_comp_off_dates?: { date: string; holiday_name: string; holiday_id: string }[] | null;
    attachment_path?: string | null;
    attachment_meta?: { mime?: string; size?: number; original_name?: string | null } | null;
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
    sap_applied?: boolean | null;
    leave_type: string;
    start_date: string;
    end_date: string;
    total_days: number;
    reason?: string | null;
    actual_rh_date?: string | null;
    actual_rh_date_2?: string | null;
    ch_comp_off_dates?: { date: string; holiday_name: string; holiday_id: string }[] | null;
};

export type LeaveRequestFilters = {
    team?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    /** Fetch requests that overlap this date range (inclusive). */
    overlapStartDate?: string;
    overlapEndDate?: string;
};
export function isFinalLeaveApproved(request: Pick<LeaveRequest, 'status' | 'supervisor_approved_at'>): boolean {
    return request.status === 'Approved' && Boolean(request.supervisor_approved_at);
}

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

/**
 * When a CL or COMP_OFF leave is approved and contains CH dates,
 * create comp_off_ledger entries for those CH dates to credit the employee.
 */
async function syncCHCompOffCredits(request: LeaveRequest) {
    const chDates = request.ch_comp_off_dates;
    if (!chDates || chDates.length === 0) return;

    // Only applicable for CL-family and COMP_OFF leave types
    const clTypes = ['CL', 'CL_CON', 'CL_1ST', 'CL_1ST_CON', 'CL_2ND', 'CL_2ND_CON'];
    if (!clTypes.includes(request.leave_type) && request.leave_type !== 'COMP_OFF') return;

    try {
        const entries = chDates.map((ch) => ({
            employee_id: request.employee_id,
            holiday_id: ch.holiday_id,
            duty_date: ch.date,
            days_granted: 1,
            expiry_date: (() => {
                const d = new Date(ch.date);
                d.setDate(d.getDate() + 89);
                return format(d, 'yyyy-MM-dd');
            })(),
            status: 'available',
        }));

        // Upsert to avoid duplicates (employee_id + holiday_id + duty_date is unique)
        for (const entry of entries) {
            const { error } = await supabase
                .from('comp_off_ledger' as any)
                .upsert(entry as any, { onConflict: 'employee_id,holiday_id,duty_date' });
            if (error) {
                logCriticalEvent('ch_comp_off_credit_error', {
                    leave_request_id: request.id,
                    holiday_id: entry.holiday_id,
                    duty_date: entry.duty_date,
                    error: error.message,
                });
            }
        }
    } catch (err) {
        logCriticalEvent('ch_comp_off_credit_failure', {
            leave_request_id: request.id,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function syncApprovedCompOffUsage(request: LeaveRequest) {
    if (request.leave_type !== 'COMP_OFF') return;

    try {
    const { employee_code, employee_name } = await resolveScheduleIdentity(request.employee_id, request.employee_name);
    const start = parseISO(request.start_date);
    const end = parseISO(request.end_date);
    if (!isValid(start) || !isValid(end)) {
        throw new Error('Invalid comp-off date range for ledger sync.');
    }

    const leaveDays = eachDayOfInterval({ start, end }).map((day) => format(day, 'yyyy-MM-dd'));
    if (leaveDays.length === 0) return;

    const { data: earnedRows, error: earnedRowsError } = await supabase
        .from('employee_leave_records' as any)
        .select('id, leave_category, source_event_type, leave_date, leave_used_on, duty_code, raw_leave_used_value, metadata, raw_event')
        .eq('emp_id', employee_code)
        .in('leave_category', ['COMP_OFF', 'COMP_OFF_EARNED', 'LAST_YEAR_CH_DUTY', 'OPE'])
        .order('leave_date', { ascending: true });
    if (earnedRowsError) throw earnedRowsError;

    const candidates = buildCompOffAllocationCandidates((earnedRows || []) as any[]);
    const alreadySynced = candidates.filter((candidate) => candidate.metadata?.leave_request_id === request.id);
    if (alreadySynced.length >= leaveDays.length) return;

    const allocation = allocateCompOffCandidates(candidates, leaveDays.length, 0);
    if (!allocation.canCoverRequest || allocation.selectedEntries.length < leaveDays.length) {
        throw new Error('Insufficient comp-off entries are available to sync this approved leave.');
    }

    // Atomic allocation via RPC — all-or-nothing transaction
    const recordIds = allocation.selectedEntries.map((e) => e.recordId);
    const { error: rpcError } = await supabase.rpc('allocate_comp_off_for_leave', {
        p_leave_request_id: request.id,
        p_record_ids: recordIds,
        p_leave_dates: leaveDays,
        p_employee_name: employee_name,
        p_start_date: request.start_date,
        p_end_date: request.end_date,
    });
    if (rpcError) throw rpcError;
    } catch (err) {
        logCriticalEvent('comp_off_allocation_error', {
            leave_request_id: request.id,
            leave_type: request.leave_type,
            employee_id: request.employee_id,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}

async function clearApprovedCompOffUsage(request: LeaveRequest) {
    if (request.leave_type !== 'COMP_OFF') return;

    const { employee_code } = await resolveScheduleIdentity(request.employee_id, request.employee_name);

    // Atomic deallocation via RPC — all-or-nothing transaction
    const { error: rpcError } = await supabase.rpc('clear_comp_off_for_leave', {
        p_leave_request_id: request.id,
        p_employee_code: employee_code,
    });
    if (rpcError) throw rpcError;
}

async function applyApprovedLeaveToSchedule(request: LeaveRequest) {
    try {
    const { employee_code, employee_name } = await resolveScheduleIdentity(request.employee_id, request.employee_name);

    // Atomic schedule sync via RPC — snapshots + LEAVE codes in one transaction
    const { error: rpcError } = await supabase.rpc('apply_leave_to_schedule', {
        p_leave_request_id: request.id,
        p_employee_id: request.employee_id,
        p_employee_code: employee_code,
        p_employee_name: employee_name,
        p_start_date: request.start_date,
        p_end_date: request.end_date,
        p_leave_type: request.leave_type || 'Leave',
    });
    if (rpcError) throw rpcError;
    } catch (err) {
        logCriticalEvent('schedule_sync_failure', {
            leave_request_id: request.id,
            employee_id: request.employee_id,
            start_date: request.start_date,
            end_date: request.end_date,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}

async function restoreScheduleAfterLeaveCancellation(request: LeaveRequest) {
    // Atomic schedule restore via RPC — all-or-nothing transaction
    const { error: rpcError } = await supabase.rpc('restore_schedule_after_cancellation', {
        p_leave_request_id: request.id,
        p_employee_id: request.employee_id,
    });
    if (rpcError) throw rpcError;
}

// Schedule sync and restore errors now propagate to the caller.
// If schedule sync fails, the approval mutation will also fail,
// preventing the leave from being marked as Approved with no schedule update.

/**
 * Maps a leave_request leave_type to the leave_balances enum bucket.
 * Returns null for types that don't use balance-based enforcement.
 */
function getBalanceBucketForDeduction(leaveType: string): 'cl' | 'rh' | null {
    if (['CL', 'CL_CON', 'CL_1ST', 'CL_1ST_CON', 'CL_2ND', 'CL_2ND_CON'].includes(leaveType)) {
        return 'cl';
    }
    if (leaveType === 'RH') return 'rh';
    // COMP_OFF uses its own allocation system (employee_leave_records).
    // EL, NEE, HPL, COMM are not balance-enforced yet.
    return null;
}

/**
 * Deduct leave balance from the leave_balances table when a leave is approved.
 * Calls the deduct_leave_balance RPC for atomic, transactional decrement.
 */
async function deductLeaveBalance(request: LeaveRequest) {
    const bucket = getBalanceBucketForDeduction(request.leave_type);
    if (!bucket) return; // Not a balance-tracked type

    const year = new Date(request.start_date).getFullYear();
    try {
        const { error } = await supabase.rpc('deduct_leave_balance', {
            p_user_id: request.employee_id,
            p_leave_type: bucket,
            p_year: year,
            p_days: request.total_days,
        });
        if (error) throw error;
    } catch (err) {
        logCriticalEvent('leave_balance_deduction_error', {
            leave_request_id: request.id,
            leave_type: request.leave_type,
            bucket,
            employee_id: request.employee_id,
            total_days: request.total_days,
            error: err instanceof Error ? err.message : String(err),
        });
        // Non-blocking: log but don't fail the approval
        captureError(err, { tags: { flow: 'leave_balance_deduction' } });
    }
}

/**
 * Restore leave balance to the leave_balances table when an approved leave is cancelled.
 * Calls the restore_leave_balance RPC for atomic, transactional increment.
 */
async function restoreLeaveBalance(request: LeaveRequest) {
    const bucket = getBalanceBucketForDeduction(request.leave_type);
    if (!bucket) return;

    const year = new Date(request.start_date).getFullYear();
    try {
        const { error } = await supabase.rpc('restore_leave_balance', {
            p_user_id: request.employee_id,
            p_leave_type: bucket,
            p_year: year,
            p_days: request.total_days,
        });
        if (error) throw error;
    } catch (err) {
        logCriticalEvent('leave_balance_restore_error', {
            leave_request_id: request.id,
            leave_type: request.leave_type,
            bucket,
            employee_id: request.employee_id,
            total_days: request.total_days,
            error: err instanceof Error ? err.message : String(err),
        });
        captureError(err, { tags: { flow: 'leave_balance_restore' } });
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
                .order('applied_at', { ascending: false })
                .limit(500);

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
            if (filters?.overlapStartDate && filters?.overlapEndDate) {
                query = query
                    .lte('start_date', filters.overlapEndDate)
                    .gte('end_date', filters.overlapStartDate);
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
            qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
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
            qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
            qc.invalidateQueries({ queryKey: ['leave-records'] });
            qc.invalidateQueries({ queryKey: ['leave-record-summary'] });
            qc.invalidateQueries({ queryKey: ['leave_balances'] });
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

            // Store cancellation info in remarks; do NOT overwrite original approval fields
            // to preserve the audit trail of who originally approved.
            if (actor_role === 'wso') {
                updateData.wso_comments = remarks ? `[Cancelled] ${remarks}` : updateData.wso_comments;
            } else {
                updateData.supervisor_comments = remarks ? `[Cancelled] ${remarks}` : updateData.supervisor_comments;
            }

            const { data, error } = await supabase
                .from('leave_requests' as any)
                .update(updateData as any)
                .eq('id', id)
                .eq('status', 'Approved')
                .select()
                .single();
            if (error) throw error;
            await clearApprovedCompOffUsage(data as LeaveRequest);
            await restoreScheduleAfterLeaveCancellation(data as LeaveRequest);
            await restoreLeaveBalance(data as LeaveRequest);

            // Fire-and-forget push notification for cancellation
            const cancelled = data as LeaveRequest;
            supabase.functions.invoke('send-notification', {
                body: {
                    user_ids: [cancelled.employee_id],
                    title: 'Leave Cancelled',
                    body: `Your ${cancelled.leave_type} leave (${cancelled.start_date} to ${cancelled.end_date}) has been cancelled.`,
                    url: '/employee/leave',
                    category: 'leave_status',
                    metadata: { leave_request_id: cancelled.id, leave_type: cancelled.leave_type, status: 'Cancelled', start_date: cancelled.start_date, end_date: cancelled.end_date },
                },
            }).catch((err: unknown) => captureError(err, { tags: { silent_failure: 'true', flow: 'leave_cancellation_notification' } }));

            return data;
        },
        onSuccess: (data) => {
            const cancelled = data as LeaveRequest;
            logSupervisorEdit({
                action: 'update',
                table: 'leave_requests',
                description: `Cancelled approved leave for ${cancelled.employee_name}: ${cancelled.leave_type} (${cancelled.start_date} to ${cancelled.end_date})`,
                recordId: cancelled.id,
                after: { status: 'Cancelled', leave_type: cancelled.leave_type },
            });
            qc.invalidateQueries({ queryKey: ['leave-requests'] });
            qc.invalidateQueries({ queryKey: scheduleKeys.all });
            qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
            qc.invalidateQueries({ queryKey: ['leave-records'] });
            qc.invalidateQueries({ queryKey: ['leave-record-summary'] });
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
                await syncApprovedCompOffUsage(data as LeaveRequest);
                await syncCHCompOffCredits(data as LeaveRequest);
                await applyApprovedLeaveToSchedule(data as LeaveRequest);
                await deductLeaveBalance(data as LeaveRequest);
            }

            // Fire-and-forget push notification
            const req = data as LeaveRequest;
            const statusLabel = req.status === 'Approved' ? 'Approved' : req.status === 'Rejected' ? 'Rejected' : null;
            if (statusLabel) {
                supabase.functions.invoke('send-notification', {
                    body: {
                        user_ids: [req.employee_id],
                        title: `Leave ${statusLabel}`,
                        body: `Your ${req.leave_type} leave (${req.start_date} to ${req.end_date}) has been ${statusLabel.toLowerCase()}.`,
                        url: '/employee/leave',
                        category: 'leave_status',
                        metadata: { leave_request_id: req.id, leave_type: req.leave_type, status: req.status, start_date: req.start_date, end_date: req.end_date },
                    },
                }).catch((err: unknown) => captureError(err, { tags: { silent_failure: 'true', flow: 'leave_review_notification' } }));
            }

            return data;
        },
        onSuccess: (data) => {
            const req = data as LeaveRequest;
            logSupervisorEdit({
                action: 'update',
                table: 'leave_requests',
                description: `${req.status} leave for ${req.employee_name}: ${req.leave_type} (${req.start_date} to ${req.end_date})`,
                recordId: req.id,
                after: { status: req.status, leave_type: req.leave_type, start_date: req.start_date, end_date: req.end_date },
            });
            qc.invalidateQueries({ queryKey: ['leave-requests'] });
            qc.invalidateQueries({ queryKey: scheduleKeys.all });
            qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
            qc.invalidateQueries({ queryKey: ['leave-records'] });
            qc.invalidateQueries({ queryKey: ['leave-record-summary'] });
            qc.invalidateQueries({ queryKey: ['comp-off-ledger'] });
            qc.invalidateQueries({ queryKey: ['leave_balances'] });
        },
    });
}

/** Toggle the SAP-updated flag on an approved leave request */
export function useMarkSapUpdated() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, sap_updated }: { id: string; sap_updated: boolean }) => {
            const { data, error } = await supabase
                .from('leave_requests' as any)
                .update({ sap_updated } as any)
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
                .select('leave_type, status, supervisor_approved_at')
                .eq('employee_id', userId)
                .eq('status', 'Approved');
            if (error) throw error;

            const summary: Record<string, number> = {};
            for (const row of (data || []) as any[]) {
                if (!row.supervisor_approved_at) continue;
                summary[row.leave_type] = (summary[row.leave_type] || 0) + 1;
            }
            return summary;
        },
        enabled: !!userId,
        staleTime: 5 * 60 * 1000,
    });
}
