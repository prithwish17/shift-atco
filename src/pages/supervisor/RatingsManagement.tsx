import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, RefreshCw, Search, X, Eye, Pencil, Save, Plus, Trash2, GraduationCap, Check, ChevronsUpDown, ListChecks } from 'lucide-react';
import { format, startOfDay } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getFunctionsProxyBaseUrl } from '@/lib/appConfig';
import { useUsers } from '@/hooks/useUsers';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
    TRAINEE_STATUS_OPTIONS,
    formatTraineeDate,
    getRequiredTraineeDateField,
    getScheduledTraineeMilestone,
    getTraineeStatusBadgeClass,
    getTraineeStatusLabel,
    type TraineeStatus,
} from '@/lib/traineeMilestones';
import {
    formatDaysLeft,
    formatOjtHours,
    formatOjtRatio,
    getOjtBandClass,
    getOjtBandLabel,
    getOjtRatioTextClass,
    type OjtBand,
} from '@/domain/ojt';
import {
    PROFICIENCY_RATING_TYPES as RATING_TYPES,
    getRecordProfValidity,
    normalizeRatingEntry,
    type ProficiencyRatingEntry,
} from '@/lib/proficiency';
import { toast } from 'sonner';
import { logSupervisorEdit } from '@/lib/supervisorAuditLog';

// ---------- Types ----------
const EMPTY_TRAINEE_STATUS_VALUE = '__none__';

type RatingEntry = ProficiencyRatingEntry;

interface RatingSyncRecord {
    emp_id: string;
    name: string;
    designation: string | null;
    contact_no: string | null;
    current_station: string | null;
    license_number: string | null;
    elpa_level: string | null;
    highest_rating: string | null;
    ratings: Record<string, RatingEntry>;
}

function preferNonEmptyString(...values: Array<string | null | undefined>) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    }

    return null;
}

function normalizeEmployeeId(value: string | null | undefined) {
    return String(value || '').trim().toUpperCase();
}

function isLikelyEmployeeCode(value: string | null | undefined) {
    const normalizedValue = String(value || '').trim();
    return /^\d+$/.test(normalizedValue);
}

function resolveRatingRecordName(employeeName: string | null | undefined, empId: string, profileFullName?: string | null) {
    const normalizedEmployeeName = preferNonEmptyString(employeeName);
    const normalizedProfileName = preferNonEmptyString(profileFullName);

    if (normalizedProfileName) {
        if (!normalizedEmployeeName) {
            return normalizedProfileName;
        }

        if (normalizeEmployeeId(normalizedEmployeeName) === normalizeEmployeeId(empId) || isLikelyEmployeeCode(normalizedEmployeeName)) {
            return normalizedProfileName;
        }
    }

    return normalizedEmployeeName || normalizedProfileName || empId;
}

function hasMeaningfulRatingRecord(record: Pick<RatingSyncRecord, 'ratings' | 'highest_rating' | 'designation'>) {
    return Object.keys(record.ratings).length > 0 || Boolean(preferNonEmptyString(record.highest_rating, record.designation));
}

function mergeRatingSyncRecords(existing: RatingSyncRecord, incoming: RatingSyncRecord): RatingSyncRecord {
    return {
        ...existing,
        ...incoming,
        name: preferNonEmptyString(existing.name, incoming.name) || existing.emp_id,
        designation: preferNonEmptyString(existing.designation, incoming.designation),
        contact_no: preferNonEmptyString(existing.contact_no, incoming.contact_no),
        current_station: preferNonEmptyString(existing.current_station, incoming.current_station),
        license_number: preferNonEmptyString(existing.license_number, incoming.license_number),
        elpa_level: preferNonEmptyString(existing.elpa_level, incoming.elpa_level),
        highest_rating: preferNonEmptyString(existing.highest_rating, incoming.highest_rating),
        ratings: {
            ...existing.ratings,
            ...incoming.ratings,
        },
    };
}

interface TraineeSyncRecord {
    emp_id: string;
    name: string;
    designation: string | null;
    unit: string | null;
    hours_required: number | null;
    status: TraineeStatus | null;
    preboard_completed_on: string | null;
    preboard_scheduled_on: string | null;
    board_scheduled_on: string | null;
    highest_rating: string | null;
    current_station: string | null;
    /**
     * OJT correlation, supplied by get_supervisor_trainee_records(). Optional so
     * the legacy fallback query below still type-checks when the RPC is absent.
     * Where a trainee runs more than one live cycle, these describe the most
     * pressing one and ojt_cycle_count says how many there are.
     */
    ojt_unit?: string | null;
    ojt_start_date?: string | null;
    ojt_deadline?: string | null;
    ojt_hours_left?: number | null;
    ojt_days_left?: number | null;
    ojt_ratio?: number | null;
    ojt_band?: OjtBand | null;
    ojt_requires_gm_extension?: boolean;
    ojt_cycle_count?: number;
    /** 'both' | 'trainee' | 'ojt' — which side this row came from. */
    source?: string | null;
}

type EditableRatingRecord = {
    emp_id: string;
    name: string;
    designation: string | null;
    contact_no: string | null;
    current_station: string | null;
    license_number: string | null;
    elpa_level: string | null;
    highest_rating: string | null;
    ratings: Record<string, RatingEntry>;
};

type EditableTraineeRecord = {
    emp_id: string;
    name: string;
    designation: string | null;
    unit: string | null;
    hours_required: number | null;
    status: TraineeStatus | null;
    preboard_completed_on: string | null;
    preboard_scheduled_on: string | null;
    board_scheduled_on: string | null;
    current_station: string | null;
    highest_rating: string | null;
};

function clearEditableTraineeStatusData(record: EditableTraineeRecord): EditableTraineeRecord {
    return {
        ...record,
        status: null,
        preboard_completed_on: null,
        preboard_scheduled_on: null,
        board_scheduled_on: null,
    };
}

async function getCurrentOrRefreshedSession(forceRefresh = false) {
    if (forceRefresh) {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session) {
            return data.session;
        }
    }

    const {
        data: { session },
    } = await supabase.auth.getSession();

    return session;
}

function isUnauthorizedError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.toLowerCase();
    return normalized.includes('unauthorized') || normalized.includes('401');
}

