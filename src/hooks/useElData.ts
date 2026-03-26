import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";

export function useElApiUrl() {
    return useQuery({
        queryKey: ["app-settings", "el_webapp_url"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("app_settings" as any)
                .select("value")
                .eq("key", "el_data_webapp_url")
                .maybeSingle();

            if (error) throw error;
            return (data?.value as string) || "";
        },
    });
}

export type ElLeaveDetail = {
    id: string;
    emp_id: string;
    employee_name: string;
    leave_from: string;
    leave_to: string;
};

export type ElSummary = {
    emp_id: string;
    employee_name: string;
    total_earned_leave_days: number;
};

function getInclusiveDayCount(leaveFrom: string, leaveTo: string): number {
    const start = new Date(`${leaveFrom}T00:00:00Z`);
    const end = new Date(`${leaveTo}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
        return 0;
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((end.getTime() - start.getTime()) / millisecondsPerDay) + 1;
}

function getOverlappingInclusiveDayCount(leaveFrom: string, leaveTo: string, rangeStart: string, rangeEnd: string): number {
    const start = new Date(`${leaveFrom}T00:00:00Z`);
    const end = new Date(`${leaveTo}T00:00:00Z`);
    const boundedStart = new Date(`${rangeStart}T00:00:00Z`);
    const boundedEnd = new Date(`${rangeEnd}T00:00:00Z`);

    if (
        Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime()) ||
        Number.isNaN(boundedStart.getTime()) ||
        Number.isNaN(boundedEnd.getTime())
    ) {
        return 0;
    }

    const overlapStart = start > boundedStart ? start : boundedStart;
    const overlapEnd = end < boundedEnd ? end : boundedEnd;

    if (overlapEnd < overlapStart) {
        return 0;
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    return Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / millisecondsPerDay) + 1;
}

export function useElData() {
    return useQuery<ElSummary[]>({
        queryKey: ["el-data"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("employee_el_records" as any)
                .select("emp_id, employee_name, leave_from, leave_to")
                .order("employee_name", { ascending: true })
                .order("leave_from", { ascending: false });

            if (error) throw error;

            const totals = new Map<string, ElSummary>();
            for (const row of (data || []) as Array<{
                emp_id: string;
                employee_name: string;
                leave_from: string;
                leave_to: string;
            }>) {
                const days = getInclusiveDayCount(row.leave_from, row.leave_to);
                const existing = totals.get(row.emp_id);
                if (existing) {
                    existing.total_earned_leave_days += days;
                } else {
                    totals.set(row.emp_id, {
                        emp_id: row.emp_id,
                        employee_name: row.employee_name,
                        total_earned_leave_days: days,
                    });
                }
            }

            return Array.from(totals.values()).sort((left, right) =>
                left.employee_name.localeCompare(right.employee_name),
            );
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

export function useElTotalAvailed(year: number) {
    return useQuery<number>({
        queryKey: ["el-data", "total-availed", year],
        queryFn: async () => {
            const yearStart = `${year}-01-01`;
            const yearEnd = `${year}-12-31`;

            const { data, error } = await supabase
                .from("employee_el_records" as any)
                .select("leave_from, leave_to")
                .lte("leave_from", yearEnd)
                .gte("leave_to", yearStart);

            if (error) throw error;

            return ((data || []) as Array<{ leave_from: string; leave_to: string }>).reduce((sum, row) => {
                return sum + getOverlappingInclusiveDayCount(row.leave_from, row.leave_to, yearStart, yearEnd);
            }, 0);
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

export function useElDetails(empId?: string) {
    return useQuery<ElLeaveDetail[]>({
        queryKey: ["el-details", empId],
        enabled: !!empId,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("employee_el_records" as any)
                .select("id, emp_id, employee_name, leave_from, leave_to")
                .eq("emp_id", empId!)
                .order("leave_from", { ascending: false });

            if (error) throw error;
            return (data || []) as unknown as ElLeaveDetail[];
        },
        staleTime: 10 * 60 * 1000,
        retry: 1,
    });
}

export function useSyncElData() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            // Try direct Supabase edge function first
            let directError: any = null;
            try {
                const { data, error } = await supabase.functions.invoke("fetch-el-data", { body: {} });
                if (!error) return data;
                directError = error;
            } catch (err) {
                // CORS or network error — direct call failed
                directError = err;
            }

            // Fallback to Vercel proxy in dev
            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw directError;

                const base = getFunctionsProxyBaseUrl();

                const res = await fetch(`${base}/api/functions/fetch-el-data`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                });

                if (res.ok) return res.json();

                // Guard against HTML error pages
                const contentType = res.headers.get("content-type") || "";
                if (contentType.includes("application/json")) {
                    const errBody = await res.json().catch(() => ({}));
                    throw new Error(
                        errBody.error ||
                        directError?.message ||
                        `Edge function failed via proxy: HTTP ${res.status}`,
                    );
                }

                throw new Error(
                    directError?.message ||
                    `Edge function failed via proxy: HTTP ${res.status}`,
                );
            }

            throw directError;
        },
        onSuccess: async (result: { employees?: number; details?: number } | undefined) => {
            await qc.invalidateQueries({ queryKey: ["el-data"] });
            await qc.invalidateQueries({ queryKey: ["el-details"] });
            toast.success(`EL data synced${result?.employees ? ` (${result.employees} employees)` : ""}`);
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to sync EL data");
        },
    });
}
