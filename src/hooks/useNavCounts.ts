import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { BadgeKey } from "@/lib/navConfig";

export type NavCounts = Partial<Record<BadgeKey, number>>;

/**
 * Counts for the sidebar's Approvals badges.
 *
 * These are head-only count queries rather than a reuse of the dashboard's
 * `useAllLeaveRequests` / `useDutyExchanges`, which pull up to 500 rows plus
 * joined profiles — far too heavy to run on every page just to render a number.
 *
 * A badge means "waiting on you", so leave is filtered to `Pending Supervisor`
 * only. Requests sitting at `Pending WSO` are counted on the dashboard's leave
 * tile but are not the supervisor's action.
 */
export function useNavCounts(enabled: boolean): NavCounts {
  const { data: pendingLeaves } = useQuery({
    queryKey: ["nav-counts", "pending-leaves"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        // leave_requests isn't in the generated types yet — same cast as useLeaveRequests
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("leave_requests" as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "Pending Supervisor");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: pendingExchanges } = useQuery({
    queryKey: ["nav-counts", "pending-exchanges"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("duty_exchanges")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_supervisor");
      if (error) throw error;
      return count ?? 0;
    },
  });

  return useMemo(
    () => ({ pendingLeaves, pendingExchanges }),
    [pendingLeaves, pendingExchanges],
  );
}
