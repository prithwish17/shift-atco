/**
 * The Night Channel Allocation feature toggle.
 *
 * Read from `app_settings`, so the module can be turned off without a deploy.
 * A missing row means enabled — the migration seeds it, and a lookup failure
 * must not hide a page people are relying on.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const NIGHT_ALLOCATION_SETTING_KEY = "night_allocation.enabled";

export function useNightAllocationEnabled() {
  const query = useQuery({
    queryKey: ["night-allocation-enabled"],
    queryFn: async () => {
      const { data, error } = await supabase
        // The generated Supabase types omit app_settings, as they do several
        // live tables; the cast is confined to this one call.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("app_settings" as any)
        .select("value")
        .eq("key", NIGHT_ALLOCATION_SETTING_KEY)
        .maybeSingle();
      if (error) throw error;
      const value = (data as { value?: string | null } | null)?.value;
      return value == null ? true : String(value).toLowerCase() !== "false";
    },
    staleTime: 5 * 60 * 1000,
  });

  return { enabled: query.data !== false, isLoading: query.isLoading };
}
