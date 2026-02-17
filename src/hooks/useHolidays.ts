import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

type Holiday = Tables<"holidays">;
type HolidayInsert = TablesInsert<"holidays">;
type HolidayUpdate = TablesUpdate<"holidays">;

export function useHolidays() {
  return useQuery({
    queryKey: ["holidays"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select(`
          *,
          creator:created_by(full_name)
        `)
        .order("holiday_date", { ascending: true });

      if (error) throw error;
      return data as Holiday[];
    },
    staleTime: 30 * 60 * 1000, // 30 minutes (holidays don't change often)
    gcTime: 60 * 60 * 1000, // 1 hour
  });
}

export function useCreateHoliday() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (holiday: HolidayInsert) => {
      const { data, error } = await supabase
        .from("holidays")
        .insert(holiday)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
  });
}

export function useUpdateHoliday() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: HolidayUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("holidays")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
  });
}

export function useDeleteHoliday() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("holidays")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
  });
}
