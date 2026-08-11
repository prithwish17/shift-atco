import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { eachDayOfInterval, format, isAfter, isBefore, parseISO, startOfMonth, subDays, subMonths } from 'date-fns';
import { getFunctionsProxyBaseUrl } from '@/lib/appConfig';
import { scheduleKeys, SCHEDULE_QUERY_OPTIONS } from '@/lib/scheduleQueryConfig';
import { logSupervisorEdit } from '@/lib/supervisorAuditLog';

// Duty code legend from Google Sheet
export const DUTY_CODES = [
    'M', 'A', 'N', 'NO', 'CO', 'M+A', 'NO+N', 'LEAVE',
    'SAT', 'SUN', 'G', 'T', 'CH', 'NH', 'SAT+NO', 'NA',
    'SUN+N', 'SUN+M', 'SUN+A', 'SUN+NO', 'SAT+N', 'CO+N',
    'SL', 'Tr', 'CO+A', 'CO+M', 'GO', 'A+M',
] as const;

export type DutyCode = (typeof DUTY_CODES)[number];

// Duty code descriptions
export const DUTY_DESCRIPTIONS: Record<string, string> = {
    M: 'Morning Shift',
    A: 'Afternoon Shift',
    N: 'Night Shift',
    NO: 'Night Off',
    CO: 'Clear off',
    'M+A': 'Morning + Afternoon',
    'NO+N': 'Night Off + Night',
    LEAVE: 'Leave',
    SAT: 'Saturday',
    SUN: 'Sunday',
    G: 'General shift',
    T: 'Training',
    CH: 'Closed Holiday',
    NH: 'National Holiday',
    'SAT+NO': 'Saturday + Night Off',
    NA: 'Not Available',
    'SUN+N': 'Sunday + Night',
    'SUN+M': 'Sunday + Morning',
    'SUN+A': 'Sunday + Afternoon',
    'SUN+NO': 'Sunday + Night Off',
    'SAT+N': 'Saturday + Night',
    'CO+N': 'Clear off + Night',
    SL: 'Sick Leave',
    Tr: 'Transfer',
    'CO+A': 'Clear off + Afternoon',
    'CO+M': 'Clear off + Morning',
    GO: 'General Oscar',
    'A+M': 'Afternoon + Morning',
};

export interface EmployeeSchedule {
    id: string;
    employee_code: string;
    employee_name: string;
    duty_date: string;
    duty_code: string;
    duty_description: string;
    created_at: string;
    updated_at: string;
}

type ApprovedLeaveRange = {
    id: string;
    start_date: string;
    end_date: string;
    leave_type: string;
};

// Schedules older than this many calendar months live in the audit-log Google
// Sheet, not the database (see archive-schedules edge fn). MUST match the
// monthsToKeep passed to the archiver by the archive-schedules-monthly cron
// (see 20260802010000_schedule_archive_retention_6_months.sql) — if this is
// larger than the archiver's retention, the months in between are queried from
// the database, found to be empty, and never fall back to the archive.
const MONTHS_KEPT_IN_DB = 6;

/**
 * First day of the oldest month still kept in the database. Anything with a
 * duty_date strictly before this is served from the archive URL instead.
 */
export function getScheduleArchiveCutoff(): string {
    return format(startOfMonth(subMonths(new Date(), MONTHS_KEPT_IN_DB - 1)), 'yyyy-MM-dd');
}

/**
 * Fetch archived schedule rows for one employee directly from the audit-log
 * Google Sheet (via /api/schedule-archive). Never throws — returns [] on any
 * failure so the live (DB) portion still renders.
 */
async function fetchArchivedSchedules(
    employeeCode: string,
    from: string,
    to: string
): Promise<EmployeeSchedule[]> {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return [];

        const url = new URL(`${getFunctionsProxyBaseUrl()}/api/schedule-archive`);
        url.searchParams.set('employee', employeeCode);
        url.searchParams.set('from', from);
        url.searchParams.set('to', to);

        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return [];

        const json = await res.json().catch(() => null);
        const rows = (json?.rows || []) as Array<{
            employee_code: string;
            employee_name: string;
            duty_date: string;
            duty_code: string;
            duty_description: string;
            archived_at?: string;
        }>;

        return rows.map((r) => ({
            id: `archive-${r.employee_code}-${r.duty_date}`,
            employee_code: r.employee_code,
            employee_name: r.employee_name,
            duty_date: r.duty_date,
            duty_code: r.duty_code,
            duty_description: r.duty_description,
            created_at: r.archived_at || '',
            updated_at: r.archived_at || '',
        }));
    } catch {
        return [];
    }
}

/**
 * Identity behind an employee code, used to overlay approved leave.  Every
 * schedule query needs it, and a page usually mounts several of them over
 * different date ranges — pulling it through the query cache collapses those
 * repeated `profiles` round trips into one.
 */
