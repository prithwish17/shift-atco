import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { logSupervisorEdit } from '@/lib/supervisorAuditLog';
import { computeProgress } from '@/domain/ojt';
import type { OjtOverrideUpdate, OjtProgressRecord, OjtStartDateSource } from '@/domain/ojt';

export const OJT_PROGRESS_QUERY_KEY = ['ojt-progress-records'];

interface OjtProgressRow {
    emp_id: string | null;
    unit: string | null;
    employee_name: string | null;
    designation: string | null;
    required_hours: number | null;
    required_days: number | null;
    performed_hours: number | null;
    performed_days: number | null;
    start_date: string | null;
    start_date_source: string | null;
    marking_date: string | null;
    deadline: string | null;
    deadline_is_overridden: boolean | null;
    profile_linked: boolean | null;
    current_station: string | null;
    highest_rating: string | null;
    sheet_required_hours: number | null;
    sheet_required_days: number | null;
    sheet_performed_hours: number | null;
    sheet_performed_days: number | null;
    sheet_start_date: string | null;
    sheet_synced_at: string | null;
    override_required_hours: number | null;
    override_required_days: number | null;
    override_performed_hours: number | null;
    override_performed_days: number | null;
    override_start_date: string | null;
    override_updated_at: string | null;
    override_updated_by_name: string | null;
    override_note: string | null;
    trainee_status: string | null;
    trainee_status_date: string | null;
}

/**
 * Derived values are recomputed on the client from the resolved inputs rather
 * than read off the RPC. The RPC's own copies stay correct as of query time,
 * but a tab left open across midnight IST would show a stale days_left; running
 * the shared engine here keeps the figures live and means the UI and the tests
 * exercise exactly the same code path.
 */
function toRecord(row: OjtProgressRow): OjtProgressRecord {
    const progress = computeProgress({
        requiredHours: row.required_hours,
        requiredDays: row.required_days,
        performedHours: row.performed_hours,
        performedDays: row.performed_days,
        startDate: row.start_date,
        deadlineOverride: row.deadline_is_overridden ? row.deadline : null,
    });

    return {
        ...progress,
        empId: row.emp_id || '',
        unit: row.unit || '',
        employeeName: row.employee_name || row.emp_id || '',
        designation: row.designation,
        requiredHours: row.required_hours,
        requiredDays: row.required_days,
        performedHours: row.performed_hours,
        performedDays: row.performed_days,
        startDate: row.start_date,
        startDateSource: (row.start_date_source as OjtStartDateSource) ?? null,
        markingDate: row.marking_date,
        deadlineIsOverridden: Boolean(row.deadline_is_overridden),
        profileLinked: Boolean(row.profile_linked),
        currentStation: row.current_station,
        highestRating: row.highest_rating,
        sheetRequiredHours: row.sheet_required_hours,
        sheetRequiredDays: row.sheet_required_days,
        sheetPerformedHours: row.sheet_performed_hours,
        sheetPerformedDays: row.sheet_performed_days,
        sheetStartDate: row.sheet_start_date,
        sheetSyncedAt: row.sheet_synced_at,
        overrideRequiredHours: row.override_required_hours,
        overrideRequiredDays: row.override_required_days,
        overridePerformedHours: row.override_performed_hours,
        overridePerformedDays: row.override_performed_days,
        overrideStartDate: row.override_start_date,
        overrideUpdatedAt: row.override_updated_at,
        overrideUpdatedByName: row.override_updated_by_name,
        overrideNote: row.override_note,
        traineeStatus: row.trainee_status,
        traineeStatusDate: row.trainee_status_date,
    };
}

export function useOjtProgressRecords() {
    return useQuery<OjtProgressRecord[]>({
        queryKey: OJT_PROGRESS_QUERY_KEY,
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_ojt_progress_records' as never);
            if (error) throw error;

            return ((data || []) as unknown as OjtProgressRow[])
                .filter((row) => Boolean(row.emp_id) && Boolean(row.unit))
                .map(toRecord);
        },
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
}

export function useSyncOjtData() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => invokeEdgeFunction<{
            upserted?: number;
            archived?: number;
            unlinked?: number;
            missing_start_date?: number;
            ojt_only?: number;
            ojt_only_keys?: string[];
        }>('fetch-ojt-data'),
        onSuccess: async (result) => {
            await qc.invalidateQueries({ queryKey: OJT_PROGRESS_QUERY_KEY });
            await qc.invalidateQueries({ queryKey: ['my-ojt-progress'] });

            const parts = [`${result?.upserted ?? 0} cycles synced`];
            if (result?.archived) parts.push(`${result.archived} archived`);
            if (result?.unlinked) parts.push(`${result.unlinked} without an app account`);
            if (result?.missing_start_date) parts.push(`${result.missing_start_date} without a start date`);

            toast.success(`OJT data synced — ${parts.join(', ')}`);

            // Present on the OJT tab but not on Extracted Data, so not tracked at
            // all. Warned separately because it points at the sheet, not the app.
            if (result?.ojt_only) {
                toast.warning(
                    `${result.ojt_only} row${result.ojt_only === 1 ? '' : 's'} on the OJT tab have no Extracted Data row and were not imported` +
                    (result.ojt_only_keys?.length ? `: ${result.ojt_only_keys.join(', ')}` : ''),
                    { duration: 10000 },
                );
            }
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to sync OJT data');
        },
    });
}

export interface OjtOverrideVariables {
    empId: string;
    unit: string;
    employeeName: string;
    updates: OjtOverrideUpdate;
}

export function useUpdateOjtOverride() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ empId, unit, updates }: OjtOverrideVariables) =>
            invokeEdgeFunction<{ success: boolean; overridden: boolean }>('update-ojt-progress', {
                emp_id: empId,
                unit,
                updates,
            }),
        onSuccess: (_result, variables) => {
            toast.success(`OJT record updated for ${variables.employeeName}`);
            logSupervisorEdit({
                action: 'update',
                table: 'employee_ojt_progress',
                description:
                    `OJT override updated for ${variables.empId} (${variables.unit}): ` +
                    Object.entries(variables.updates)
                        .map(([key, value]) => `${key}=${value === null ? 'reverted to sheet' : value}`)
                        .join(', '),
                recordId: `${variables.empId}|${variables.unit}`,
                after: { emp_id: variables.empId, unit: variables.unit, ...variables.updates },
            });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to update OJT record');
        },
        onSettled: async () => {
            await qc.invalidateQueries({ queryKey: OJT_PROGRESS_QUERY_KEY });
            await qc.invalidateQueries({ queryKey: ['my-ojt-progress'] });
        },
    });
}
