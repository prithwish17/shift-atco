import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RosterEntry {
  id?: string;
  date: string;
  shift: string;
  team: string;
  unit: string;
  employee_name: string;
  position: string;
  created_at?: string;
}

// Fetch fresh data from the Google Apps Script via edge function
export function useFetchRoster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ team, shift }: { team: string; shift: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const url = new URL("/api/functions/fetch-roster", window.location.origin);
      if (team) url.searchParams.set("team", team);
      if (shift) url.searchParams.set("shift", shift);

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to fetch roster");
      }

      const json = await res.json();
      return json.data as RosterEntry[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rosters"] });
      queryClient.invalidateQueries({ queryKey: ["my-roster"] });
    },
  });
}

// Read persisted rosters from Supabase
export function useRosters(filters?: {
  team?: string;
  shift?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ["rosters", filters],
    queryFn: async () => {
      let query = supabase.from("rosters" as any).select("*");

      if (filters?.team) {
        query = query.eq("team", filters.team);
      }
      if (filters?.shift) {
        query = query.eq("shift", filters.shift);
      }
      if (filters?.search) {
        query = query.or(
          `employee_name.ilike.%${filters.search}%,unit.ilike.%${filters.search}%,position.ilike.%${filters.search}%`
        );
      }

      query = query.order("date", { ascending: false }).limit(500);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as RosterEntry[];
    },
  });
}

// Fetch roster entries for a specific employee by name
export function useMyRoster(employeeName?: string) {
  return useQuery({
    queryKey: ["my-roster", employeeName],
    enabled: !!employeeName,
    queryFn: async () => {
      const { data, error } = await (supabase.from("rosters" as any)
        .select("*")
        .ilike("employee_name", employeeName!)
        .order("date", { ascending: false })
        .limit(50));
      if (error) throw error;
      return (data || []) as unknown as RosterEntry[];
    },
  });
}
