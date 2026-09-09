import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";

export function useEmployeeDataApiUrl() {
    return useQuery({
        queryKey: ["app-settings", "employee_data_webapp_url"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("app_settings" as any)
                .select("value")
                .eq("key", "employee_data_webapp_url")
                .maybeSingle();

            if (error) throw error;
            return ((data as any)?.value as string) || "";
        },
    });
}

export function useSyncEmployeeData() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => invokeEdgeFunction<Record<string, number>>("fetch-employee-data"),
        onSuccess: async (result: any) => {
            await qc.invalidateQueries({ queryKey: ["users"] });
            await qc.invalidateQueries({ queryKey: ["profile"] });
            await qc.invalidateQueries({ queryKey: ["missing-employees"] });
            await qc.invalidateQueries({ queryKey: ["missing-employees-hidden"] });
            const parts: string[] = [];
            if (result?.total) parts.push(`${result.total} employees processed`);
            if (result?.newEmployeesCreated) parts.push(`${result.newEmployeesCreated} new registered`);
            if (result?.designationUpdated) parts.push(`${result.designationUpdated} designations updated`);
            if (result?.missingEmployees) parts.push(`${result.missingEmployees} missing from API`);
            toast.success(`Employee data synced${parts.length ? ` (${parts.join(", ")})` : ""}`);
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to sync employee data");
        },
    });
}

export interface MissingEmployee {
    employee_id: string;
    full_name: string;
    designation: string | null;
}

export function useMissingEmployees() {
    return useQuery({
        queryKey: ["missing-employees"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("app_settings" as any)
                .select("value")
                .eq("key", "missing_employees_data")
                .maybeSingle();

            if (error) throw error;
            const raw = (data as any)?.value;
            if (!raw) return [] as MissingEmployee[];
            try {
                return JSON.parse(raw) as MissingEmployee[];
            } catch {
                return [] as MissingEmployee[];
            }
        },
    });
}

export function useMissingEmployeesHidden() {
    return useQuery({
        queryKey: ["missing-employees-hidden"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("app_settings" as any)
                .select("value")
                .eq("key", "missing_employees_hidden")
                .maybeSingle();

            if (error) throw error;
            return String((data as any)?.value || "false") === "true";
        },
    });
}

export function useHideMissingEmployeesBoard() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => invokeEdgeFunction("dismiss-missing-employee"),
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: ["missing-employees"] });
            await qc.invalidateQueries({ queryKey: ["missing-employees-hidden"] });
            toast.success("Missing from API board hidden");
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to hide missing board");
        },
    });
}
