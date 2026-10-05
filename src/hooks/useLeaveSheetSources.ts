import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

/**
 * The leave sheet lifecycle, for admins.
 *
 * The register is the system of record; a Google Sheet workbook is a *source*
 * that feeds it while it is live and is frozen once closed. See
 * docs/leave/SHEET_INDEPENDENCE.md and docs/leave/RUNBOOK.md.
 */

export type LeaveSheetSource = Tables<'leave_sheet_sources'>;
export type LeaveSheetSyncRun = Tables<'leave_sheet_sync_runs'>;
export type ArchivedLeaveRecord = Tables<'employee_leave_records_archive'>;

type RpcResult = { ok: boolean; message?: string; [key: string]: unknown };

const KEYS = {
    sources: ['leave-sheet-sources'] as const,
    runs: ['leave-sheet-sync-runs'] as const,
    archive: ['leave-record-archive'] as const,
};

export function useLeaveSheetSources() {
    return useQuery({
        queryKey: KEYS.sources,
        staleTime: 60 * 1000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('leave_sheet_sources')
                .select('*')
                .order('activated_at', { ascending: false });
            if (error) throw error;
            return data ?? [];
        },
    });
}

export function useLeaveSheetSyncRuns(limit = 8) {
    return useQuery({
        queryKey: [...KEYS.runs, limit],
        staleTime: 60 * 1000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('leave_sheet_sync_runs')
                .select('*')
                .order('started_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            return data ?? [];
        },
    });
}

export function useArchivedLeaveRecords(limit = 15) {
    return useQuery({
        queryKey: [...KEYS.archive, limit],
        staleTime: 60 * 1000,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_leave_records_archive')
                .select('*')
                .order('archived_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            return data ?? [];
        },
    });
}

/** Runs an admin RPC and turns `{ ok: false, message }` into a thrown error. */
function useAdminRpc<TInput>(call: (input: TInput) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: TInput) => {
            const { data, error } = await call(input);
            if (error) throw new Error(error.message);
            const result = (data ?? {}) as RpcResult;
            if (!result.ok) throw new Error(result.message ?? 'The database refused the change');
            return result;
        },
        onSuccess: () => {
            for (const key of Object.values(KEYS)) qc.invalidateQueries({ queryKey: key });
            qc.invalidateQueries({ queryKey: ['leave-sheet-push-queue'] });
            qc.invalidateQueries({ queryKey: ['leave-data-structured'] });
        },
    });
}

/** Freeze a workbook: the sync stops, and nothing it contributed can change. */
export function useCloseLeaveSheetSource() {
    return useAdminRpc((input: { sourceKey: string; reason: string }) =>
        supabase.rpc('close_leave_sheet_source', { p_source_key: input.sourceKey, p_reason: input.reason }));
}

/** Register the next workbook (or reopen a closed one) as the live source. */
export function useActivateLeaveSheetSource() {
    return useAdminRpc((input: { sourceKey: string; label: string; year: number; readUrl?: string }) =>
        supabase.rpc('activate_leave_sheet_source', {
            p_source_key: input.sourceKey,
            p_label: input.label,
            p_leave_year: input.year,
            p_read_url: input.readUrl || undefined,
        }));
}

/** Let through a retirement the circuit breaker held back. */
export function useApproveLeaveSheetRetirement() {
    return useAdminRpc((input: { runId: string; reason?: string }) =>
        supabase.rpc('approve_leave_sheet_retirement', { p_run_id: input.runId, p_reason: input.reason }));
}

/** Put an archived register row back, as an app-owned row. */
export function useRestoreArchivedLeaveRecord() {
    return useAdminRpc((input: { archiveId: string; reason?: string }) =>
        supabase.rpc('restore_archived_leave_record', { p_archive_id: input.archiveId, p_reason: input.reason }));
}
