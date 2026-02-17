import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

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

export function useDutyRoster(date: Date, shift: string) {
    const dateStr = format(date, 'yyyy-MM-dd');
    return useQuery({
        queryKey: ['duty-roster', dateStr, shift],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('duty_rosters' as any)
                .select('*')
                .eq('roster_date', dateStr)
                .eq('shift', shift)
                .maybeSingle();
            if (error) throw error;
            return data as DutyRoster | null;
        },
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
                .maybeSingle();
            if (existing) return existing as DutyRoster;
            const { data, error } = await supabase
                .from('duty_rosters' as any)
                .insert({ roster_date: date, shift, team } as any)
                .select()
                .single();
            if (error) throw error;
            return data as DutyRoster;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['duty-roster'] }),
    });
}

// ---------- Assignments ----------

export function useRosterAssignments(rosterId: string | undefined) {
    return useQuery({
        queryKey: ['roster-assignments', rosterId],
        queryFn: async () => {
            if (!rosterId) return [];
            const { data, error } = await supabase
                .from('roster_assignments' as any)
                .select('*')
                .eq('roster_id', rosterId);
            if (error) throw error;

            // Manually enrich with profile data since roster_assignments FK goes to auth.users, not profiles
            const records = (data || []) as RosterAssignment[];
            if (records.length > 0) {
                const empIds = [...new Set(records.filter(r => r.employee_id).map(r => r.employee_id!))];
                if (empIds.length > 0) {
                    const { data: profiles } = await supabase
                        .from('profiles')
                        .select('id, full_name, designation')
                        .in('id', empIds);
                    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
                    for (const rec of records) {
                        rec.profiles = rec.employee_id ? (profileMap.get(rec.employee_id) as any) || null : null;
                    }
                }
            }
            return records;
        },
        enabled: !!rosterId,
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
        onSuccess: () => qc.invalidateQueries({ queryKey: ['roster-assignments'] }),
    });
}

// ---------- Leave Records for Grid ----------

export function useGridLeaveRecords(date: Date) {
    const dateStr = format(date, 'yyyy-MM-dd');
    return useQuery({
        queryKey: ['grid-leave', dateStr],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('employee_leave_dates' as any)
                .select('*')
                .eq('leave_date', dateStr);
            if (error) throw error;

            // Manually enrich with profile data since employee_leave_dates FK goes to auth.users, not profiles
            const records = (data || []) as GridLeaveRecord[];
            if (records.length > 0) {
                const empIds = [...new Set(records.map(r => r.employee_id))];
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name, designation')
                    .in('id', empIds);
                const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
                for (const rec of records) {
                    rec.profiles = (profileMap.get(rec.employee_id) as any) || null;
                }
            }
            return records;
        },
    });
}

// ---------- Extra Duties ----------

export function useGridExtraDuties(rosterId: string | undefined) {
    return useQuery({
        queryKey: ['grid-extra-duties', rosterId],
        queryFn: async () => {
            if (!rosterId) return [];
            const { data, error } = await supabase
                .from('extra_duties' as any)
                .select('*')
                .eq('roster_id', rosterId);
            if (error) throw error;

            // Manually enrich with profile data since extra_duties FK goes to auth.users, not profiles
            const records = (data || []) as GridExtraDuty[];
            if (records.length > 0) {
                const empIds = [...new Set(records.filter(r => r.employee_id).map(r => r.employee_id!))];
                if (empIds.length > 0) {
                    const { data: profiles } = await supabase
                        .from('profiles')
                        .select('id, full_name, designation')
                        .in('id', empIds);
                    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
                    for (const rec of records) {
                        rec.profiles = rec.employee_id ? (profileMap.get(rec.employee_id) as any) || null : null;
                    }
                }
            }
            return records;
        },
        enabled: !!rosterId,
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
        onSuccess: () => qc.invalidateQueries({ queryKey: ['grid-extra-duties'] }),
    });
}

export function useDeleteExtraDuty() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('extra_duties' as any)
                .delete()
                .eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['grid-extra-duties'] }),
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
                .order('full_name');
            if (error) throw error;
            return (data || []) as GridEmployee[];
        },
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
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['duty-roster'] });
            qc.invalidateQueries({ queryKey: ['roster-assignments'] });
        },
    });
}
