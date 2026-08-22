import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

import { supabase } from '@/integrations/supabase/client';
import { getFunctionsProxyBaseUrl } from '@/lib/appConfig';
import { logSupervisorEdit } from '@/lib/supervisorAuditLog';
import {
    fetchLeaveDiscrepancies,
    groupBacklogRuns,
    type BacklogItem,
} from '@/lib/leaveReconciliation';

/**
 * Supervisor-facing backlog clearing.
 *
 * The ~1000 outstanding leave applications survive only as roster markers, so the
 * queue is derived from the shared reconciliation detector rather than stored:
 * an item disappears from the queue the moment it is cleared, with no extra state
 * to keep in sync.
 */

/** A conflict the RPC reports instead of raising, so a long run keeps going. */
export interface BackfillConflict {
    kind:
        | 'unknown_employee'
        | 'invalid_range'
        | 'overlap'
        | 'comp_off_required'
        | 'comp_off_shortfall'
        | 'comp_off_invalid'
        | 'comp_off_already_used';
    message: string;
    leave_request_id?: string;
    leave_type?: string;
    start_date?: string;
    end_date?: string;
    status?: string;
    count?: number;
}

export interface BackfillWarning {
    kind: string;
    date?: string;
    message: string;
}

export interface BackfillResult {
    ok: boolean;
    leave_request_id?: string;
    records_written?: number;
    schedule_days_written?: number;
    comp_off_allocated?: number;
    ch_credits?: number;
    warnings?: BackfillWarning[];
    conflict?: BackfillConflict;
}

export interface BackfillInput {
    employeeCode: string;
    employeeName?: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    reason?: string;
    /** employee_leave_records ids this COMP_OFF request consumes. */
    compOffRecordIds?: string[];
    /** [{ date, holiday_id }] — excluded from deduction, credited as comp-off. */
    chCompOffDates?: Array<{ date: string; holiday_id?: string | null }>;
    actualRhDate?: string | null;
    batchId?: string | null;
    auditReason?: string;
    /** Consume comp-off already marked used outside the app. Audited. */
    allowUsedCompOff?: boolean;
    team?: string;
}

/** The backlog queue for a month, collapsed into per-employee date runs. */
export function useLeaveBacklog(monthStart: string, monthEnd: string) {
    return useQuery({
        queryKey: ['leave-backlog', monthStart, monthEnd],
        staleTime: 2 * 60 * 1000,
        queryFn: async () => {
            const rows = await fetchLeaveDiscrepancies(monthStart, monthEnd);
            const items = groupBacklogRuns(rows);
            return { items, rows, total: items.length };
        },
    });
}

/** Open a batch so a clearing session can be reviewed (or rolled back) as a unit. */
export function useOpenBackfillBatch() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (note?: string) => {
            const { data: { user } } = await supabase.auth.getUser();
            const { data: profile } = await supabase
                .from('profiles')
                .select('full_name')
                .eq('id', user?.id ?? '')
                .maybeSingle();

            const { data, error } = await supabase
                .from('leave_backfill_batches')
                .insert({
                    created_by: user?.id ?? null,
                    created_by_name: profile?.full_name ?? null,
                    note: note ?? null,
                })
                .select()
                .single();
            if (error) throw error;
            return data as { id: string };
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leave-backfill-batches'] });
        },
    });
}

export function useCloseBackfillBatch() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ batchId, months }: { batchId: string; months: string[] }) => {
            const { error } = await supabase
                .from('leave_backfill_batches')
                .update({ status: 'closed', closed_at: new Date().toISOString() })
                .eq('id', batchId);
            if (error) throw error;

            await invalidateLeaveRosterCache(months);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leave-backfill-batches'] });
            qc.invalidateQueries({ queryKey: ['leave-backlog'] });
        },
    });
}

/**
 * Clear one backlog item.
 *
 * Data problems come back as `{ ok: false, conflict }` rather than throwing, so a
 * supervisor working through hundreds of rows sees the bad one inline and keeps
 * moving. Only permission failures throw.
 */
export function useBackfillLeaveEntry() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: BackfillInput): Promise<BackfillResult> => {
            const { data, error } = await supabase.rpc('backfill_leave_entry', {
                p_employee_code: input.employeeCode,
                p_leave_type: input.leaveType,
                p_start_date: input.startDate,
                p_end_date: input.endDate,
                p_total_days: input.totalDays,
                p_reason: input.reason ?? null,
                p_applied_at: null,
                p_comp_off_record_ids: input.compOffRecordIds ?? null,
                p_ch_comp_off_dates: input.chCompOffDates ?? null,
                p_actual_rh_date: input.actualRhDate ?? null,
                p_batch_id: input.batchId ?? null,
                p_audit_reason: input.auditReason ?? null,
                p_allow_used_comp_off: input.allowUsedCompOff ?? false,
            });
            if (error) throw error;

            const result = data as unknown as BackfillResult;

            if (result?.ok) {
                // Mirrors every other supervisor mutation in the app. The durable
                // trail is leave_audit_log, written inside the RPC.
                logSupervisorEdit({
                    action: 'insert',
                    table: 'leave_requests',
                    description: `Backfilled ${input.leaveType} for ${input.employeeCode} ${input.startDate}..${input.endDate}`,
                    recordId: result.leave_request_id,
                    after: {
                        leave_type: input.leaveType,
                        start_date: input.startDate,
                        end_date: input.endDate,
                        total_days: input.totalDays,
                    },
                });
            }

            return result;
        },
        onSuccess: (result) => {
            if (!result?.ok) return;
            qc.invalidateQueries({ queryKey: ['leave-backlog'] });
            qc.invalidateQueries({ queryKey: ['leave-discrepancy-page'] });
            qc.invalidateQueries({ queryKey: ['leave-requests'] });
            qc.invalidateQueries({ queryKey: ['leave-records'] });
        },
    });
}

