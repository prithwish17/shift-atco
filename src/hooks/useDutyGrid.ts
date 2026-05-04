import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { logSupervisorEdit } from '@/lib/supervisorAuditLog';

// ---------- Types ----------

export interface DutyRoster {
    id: string;
    roster_date: string;
    shift: string;
    team: string | null;
    created_at: string;
    updated_at: string;
}

export interface RosterAssignment {
    id: string;
    roster_id: string;
    position_name: string;
    position_label: string | null;
    department: string;
    employee_id: string | null;
    remark: string | null;
    section_type: string;
    created_at: string;
    profiles?: { full_name: string; designation: string | null } | null;
}

export interface GridLeaveRecord {
    id: string;
    employee_id: string;
    leave_date: string;
    leave_type: string;
    remarks: string | null;
    created_at: string;
    profiles?: { full_name: string; designation: string | null } | null;
}

export interface GridExtraDuty {
    id: string;
    roster_id: string;
    employee_id: string | null;
    duty_type: string;
    remarks: string | null;
    created_at: string;
    profiles?: { full_name: string; designation: string | null } | null;
}

export interface GridEmployee {
    id: string;
    full_name: string;
    designation: string | null;
}

// ---------- Roster CRUD ----------

export function useDutyRoster(date: Date, shift: string, team: string) {
    const dateStr = format(date, 'yyyy-MM-dd');
    return useQuery({
        queryKey: ['duty-roster', dateStr, shift, team],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('duty_rosters' as any)
                .select('*')
                .eq('roster_date', dateStr)
                .eq('shift', shift)
                .eq('team', team)
                .maybeSingle();
            if (error) throw error;
            return data as DutyRoster | null;
        },
        enabled: !!team,
        staleTime: 2 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}

export function useCreateOrGetRoster() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ date, shift, team }: { date: string; shift: string; team?: string }) => {
            // Try to find existing
            const { data: existing } = await supabase
                .from('duty_rosters' as any)
                .select('*')
                .eq('roster_date', date)
                .eq('shift', shift)
                .eq('team', team || '')
                .maybeSingle();
            if (existing) return existing as DutyRoster;

            // Try upsert; if constraint mismatch, fall back to insert
            try {
                const { data, error } = await supabase
                    .from('duty_rosters' as any)
                    .upsert(
                        { roster_date: date, shift, team } as any,
                        { onConflict: 'roster_date,shift,team' }
                    )
                    .select()
                    .single();
                if (!error && data) return data as DutyRoster;
            } catch { /* fall through */ }

            // Fallback: plain insert, catch conflict and re-fetch
            const { data, error } = await supabase
                .from('duty_rosters' as any)
                .insert({ roster_date: date, shift, team } as any)
                .select()
                .single();
            if (error) {
                // Conflict (409) — row was created by another request, re-fetch
                if (error.code === '23505' || (error as any).status === 409) {
                    const { data: refetched } = await supabase
                        .from('duty_rosters' as any)
                        .select('*')
                        .eq('roster_date', date)
                        .eq('shift', shift)
                        .eq('team', team || '')
                        .maybeSingle();
                    if (refetched) return refetched as DutyRoster;
                }
                throw error;
            }
            return data as DutyRoster;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['duty-roster'] }),
    });
}

// ---------- Assignments ----------

