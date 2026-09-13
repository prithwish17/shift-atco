import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";

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
        mutationFn: async () =>
            invokeEdgeFunction<{ total?: number; updated?: number }>("fetch-team-code"),
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