async function fetchScheduleOwner(client: ReturnType<typeof useQueryClient>, employeeCode: string) {
    // Never rejects: the leave overlay is an enhancement, and losing it must not
    // take the schedule itself down with it.
    return client
        .fetchQuery({
            queryKey: ['schedule', 'owner', employeeCode],
            staleTime: 10 * 60_000,
            queryFn: async () => {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .eq('employee_id', employeeCode)
                    .maybeSingle();
                if (error) return null;
                return data;
            },
        })
        .catch(() => null);
}

// Query schedules with optional filters
export function useEmployeeSchedules(
    employeeCode?: string,
    startDate?: string,
    endDate?: string
) {
    const queryClient = useQueryClient();

    return useQuery({
        queryKey: scheduleKeys.employee(employeeCode, startDate, endDate),
        ...SCHEDULE_QUERY_OPTIONS,
        queryFn: async () => {
            let query = supabase
                .from('employee_schedules' as any)
                .select('*')
                .order('duty_date');

            if (employeeCode) query = query.eq('employee_code', employeeCode);
            if (startDate) query = query.gte('duty_date', startDate);
            if (endDate) query = query.lte('duty_date', endDate);

            // If the requested range reaches before the archive cutoff, pull that
            // older slice straight from the archive URL (Google Sheet) instead of
            // the DB, which no longer holds it.
            const cutoff = getScheduleArchiveCutoff();
            const needsArchive = !!(employeeCode && startDate && startDate < cutoff);
            const archiveTo = needsArchive
                ? (endDate && endDate < cutoff
                    ? endDate
                    : format(subDays(parseISO(cutoff), 1), 'yyyy-MM-dd'))
                : '';

            // Fire schedule + profile (+ archive) queries in parallel.
            const [scheduleResult, profile, archivedRows] = await Promise.all([
                query,
                employeeCode
                    ? fetchScheduleOwner(queryClient, employeeCode)
                    : Promise.resolve(null),
                needsArchive
                    ? fetchArchivedSchedules(employeeCode as string, startDate as string, archiveTo)
                    : Promise.resolve([] as EmployeeSchedule[]),
            ]);

            if (scheduleResult.error) {
                throw scheduleResult.error;
            }
            const dbSchedules = (scheduleResult.data || []) as unknown as EmployeeSchedule[];

            // Merge archived (older) + DB (recent); de-dupe by date, DB wins.
            const mergedByDate = new Map<string, EmployeeSchedule>();
            for (const r of archivedRows) mergedByDate.set(r.duty_date, r);
            for (const r of dbSchedules) mergedByDate.set(r.duty_date, r);
            const schedules = Array.from(mergedByDate.values()).sort((a, b) =>
                a.duty_date.localeCompare(b.duty_date)
            );

            if (!profile?.id) {
                return schedules;
            }

            // Keep leave query bounded to the same date window as schedule query.
            let leaveStart = startDate || null;
            let leaveEnd = endDate || null;
            if (!leaveStart && schedules.length > 0) leaveStart = schedules[0].duty_date;
            if (!leaveEnd && schedules.length > 0) leaveEnd = schedules[schedules.length - 1].duty_date;

            let leaveQuery = supabase
                .from('leave_requests' as any)
                .select('id, start_date, end_date, leave_type')
                .eq('employee_id', profile.id)
                .eq('status', 'Approved')
                .order('start_date', { ascending: true });

            if (leaveStart) leaveQuery = leaveQuery.lte('start_date', leaveEnd || leaveStart);
            if (leaveEnd) leaveQuery = leaveQuery.gte('end_date', leaveStart || leaveEnd);

            const { data: leaves, error: leavesError } = await leaveQuery;
            if (leavesError) {
                // Don't throw — return schedules without leave overlay
                return schedules;
            }

            const approvedLeaves = (leaves || []) as unknown as ApprovedLeaveRange[];
            if (approvedLeaves.length === 0) {
                return schedules;
            }

            const scheduleByDate = new Map<string, EmployeeSchedule>(
                schedules.map((s) => [s.duty_date, s])
            );

            for (const leave of approvedLeaves) {
                const leaveFrom = parseISO(leave.start_date);
                const leaveTo = parseISO(leave.end_date);
                if (isAfter(leaveFrom, leaveTo)) continue;

                let from = leaveFrom;
                let to = leaveTo;

                if (leaveStart) {
                    const boundedFrom = parseISO(leaveStart);
                    if (isBefore(from, boundedFrom)) from = boundedFrom;
                }
                if (leaveEnd) {
                    const boundedTo = parseISO(leaveEnd);
                    if (isAfter(to, boundedTo)) to = boundedTo;
                }
                if (isAfter(from, to)) continue;

                const leaveDays = eachDayOfInterval({ start: from, end: to });
                for (const day of leaveDays) {
                    const dutyDate = format(day, 'yyyy-MM-dd');
                    const existing = scheduleByDate.get(dutyDate);
                    scheduleByDate.set(dutyDate, {
                        id: existing?.id || `leave-${leave.id}-${dutyDate}`,
                        employee_code: existing?.employee_code || employeeCode,
                        employee_name: existing?.employee_name || profile.full_name || '',
                        duty_date: dutyDate,
                        duty_code: 'LEAVE',
                        duty_description: leave.leave_type
                            ? `Approved Leave (${leave.leave_type})`
                            : 'Approved Leave',
                        created_at: existing?.created_at || '',
                        updated_at: existing?.updated_at || '',
                    });
                }
            }

            return Array.from(scheduleByDate.values()).sort((a, b) =>
                a.duty_date.localeCompare(b.duty_date)
            );
        },
        enabled: !!employeeCode,
    });
}