export function useRosterAssignments(rosterId: string | undefined) {
    const qc = useQueryClient();
    return useQuery({
        queryKey: ['roster-assignments', rosterId],
        queryFn: async () => {
            if (!rosterId) return [];
            const { data, error } = await supabase
                .from('roster_assignments' as any)
                .select('*')
                .eq('roster_id', rosterId);
            if (error) throw error;

            const records = (data || []) as RosterAssignment[];
            // Enrich from cached grid-employees (avoids a second DB round-trip).
            // If grid-employees cache is cold, profiles will be enriched later
            // by the post-query useMemo in useATCGridState.
            const employees = qc.getQueryData<GridEmployee[]>(['grid-employees']);
            if (records.length > 0 && employees && employees.length > 0) {
                const profileMap = new Map(employees.map(e => [e.id, { full_name: e.full_name, designation: e.designation }]));
                for (const rec of records) {
                    rec.profiles = rec.employee_id ? profileMap.get(rec.employee_id) || null : null;
                }
            }
            return records;
        },
        enabled: !!rosterId,
        staleTime: 2 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}

export function useUpsertAssignment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (assignment: {
            id?: string;
            roster_id: string;
            position_name: string;
            position_label?: string;
            department: string;
            employee_id?: string | null;
            remark?: string | null;
            section_type: string;
        }) => {
            if (assignment.id) {
                const { data, error } = await supabase
                    .from('roster_assignments' as any)
                    .update({
                        employee_id: assignment.employee_id,
                        remark: assignment.remark,
                        position_label: assignment.position_label,
                    } as any)
                    .eq('id', assignment.id)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await supabase
                    .from('roster_assignments' as any)
                    .insert(assignment as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onMutate: async (assignment) => {
            const queryKey = ['roster-assignments', assignment.roster_id] as const;
            await qc.cancelQueries({ queryKey });
            const previous = qc.getQueryData<RosterAssignment[]>(queryKey);

            // Resolve profile from cached employees for instant display
            const employees = qc.getQueryData<GridEmployee[]>(['grid-employees']) || [];
            const emp = assignment.employee_id ? employees.find(e => e.id === assignment.employee_id) : null;
            const profileData = emp ? { full_name: emp.full_name, designation: emp.designation } : null;

            qc.setQueryData<RosterAssignment[]>(queryKey, (old) => {
                if (!old) return old;
                if (assignment.id) {
                    // Optimistic update existing
                    return old.map(a => a.id === assignment.id ? {
                        ...a,
                        employee_id: assignment.employee_id ?? a.employee_id,
                        remark: assignment.remark !== undefined ? assignment.remark : a.remark,
                        position_label: assignment.position_label ?? a.position_label,
                        profiles: assignment.employee_id !== undefined ? profileData : a.profiles,
                    } : a);
                }
                // Optimistic insert
                return [...old, {
                    id: `optimistic-${Date.now()}`,
                    roster_id: assignment.roster_id,
                    position_name: assignment.position_name,
                    position_label: assignment.position_label || null,
                    department: assignment.department,
                    employee_id: assignment.employee_id || null,
                    remark: assignment.remark || null,
                    section_type: assignment.section_type,
                    created_at: new Date().toISOString(),
                    profiles: profileData,
                }];
            });

            return { previous, queryKey };
        },
        onError: (_err, _vars, context) => {
            if (context?.previous !== undefined) {
                qc.setQueryData(context.queryKey, context.previous);
            }
        },
        onSuccess: (_data, assignment) => {
            const employees = qc.getQueryData<GridEmployee[]>(['grid-employees']) || [];
            const emp = assignment.employee_id ? employees.find(e => e.id === assignment.employee_id) : null;
            logSupervisorEdit({
                action: assignment.id ? "update" : "insert",
                table: "roster_assignments",
                description: `Roster assignment ${assignment.id ? "updated" : "created"}: position ${assignment.position_name} in ${assignment.department}${emp ? ` → ${emp.full_name}` : ""}`,
                recordId: assignment.id || assignment.roster_id,
                after: { roster_id: assignment.roster_id, position_name: assignment.position_name, employee_id: assignment.employee_id ?? null },
            });
        },
        onSettled: (_data, _error, assignment) => {
            qc.invalidateQueries({ queryKey: ['roster-assignments', assignment.roster_id] });
        },
    });
}

// ---------- Leave Records for Grid ----------

export function useGridLeaveRecords(date: Date) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const qc = useQueryClient();
    return useQuery({
        queryKey: ['grid-leave', dateStr],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_leave_dates' as any)
                .select('*')
                .eq('leave_date', dateStr);
            if (error) throw error;

            const records = (data || []) as GridLeaveRecord[];
            const employees = qc.getQueryData<GridEmployee[]>(['grid-employees']);
            if (records.length > 0 && employees && employees.length > 0) {
                const profileMap = new Map(employees.map(e => [e.id, { full_name: e.full_name, designation: e.designation }]));
                for (const rec of records) {
                    rec.profiles = profileMap.get(rec.employee_id) || null;
                }
            }
            return records;
        },
        staleTime: 2 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}

// ---------- Extra Duties ----------

export function useGridExtraDuties(rosterId: string | undefined) {
    const qc = useQueryClient();
    return useQuery({
        queryKey: ['grid-extra-duties', rosterId],
        queryFn: async () => {
            if (!rosterId) return [];
            const { data, error } = await supabase
                .from('extra_duties' as any)
                .select('*')
                .eq('roster_id', rosterId);
            if (error) throw error;

            const records = (data || []) as GridExtraDuty[];
            const employees = qc.getQueryData<GridEmployee[]>(['grid-employees']);
            if (records.length > 0 && employees && employees.length > 0) {
                const profileMap = new Map(employees.map(e => [e.id, { full_name: e.full_name, designation: e.designation }]));
                for (const rec of records) {
                    rec.profiles = rec.employee_id ? profileMap.get(rec.employee_id) || null : null;
                }
            }
            return records;
        },
        enabled: !!rosterId,
        staleTime: 2 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}

export function useCreateExtraDuty() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (duty: {
            roster_id: string;
            employee_id?: string | null;
            duty_type: string;
            remarks?: string | null;
        }) => {
            const { data, error } = await supabase
                .from('extra_duties' as any)
                .insert(duty as any)
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onMutate: async (duty) => {
            const queryKey = ['grid-extra-duties', duty.roster_id] as const;
            await qc.cancelQueries({ queryKey });
            const previous = qc.getQueryData<GridExtraDuty[]>(queryKey);

            const employees = qc.getQueryData<GridEmployee[]>(['grid-employees']) || [];
            const emp = duty.employee_id ? employees.find(e => e.id === duty.employee_id) : null;

            qc.setQueryData<GridExtraDuty[]>(queryKey, (old) => [
                ...(old || []),
                {
                    id: `optimistic-${Date.now()}`,
                    roster_id: duty.roster_id,
                    employee_id: duty.employee_id || null,
                    duty_type: duty.duty_type,
                    remarks: duty.remarks || null,
                    created_at: new Date().toISOString(),
                    profiles: emp ? { full_name: emp.full_name, designation: emp.designation } : null,
                },
            ]);
            return { previous, queryKey };
        },
        onError: (_err, _vars, context) => {
            if (context?.previous !== undefined) {
                qc.setQueryData(context.queryKey, context.previous);
            }
        },
        onSuccess: (_data, duty) => {
            const employees = qc.getQueryData<GridEmployee[]>(['grid-employees']) || [];
            const emp = duty.employee_id ? employees.find(e => e.id === duty.employee_id) : null;
            logSupervisorEdit({
                action: "insert",
                table: "extra_duties",
                description: `Extra duty created: type ${duty.duty_type}${emp ? ` for ${emp.full_name}` : ""} on roster ${duty.roster_id}`,
                recordId: duty.roster_id,
                after: { roster_id: duty.roster_id, duty_type: duty.duty_type, employee_id: duty.employee_id ?? null },
            });
        },
        onSettled: (_data, _error, duty) => {
            qc.invalidateQueries({ queryKey: ['grid-extra-duties', duty.roster_id] });
        },
    });
}

export function useDeleteExtraDuty() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, rosterId }: { id: string; rosterId: string }) => {
            const { error } = await supabase
                .from('extra_duties' as any)
                .delete()
                .eq('id', id);
            if (error) throw error;
        },
        onMutate: async ({ id, rosterId }) => {
            const queryKey = ['grid-extra-duties', rosterId] as const;
            await qc.cancelQueries({ queryKey });
            const previous = qc.getQueryData<GridExtraDuty[]>(queryKey);
            qc.setQueryData<GridExtraDuty[]>(queryKey, (old) =>
                (old || []).filter(d => d.id !== id)
            );
            return { previous, queryKey };
        },
        onError: (_err, _vars, context) => {
            if (context?.previous !== undefined) {
                qc.setQueryData(context.queryKey, context.previous);
            }
        },
        onSuccess: (_data, { id, rosterId }) => {
            logSupervisorEdit({
                action: "delete",
                table: "extra_duties",
                description: `Extra duty deleted from roster ${rosterId}`,
                recordId: id,
                before: { id, roster_id: rosterId },
            });
        },
        onSettled: (_data, _error, { rosterId }) => {
            qc.invalidateQueries({ queryKey: ['grid-extra-duties', rosterId] });
        },
    });
}

