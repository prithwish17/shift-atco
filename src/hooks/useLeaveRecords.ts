import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";

// Leave categories from Google Sheets
export const LEAVE_CATEGORIES = [
    { value: "CL", label: "Casual Leave", color: "indigo" },
    { value: "RH", label: "Restricted Holiday", color: "blue" },
    { value: "NH", label: "National Holiday", color: "emerald" },
    { value: "CH", label: "Closed Holiday", color: "violet" },
    { value: "COMP_OFF", label: "Comp Off", color: "amber" },
    { value: "COMP_OFF_EARNED", label: "Comp Off Earned", color: "amber" },
    { value: "COMP_OFF_USED", label: "Comp Off Used", color: "orange" },
    { value: "LAST_YEAR_CH_DUTY", label: "From Last Year", color: "amber" },
    { value: "LAST_YEAR_COMP_OFF", label: "Last Year Comp Off", color: "orange" },
    { value: "OPE_COMP_OFF", label: "OPE Comp Off", color: "rose" },
    { value: "OPE", label: "OPE Duty", color: "rose" },
] as const;

export type LeaveCategory = (typeof LEAVE_CATEGORIES)[number]["value"];

export interface LeaveRecord {
    id: string;
    emp_id: string;
    employee_name: string;
    sl_no: number | null;
    status: string | null;
    leave_category: string;
    source_event_type: string;
    event_kind: string;
    leave_date: string;
    leave_used_on: string | null;
    duty_code: string;
    raw_date_value: string | null;
    raw_shift_value: string | null;
    raw_leave_used_value: string | null;
    raw_event: Record<string, any>;
    metadata: Record<string, any>;
    source: string;
    sync_batch_id: string | null;
    created_at: string;
    updated_at: string;
}

export function getLeaveCategoryLabel(value: string): string {
    return LEAVE_CATEGORIES.find((c) => c.value === value)?.label || value;
}

export function getLeaveCategoryColor(value: string): string {
    return LEAVE_CATEGORIES.find((c) => c.value === value)?.color || "gray";
}

/** Fetch leave records for an employee, optionally filtered by year */
export function useLeaveRecords(empId?: string, year?: number) {
    return useQuery({
        queryKey: ["leave-records", empId, year],
        queryFn: async () => {
            if (!empId) return [];

            let query = (supabase as any)
                .from("employee_leave_records")
                .select("*")
                .eq("emp_id", empId)
                .order("leave_date", { ascending: false });

            if (year) {
                query = query
                    .gte("leave_date", `${year}-01-01`)
                    .lte("leave_date", `${year}-12-31`);
            }

            const { data, error } = await query;
            if (error) throw error;
            return (data || []) as LeaveRecord[];
        },
        enabled: !!empId,
        staleTime: 5 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
    });
}

/** Get summary counts by category for an employee */
export function useLeaveRecordSummary(empId?: string, year?: number) {
    return useQuery({
        queryKey: ["leave-record-summary", empId, year],
        queryFn: async () => {
            if (!empId) return {};

            let query = (supabase as any)
                .from("employee_leave_records")
                .select("leave_category")
                .eq("emp_id", empId);

            if (year) {
                query = query
                    .gte("leave_date", `${year}-01-01`)
                    .lte("leave_date", `${year}-12-31`);
            }

            const { data, error } = await query;
            if (error) throw error;

            const summary: Record<string, number> = {};
            for (const row of (data || []) as any[]) {
                summary[row.leave_category] = (summary[row.leave_category] || 0) + 1;
            }
            return summary;
        },
        enabled: !!empId,
        staleTime: 5 * 60 * 1000,
    });
}

/** Trigger the fetch-leave-data edge function */
export function useFetchLeaveData() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const { data, error } = await supabase.functions.invoke("fetch-leave-data", { body: {} });
            if (!error) return data;

            // Fallback to Vercel proxy in dev (same pattern as useFetchSchedule)
            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw error;

                const base = getFunctionsProxyBaseUrl();

                const res = await fetch(`${base}/api/functions/fetch-leave-data`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                        "Content-Type": "application/json",
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
            qc.invalidateQueries({ queryKey: ["leave-records"] });
            qc.invalidateQueries({ queryKey: ["leave-record-summary"] });
        },
    });
}

/** Insert a new leave record from the web app */
export function useCreateLeaveRecord() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (record: {
            emp_id: string;
            employee_name: string;
            leave_category: string;
            leave_date: string;
            metadata?: Record<string, any>;
        }) => {
            const { data, error } = await (supabase as any)
                .from("employee_leave_records")
                .insert({
                    ...record,
                    source_event_type: record.leave_category,
                    event_kind: "manual",
                    leave_used_on: null,
                    duty_code: "",
                    raw_date_value: record.leave_date,
                    raw_shift_value: null,
                    raw_leave_used_value: null,
                    raw_event: record.metadata || {},
                    metadata: record.metadata || {},
                    source: "webapp",
                })
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["leave-records"] });
            qc.invalidateQueries({ queryKey: ["leave-record-summary"] });
        },
    });
}

/** Delete a leave record */
export function useDeleteLeaveRecord() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase as any)
                .from("employee_leave_records")
                .delete()
                .eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["leave-records"] });
            qc.invalidateQueries({ queryKey: ["leave-record-summary"] });
        },
    });
}
