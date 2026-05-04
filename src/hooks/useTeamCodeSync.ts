import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";

export function useTeamCodeApiUrl() {
    return useQuery({
        queryKey: ["app-settings", "team_code_webapp_url"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("app_settings" as any)
                .select("value")
                .eq("key", "team_code_webapp_url")
                .maybeSingle();

            if (error) throw error;
            return ((data as any)?.value as string) || "";
        },
    });
}

export function useSyncTeamCode() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            // Try direct Supabase edge function first
            let directError: any = null;
            try {
                const { data, error } = await supabase.functions.invoke("fetch-team-code", { body: {} });
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

                const res = await fetch(`${base}/api/functions/fetch-team-code`, {
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
        onSuccess: async (result: { total?: number; updated?: number } | undefined) => {
            await qc.invalidateQueries({ queryKey: ["users"] });
            await qc.invalidateQueries({ queryKey: ["profile"] });
            toast.success(`Team codes synced${result?.updated ? ` (${result.updated} profiles updated)` : ""}`);
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to sync team codes");
        },
    });
}