/** Correct an existing request by superseding it (see amend_leave_request). */
export function useAmendLeaveRequest() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: BackfillInput & { leaveRequestId: string }) => {
            const { data, error } = await supabase.rpc('amend_leave_request', {
                p_leave_request_id: input.leaveRequestId,
                p_leave_type: input.leaveType,
                p_start_date: input.startDate,
                p_end_date: input.endDate,
                p_total_days: input.totalDays,
                p_reason: input.reason ?? null,
                p_comp_off_record_ids: input.compOffRecordIds ?? null,
                p_ch_comp_off_dates: input.chCompOffDates ?? null,
                p_actual_rh_date: input.actualRhDate ?? null,
                p_audit_reason: input.auditReason ?? null,
                p_allow_used_comp_off: input.allowUsedCompOff ?? false,
            });
            if (error) throw error;
            return data as unknown as BackfillResult;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leave-backlog'] });
            qc.invalidateQueries({ queryKey: ['leave-discrepancy-page'] });
            qc.invalidateQueries({ queryKey: ['leave-requests'] });
            qc.invalidateQueries({ queryKey: ['leave-records'] });
        },
    });
}

export interface BalanceRecomputeResult {
    user_id: string;
    year: number;
    dry_run: boolean;
    cl: { before: number | null; after: number; used: number };
    rh: { before: number | null; after: number; used: number };
}

/**
 * Derive CL/RH balances from approved history.
 *
 * Backfill deliberately does not deduct as it goes — deduct_leave_balance() raises
 * on insufficient balance, so a thousand historical entries would abort constantly
 * and leave balances half-applied. Balances are reconciled here instead, once the
 * history is in. `dryRun` powers the preview diff.
 */
export function useRecomputeLeaveBalance() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: { userId: string; year: number; dryRun?: boolean }) => {
            const { data, error } = await supabase.rpc('recompute_leave_balance', {
                p_user_id: input.userId,
                p_year: input.year,
                p_dry_run: input.dryRun ?? false,
            });
            if (error) throw error;
            return data as unknown as BalanceRecomputeResult;
        },
        onSuccess: (result) => {
            if (result?.dry_run) return;
            qc.invalidateQueries({ queryKey: ['leave-balances'] });
            qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
        },
    });
}

/**
 * Settle one sheet-vs-app disagreement.
 *
 * `keep_app` discards what the sheet sent; `accept_sheet` applies it. Either way
 * the row stays app-owned, so the sheet's stale-row purge still cannot delete it,
 * and the decision lands in leave_audit_log.
 */
export function useResolveSheetConflict() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: {
            recordId: string;
            resolution: 'keep_app' | 'accept_sheet';
            reason?: string;
        }) => {
            const { data, error } = await supabase.rpc('resolve_leave_sheet_conflict', {
                p_record_id: input.recordId,
                p_resolution: input.resolution,
                p_reason: input.reason ?? null,
            });
            if (error) throw error;
            return data as unknown as { ok: boolean; resolution?: string; message?: string };
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leave-discrepancy-page'] });
            qc.invalidateQueries({ queryKey: ['leave-backlog'] });
            qc.invalidateQueries({ queryKey: ['leave-records'] });
        },
    });
}

/**
 * Drop the Redis copy of the approved-leave roster for the months just touched.
 *
 * api/leave-roster.ts caches for 10 minutes, and nothing invalidates it today, so
 * without this a supervisor would clear a backlog and still see the old list.
 * Fire-and-forget: a cache miss must never fail a batch.
 */
async function invalidateLeaveRosterCache(months: string[]) {
    if (months.length === 0) return;
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Matches CacheKeys.leaveRoster(month, team) in lib/redis.ts. The
        // team-scoped variants are separate keys, so clear the ones we know about.
        const keys = months.flatMap((month) => [`leave:${month}`]);

        await fetch(`${getFunctionsProxyBaseUrl()}/api/cache/invalidate`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ keys }),
        });
    } catch {
        // Cache invalidation is best-effort; the TTL is 10 minutes regardless.
    }
}

/** Months (yyyy-MM) covered by a set of cleared items, for cache invalidation. */
export function monthsForItems(items: Array<Pick<BacklogItem, 'startDate' | 'endDate'>>): string[] {
    const months = new Set<string>();
    for (const item of items) {
        months.add(format(new Date(item.startDate), 'yyyy-MM'));
        months.add(format(new Date(item.endDate), 'yyyy-MM'));
    }
    return [...months];
}