async function invokeEdgeFunctionViaProxy<T>(functionName: string, body: Record<string, unknown>, forceRefresh = false) {
    const session = await getCurrentOrRefreshedSession(forceRefresh);

    if (!session) {
        throw new Error('Unauthorized');
    }

    const base = getFunctionsProxyBaseUrl();
    const response = await fetch(`${base}/api/functions/${functionName}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (response.ok) {
        return (await response.json()) as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let message = `Edge function ${functionName} failed: HTTP ${response.status}`;

    if (contentType.includes('application/json')) {
        const errBody = await response.json().catch(() => ({}));
        message = errBody.error || errBody.message || message;
    }

    if (response.status === 401 && !forceRefresh) {
        return invokeEdgeFunctionViaProxy<T>(functionName, body, true);
    }

    throw new Error(message);
}

async function invokeEdgeFunctionWithProxyFallback<T>(functionName: string, body: Record<string, unknown> = {}) {
    try {
        const { data, error } = await supabase.functions.invoke(functionName, { body });
        if (!error) {
            return data as T;
        }

        throw error;
    } catch (error) {
        if (isUnauthorizedError(error)) {
            await getCurrentOrRefreshedSession(true);

            try {
                const { data, error: retryError } = await supabase.functions.invoke(functionName, { body });
                if (!retryError) {
                    return data as T;
                }

                throw retryError;
            } catch (retryError) {
                error = retryError;
            }
        }

        return invokeEdgeFunctionViaProxy<T>(functionName, body, isUnauthorizedError(error));
    }
}

// ---------- Hooks ----------
function useRatingSyncData() {
    return useQuery<RatingSyncRecord[]>({
        queryKey: ['rating-sync-data'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_training_records' as any)
                .select('emp_id, employee_name, license_number, elpa_level, highest_rating, rating_data, rating_designation')
                .order('employee_name', { ascending: true });

            if (error) throw error;

            const rows = ((data || []) as unknown as Array<{
                emp_id: string;
                employee_name: string;
                license_number: string | null;
                elpa_level: string | null;
                highest_rating: string | null;
                rating_data: Record<string, RatingEntry> | null;
                rating_designation: string | null;
            }>);

            const meaningfulRows = rows
                .map((row) => ({
                    emp_id: normalizeEmployeeId(row.emp_id),
                    employee_name: row.employee_name,
                    license_number: row.license_number,
                    elpa_level: row.elpa_level,
                    highest_rating: row.highest_rating,
                    rating_designation: row.rating_designation,
                    ratings: Object.fromEntries(
                        Object.entries(row.rating_data || {}).map(([ratingKey, entry]) => [
                            ratingKey,
                            normalizeRatingEntry(entry),
                        ]),
                    ),
                }))
                .filter((row) => row.emp_id)
                .filter((row) => hasMeaningfulRatingRecord(row));

            const employeeIds = meaningfulRows.map((row) => row.emp_id);
            let profileMeta = new Map<string, { full_name: string | null; mobile: string | null; station: string | null }>();

            if (employeeIds.length > 0) {
                const { data: profiles, error: profilesError } = await supabase
                    .from('profiles')
                    .select('employee_id, full_name, mobile, station')
                    .in('employee_id', employeeIds);

                if (profilesError) throw profilesError;

                profileMeta = new Map(
                    ((profiles || []) as Array<{ employee_id: string | null; full_name: string | null; mobile: string | null; station: string | null }>)
                        .filter((row): row is { employee_id: string; full_name: string | null; mobile: string | null; station: string | null } => Boolean(row.employee_id))
                        .map((row) => [normalizeEmployeeId(row.employee_id), { full_name: row.full_name, mobile: row.mobile, station: row.station }]),
                );
            }

            return meaningfulRows.map((row) => {
                const profile = profileMeta.get(row.emp_id);

                return {
                    emp_id: row.emp_id,
                    name: resolveRatingRecordName(row.employee_name, row.emp_id, profile?.full_name),
                    designation: row.rating_designation,
                    contact_no: profile?.mobile ?? null,
                    current_station: profile?.station ?? null,
                    license_number: row.license_number,
                    elpa_level: row.elpa_level,
                    highest_rating: row.highest_rating,
                    ratings: row.ratings,
                };
            });
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

function useSyncRatingData() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => invokeEdgeFunctionWithProxyFallback<{ upserted?: number }>('fetch-rating-data'),
        onSuccess: async (result: { upserted?: number } | undefined) => {
            await qc.invalidateQueries({ queryKey: ['rating-sync-data'] });
            toast.success(`Rating data synced${result?.upserted ? ` (${result.upserted} records)` : ''}`);
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to sync rating data');
        },
    });
}

function shouldFallbackToLegacyTraineeQuery(error: unknown) {
    const message = String((error as { message?: string } | null)?.message || '').toLowerCase();

    return message.includes('get_supervisor_trainee_records')
        || message.includes('schema cache')
        || message.includes('does not exist')
        || message.includes('could not find the function');
}

async function loadLegacyTraineeSyncData() {
    const fullSelect = 'emp_id, employee_name, trainee_designation, trainee_unit, trainee_hours_required, trainee_status, trainee_preboard_completed_on, trainee_preboard_scheduled_on, trainee_board_scheduled_on, raw_payload, highest_rating';
    const legacySelect = 'emp_id, employee_name, trainee_designation, trainee_unit, trainee_hours_required, trainee_hr_grade, trainee_preboard_completed_on, trainee_preboard_scheduled_on, trainee_board_scheduled_on, raw_payload, highest_rating';
    const fallbackSelect = 'emp_id, employee_name, trainee_designation, trainee_unit, trainee_hours_required, raw_payload, highest_rating';

    let data: unknown[] | null = null;

    const { data: fullData, error } = await supabase
        .from('employee_training_records' as any)
        .select(fullSelect)
        .or('trainee_unit.not.is.null,trainee_hours_required.not.is.null')
        .order('employee_name', { ascending: true });

    if (error) {
        const message = String(error.message || '').toLowerCase();
        const missingStatusColumns =
            message.includes('trainee_status') ||
            message.includes('trainee_hr_grade') ||
            message.includes('trainee_preboard_completed_on') ||
            message.includes('trainee_preboard_scheduled_on') ||
            message.includes('trainee_board_scheduled_on');

        if (!missingStatusColumns) {
            throw error;
        }

        const { data: legacyData, error: legacyError } = await supabase
            .from('employee_training_records' as any)
            .select(legacySelect)
            .or('trainee_unit.not.is.null,trainee_hours_required.not.is.null')
            .order('employee_name', { ascending: true });

        if (legacyError) {
            const { data: fallbackData, error: fallbackError } = await supabase
                .from('employee_training_records' as any)
                .select(fallbackSelect)
                .or('trainee_unit.not.is.null,trainee_hours_required.not.is.null')
                .order('employee_name', { ascending: true });

            if (fallbackError) throw fallbackError;
            data = fallbackData as unknown[];
        } else {
            data = legacyData as unknown[];
        }
    } else {
        data = fullData as unknown[];
    }

    const rows = ((data || []) as unknown as Array<{
        emp_id: string;
        employee_name: string;
        trainee_designation: string | null;
        trainee_unit: string | null;
        trainee_hours_required: number | null;
        trainee_status?: TraineeStatus | null;
        trainee_hr_grade: TraineeStatus | null;
        trainee_preboard_completed_on: string | null;
        trainee_preboard_scheduled_on: string | null;
        trainee_board_scheduled_on: string | null;
        raw_payload?: Record<string, unknown> | null;
        highest_rating: string | null;
    }>);

    const employeeIds = rows.map((row) => row.emp_id).filter(Boolean);
    let stationMap = new Map<string, string | null>();

    if (employeeIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('employee_id, station, is_hidden')
            .in('employee_id', employeeIds);

        if (profilesError) throw profilesError;

        const hiddenTraineeIds = new Set(
            ((profiles || []) as Array<{ employee_id: string | null; is_hidden: boolean }>)
                .filter((row) => row.is_hidden)
                .map((row) => row.employee_id)
                .filter(Boolean) as string[],
        );

        stationMap = new Map(
            ((profiles || []) as Array<{ employee_id: string | null; station: string | null; is_hidden: boolean }>)
                .filter((row): row is { employee_id: string; station: string | null; is_hidden: boolean } => Boolean(row.employee_id) && !row.is_hidden)
                .map((row) => [row.employee_id, row.station]),
        );

        return rows
            .filter((row) => !hiddenTraineeIds.has(row.emp_id))
            .map((row) => {
                const rawPayload = (row.raw_payload || {}) as Record<string, unknown>;
                const status = (row.trainee_status ?? row.trainee_hr_grade ?? rawPayload.trainee_status ?? null) as TraineeStatus | null;
                const preboardCompletedOn = (row.trainee_preboard_completed_on ?? rawPayload.trainee_preboard_completed_on ?? null) as string | null;
                const preboardScheduledOn = (row.trainee_preboard_scheduled_on ?? rawPayload.trainee_preboard_scheduled_on ?? null) as string | null;
                const boardScheduledOn = (row.trainee_board_scheduled_on ?? rawPayload.trainee_board_scheduled_on ?? null) as string | null;

                return {
                    emp_id: row.emp_id,
                    name: row.employee_name,
                    designation: row.trainee_designation,
                    unit: row.trainee_unit,
                    hours_required: row.trainee_hours_required,
                    status,
                    preboard_completed_on: preboardCompletedOn,
                    preboard_scheduled_on: preboardScheduledOn,
                    board_scheduled_on: boardScheduledOn,
                    highest_rating: row.highest_rating,
                    current_station: stationMap.get(row.emp_id) ?? null,
                };
            })
            .filter((row) => row.status !== 'training_completed');
    }

    return [] as TraineeSyncRecord[];
}

function useTraineeSyncData() {
    return useQuery<TraineeSyncRecord[]>({
        queryKey: ['trainee-sync-data'],
        queryFn: async () => {
            try {
                const { data, error } = await supabase.rpc('get_supervisor_trainee_records' as any);

                if (error) {
                    throw error;
                }

                return ((data || []) as Array<{
                    emp_id: string | null;
                    name: string | null;
                    designation: string | null;
                    unit: string | null;
                    hours_required: number | null;
                    status: TraineeStatus | null;
                    preboard_completed_on: string | null;
                    preboard_scheduled_on: string | null;
                    board_scheduled_on: string | null;
                    highest_rating: string | null;
                    current_station: string | null;
                    ojt_unit: string | null;
                    ojt_start_date: string | null;
                    ojt_deadline: string | null;
                    ojt_hours_left: number | null;
                    ojt_days_left: number | null;
                    ojt_ratio: number | null;
                    ojt_band: OjtBand | null;
                    ojt_requires_gm_extension: boolean | null;
                    ojt_cycle_count: number | null;
                    source: string | null;
                }>)
                    .filter((row) => Boolean(row.emp_id))
                    .map((row) => ({
                        emp_id: row.emp_id as string,
                        name: row.name || (row.emp_id as string),
                        designation: row.designation,
                        unit: row.unit,
                        hours_required: row.hours_required,
                        status: row.status,
                        preboard_completed_on: row.preboard_completed_on,
                        preboard_scheduled_on: row.preboard_scheduled_on,
                        board_scheduled_on: row.board_scheduled_on,
                        highest_rating: row.highest_rating,
                        current_station: row.current_station,
                        ojt_unit: row.ojt_unit,
                        ojt_start_date: row.ojt_start_date,
                        ojt_deadline: row.ojt_deadline,
                        ojt_hours_left: row.ojt_hours_left,
                        ojt_days_left: row.ojt_days_left,
                        ojt_ratio: row.ojt_ratio,
                        ojt_band: row.ojt_band,
                        ojt_requires_gm_extension: Boolean(row.ojt_requires_gm_extension),
                        ojt_cycle_count: row.ojt_cycle_count ?? 0,
                        source: row.source,
                    }));
            } catch (error) {
                if (!shouldFallbackToLegacyTraineeQuery(error)) {
                    throw error;
                }

                return loadLegacyTraineeSyncData();
            }
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

function useSyncTraineeData() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => invokeEdgeFunctionWithProxyFallback<{ upserted?: number; unmatched?: number; cleared?: number }>('fetch-trainee-data'),
        onSuccess: async (result: { upserted?: number; unmatched?: number; cleared?: number } | undefined) => {
            await qc.invalidateQueries({ queryKey: ['trainee-sync-data'] });
            toast.success(
                `Trainee data synced${result?.upserted ? ` (${result.upserted} matched)` : ''}${result?.unmatched ? `, ${result.unmatched} unmatched` : ''}${result?.cleared ? `, ${result.cleared} cleared` : ''}`,
            );
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to sync trainee data');
        },
    });
}

async function invokeUpdateTrainingRecord(empId: string, updates: Record<string, unknown>) {
    return invokeEdgeFunctionWithProxyFallback('update-training-record', { emp_id: empId, updates });
}

function useUpdateRatingRecord() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (record: EditableRatingRecord) => {
            const cleanedRatings: Record<string, RatingEntry> = {};

            for (const [key, value] of Object.entries(record.ratings)) {
                const cleanedHistory: Record<string, { date: string | null; instructor: string | null }> = {};

                for (const [historyKey, history] of Object.entries(value.proficiency_history || {})) {
                    if (history.date || history.instructor) {
                        cleanedHistory[historyKey] = {
                            date: history.date || null,
                            instructor: history.instructor || null,
                        };
                    }
                }

                const cleanedEntry = normalizeRatingEntry({
                    status: value.status ?? null,
                    rating_date: value.rating_date || null,
                    endorsement_date: value.endorsement_date || null,
                    last_proficiency: {
                        date: value.last_proficiency?.date || null,
                        instructor: value.last_proficiency?.instructor || null,
                    },
                    proficiency_history: cleanedHistory,
                });

                const hasValue =
                    (cleanedEntry.status !== null && cleanedEntry.status !== undefined) ||
                    cleanedEntry.rating_date ||
                    cleanedEntry.endorsement_date ||
                    cleanedEntry.last_proficiency.date ||
                    cleanedEntry.last_proficiency.instructor ||
                    Object.keys(cleanedEntry.proficiency_history).length > 0;

                if (hasValue) {
                    cleanedRatings[key] = cleanedEntry;
                }
            }

            await invokeUpdateTrainingRecord(record.emp_id, {
                rating_data: cleanedRatings,
                rating_designation: record.designation || null,
                rating_synced_at: new Date().toISOString(),
            });
        },
        onSuccess: async (_, record) => {
            await qc.invalidateQueries({ queryKey: ['rating-sync-data'] });
            toast.success('Rating record updated');
            logSupervisorEdit({
                action: "update",
                table: "employee_training_records",
                description: `Rating record updated for ${record.emp_id} (${record.designation || "no designation"})`,
                recordId: record.emp_id,
                after: { emp_id: record.emp_id, designation: record.designation ?? null },
            });
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to update rating record');
        },
    });
}

function useUpdateTraineeRecord() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ record, removeFromList }: { record: EditableTraineeRecord; removeFromList: boolean }) => {
            await invokeUpdateTrainingRecord(record.emp_id, {
                trainee_status: removeFromList ? 'training_completed' : record.status,
                trainee_preboard_completed_on: record.preboard_completed_on,
                trainee_preboard_scheduled_on: record.preboard_scheduled_on,
                trainee_board_scheduled_on: record.board_scheduled_on,
                trainee_synced_at: new Date().toISOString(),
            });

            return { record, removeFromList };
        },
        onMutate: async ({ record, removeFromList }) => {
            await qc.cancelQueries({ queryKey: ['trainee-sync-data'] });
            const previous = qc.getQueryData<TraineeSyncRecord[]>(['trainee-sync-data']);

            qc.setQueryData<TraineeSyncRecord[]>(['trainee-sync-data'], (current = []) => {
                if (removeFromList) {
                    return current.filter((item) => item.emp_id !== record.emp_id);
                }

                return current.map((item) => (
                    item.emp_id === record.emp_id
                        ? {
                            ...item,
                            status: record.status,
                            preboard_completed_on: record.preboard_completed_on,
                            preboard_scheduled_on: record.preboard_scheduled_on,
                            board_scheduled_on: record.board_scheduled_on,
                        }
                        : item
                ));
            });

            return { previous };
        },
        onError: (error: Error, _vars, context) => {
            if (context?.previous) {
                qc.setQueryData(['trainee-sync-data'], context.previous);
            }
            toast.error(error.message || 'Failed to update trainee status');
        },
        onSuccess: ({ removeFromList, record }) => {
            toast.success(removeFromList ? 'Trainee marked completed and removed from trainee list' : 'Trainee status updated');
            logSupervisorEdit({
                action: "update",
                table: "employee_training_records",
                description: removeFromList
                    ? `Trainee ${record.emp_id} marked completed and removed from trainee list`
                    : `Trainee status updated for ${record.emp_id} → ${record.status}`,
                recordId: record.emp_id,
                after: { emp_id: record.emp_id, status: removeFromList ? "training_completed" : record.status },
            });
        },
        onSettled: async () => {
            await qc.invalidateQueries({ queryKey: ['trainee-sync-data'] });
        },
    });
}

function useProfilesForTraineeAdd(enabled: boolean) {
    return useQuery({
        queryKey: ['profiles-for-trainee-add'],
        enabled,
        queryFn: async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('employee_id, full_name, designation')
                .eq('is_hidden', false)
                .order('full_name', { ascending: true });
            if (error) throw error;
            return (data || []) as Array<{ employee_id: string; full_name: string | null; designation: string | null }>;
        },
        staleTime: 5 * 60 * 1000,
    });
}

interface AddTraineePayload {
    emp_id: string;
    name: string;
    unit: string;
    hours_required: number | null;
    designation: string | null;
}

function useAddTrainee() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (payload: AddTraineePayload) => {
            await invokeUpdateTrainingRecord(payload.emp_id, {
                trainee_unit: payload.unit || null,
                trainee_hours_required: payload.hours_required,
                trainee_designation: payload.designation || null,
                trainee_status: 'training_continue',   // default status when manually added
                trainee_synced_at: new Date().toISOString(),
            });
        },
        onSuccess: async (_, payload) => {
            await qc.invalidateQueries({ queryKey: ['trainee-sync-data'] });
            toast.success('Employee added to trainee list');
            logSupervisorEdit({
                action: "insert",
                table: "employee_training_records",
                description: `Employee added to trainee list: ${payload.name} (${payload.emp_id})`,
                recordId: payload.emp_id,
                after: { emp_id: payload.emp_id, name: payload.name, unit: payload.unit },
            });
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Failed to add employee');
        },
    });
}

// ---------- Helpers ----------
type RatingType = typeof RATING_TYPES[number];

function getRatingEditTheme(ratingKey: string) {
    switch (ratingKey) {
        case 'ADC':
            return {
                panelClass: 'border-sky-200 bg-sky-50/40 dark:border-sky-900/60 dark:bg-sky-950/20',
                headerClass: 'border-sky-200 bg-sky-100/70 dark:border-sky-900/60 dark:bg-sky-900/25',
                badgeClass: 'border-sky-200 bg-sky-600 text-white',
                accentClass: 'bg-sky-500',
                sectionClass: 'border-sky-200/80 bg-white/80 dark:border-sky-900/40 dark:bg-slate-950/60',
            };
        case 'APP':
            return {
                panelClass: 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/60 dark:bg-emerald-950/20',
                headerClass: 'border-emerald-200 bg-emerald-100/70 dark:border-emerald-900/60 dark:bg-emerald-900/25',
                badgeClass: 'border-emerald-200 bg-emerald-600 text-white',
                accentClass: 'bg-emerald-500',
                sectionClass: 'border-emerald-200/80 bg-white/80 dark:border-emerald-900/40 dark:bg-slate-950/60',
            };
        case 'ACC':
            return {
                panelClass: 'border-amber-200 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20',
                headerClass: 'border-amber-200 bg-amber-100/70 dark:border-amber-900/60 dark:bg-amber-900/25',
                badgeClass: 'border-amber-200 bg-amber-500 text-white',
                accentClass: 'bg-amber-500',
                sectionClass: 'border-amber-200/80 bg-white/80 dark:border-amber-900/40 dark:bg-slate-950/60',
            };
        case 'ACC(S)':
            return {
                panelClass: 'border-violet-200 bg-violet-50/40 dark:border-violet-900/60 dark:bg-violet-950/20',
                headerClass: 'border-violet-200 bg-violet-100/70 dark:border-violet-900/60 dark:bg-violet-900/25',
                badgeClass: 'border-violet-200 bg-violet-600 text-white',
                accentClass: 'bg-violet-500',
                sectionClass: 'border-violet-200/80 bg-white/80 dark:border-violet-900/40 dark:bg-slate-950/60',
            };
        case 'OCC':
            return {
                panelClass: 'border-rose-200 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/20',
                headerClass: 'border-rose-200 bg-rose-100/70 dark:border-rose-900/60 dark:bg-rose-900/25',
                badgeClass: 'border-rose-200 bg-rose-600 text-white',
                accentClass: 'bg-rose-500',
                sectionClass: 'border-rose-200/80 bg-white/80 dark:border-rose-900/40 dark:bg-slate-950/60',
            };
        case 'PLR':
            return {
                panelClass: 'border-slate-300 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/60',
                headerClass: 'border-slate-300 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-800/70',
                badgeClass: 'border-slate-300 bg-slate-700 text-white',
                accentClass: 'bg-slate-500',
                sectionClass: 'border-slate-200/90 bg-white/85 dark:border-slate-800 dark:bg-slate-950/60',
            };
        default:
            return {
                panelClass: 'border-border bg-muted/20',
                headerClass: 'border-border bg-muted/40',
                badgeClass: 'border-border bg-foreground text-background',
                accentClass: 'bg-foreground',
                sectionClass: 'border-border bg-background/90',
            };
    }
}

function getWorstProfStatus(record: RatingSyncRecord, today: Date): 'valid' | 'warning' | 'expired' | 'none' {
    const active = Object.entries(record.ratings).filter(([, v]) => v.status === '1');
    let worst: 'valid' | 'warning' | 'expired' | 'none' = 'none';
    for (const [ratingKey, entry] of active) {
        const pv = getRecordProfValidity(record, ratingKey, today);
        if (pv?.exemptByAccS) {
            if (worst === 'none') worst = 'valid';
            continue;
        }
        if (!pv) { if (worst === 'none') worst = 'expired'; continue; }
        if (pv.daysLeft < 0) return 'expired';
        if (pv.daysLeft <= 90 && worst !== 'expired') worst = 'warning';
        if (pv.daysLeft > 90 && worst === 'none') worst = 'valid';
    }
    return worst;
}

function getTopCardExpiryBadge(daysLeft: number | null) {
    if (daysLeft === null) {
        return {
            className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-900/60',
            label: 'No prof date',
        };
    }

    if (daysLeft < 0) {
        return {
            className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-900/60',
            label: `${Math.abs(daysLeft)}d overdue`,
        };
    }

    if (daysLeft <= 90) {
        return {
            className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-900/60',
            label: `${daysLeft}d left`,
        };
    }

    return {
        className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-900/60',
        label: `${daysLeft}d left`,
    };
}

function getRecordSoonestExpiryDays(record: RatingSyncRecord, today: Date) {
    const activeEntries = Object.entries(record.ratings).filter(([, entry]) => entry.status === '1');
    if (activeEntries.length === 0) return undefined;

    let soonestDaysLeft: number | null | undefined;

    for (const [ratingKey] of activeEntries) {
        const validity = getRecordProfValidity(record, ratingKey, today);
        if (validity?.exemptByAccS) continue;
        if (!validity) return null;

        if (soonestDaysLeft === undefined || validity.daysLeft < soonestDaysLeft) {
            soonestDaysLeft = validity.daysLeft;
        }
    }

    return soonestDaysLeft;
}

function getRecordRatingDisplayStatus(record: RatingSyncRecord, ratingType: RatingType, today: Date): 'active' | 'expired' | 'inactive' {
    const entry = record.ratings[ratingType];
    if (entry.status !== '1') return 'inactive';

    const validity = getRecordProfValidity(record, ratingType, today);
    if (validity?.exemptByAccS) return 'active';
    if (!validity || validity.daysLeft < 0) return 'expired';

    return 'active';
}

function getInstructorSuggestions(records: RatingSyncRecord[]) {
    const suggestions = new Set<string>();

    records.forEach((record) => {
        if (record.name?.trim()) {
            suggestions.add(record.name.trim());
        }
    });

    return [...suggestions].sort((first, second) => first.localeCompare(second));
}

function createEmptyRatingEntry(): RatingEntry {
    return {
        status: null,
        rating_date: null,
        endorsement_date: null,
        last_proficiency: {
            date: null,
            instructor: null,
        },
        proficiency_history: {},
    };
}

function cloneRecordForEdit(record: RatingSyncRecord): EditableRatingRecord {
    return {
        emp_id: record.emp_id,
        name: record.name,
        designation: record.designation,
        contact_no: record.contact_no,
        current_station: record.current_station,
        license_number: record.license_number,
        elpa_level: record.elpa_level,
        highest_rating: record.highest_rating,
        ratings: Object.fromEntries(
            [...new Set([...RATING_TYPES, ...Object.keys(record.ratings)])].map((key) => {
                const source = record.ratings[key] || createEmptyRatingEntry();
                return [key, normalizeRatingEntry(source) satisfies RatingEntry];
            }),
        ),
    };
}

function cloneTraineeRecordForEdit(record: TraineeSyncRecord): EditableTraineeRecord {
    return {
        emp_id: record.emp_id,
        name: record.name,
        designation: record.designation,
        unit: record.unit,
        hours_required: record.hours_required,
        status: record.status,
        preboard_completed_on: record.preboard_completed_on,
        preboard_scheduled_on: record.preboard_scheduled_on,
        board_scheduled_on: record.board_scheduled_on,
        current_station: record.current_station,
        highest_rating: record.highest_rating,
    };
}

function TraineeTab({
    data,
    syncMutation,
    refetch,
    isLoading,
    errorMessage,
    addDialogOpen,
    onAddDialogOpenChange,
}: {
    data: TraineeSyncRecord[];
    syncMutation: ReturnType<typeof useSyncTraineeData>;
    refetch: () => void;
    isLoading: boolean;
    errorMessage?: string;
    addDialogOpen: boolean;
    onAddDialogOpenChange: (open: boolean) => void;
}) {
    const [search, setSearch] = useState('');
    const [unitFilter, setUnitFilter] = useState<'all' | string>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'preboard_scheduled' | 'board_scheduled' | 'preboard_done_no_board'>('all');
    const [editingRecord, setEditingRecord] = useState<EditableTraineeRecord | null>(null);
    const [completionCandidate, setCompletionCandidate] = useState<EditableTraineeRecord | null>(null);
    const [empComboOpen, setEmpComboOpen] = useState(false);
    const [addForm, setAddForm] = useState<{ emp_id: string; name: string; designation: string; unit: string; hours_required: string }>({
        emp_id: '', name: '', designation: '', unit: '', hours_required: '',
    });
    const updateTraineeRecord = useUpdateTraineeRecord();
    const addTrainee = useAddTrainee();
    const { data: allProfiles = [] } = useProfilesForTraineeAdd(addDialogOpen);
    const existingEmpIds = useMemo(() => new Set(data.map((r) => r.emp_id)), [data]);
    const availableProfiles = useMemo(
        () => allProfiles.filter((p) => p.employee_id && !existingEmpIds.has(p.employee_id)),
        [allProfiles, existingEmpIds],
    );
    const units = [...new Set(data.map((record) => record.unit).filter((unit): unit is string => Boolean(unit)))].sort((a, b) => a.localeCompare(b));

    useEffect(() => {
        if (!addDialogOpen) {
            setEmpComboOpen(false);
            return;
        }

        setAddForm({ emp_id: '', name: '', designation: '', unit: '', hours_required: '' });
        setEmpComboOpen(false);
    }, [addDialogOpen]);

    const preStatusFiltered = [...data].filter((record) => {
        const query = search.trim().toLowerCase();
        if (query) {
            const haystack = [
                record.name,
                record.emp_id,
                record.designation || '',
                record.unit || '',
                record.highest_rating || '',
                record.current_station || '',
                getTraineeStatusLabel(record.status),
                record.preboard_completed_on || '',
                record.preboard_scheduled_on || '',
                record.board_scheduled_on || '',
                record.ojt_unit || '',
                record.ojt_band ? getOjtBandLabel(record.ojt_band) : '',
                record.ojt_requires_gm_extension ? 'gm extension' : '',
            ]
                .join(' ')
                .toLowerCase();
            if (!haystack.includes(query)) return false;
        }
        if (unitFilter !== 'all' && (record.unit || '') !== unitFilter) return false;
        return true;
    });

    const tabCounts = {
        all: preStatusFiltered.length,
        preboard_scheduled: preStatusFiltered.filter((r) =>
            Boolean(r.preboard_scheduled_on) &&
            r.status !== 'preboard_complete' &&
            r.status !== 'board_date_fixed' &&
            !r.board_scheduled_on
        ).length,
        board_scheduled: preStatusFiltered.filter((r) => Boolean(r.board_scheduled_on) || r.status === 'board_date_fixed').length,
        preboard_done_no_board: preStatusFiltered.filter((r) =>
            (r.status === 'preboard_complete' || Boolean(r.preboard_completed_on)) &&
            r.status !== 'board_date_fixed' && !r.board_scheduled_on
        ).length,
    };

    const traineeFilterTabs = [
        {
            value: 'all',
            label: 'Trainees',
            count: tabCounts.all,
            triggerClass: 'border-slate-200/70 bg-slate-50/90 text-slate-600 hover:bg-slate-100/90 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/70 data-[state=active]:border-slate-300 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 dark:data-[state=active]:border-slate-600 dark:data-[state=active]:bg-slate-700/90 dark:data-[state=active]:text-white',
        },
        {
            value: 'preboard_scheduled',
            label: 'Pre Board Scheduled',
            count: tabCounts.preboard_scheduled,
            triggerClass: 'border-indigo-200/70 bg-indigo-50/90 text-indigo-700 hover:bg-indigo-100/90 dark:border-indigo-900/70 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50 data-[state=active]:border-indigo-300 data-[state=active]:bg-indigo-100 data-[state=active]:text-indigo-900 dark:data-[state=active]:border-indigo-700 dark:data-[state=active]:bg-indigo-900/80 dark:data-[state=active]:text-indigo-50',
        },
        {
            value: 'preboard_done_no_board',
            label: 'Pre Board Completed',
            count: tabCounts.preboard_done_no_board,
            triggerClass: 'border-amber-200/70 bg-amber-50/90 text-amber-700 hover:bg-amber-100/90 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50 data-[state=active]:border-amber-300 data-[state=active]:bg-amber-100 data-[state=active]:text-amber-900 dark:data-[state=active]:border-amber-700 dark:data-[state=active]:bg-amber-900/80 dark:data-[state=active]:text-amber-50',
        },
        {
            value: 'board_scheduled',
            label: 'Board Scheduled',
            count: tabCounts.board_scheduled,
            triggerClass: 'border-emerald-200/70 bg-emerald-50/90 text-emerald-700 hover:bg-emerald-100/90 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50 data-[state=active]:border-emerald-300 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-900 dark:data-[state=active]:border-emerald-700 dark:data-[state=active]:bg-emerald-900/80 dark:data-[state=active]:text-emerald-50',
        },
    ] as const;

    const filtered = preStatusFiltered
        .filter((record) => {
            if (statusFilter === 'preboard_scheduled')
                return Boolean(record.preboard_scheduled_on) &&
                    record.status !== 'preboard_complete' &&
                    record.status !== 'board_date_fixed' &&
                    !record.board_scheduled_on;
            if (statusFilter === 'board_scheduled') return Boolean(record.board_scheduled_on) || record.status === 'board_date_fixed';
            if (statusFilter === 'preboard_done_no_board')
                return (record.status === 'preboard_complete' || Boolean(record.preboard_completed_on)) &&
                    record.status !== 'board_date_fixed' && !record.board_scheduled_on;
            return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    return (
        <div className="space-y-3">
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold md:text-base">
                        <GraduationCap className="h-4 w-4 text-indigo-600" /> Trainee Unit Marking
                    </h3>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground md:top-3 md:h-3.5 md:w-3.5" />
                        <Input
                            placeholder="Search trainee, ID, designation, unit or status"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-9 w-full pl-7 pr-8 text-xs md:h-10 md:pl-8 md:text-[15px]"
                        />
                        {search && (
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="absolute right-1 top-1.5 h-6 w-6 text-muted-foreground hover:text-foreground md:top-1.5 md:h-7 md:w-7"
                                onClick={() => setSearch('')}
                            >
                                <X className="h-3 w-3 md:h-3.5 md:w-3.5" />
                            </Button>
                        )}
                    </div>
                    <Select value={unitFilter} onValueChange={setUnitFilter}>
                        <SelectTrigger className="h-9 w-[130px] shrink-0 text-xs">
                            <SelectValue placeholder="All units" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All units</SelectItem>
                            {units.map((unit) => (
                                <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        size="sm"
                        className="h-9 w-full shrink-0 whitespace-nowrap px-3 text-xs sm:w-auto md:h-10 md:px-4 md:text-[15px]"
                        onClick={() => syncMutation.mutate()}
                        disabled={syncMutation.isPending}
                    >
                        <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                        {syncMutation.isPending ? 'Syncing...' : 'Fetch & Save'}
                    </Button>
                </div>
                <Tabs
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as 'all' | 'preboard_scheduled' | 'board_scheduled' | 'preboard_done_no_board')}
                >
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-1.5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/10">
                        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
                            {traineeFilterTabs.map((tab) => (
                                <TabsTrigger
                                    key={tab.value}
                                    value={tab.value}
                                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition data-[state=active]:shadow-sm ${tab.triggerClass}`}
                                >
                                    <span>{tab.label}</span>
                                    <span className="ml-2 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-current ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
                                        {tab.count}
                                    </span>
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>
                </Tabs>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading trainee data...</div>
            ) : errorMessage ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-6 py-10 text-center text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200">
                    <GraduationCap className="h-10 w-10 opacity-40" />
                    <p className="text-sm font-medium">Unable to load trainee data.</p>
                    <p className="max-w-xl text-xs text-rose-600/90 dark:text-rose-200/80">{errorMessage}</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <GraduationCap className="h-10 w-10 mb-2 opacity-30" />
                    <p className="text-sm">{data.length === 0 ? 'No trainee data yet. Click "Fetch & Save" to sync.' : 'No matching trainees.'}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
                    {filtered.map((record) => {
                        const scheduledMilestone = getScheduledTraineeMilestone(record);

                        return (
                        <Card key={record.emp_id} className="h-full border-indigo-100 p-3 dark:border-slate-800 md:p-4">
                            <div className="flex h-full flex-col space-y-2.5">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs md:text-sm font-semibold leading-tight break-words">{record.name}</p>
                                    <p className="text-[10px] md:text-xs text-muted-foreground">Emp ID: {record.emp_id}</p>
                                </div>
                                <div className="flex w-full flex-wrap items-center justify-between gap-1 sm:w-auto sm:justify-end sm:gap-1.5">
                                    {record.designation && (
                                        <Badge variant="secondary" className="text-[9px] md:text-[10px] px-1.5 py-0">{record.designation}</Badge>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-[10px]"
                                        onClick={() => setEditingRecord(cloneTraineeRecordForEdit(record))}
                                    >
                                        <Pencil className="mr-1 h-3 w-3" /> Edit
                                    </Button>
                                </div>
                            </div>
                            <Separator />
                            <div className="flex-1 space-y-1.5 text-[10px] md:text-xs">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">Marked Unit</span>
                                    <Badge className="max-w-[65%] justify-end bg-indigo-100 text-right text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-200 dark:border-indigo-900/60">{record.unit || 'Not marked'}</Badge>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">Total Hours</span>
                                    <span className="font-semibold text-slate-900 dark:text-white">{record.hours_required ?? '—'}</span>
                                </div>
                                {record.preboard_completed_on && (
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Pre-Board Completed</span>
                                        <span className="min-w-0 text-right font-medium">{formatTraineeDate(record.preboard_completed_on)}</span>
                                    </div>
                                )}
                                {record.preboard_scheduled_on && (
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Pre-Board Scheduled</span>
                                        <span className="min-w-0 text-right font-medium">{formatTraineeDate(record.preboard_scheduled_on)}</span>
                                    </div>
                                )}
                                {record.board_scheduled_on && (
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-muted-foreground">Board Scheduled</span>
                                        <span className="min-w-0 text-right font-medium">{formatTraineeDate(record.board_scheduled_on)}</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">Highest Rating</span>
                                    <span className="min-w-0 text-right font-medium">{record.highest_rating || '—'}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">Station</span>
                                    <span className="min-w-0 text-right font-medium">{record.current_station || '—'}</span>
                                </div>

                                {/* OJT hours progress, correlated from the OJT Progress page. */}
                                {record.ojt_band && (
                                    <div className="mt-2 space-y-1 rounded-lg border border-border/70 bg-muted/40 p-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium text-muted-foreground">
                                                OJT {record.ojt_unit}
                                                {(record.ojt_cycle_count ?? 0) > 1 && (
                                                    <span className="ml-1 font-normal">
                                                        (+{(record.ojt_cycle_count ?? 1) - 1} more)
                                                    </span>
                                                )}
                                            </span>
                                            <Badge variant="outline" className={`text-[9px] md:text-[10px] px-1.5 py-0 ${getOjtBandClass(record.ojt_band)}`}>
                                                {getOjtBandLabel(record.ojt_band)}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-muted-foreground">Hours left</span>
                                            <span className="text-right font-medium tabular-nums">
                                                {formatOjtHours(record.ojt_hours_left)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-muted-foreground">Deadline</span>
                                            <span className="text-right font-medium">
                                                {formatTraineeDate(record.ojt_deadline)}
                                                <span className={`ml-1 font-normal ${(record.ojt_days_left ?? 0) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>
                                                    ({formatDaysLeft(record.ojt_days_left)})
                                                </span>
                                            </span>
                                        </div>
                                        {record.ojt_ratio !== null && record.ojt_ratio !== undefined && (
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-muted-foreground">Required rate</span>
                                                <span className={`text-right font-semibold tabular-nums ${getOjtRatioTextClass(record.ojt_band)}`}>
                                                    {formatOjtRatio(record.ojt_ratio)} hrs/day
                                                </span>
                                            </div>
                                        )}
                                        {record.ojt_requires_gm_extension && (
                                            <p className="pt-0.5 font-medium text-rose-700 dark:text-rose-300">
                                                Needs GM (ATM) extension — under 15 days at above 1 hr/day
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="mt-auto border-t border-border/70 pt-2">
                                <div className="flex flex-col gap-2 text-[10px] md:text-xs sm:flex-row sm:items-start sm:justify-between">
                                    <span className="pt-0.5 text-muted-foreground">Status</span>
                                    <div className="flex flex-col items-start gap-1 sm:items-end">
                                        <Badge variant="outline" className={`text-[9px] md:text-[10px] px-1.5 py-0 ${getTraineeStatusBadgeClass(record.status)}`}>
                                            {getTraineeStatusLabel(record.status)}
                                        </Badge>
                                        {scheduledMilestone && (
                                            <Badge variant="outline" className={`text-[9px] md:text-[10px] px-1.5 py-0 ${scheduledMilestone.countdownClass}`}>
                                                {scheduledMilestone.countdownLabel}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </div>
                            </div>
                        </Card>
                        );
                    })}
                </div>
            )}

            <Dialog open={Boolean(editingRecord)} onOpenChange={(open) => !open && setEditingRecord(null)}>
                <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md sm:w-full">
                    <DialogHeader>
                        <DialogTitle>Edit Trainee</DialogTitle>
                        <DialogDescription>
                            Update the status for this trainee. Choosing Training Completed will remove the trainee from this list.
                        </DialogDescription>
                    </DialogHeader>
                    {editingRecord && (
                        <div className="space-y-4">
                            <div className="rounded-lg border bg-muted/20 p-3 text-xs md:text-sm">
                                <div className="font-semibold text-foreground">{editingRecord.name}</div>
                                <div className="mt-1 text-muted-foreground">Emp ID: {editingRecord.emp_id}</div>
                                <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] md:grid-cols-2 md:text-xs">
                                    <div>
                                        <span className="text-muted-foreground">Marked Unit</span>
                                        <div className="font-medium text-foreground">{editingRecord.unit || '—'}</div>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Total Hours</span>
                                        <div className="font-medium text-foreground">{editingRecord.hours_required ?? '—'}</div>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Station</span>
                                        <div className="font-medium text-foreground">{editingRecord.current_station || '—'}</div>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Highest Rating</span>
                                        <div className="font-medium text-foreground">{editingRecord.highest_rating || '—'}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</Label>
                                <Select
                                    value={editingRecord.status ?? EMPTY_TRAINEE_STATUS_VALUE}
                                    onValueChange={(value) => {
                                        if (value === EMPTY_TRAINEE_STATUS_VALUE) {
                                            setEditingRecord(clearEditableTraineeStatusData(editingRecord));
                                            return;
                                        }

                                        if (value === 'training_completed') {
                                            setCompletionCandidate({ ...editingRecord, status: 'training_completed' });
                                            return;
                                        }

                                        setEditingRecord({
                                            ...editingRecord,
                                            status: value as TraineeStatus,
                                        });
                                    }}
                                >
                                    <SelectTrigger className="h-10 text-sm">
                                        <SelectValue placeholder="Select Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={EMPTY_TRAINEE_STATUS_VALUE}>No saved status</SelectItem>
                                        {TRAINEE_STATUS_OPTIONS.filter((option) => option.value !== 'training_completed').map((option) => (
                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                        ))}
                                        <SelectItem value="training_completed">Training Completed</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                                    <span>
                                        {editingRecord.status ? `Saved status: ${getTraineeStatusLabel(editingRecord.status)}` : 'No saved status data'}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-[11px]"
                                        disabled={updateTraineeRecord.isPending || (!editingRecord.status && !editingRecord.preboard_completed_on && !editingRecord.preboard_scheduled_on && !editingRecord.board_scheduled_on)}
                                        onClick={() => setEditingRecord(clearEditableTraineeStatusData(editingRecord))}
                                    >
                                        Clear Status
                                    </Button>
                                </div>
                            </div>

                            {getRequiredTraineeDateField(editingRecord.status) === 'preboard_completed_on' && (
                                <div className="space-y-2">
                                    <Label htmlFor="preboard-completed-on" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pre-Board Completed Date</Label>
                                    <Input
                                        id="preboard-completed-on"
                                        type="date"
                                        value={editingRecord.preboard_completed_on || ''}
                                        onChange={(event) => setEditingRecord({ ...editingRecord, preboard_completed_on: event.target.value || null })}
                                    />
                                </div>
                            )}

                            {getRequiredTraineeDateField(editingRecord.status) === 'preboard_scheduled_on' && (
                                <div className="space-y-2">
                                    <Label htmlFor="preboard-scheduled-on" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pre-Board Scheduled Date</Label>
                                    <Input
                                        id="preboard-scheduled-on"
                                        type="date"
                                        value={editingRecord.preboard_scheduled_on || ''}
                                        onChange={(event) => setEditingRecord({ ...editingRecord, preboard_scheduled_on: event.target.value || null })}
                                    />
                                </div>
                            )}

                            {getRequiredTraineeDateField(editingRecord.status) === 'board_scheduled_on' && (
                                <div className="space-y-2">
                                    <Label htmlFor="board-scheduled-on" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Board Scheduled Date</Label>
                                    <Input
                                        id="board-scheduled-on"
                                        type="date"
                                        value={editingRecord.board_scheduled_on || ''}
                                        onChange={(event) => setEditingRecord({ ...editingRecord, board_scheduled_on: event.target.value || null })}
                                    />
                                </div>
                            )}

                            <div className="flex items-center justify-end gap-2">
                                <Button variant="outline" onClick={() => setEditingRecord(null)} disabled={updateTraineeRecord.isPending}>
                                    Cancel
                                </Button>
                                <Button
                                    onClick={() => {
                                        if (!editingRecord) return;

                                        const requiredField = getRequiredTraineeDateField(editingRecord.status);
                                        if (requiredField && !editingRecord[requiredField]) {
                                            const labelMap = {
                                                preboard_completed_on: 'Pre-Board Completed date',
                                                preboard_scheduled_on: 'Pre-Board Scheduled date',
                                                board_scheduled_on: 'Board Scheduled date',
                                            } as const;
                                            toast.error(`${labelMap[requiredField]} is required`);
                                            return;
                                        }

                                        updateTraineeRecord.mutate(
                                            { record: editingRecord, removeFromList: false },
                                            { onSuccess: () => setEditingRecord(null) },
                                        );
                                    }}
                                    disabled={updateTraineeRecord.isPending}
                                >
                                    <Save className="mr-1.5 h-4 w-4" />
                                    {updateTraineeRecord.isPending ? 'Saving...' : 'Save Status'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Add Employee as Trainee dialog */}
            <Dialog open={addDialogOpen} onOpenChange={onAddDialogOpenChange}>
                <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md sm:w-full">
                    <DialogHeader>
                        <DialogTitle>Add Employee as Trainee</DialogTitle>
                        <DialogDescription>
                            Select an employee from the database and set their initial trainee details.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {/* Employee picker */}
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Employee</Label>
                            <Popover open={empComboOpen} onOpenChange={setEmpComboOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        aria-expanded={empComboOpen}
                                        className="w-full justify-between text-sm font-normal"
                                    >
                                        {addForm.emp_id
                                            ? (addForm.name || addForm.emp_id)
                                            : 'Select employee…'}
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[min(calc(100vw-2rem),28rem)] p-0" align="start">
                                    <Command>
                                        <CommandInput placeholder="Search by name or ID…" />
                                        <CommandList>
                                            <CommandEmpty>No employees found.</CommandEmpty>
                                            <CommandGroup>
                                                <ScrollArea className="h-56">
                                                    {availableProfiles.map((profile) => (
                                                        <CommandItem
                                                            key={profile.employee_id}
                                                            value={`${profile.full_name || ''} ${profile.employee_id}`}
                                                            onSelect={() => {
                                                                setAddForm((prev) => ({
                                                                    ...prev,
                                                                    emp_id: profile.employee_id,
                                                                    name: profile.full_name || profile.employee_id,
                                                                    designation: prev.designation || profile.designation || '',
                                                                }));
                                                                setEmpComboOpen(false);
                                                            }}
                                                        >
                                                            <Check className={`mr-2 h-4 w-4 ${addForm.emp_id === profile.employee_id ? 'opacity-100' : 'opacity-0'}`} />
                                                            <div className="flex flex-col">
                                                                <span className="text-sm">{profile.full_name || profile.employee_id}</span>
                                                                <span className="text-xs text-muted-foreground">{profile.employee_id}{profile.designation ? ` · ${profile.designation}` : ''}</span>
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </ScrollArea>
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Unit */}
                        <div className="space-y-2">
                            <Label htmlFor="add-trainee-unit" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Marked Unit</Label>
                            <Input
                                id="add-trainee-unit"
                                placeholder="e.g. ADC, APP"
                                value={addForm.unit}
                                onChange={(e) => setAddForm((prev) => ({ ...prev, unit: e.target.value }))}
                            />
                        </div>

                        {/* Hours required */}
                        <div className="space-y-2">
                            <Label htmlFor="add-trainee-hours" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hours Required</Label>
                            <Input
                                id="add-trainee-hours"
                                type="number"
                                min={0}
                                placeholder="e.g. 100"
                                value={addForm.hours_required}
                                onChange={(e) => setAddForm((prev) => ({ ...prev, hours_required: e.target.value }))}
                            />
                        </div>

                        {/* Designation */}
                        <div className="space-y-2">
                            <Label htmlFor="add-trainee-desig" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Designation <span className="normal-case font-normal text-muted-foreground">(optional)</span></Label>
                            <Input
                                id="add-trainee-desig"
                                placeholder="e.g. ATCO"
                                value={addForm.designation}
                                onChange={(e) => setAddForm((prev) => ({ ...prev, designation: e.target.value }))}
                            />
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                            <Button variant="outline" onClick={() => onAddDialogOpenChange(false)} disabled={addTrainee.isPending}>
                                Cancel
                            </Button>
                            <Button
                                onClick={() => {
                                    if (!addForm.emp_id) {
                                        toast.error('Please select an employee');
                                        return;
                                    }
                                    if (!addForm.unit && !addForm.hours_required) {
                                        toast.error('Please enter at least a unit or hours required');
                                        return;
                                    }
                                    addTrainee.mutate(
                                        {
                                            emp_id: addForm.emp_id,
                                            name: addForm.name,
                                            unit: addForm.unit,
                                            hours_required: addForm.hours_required ? Number(addForm.hours_required) : null,
                                            designation: addForm.designation || null,
                                        },
                                        { onSuccess: () => onAddDialogOpenChange(false) },
                                    );
                                }}
                                disabled={addTrainee.isPending}
                            >
                                <Plus className="mr-1.5 h-4 w-4" />
                                {addTrainee.isPending ? 'Adding…' : 'Add to Trainee List'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={Boolean(completionCandidate)} onOpenChange={(open) => !open && setCompletionCandidate(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Mark Training Completed?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {completionCandidate?.name ? `${completionCandidate.name} will be removed from the trainee list after this action.` : 'This trainee will be removed from the trainee list after this action.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={updateTraineeRecord.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 text-white hover:bg-red-700"
                            disabled={updateTraineeRecord.isPending}
                            onClick={(event) => {
                                event.preventDefault();
                                if (!completionCandidate) return;

                                updateTraineeRecord.mutate(
                                    { record: completionCandidate, removeFromList: true },
                                    {
                                        onSuccess: () => {
                                            setEditingRecord(null);
                                            setCompletionCandidate(null);
                                        },
                                    },
                                );
                            }}
                        >
                            {updateTraineeRecord.isPending ? 'Removing...' : 'Yes, mark completed'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export function SupervisorTraineePanel({
    addDialogOpen = false,
    onAddDialogOpenChange,
}: {
    addDialogOpen?: boolean;
    onAddDialogOpenChange?: (open: boolean) => void;
}) {
    const {
        data: traineeSyncData = [],
        isLoading: traineeLoading,
        refetch: refetchTrainees,
        error: traineeError,
    } = useTraineeSyncData();
    const syncTraineeData = useSyncTraineeData();
    const [internalAddDialogOpen, setInternalAddDialogOpen] = useState(false);

    return (
        <TraineeTab
            data={traineeSyncData}
            syncMutation={syncTraineeData}
            refetch={refetchTrainees}
            isLoading={traineeLoading}
            errorMessage={traineeError instanceof Error ? traineeError.message : undefined}
            addDialogOpen={onAddDialogOpenChange ? addDialogOpen : internalAddDialogOpen}
            onAddDialogOpenChange={onAddDialogOpenChange ?? setInternalAddDialogOpen}
        />
    );
}

// ---------- Sub-components ----------

/** Overview tab — shows all employees with all their active ratings */
function OverviewTab({
    data, syncMutation, refetch, isLoading
}: { data: RatingSyncRecord[]; syncMutation: ReturnType<typeof useSyncRatingData>; refetch: () => void; isLoading: boolean }) {
    const today = startOfDay(new Date());
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search, 250);
    const [sort, setSort] = useState<'name' | 'designation'>('name');
    const [selectedRatingTypes, setSelectedRatingTypes] = useState<RatingType[]>([]);
    const [ratingTypeFilterOpen, setRatingTypeFilterOpen] = useState(false);
    const [viewingRecord, setViewingRecord] = useState<RatingSyncRecord | null>(null);
    const [editingRecord, setEditingRecord] = useState<EditableRatingRecord | null>(null);
    const updateRatingRecord = useUpdateRatingRecord();
    const instructorSuggestions = useMemo(() => getInstructorSuggestions(data), [data]);

    const toggleRatingTypeFilter = (ratingType: RatingType) => {
        setSelectedRatingTypes((current) =>
            current.includes(ratingType)
                ? current.filter((value) => value !== ratingType)
                : [...current, ratingType],
        );
    };

    const selectedRatingTypeLabel =
        selectedRatingTypes.length === 0
            ? 'All rating types'
            : selectedRatingTypes.length <= 2
                ? selectedRatingTypes.join(', ')
                : `${selectedRatingTypes.slice(0, 2).join(', ')} +${selectedRatingTypes.length - 2}`;


    const filtered = useMemo(() => [...data]
        .filter((r) => {
            if (!debouncedSearch.trim()) return true;
            const q = debouncedSearch.trim().toLowerCase();
            return r.name.toLowerCase().includes(q) || r.emp_id.toLowerCase().includes(q) || (r.designation || '').toLowerCase().includes(q);
        })
        .filter((r) => {
            if (selectedRatingTypes.length === 0) return true;
            return selectedRatingTypes.some((ratingType) => r.ratings[ratingType]?.status === '1');
        })
        .sort((a, b) => {
            if (sort === 'designation') return (a.designation || '').localeCompare(b.designation || '');
            return a.name.localeCompare(b.name);
        }), [data, debouncedSearch, selectedRatingTypes, sort]);

    const { totalActive, withRatings, profExpired, profWarning } = useMemo(() => {
        let totalActive = 0, withRatings = 0, profExpired = 0, profWarning = 0;

        for (const r of data) {
            let hasActive = false;
            for (const [ratingKey, v] of Object.entries(r.ratings)) {
                if (v.status === '1') {
                    totalActive++;
                    hasActive = true;
                    const pv = getRecordProfValidity(r, ratingKey, today);
                    if (pv?.exemptByAccS) { /* valid */ }
                    else if (!pv || pv.daysLeft < 0) profExpired++;
                    else if (pv.daysLeft <= 90) profWarning++;
                }
            }
            if (hasActive) withRatings++;
        }

        return { totalActive, withRatings, profExpired, profWarning };
    }, [data, today]);

    return (
        <div className="space-y-3">
            {/* Header controls */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold md:text-base flex items-center gap-1.5">
                        <Shield className="h-4 w-4 text-indigo-600" /> Rating Records
                    </h3>
                </div>
                <div className="flex items-center gap-2 md:flex-row md:items-center">
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground md:top-3 md:h-3.5 md:w-3.5" />
                        <Input
                            placeholder="Search name, ID or designation"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-7 w-full pl-7 pr-8 text-xs md:h-10 md:pl-8 md:text-[15px]"
                        />
                        {search && (
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="absolute right-1 top-0.5 h-6 w-6 text-muted-foreground hover:text-foreground md:top-1.5 md:h-7 md:w-7"
                                onClick={() => setSearch('')}
                            >
                                <X className="h-3 w-3 md:h-3.5 md:w-3.5" />
                            </Button>
                        )}
                    </div>
                    <Button
                        size="sm"
                        className="h-7 shrink-0 whitespace-nowrap px-3 text-xs md:h-10 md:px-4 md:text-[15px]"
                        onClick={() => syncMutation.mutate()}
                        disabled={syncMutation.isPending}
                    >
                        <RefreshCw className={`mr-1 h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                        {syncMutation.isPending ? 'Syncing...' : 'Fetch & Save'}
                    </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:items-end md:justify-end">
                    <div className="min-w-0 space-y-1 md:w-[205px]">
                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Sort</Label>
                        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                            <SelectTrigger className="h-7 w-full text-xs md:h-9 md:text-[15px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="name">Name A-Z</SelectItem>
                                <SelectItem value="designation">Designation</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="min-w-0 space-y-1 md:w-[235px]">
                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Filter</Label>
                        <Popover open={ratingTypeFilterOpen} onOpenChange={setRatingTypeFilterOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={ratingTypeFilterOpen}
                                    className="h-8 w-full justify-between px-3 text-xs font-normal md:h-9 md:text-[15px]"
                                >
                                    <span className="truncate">{selectedRatingTypeLabel}</span>
                                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[min(calc(100vw-2rem),18rem)] p-0" align="start">
                                <Command>
                                    <CommandInput placeholder="Search rating type..." />
                                    <CommandList>
                                        <CommandEmpty>No rating types found.</CommandEmpty>
                                        <CommandGroup>
                                            <CommandItem onSelect={() => setSelectedRatingTypes([])}>
                                                <Check className={`mr-2 h-4 w-4 ${selectedRatingTypes.length === 0 ? 'opacity-100' : 'opacity-0'}`} />
                                                All rating types
                                            </CommandItem>
                                            {RATING_TYPES.map((ratingType) => {
                                                const selected = selectedRatingTypes.includes(ratingType);

                                                return (
                                                    <CommandItem
                                                        key={ratingType}
                                                        value={ratingType}
                                                        onSelect={() => toggleRatingTypeFilter(ratingType)}
                                                    >
                                                        <Check className={`mr-2 h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                                                        {ratingType}
                                                    </CommandItem>
                                                );
                                            })}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="min-w-0 space-y-1 md:w-[160px]">
                        <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px]">Actions</Label>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-full text-xs md:h-9 md:px-4 md:text-[15px]"
                            onClick={() => refetch()}
                            disabled={isLoading}
                        >
                            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                            Reload
                        </Button>
                    </div>
                </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                <Card className="border-0 bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-white/75">Employees</span>
                        <span className="text-lg md:text-xl font-bold">{data.length}</span>
                    </CardContent>
                </Card>
                <Card className="border-muted">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-muted-foreground">With Rating</span>
                        <span className="text-lg md:text-xl font-bold">{withRatings}</span>
                    </CardContent>
                </Card>
                <Card className="border-muted">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-muted-foreground">Active</span>
                        <span className="text-lg md:text-xl font-bold">{totalActive}</span>
                    </CardContent>
                </Card>
                <Card className="border-red-200 bg-red-50/30 dark:border-red-900/60 dark:bg-red-950/20">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-red-600 dark:text-red-300">Prof Expired</span>
                        <span className="text-lg md:text-xl font-bold text-red-600 dark:text-red-300">{profExpired}</span>
                    </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50/30 dark:border-amber-900/60 dark:bg-amber-950/20">
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-300">Prof ≤90d</span>
                        <span className="text-lg md:text-xl font-bold text-amber-600 dark:text-amber-300">{profWarning}</span>
                    </CardContent>
                </Card>
            </div>

            {/* Cards */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading rating data...</div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Shield className="h-10 w-10 mb-2 opacity-30" />
                    <p className="text-sm">
                        {data.length === 0
                            ? 'No rating data yet. Click "Fetch & Save" to sync.'
                            : selectedRatingTypes.length > 0
                                ? 'No employees match the selected rating types.'
                                : 'No matching records.'}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
                    {filtered.map((record) => {
                        const activeEntries: [string, RatingEntry][] = [];
                        const inactiveEntries: [string, RatingEntry][] = [];
                        const visibleActiveEntries: [string, RatingEntry][] = [];
                        const visibleInactiveEntries: [string, RatingEntry][] = [];
                        for (const [key, v] of Object.entries(record.ratings)) {
                            const isActive = v.status === '1';
                            const isVisible = selectedRatingTypes.length === 0 || selectedRatingTypes.includes(key as RatingType);
                            if (isActive) {
                                activeEntries.push([key, v]);
                                if (isVisible) visibleActiveEntries.push([key, v]);
                            } else {
                                inactiveEntries.push([key, v]);
                                if (isVisible) visibleInactiveEntries.push([key, v]);
                            }
                        }
                        const worstStatus = getWorstProfStatus(record, today);
                        const soonestExpiryDays = getRecordSoonestExpiryDays(record, today);
                        const expiryBadge = soonestExpiryDays !== undefined ? getTopCardExpiryBadge(soonestExpiryDays) : null;
                        const borderClass = worstStatus === 'expired' ? 'border-red-400' : worstStatus === 'warning' ? 'border-amber-400' : worstStatus === 'valid' ? 'border-emerald-300' : '';

                        return (
                            <Card key={record.emp_id} className={`p-3 md:p-4 space-y-2.5 ${borderClass}`}>
                                {expiryBadge && (
                                    <div className="flex justify-start">
                                        <Badge variant="outline" className={`text-[9px] md:text-[10px] px-1.5 py-0 ${expiryBadge.className}`}>
                                            Expiry {expiryBadge.label}
                                        </Badge>
                                    </div>
                                )}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs md:text-sm font-semibold leading-tight truncate">{record.name}</p>
                                        <p className="text-[10px] md:text-xs text-muted-foreground">Emp ID: {record.emp_id}</p>
                                        <p className="mt-1 text-[10px] md:text-xs text-muted-foreground">Highest Rating: {record.highest_rating || '—'}</p>
                                    </div>
                                    {record.designation && (
                                        <Badge variant="secondary" className="text-[9px] md:text-[10px] px-1.5 py-0 shrink-0">{record.designation}</Badge>
                                    )}
                                </div>
                                <Separator />
                                {visibleActiveEntries.length > 0 ? (
                                    <div className="space-y-0">
                                        <div className="grid grid-cols-[48px_1fr_1fr_1fr] gap-x-1 text-[9px] md:text-[10px] text-muted-foreground font-semibold uppercase tracking-wide pb-1 border-b mb-1">
                                            <span>Type</span><span>Rated</span><span>Last Prof</span><span>Prof Valid</span>
                                        </div>
                                        {visibleActiveEntries.map(([key, entry]) => {
                                            const pv = getRecordProfValidity(record, key, today);
                                            const profLabel = pv?.exemptByAccS ? 'ACC(S)' : pv ? format(pv.validUpto, 'd MMM yy') : '-';
                                            const profBadgeClass = pv?.exemptByAccS
                                                ? 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-900/60'
                                                : !pv || pv.daysLeft < 0
                                                ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-900/60'
                                                : pv.daysLeft <= 90
                                                    ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-900/60'
                                                    : 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-900/60';
                                            const profDaysText = pv?.exemptByAccS ? 'PLR validity covered by active ACC(S)'
                                                : !pv ? 'No Prof'
                                                : pv.daysLeft < 0 ? `${Math.abs(pv.daysLeft)}d over`
                                                    : `${pv.daysLeft}d left`;

                                            return (
                                                <div key={key} className="grid grid-cols-[48px_1fr_1fr_1fr] gap-x-1 items-center py-1 border-b border-dashed last:border-0 text-[10px] md:text-xs">
                                                    <span className="font-bold text-[10px]">{key}</span>
                                                    <span className="font-medium">{entry.rating_date ? format(new Date(entry.rating_date), 'd MMM yy') : '-'}</span>
                                                    <span className="font-medium">{entry.last_proficiency?.date ? format(new Date(entry.last_proficiency.date), 'd MMM yy') : '-'}</span>
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Badge variant="outline" className={`text-[8px] md:text-[9px] px-1 py-0 cursor-default ${profBadgeClass}`}>
                                                                    {profLabel}
                                                                </Badge>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" className="text-xs">
                                                                {profDaysText}
                                                                {entry.last_proficiency?.instructor ? ` · Instructor: ${entry.last_proficiency.instructor}` : ''}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-[10px] md:text-xs text-muted-foreground italic">
                                        {selectedRatingTypes.length > 0 ? 'No active ratings for selected types' : 'No active ratings'}
                                    </p>
                                )}
                                <div className="flex items-center justify-between pt-1">
                                    <span className="text-[10px] md:text-xs text-muted-foreground">
                                        {selectedRatingTypes.length > 0 ? `${visibleInactiveEntries.length} matching inactive` : `${visibleInactiveEntries.length} inactive`}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setEditingRecord(cloneRecordForEdit(record))}>
                                            <Pencil className="h-3 w-3 mr-0.5" /> Edit
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setViewingRecord(record)}>
                                            <Eye className="h-3 w-3 mr-0.5" /> Details
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Detail Dialog */}
            <RatingDetailDialog record={viewingRecord} onClose={() => setViewingRecord(null)} />
            <RatingEditDialog
                record={editingRecord}
                onClose={() => setEditingRecord(null)}
                onSave={(record) => updateRatingRecord.mutate(record, { onSuccess: () => setEditingRecord(null) })}
                isSaving={updateRatingRecord.isPending}
                instructorSuggestions={instructorSuggestions}
                visibleRatingKeys={undefined}
            />
        </div>
    );
}

/** Individual rating type tab — e.g. only ADC entries */
function RatingTypeTab({
    data, ratingType, isLoading
}: { data: RatingSyncRecord[]; ratingType: RatingType; isLoading: boolean }) {
    const today = startOfDay(new Date());
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search, 250);
    const [sort, setSort] = useState<'name' | 'designation' | 'prof-expiry'>('prof-expiry');
    const [cardFilter, setCardFilter] = useState<'all' | 'active' | 'expired' | 'prof-warning' | 'inactive'>('all');
    const [viewingRecord, setViewingRecord] = useState<RatingSyncRecord | null>(null);
    const [editingRecord, setEditingRecord] = useState<EditableRatingRecord | null>(null);
    const updateRatingRecord = useUpdateRatingRecord();
    const instructorSuggestions = useMemo(() => getInstructorSuggestions(data), [data]);

    const recordsWithStatus = useMemo(() =>
        data.filter((r) => r.ratings[ratingType]).map((record) => ({
            record,
            displayStatus: getRecordRatingDisplayStatus(record, ratingType, today),
        })), [data, ratingType, today]);

    const searchFilteredRecords = useMemo(() => {
        const q = debouncedSearch.trim().toLowerCase();
        return recordsWithStatus.filter(({ record }) => {
            if (!q) return true;
            return record.name.toLowerCase().includes(q)
                || record.emp_id.toLowerCase().includes(q)
                || (record.designation || '').toLowerCase().includes(q)
                || (record.contact_no || '').toLowerCase().includes(q)
                || (record.current_station || '').toLowerCase().includes(q)
                || (record.license_number || '').toLowerCase().includes(q)
                || (record.highest_rating || '').toLowerCase().includes(q);
        });
    }, [recordsWithStatus, debouncedSearch]);

    const { activeCount, expiredCount, inactiveCount, profWarning } = useMemo(() => {
        let activeCount = 0, expiredCount = 0, inactiveCount = 0, profWarning = 0;
        for (const { record, displayStatus } of searchFilteredRecords) {
            if (displayStatus === 'active') activeCount++;
            else if (displayStatus === 'expired') expiredCount++;
            else if (displayStatus === 'inactive') inactiveCount++;
            if (displayStatus !== 'inactive') {
                const pv = getRecordProfValidity(record, ratingType, today);
                if (!pv?.exemptByAccS && pv && pv.daysLeft >= 0 && pv.daysLeft <= 90) profWarning++;
            }
        }
        return { activeCount, expiredCount, inactiveCount, profWarning };
    }, [searchFilteredRecords, ratingType, today]);

    const filtered = useMemo(() => {
        const matchesCardFilter = ({ record, displayStatus }: (typeof recordsWithStatus)[number]) => {
            if (cardFilter === 'all') return true;
            if (cardFilter === 'active') return displayStatus === 'active';
            if (cardFilter === 'expired') return displayStatus === 'expired';
            if (cardFilter === 'inactive') return displayStatus === 'inactive';
            const pv = getRecordProfValidity(record, ratingType, today);
            if (cardFilter === 'prof-warning') return !pv?.exemptByAccS && pv !== null && pv.daysLeft >= 0 && pv.daysLeft <= 90;
            return true;
        };

        const statusFilteredRecords = searchFilteredRecords.filter(({ displayStatus }) =>
            displayStatus === 'active' || displayStatus === 'expired',
        );
        const filteredSource = cardFilter === 'all'
            ? statusFilteredRecords
            : searchFilteredRecords.filter(matchesCardFilter);

        return [...filteredSource].sort((a, b) => {
            if (sort === 'designation') return (a.record.designation || '').localeCompare(b.record.designation || '');
            if (sort === 'prof-expiry') {
                const pvA = getRecordProfValidity(a.record, ratingType, today);
                const pvB = getRecordProfValidity(b.record, ratingType, today);
                const daysA = pvA?.exemptByAccS ? Number.POSITIVE_INFINITY : (pvA?.daysLeft ?? -9999);
                const daysB = pvB?.exemptByAccS ? Number.POSITIVE_INFINITY : (pvB?.daysLeft ?? -9999);
                return daysA - daysB;
            }
            return a.record.name.localeCompare(b.record.name);
        });
    }, [searchFilteredRecords, cardFilter, sort, ratingType, today]);

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold md:text-base flex items-center gap-1.5">
                        <Shield className="h-4 w-4 text-indigo-600" /> {ratingType} Rating Records
                    </h3>
                </div>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground md:top-3 md:h-3.5 md:w-3.5" />
                        <Input
                            placeholder="Search name, ID or designation"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-7 w-full pl-7 pr-8 text-xs md:h-10 md:pl-8 md:text-[15px]"
                        />
                        {search && (
                            <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="absolute right-1 top-0.5 h-6 w-6 text-muted-foreground hover:text-foreground md:top-1.5 md:h-7 md:w-7"
                                onClick={() => setSearch('')}
                            >
                                <X className="h-3 w-3 md:h-3.5 md:w-3.5" />
                            </Button>
                        )}
                    </div>
                    <div className="w-full md:w-[205px]">
                        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                            <SelectTrigger aria-label="Sort rating records" className="h-7 w-full text-xs md:h-10 md:text-[15px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="prof-expiry">Prof Expiry (soonest)</SelectItem>
                                <SelectItem value="name">Name A-Z</SelectItem>
                                <SelectItem value="designation">Designation</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Summary — clickable filter cards */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Card
                    onClick={() => setCardFilter(cardFilter === 'active' ? 'all' : 'active')}
                    className={`cursor-pointer border-emerald-200 bg-emerald-50/30 transition-shadow hover:shadow-md ${cardFilter === 'active' ? 'ring-2 ring-emerald-400 ring-offset-1' : ''}`}
                >
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-emerald-600">Active</span>
                        <span className="text-lg md:text-xl font-bold text-emerald-600">{activeCount}</span>
                    </CardContent>
                </Card>
                <Card
                    onClick={() => setCardFilter(cardFilter === 'expired' ? 'all' : 'expired')}
                    className={`cursor-pointer border-red-200 bg-red-50/30 transition-shadow hover:shadow-md ${cardFilter === 'expired' ? 'ring-2 ring-red-400 ring-offset-1' : ''}`}
                >
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-red-600">Expired</span>
                        <span className="text-lg md:text-xl font-bold text-red-600">{expiredCount}</span>
                    </CardContent>
                </Card>
                <Card
                    onClick={() => setCardFilter(cardFilter === 'prof-warning' ? 'all' : 'prof-warning')}
                    className={`cursor-pointer border-amber-200 bg-amber-50/30 transition-shadow hover:shadow-md ${cardFilter === 'prof-warning' ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                >
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-amber-600">Prof ≤90d</span>
                        <span className="text-lg md:text-xl font-bold text-amber-600">{profWarning}</span>
                    </CardContent>
                </Card>
                <Card
                    onClick={() => setCardFilter(cardFilter === 'inactive' ? 'all' : 'inactive')}
                    className={`cursor-pointer transition-shadow hover:shadow-md ${cardFilter === 'inactive' ? 'ring-2 ring-slate-400 ring-offset-1' : 'border-muted'}`}
                >
                    <CardContent className="flex items-center justify-between py-2 px-3">
                        <span className="text-[10px] md:text-xs font-medium uppercase tracking-wide text-muted-foreground">Inactive</span>
                        <span className="text-lg md:text-xl font-bold">{inactiveCount}</span>
                    </CardContent>
                </Card>
            </div>

            {/* Cards */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Shield className="h-10 w-10 mb-2 opacity-30" />
                    <p className="text-sm">No employees with {ratingType} rating.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
                    {filtered.map(({ record, displayStatus }) => {
                        const entry = record.ratings[ratingType];
                        const isActive = entry.status === '1';
                        const pv = isActive ? getRecordProfValidity(record, ratingType, today) : null;
                        const expiryBadge = isActive && !pv?.exemptByAccS ? getTopCardExpiryBadge(pv?.daysLeft ?? null) : null;
                        const profLabel = pv?.exemptByAccS ? 'ACC(S) valid' : pv ? format(pv.validUpto, 'd MMM yy') : null;
                        const profDaysText = pv?.exemptByAccS ? 'PLR validity covered by active ACC(S)'
                            : !pv ? null
                            : pv.daysLeft < 0 ? `${Math.abs(pv.daysLeft)}d overdue`
                                : `${pv.daysLeft}d left`;
                        const borderClass = !isActive ? 'border-muted'
                            : pv?.exemptByAccS ? 'border-sky-300'
                                : !pv || pv.daysLeft < 0 ? 'border-red-400'
                                : pv.daysLeft <= 90 ? 'border-amber-400'
                                    : 'border-emerald-300';
                        const statusBadge = displayStatus === 'expired'
                            ? <Badge className="bg-red-100 text-red-700 border-red-200 text-[9px] px-1.5 py-0">Expiry</Badge>
                            : displayStatus === 'active'
                                ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[9px] px-1.5 py-0">Active</Badge>
                                : <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-[9px] px-1.5 py-0">Inactive</Badge>;

                        const profEntries = Object.entries(entry.proficiency_history || {}).sort(([a], [b]) => b.localeCompare(a));

                        return (
                            <Card key={record.emp_id} className={`p-3 md:p-4 space-y-2 ${borderClass}`}>
                                {expiryBadge && (
                                    <div className="flex justify-start">
                                        <Badge variant="outline" className={`text-[9px] md:text-[10px] px-1.5 py-0 ${expiryBadge.className}`}>
                                            Expiry {expiryBadge.label}
                                        </Badge>
                                    </div>
                                )}
                                {/* Header */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs md:text-sm font-semibold leading-tight truncate">{record.name}</p>
                                        <p className="text-[10px] md:text-xs text-muted-foreground">Emp ID: {record.emp_id}</p>
                                        <p className="mt-1 text-[10px] md:text-xs text-muted-foreground">Highest Rating: {record.highest_rating || '—'}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {record.designation && (
                                            <Badge variant="secondary" className="text-[9px] md:text-[10px] px-1.5 py-0">{record.designation}</Badge>
                                        )}
                                        {statusBadge}
                                    </div>
                                </div>

                                <Separator />

                                {/* Rating details */}
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] md:text-xs">
                                    <div>
                                        <span className="text-muted-foreground">Rating Date</span>
                                        <p className="font-medium">{entry.rating_date ? format(new Date(entry.rating_date), 'd MMM yyyy') : '-'}</p>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Last Proficiency</span>
                                        <p className="font-medium">
                                            {entry.last_proficiency?.date ? format(new Date(entry.last_proficiency.date), 'd MMM yyyy') : '-'}
                                        </p>
                                        {entry.last_proficiency?.instructor && (
                                            <p className="text-[9px] text-muted-foreground">{entry.last_proficiency.instructor}</p>
                                        )}
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Endorsement</span>
                                        <p className="font-medium">{entry.endorsement_date ? format(new Date(entry.endorsement_date), 'd MMM yyyy') : '-'}</p>
                                    </div>
                                    {isActive && (
                                        <div>
                                            <span className="text-muted-foreground">Prof Valid Upto</span>
                                            {pv ? (
                                                <p className={`font-medium ${pv.exemptByAccS ? 'text-sky-600' : pv.daysLeft < 0 ? 'text-red-600' : pv.daysLeft <= 90 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                                    {profLabel}
                                                    {profDaysText && <span className="text-[9px] ml-1">({profDaysText})</span>}
                                                </p>
                                            ) : (
                                                <p className="font-medium text-red-600">No Prof</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Prof history count + Details */}
                                <div className="flex items-center justify-between pt-1">
                                    <span className="text-[10px] md:text-xs text-muted-foreground">
                                        {profEntries.length} proficiency check{profEntries.length !== 1 ? 's' : ''}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setEditingRecord(cloneRecordForEdit(record))}>
                                            <Pencil className="h-3 w-3 mr-0.5" /> Edit
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setViewingRecord(record)}>
                                            <Eye className="h-3 w-3 mr-0.5" /> Details
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Detail Dialog — shows all ratings for selected employee */}
            <RatingDetailDialog record={viewingRecord} onClose={() => setViewingRecord(null)} />
            <RatingEditDialog
                record={editingRecord}
                onClose={() => setEditingRecord(null)}
                onSave={(record) => updateRatingRecord.mutate(record, { onSuccess: () => setEditingRecord(null) })}
                isSaving={updateRatingRecord.isPending}
                instructorSuggestions={instructorSuggestions}
                visibleRatingKeys={editingRecord ? [ratingType] : undefined}
            />
        </div>
    );
}

/** Shared detail dialog */
function RatingDetailDialog({ record, onClose }: { record: RatingSyncRecord | null; onClose: () => void }) {
    const today = startOfDay(new Date());

    return (
        <Dialog open={!!record} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg max-h-[85vh] overflow-y-auto sm:w-full">
                <DialogHeader>
                    <DialogTitle className="text-base flex items-center gap-1.5">
                        <Shield className="h-4 w-4" /> Rating Details
                    </DialogTitle>
                    <DialogDescription>
                        {record?.name} ({record?.emp_id}){record?.designation ? ` · ${record.designation}` : ''}
                    </DialogDescription>
                </DialogHeader>
                {record && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-2">
                            <div>
                                <span className="text-muted-foreground text-xs">Contact No</span>
                                <p className="font-medium">{record.contact_no || '-'}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground text-xs">Current Station</span>
                                <p className="font-medium">{record.current_station || '-'}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground text-xs">Current License Number</span>
                                <p className="font-medium">{record.license_number || '-'}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground text-xs">ICAO ELPA Level</span>
                                <p className="font-medium">{record.elpa_level || '-'}</p>
                            </div>
                            <div className="sm:col-span-2">
                                <span className="text-muted-foreground text-xs">Highest Rating</span>
                                <p className="font-medium">{record.highest_rating || '-'}</p>
                            </div>
                        </div>
                        {Object.entries(record.ratings).map(([key, entry]) => {
                            const isActive = entry.status === '1';
                            const profEntries = Object.entries(entry.proficiency_history || {}).sort(([a], [b]) => a.localeCompare(b));
                            return (
                                <div key={key} className={`rounded-md border p-3 space-y-2 ${isActive ? 'border-emerald-200 bg-emerald-50/30' : 'border-muted bg-muted/20'}`}>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-bold">{key}</span>
                                        <Badge className={`text-[10px] px-1.5 py-0 ${isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                                            {isActive ? 'Active' : 'Inactive'}
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                        <div>
                                            <span className="text-muted-foreground text-xs">Rating Date</span>
                                            <p className="font-medium">{entry.rating_date ? format(new Date(entry.rating_date), 'd MMM yyyy') : '-'}</p>
                                        </div>
                                        <div>
                                            <span className="text-muted-foreground text-xs">Endorsement Date</span>
                                            <p className="font-medium">{entry.endorsement_date ? format(new Date(entry.endorsement_date), 'd MMM yyyy') : '-'}</p>
                                        </div>
                                    </div>
                                    {entry.last_proficiency?.date && (
                                        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                            <div>
                                                <span className="text-muted-foreground text-xs">Last Proficiency</span>
                                                <p className="font-medium">
                                                    {format(new Date(entry.last_proficiency.date), 'd MMM yyyy')}
                                                    {entry.last_proficiency.instructor ? ` — ${entry.last_proficiency.instructor}` : ''}
                                                </p>
                                            </div>
                                            {isActive && (() => {
                                                const pvDialog = getRecordProfValidity(record, key, today);
                                                if (!pvDialog) return null;
                                                const pvClass = pvDialog.exemptByAccS
                                                    ? 'text-sky-600'
                                                    : pvDialog.daysLeft < 0
                                                    ? 'text-red-600'
                                                    : pvDialog.daysLeft <= 90
                                                        ? 'text-amber-600'
                                                        : 'text-emerald-600';
                                                return (
                                                    <div>
                                                        <span className="text-muted-foreground text-xs">Prof Valid Upto</span>
                                                        <p className={`font-medium ${pvClass}`}>
                                                            {pvDialog.exemptByAccS ? 'Covered by ACC(S)' : format(pvDialog.validUpto, 'd MMM yyyy')}
                                                            <span className="text-xs ml-1">
                                                                ({pvDialog.exemptByAccS ? 'PLR does not require separate proficiency validity' : pvDialog.daysLeft < 0 ? `${Math.abs(pvDialog.daysLeft)}d overdue` : `${pvDialog.daysLeft}d left`})
                                                            </span>
                                                        </p>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                    {profEntries.length > 0 && (
                                        <>
                                            <Separator />
                                            <div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Proficiency History</h4>
                                                <div className="space-y-1">
                                                    {profEntries.map(([pKey, pVal]) => (
                                                        <div key={pKey} className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                                                            <span className="text-muted-foreground">{pKey}</span>
                                                            <span className="font-medium">
                                                                {pVal.date ? format(new Date(pVal.date), 'd MMM yyyy') : '-'}
                                                                {pVal.instructor ? ` · ${pVal.instructor}` : ''}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function InstructorCombobox({ value, onChange, suggestions, placeholder = 'Instructor name' }: {
    value: string;
    onChange: (val: string) => void;
    suggestions: string[];
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const filtered = suggestions.filter((s) =>
        s.toLowerCase().includes((search || value || '').toLowerCase()),
    );

    return (
        <div ref={wrapperRef} className="relative z-20">
            <Input
                autoComplete="nope"
                name={`instructor-${Math.random()}`}
                className="h-8 text-xs"
                value={value}
                placeholder={placeholder}
                onChange={(e) => {
                    onChange(e.target.value);
                    setSearch(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
            />
            {open && filtered.length > 0 && (
                <ul className="absolute z-[80] mt-1 max-h-40 w-full overflow-auto rounded-md border bg-popover p-1 text-xs shadow-md">
                    {filtered.slice(0, 20).map((name) => (
                        <li
                            key={name}
                            className="cursor-pointer rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                            onMouseDown={() => {
                                onChange(name);
                                setSearch('');
                                setOpen(false);
                            }}
                        >
                            {name}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function RatingEditDialog({
    record,
    onClose,
    onSave,
    isSaving,
    instructorSuggestions,
    visibleRatingKeys,
}: {
    record: EditableRatingRecord | null;
    onClose: () => void;
    onSave: (record: EditableRatingRecord) => void;
    isSaving: boolean;
    instructorSuggestions: string[];
    visibleRatingKeys?: string[];
}) {
    const [draft, setDraft] = useState<EditableRatingRecord | null>(null);


    useEffect(() => {
        if (record) {
            setDraft(record);

            return;
        }

        setDraft(null);
    }, [record]);

    const updateEntry = (ratingKey: string, updater: (entry: RatingEntry) => RatingEntry) => {
        setDraft((current) => {
            if (!current) return current;
            const entry = current.ratings[ratingKey] || createEmptyRatingEntry();
            return {
                ...current,
                ratings: {
                    ...current.ratings,
                    [ratingKey]: updater(entry),
                },
            };
        });
    };

    const allRatingKeys = draft ? [...new Set([...RATING_TYPES, ...Object.keys(draft.ratings)])] : [];
    const ratingKeys = visibleRatingKeys?.length
        ? allRatingKeys.filter((key) => visibleRatingKeys.includes(key))
        : allRatingKeys;

    const getNextHistoryLabel = (ratingKey: string): string | null => {
        if (!draft) return null;
        const used = new Set(Object.keys(draft.ratings[ratingKey]?.proficiency_history || {}));
        for (const label of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) {
            if (!used.has(label)) return label;
        }
        return null;
    };

    return (
        <Dialog open={!!record} onOpenChange={(open) => { if (!open) { setDraft(null); onClose(); } }}>
            <DialogContent className="w-[calc(100vw-1.5rem)] max-w-4xl max-h-[85vh] min-h-0 overflow-hidden flex flex-col sm:w-full">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Pencil className="h-4 w-4 text-indigo-600" />
                        Edit Rating Record
                    </DialogTitle>
                    <DialogDescription>
                        {draft?.name} ({draft?.emp_id}){draft?.designation ? ` · ${draft.designation}` : ''}
                    </DialogDescription>
                </DialogHeader>
                {draft && (
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                        <div className="space-y-5 pb-4">
                            <div className="grid grid-cols-1 gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact No</Label>
                                    <p className="mt-1 font-medium">{draft.contact_no || '-'}</p>
                                </div>
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Station</Label>
                                    <p className="mt-1 font-medium">{draft.current_station || '-'}</p>
                                </div>
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">License Number</Label>
                                    <p className="mt-1 font-medium">{draft.license_number || '-'}</p>
                                </div>
                                <div>
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ICAO ELPA Level</Label>
                                    <p className="mt-1 font-medium">{draft.elpa_level || '-'}</p>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-2">
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Highest Rating</Label>
                                    <p className="mt-1 font-medium">{draft.highest_rating || '-'}</p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Designation</Label>
                                <Input
                                    value={draft.designation || ''}
                                    onChange={(e) => setDraft({ ...draft, designation: e.target.value || null })}
                                    placeholder="Designation"
                                    className="h-9"
                                />
                            </div>

                            {ratingKeys.map((ratingKey) => {
                                const entry = normalizeRatingEntry(draft.ratings[ratingKey] || createEmptyRatingEntry());
                                const historyEntries = Object.entries(entry.proficiency_history || {}).sort(([first], [second]) => first.localeCompare(second));
                                const theme = getRatingEditTheme(ratingKey);

                                return (
                                    <div key={ratingKey} className={`rounded-xl border shadow-sm ${theme.panelClass}`}>
                                        <div className={`border-b px-4 py-3 ${theme.headerClass}`}>
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="space-y-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Badge className={`border ${theme.badgeClass}`}>{ratingKey}</Badge>
                                                        <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                                                            Rating Track
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                        Edit rating dates, status, and proficiency history for {ratingKey}.
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 self-start sm:self-center">
                                                    <span className={`hidden h-8 w-1 rounded-full sm:block ${theme.accentClass}`} />
                                                    <Select
                                                        value={entry.status || '0'}
                                                        onValueChange={(value) => updateEntry(ratingKey, (current) => ({ ...current, status: value }))}
                                                    >
                                                        <SelectTrigger className="h-8 w-[132px] bg-background/90 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="1">Active</SelectItem>
                                                            <SelectItem value="0">Inactive</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-4 p-4">
                                            <div className={`rounded-lg border p-3 ${theme.sectionClass}`}>
                                                <div className="mb-3 flex items-center gap-2">
                                                    <span className={`h-2.5 w-2.5 rounded-full ${theme.accentClass}`} />
                                                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Core Dates</Label>
                                                </div>
                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">Rating Date</Label>
                                                        <Input
                                                            type="date"
                                                            className="h-8 bg-background text-xs"
                                                            value={entry.rating_date || ''}
                                                            onChange={(e) => updateEntry(ratingKey, (current) => ({ ...current, rating_date: e.target.value || null }))}
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">Endorsement Date</Label>
                                                        <Input
                                                            type="date"
                                                            className="h-8 bg-background text-xs"
                                                            value={entry.endorsement_date || ''}
                                                            onChange={(e) => updateEntry(ratingKey, (current) => ({ ...current, endorsement_date: e.target.value || null }))}
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">Last Proficiency Date</Label>
                                                        <Input
                                                            type="text"
                                                            className="h-8 bg-background text-xs"
                                                            value={entry.last_proficiency?.date || ''}
                                                            placeholder="Auto from latest proficiency"
                                                            disabled
                                                        />
                                                    </div>
                                                    <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                                                        <Label className="text-xs">Last Proficiency Instructor</Label>
                                                        <Input
                                                            value={entry.last_proficiency?.instructor || ''}
                                                            placeholder="Auto from latest proficiency"
                                                            className="h-8 bg-background text-xs"
                                                            disabled
                                                        />
                                                        <p className="text-[11px] text-muted-foreground">
                                                            Auto-filled from the latest proficiency history date.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className={`rounded-lg border p-3 ${theme.sectionClass}`}>
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`h-2.5 w-2.5 rounded-full ${theme.accentClass}`} />
                                                        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proficiency History</Label>
                                                    </div>
                                                    {(() => {
                                                        const nextLabel = getNextHistoryLabel(ratingKey);
                                                        return nextLabel ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-8 bg-background text-xs"
                                                                onClick={() => {
                                                                    updateEntry(ratingKey, (current) => ({
                                                                        ...current,
                                                                        proficiency_history: {
                                                                            ...current.proficiency_history,
                                                                            [nextLabel]: { date: null, instructor: null },
                                                                        },
                                                                    }));
                                                                }}
                                                            >
                                                                <Plus className="mr-1 h-3 w-3" /> Add Proficiency Record
                                                            </Button>
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">All proficiency slots used</span>
                                                        );
                                                    })()}
                                                </div>

                                                {historyEntries.length === 0 ? (
                                                    <p className="mt-3 text-xs text-muted-foreground">No proficiency history entries.</p>
                                                ) : (
                                                    <div className="mt-3 space-y-2">
                                                        {historyEntries.map(([historyKey, historyValue]) => (
                                                            <div key={historyKey} className="grid grid-cols-1 gap-2 rounded-md border bg-background/90 p-3 sm:grid-cols-[1fr_160px_1fr_auto] sm:items-end">
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs">Label</Label>
                                                                    <Input value={historyKey} className="h-8 bg-background text-xs" disabled />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs">Date</Label>
                                                                    <Input
                                                                        type="date"
                                                                        className="h-8 bg-background text-xs"
                                                                        value={historyValue.date || ''}
                                                                        onChange={(e) => updateEntry(ratingKey, (current) => ({
                                                                            ...current,
                                                                            proficiency_history: {
                                                                                ...current.proficiency_history,
                                                                                [historyKey]: {
                                                                                    ...current.proficiency_history[historyKey],
                                                                                    date: e.target.value || null,
                                                                                },
                                                                            },
                                                                        }))}
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <Label className="text-xs">Instructor</Label>
                                                                    <InstructorCombobox
                                                                        value={historyValue.instructor || ''}
                                                                        onChange={(val) => updateEntry(ratingKey, (current) => ({
                                                                            ...current,
                                                                            proficiency_history: {
                                                                                ...current.proficiency_history,
                                                                                [historyKey]: {
                                                                                    ...current.proficiency_history[historyKey],
                                                                                    instructor: val || null,
                                                                                },
                                                                            },
                                                                        }))}
                                                                        suggestions={instructorSuggestions}
                                                                    />
                                                                </div>
                                                                <Button
                                                                    type="button"
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 text-muted-foreground hover:text-red-500"
                                                                    onClick={() => updateEntry(ratingKey, (current) => {
                                                                        const updatedHistory = { ...current.proficiency_history };
                                                                        delete updatedHistory[historyKey];
                                                                        return {
                                                                            ...current,
                                                                            proficiency_history: updatedHistory,
                                                                        };
                                                                    })}
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="flex flex-col-reverse justify-end gap-2 border-t pt-3 sm:flex-row">
                    <Button variant="outline" onClick={() => { setDraft(null); onClose(); }}>Cancel</Button>
                    <Button onClick={() => draft && onSave(draft)} disabled={!draft || isSaving}>
                        <Save className="mr-1 h-3.5 w-3.5" />
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ---------- Main Component ----------
export default function RatingsManagement() {
    const { users = [] } = useUsers();
    const { data: rawRatingSyncData = [], isLoading, refetch } = useRatingSyncData();
    const syncRatingData = useSyncRatingData();
    const { data: traineeSyncData = [], isLoading: traineeLoading, refetch: refetchTrainees } = useTraineeSyncData();
    const syncTraineeData = useSyncTraineeData();
    const today = startOfDay(new Date());

    const ratingSyncData = useMemo(() => {
        const visibleEmployeesById = new Map<string, { full_name: string; designation: string | null; mobile: string | null }>();

        users
            .filter((user) => !user.is_hidden && Boolean(normalizeEmployeeId(user.employee_id)))
            .forEach((user) => {
                const normalizedEmployeeId = normalizeEmployeeId(user.employee_id);
                const existingUser = visibleEmployeesById.get(normalizedEmployeeId);

                if (existingUser) {
                    visibleEmployeesById.set(normalizedEmployeeId, {
                        full_name: preferNonEmptyString(existingUser.full_name, user.full_name) || normalizedEmployeeId,
                        designation: preferNonEmptyString(existingUser.designation, user.designation),
                        mobile: preferNonEmptyString(existingUser.mobile, user.mobile),
                    });
                    return;
                }

                visibleEmployeesById.set(normalizedEmployeeId, {
                    full_name: preferNonEmptyString(user.full_name) || normalizedEmployeeId,
                    designation: user.designation ?? null,
                    mobile: user.mobile ?? null,
                });
            });

        const mergedRecordsByEmployeeId = new Map<string, RatingSyncRecord>();

        rawRatingSyncData.forEach((record) => {
            const normalizedEmployeeId = normalizeEmployeeId(record.emp_id);

            if (!normalizedEmployeeId) {
                return;
            }

            const matchingUser = visibleEmployeesById.get(normalizedEmployeeId);

            if (!matchingUser) {
                return;
            }

            const enrichedRecord: RatingSyncRecord = {
                ...record,
                emp_id: normalizedEmployeeId,
                name: preferNonEmptyString(matchingUser.full_name, record.name) || normalizedEmployeeId,
                designation: record.designation ?? matchingUser.designation ?? null,
                contact_no: record.contact_no ?? matchingUser.mobile ?? null,
            };

            const existingRecord = mergedRecordsByEmployeeId.get(normalizedEmployeeId);

            if (existingRecord) {
                mergedRecordsByEmployeeId.set(normalizedEmployeeId, mergeRatingSyncRecords(existingRecord, enrichedRecord));
                return;
            }

            mergedRecordsByEmployeeId.set(normalizedEmployeeId, enrichedRecord);
        });

        return Array.from(visibleEmployeesById.entries())
            .map(([normalizedEmployeeId, user]) => {
                const existingRecord = mergedRecordsByEmployeeId.get(normalizedEmployeeId);

                if (existingRecord) {
                    return existingRecord;
                }

                return {
                    emp_id: normalizedEmployeeId,
                    name: user.full_name,
                    designation: user.designation,
                    contact_no: user.mobile,
                    current_station: null,
                    license_number: null,
                    elpa_level: null,
                    highest_rating: null,
                    ratings: {},
                } satisfies RatingSyncRecord;
            })
            .sort((left, right) => left.name.localeCompare(right.name));
    }, [rawRatingSyncData, users]);

    return (
        <DashboardLayout role="supervisor">
            <div className="space-y-4 p-4 md:p-6">
                <Tabs defaultValue="overview" className="w-full">
                    <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5">
                            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                Ratings Management
                            </h1>
                            <div className="flex flex-wrap items-center gap-2 md:justify-end">
                                <Button asChild>
                                    <Link to="/supervisor/ratings/proficiency-list">
                                        <ListChecks className="mr-2 h-4 w-4" />
                                        Proficiency List
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:p-1.5">
                        <TabsList className="flex h-auto w-full flex-nowrap justify-start gap-1 overflow-x-auto bg-transparent p-0 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:pb-0">
                            <TabsTrigger
                                value="overview"
                                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition dark:text-slate-300 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm dark:data-[state=active]:bg-white dark:data-[state=active]:text-slate-950 sm:rounded-xl sm:px-4 sm:py-2 sm:text-sm"
                            >
                                <Shield className="mr-1 h-3 w-3 sm:mr-1.5 sm:h-3.5 sm:w-3.5" /> Overview
                            </TabsTrigger>
                            {RATING_TYPES.map((rt) => (
                                <TabsTrigger
                                    key={rt}
                                    value={rt}
                                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition dark:text-slate-300 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm dark:data-[state=active]:bg-white dark:data-[state=active]:text-slate-950 sm:rounded-xl sm:px-4 sm:py-2 sm:text-sm"
                                >
                                    {rt}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>

                    <TabsContent value="overview">
                        <OverviewTab
                            data={ratingSyncData}
                            syncMutation={syncRatingData}
                            refetch={refetch}
                            isLoading={isLoading}
                        />
                    </TabsContent>

                    {RATING_TYPES.map((rt) => (
                        <TabsContent key={rt} value={rt}>
                            <RatingTypeTab
                                data={ratingSyncData}
                                ratingType={rt}
                                isLoading={isLoading}
                            />
                        </TabsContent>
                    ))}
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
