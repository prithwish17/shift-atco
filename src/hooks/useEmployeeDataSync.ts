import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";

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
        mutationFn: async () => {
            // Try direct Supabase edge function first
            let directError: any = null;
            try {
                const { data, error } = await supabase.functions.invoke("fetch-employee-data", { body: {} });
                if (!error) return data;
                directError = error;
            } catch (err) {
                directError = err;
            }

            // Fallback to Vercel proxy in dev
            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw directError;

                const base = getFunctionsProxyBaseUrl();

                const res = await fetch(`${base}/api/functions/fetch-employee-data`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({}),
                });

                if (res.ok) return res.json();

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
        mutationFn: async () => {
            const { data, error } = await supabase.functions.invoke("dismiss-missing-employee", {
                body: {},
            });

            if (!error) return data;

            if (import.meta.env.DEV) {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) throw error;

                const base = getFunctionsProxyBaseUrl();

                const res = await fetch(`${base}/api/functions/dismiss-missing-employee`, {
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
                    `Edge function failed via proxy: HTTP ${res.status}`,
                );
            }

            throw error;
        },
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