// ---------- Employees for Grid Dropdowns ----------

export function useGridEmployees() {
    return useQuery({
        queryKey: ['grid-employees'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, full_name, designation')
                .neq('is_hidden' as any, true)
                .order('full_name');
            if (error) throw error;
            return (data || []) as GridEmployee[];
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
    });
}

// ---------- Sync Roster → Grid ----------

export function useSyncRosterToGrid() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ date, shift, team }: { date: string; shift: string; team: string }) => {
            const { syncRosterToGrid } = await import('@/lib/syncRosterToGrid');
            return syncRosterToGrid(date, shift, team);
        },
        onSuccess: (_, { date, shift, team }) => {
            qc.invalidateQueries({ queryKey: ['duty-roster'] });
            qc.invalidateQueries({ queryKey: ['roster-assignments'] });
            qc.invalidateQueries({ queryKey: ['grid-extra-duties'] });
            logSupervisorEdit({
                action: "upsert",
                table: "duty_rosters",
                description: `Roster synced to duty grid: ${date} / ${shift} / Team ${team}`,
                recordId: `${date}::${shift}::${team}`,
                after: { date, shift, team },
            });
        },
    });
}

// ---------- Roster Status Entries (Duty Change / Extra Duty from Google Sheets rosters) ----------

export type RosterStatusEntry = {
    id: string;
    employee_name: string;
    unit: string;
    position: string;
    date: string;
    shift: string;
    team: string;
};

function normalizeRosterShift(value: string) {
    const normalized = String(value || '').trim();
    if (!normalized) return normalized;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
}

export function useRosterStatusEntries(date: Date, shift: string, team: string) {
    const dateStr = format(date, 'yyyy-MM-dd');
    // Convert to the format stored in rosters table (d-MMM-yyyy)
    const rosterDateStr = format(date, 'd-MMM-yyyy');
    const rosterShift = normalizeRosterShift(shift);

    return useQuery({
        queryKey: ['roster-status-entries', dateStr, shift, team],
        queryFn: async () => {
            // Query rosters for DUTY CHANGE and EXTRA DUTY entries
            const { data, error } = await supabase
                .from('rosters' as any)
                .select('*')
                .eq('date', rosterDateStr)
                .eq('shift', rosterShift)
                .eq('team', team)
                .or('unit.ilike.duty change,unit.ilike.extra duty');

            if (error) throw error;
            return (data || []) as RosterStatusEntry[];
        },
        enabled: !!team,
        staleTime: 2 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });
}
