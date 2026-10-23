/**
 * Roster month publication — which future months employees may see.
 *
 * The roster sheet syncs a month ahead, before the roster is final, so a
 * supervisor or admin releases each future month explicitly
 * (`roster_month_publications`, one row per published month).  The current
 * month and every earlier month are always visible.
 *
 * The gate follows the portal, not the viewer's role: every employee-portal
 * page hides unpublished months, including for a supervisor who has switched
 * to it, so it shows exactly what employees see.  Supervisor and WSO pages
 * pass `showAll`, since they build and check the roster.
 *
 * Fails closed: until the publication list has loaded, nothing past the
 * current month is shown.
 */
import { useCallback, useMemo } from "react";
import { format, parseISO, startOfMonth } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const PUBLICATIONS_QUERY_KEY = ["roster-month-publications"] as const;

/** Roles allowed to publish (mirrors the table's RLS). */
const ROSTER_PUBLISHER_ROLES = new Set(["admin", "supervisor"]);

export interface RosterMonthPublication {
  /** First day of the month, yyyy-MM-dd. */
  month: string;
  published_by: string | null;
  published_at: string;
}

/** yyyy-MM for a Date or an ISO date string. */
export function monthKey(value: Date | string): string {
  return format(typeof value === "string" ? parseISO(value) : value, "yyyy-MM");
}

export function useRosterPublications() {
  return useQuery({
    queryKey: PUBLICATIONS_QUERY_KEY,
    // Only future months matter; past rows are kept for the record but never read.
    queryFn: async () => {
      const { data, error } = await supabase
        // Not in the generated types yet; the cast is confined to this call.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("roster_month_publications" as any)
        .select("month, published_by, published_at")
        .gte("month", format(startOfMonth(new Date()), "yyyy-MM-dd"))
        .order("month");
      if (error) throw error;
      return (data || []) as unknown as RosterMonthPublication[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useRosterVisibility({ showAll = false }: { showAll?: boolean } = {}) {
  const { userRole } = useAuth();
  const { data: publications, isLoading } = useRosterPublications();

  const canPublish = !!userRole && ROSTER_PUBLISHER_ROLES.has(userRole);

  const publishedMonths = useMemo(
    () => new Set((publications || []).map((p) => p.month.slice(0, 7))),
    [publications],
  );

  /** Whether the month holding this date (yyyy-MM-dd or Date) may be shown. */
  const isDateVisible = useCallback(
    (value: Date | string) => {
      if (showAll) return true;
      const month = typeof value === "string" ? value.slice(0, 7) : monthKey(value);
      return month <= monthKey(new Date()) || publishedMonths.has(month);
    },
    [showAll, publishedMonths],
  );

  return { canPublish, isDateVisible, publishedMonths, isLoading };
}

/** Publish a month (any date inside it). */
export function usePublishRosterMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (month: Date) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("roster_month_publications" as any)
        .upsert(
          {
            month: format(startOfMonth(month), "yyyy-MM-dd"),
            published_by: auth.user?.id,
          },
          { onConflict: "month", ignoreDuplicates: true },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PUBLICATIONS_QUERY_KEY }),
  });
}

/** Withdraw a published month. */
export function useUnpublishRosterMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (month: Date) => {
      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("roster_month_publications" as any)
        .delete()
        .eq("month", format(startOfMonth(month), "yyyy-MM-dd"));
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PUBLICATIONS_QUERY_KEY }),
  });
}