// Convenience hook: get schedule for the current logged-in user
export function useMySchedule(employeeId?: string, startDate?: string, endDate?: string) {
    return useEmployeeSchedules(employeeId, startDate, endDate);
}

// Trigger the edge function to fetch schedules from Google Sheets
export function useFetchSchedule() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.functions.invoke('fetch-schedule', { body: {} });
            if (!error) return data;

            // In some local networks, direct calls to *.supabase.co Edge Functions fail.
            // Retry via deployed Vercel proxy in dev as a fallback.
            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw error;

                const base = getFunctionsProxyBaseUrl();

                const res = await fetch(`${base}/api/functions/fetch-schedule`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                });

                if (res.ok) return res.json();

                const errBody = await res.json().catch(() => ({}));
                throw new Error(
                    errBody.error ||
                    error.message ||
                    `Edge function failed via proxy: HTTP ${res.status}`
                );
            }

            throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: scheduleKeys.all });
        },
    });
}

// Update a single schedule entry (duty code)
export function useUpdateSchedule() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            duty_code,
            duty_description,
        }: {
            id: string;
            duty_code: string;
            duty_description: string;
        }) => {
            const { error } = await supabase
                .from('employee_schedules' as any)
                .update({ duty_code, duty_description } as any)
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: (_data, variables) => {
            logSupervisorEdit({
                action: 'update',
                table: 'employee_schedules',
                description: `Edited schedule ${variables.id}: duty_code→${variables.duty_code}`,
                recordId: variables.id,
                after: { duty_code: variables.duty_code, duty_description: variables.duty_description },
            });
            qc.invalidateQueries({ queryKey: scheduleKeys.all });
        },
    });
}

/**
 * Lightweight hook: employee directory via SECURITY DEFINER RPC.
 * Returns id, employee_code, full_name, current_shift for all employees.
 * Always works regardless of profiles RLS.
 */
export function useEmployeeDirectory() {
    return useQuery({
        queryKey: ['employee_directory'],
        staleTime: 10 * 60_000,
        queryFn: async () => {
            const PAGE_SIZE = 1000;

            try {
                let allDirectoryRows: any[] = [];
                let from = 0;
                let hasMore = true;

                while (hasMore) {
                    const { data, error } = await supabase
                        .rpc('get_employee_directory')
                        .range(from, from + PAGE_SIZE - 1);

                    if (error) throw error;

                    const rows = data || [];
                    allDirectoryRows = allDirectoryRows.concat(rows);
                    hasMore = rows.length === PAGE_SIZE;
                    from += PAGE_SIZE;
                }

                return allDirectoryRows as { id: string; employee_code: string; full_name: string; current_shift: string }[];
            } catch {
                // Fallback: RPC unavailable — query profiles table directly (same data the RPC returns)
                const PAGE_SIZE = 1000;
                let allProfileRows: any[] = [];
                let from = 0;
                let hasMore = true;

                while (hasMore) {
                    const { data: profileData, error: profileError } = await supabase
                        .from('profiles')
                        .select('id, employee_id, full_name, current_shift')
                        .neq('employee_id', '')
                        .not('employee_id', 'is', null)
                        .neq('is_hidden', true)
                        .order('employee_id')
                        .range(from, from + PAGE_SIZE - 1);

                    if (profileError) throw profileError;

                    const rows = profileData || [];
                    allProfileRows = allProfileRows.concat(rows);
                    hasMore = rows.length === PAGE_SIZE;
                    from += PAGE_SIZE;
                }

                const seen = new Set<string>();
                const directory: { id: string; employee_code: string; full_name: string; current_shift: string }[] = [];
                for (const row of allProfileRows as any[]) {
                    const code = row.employee_id;
                    if (code && !seen.has(code)) {
                        seen.add(code);
                        directory.push({
                            id: row.id || '',
                            employee_code: code,
                            full_name: row.full_name || code,
                            current_shift: row.current_shift || '',
                        });
                    }
                }
                return directory;
            }
        },
    });
}
