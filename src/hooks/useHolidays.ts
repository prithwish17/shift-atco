import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { logSupervisorEdit } from "@/lib/supervisorAuditLog";

type Holiday = Tables<"holidays">;
type HolidayInsert = TablesInsert<"holidays">;
type HolidayUpdate = TablesUpdate<"holidays">;

export function useHolidays() {
  return useQuery({
    queryKey: ["holidays"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("holidays")
        .select("*")
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
      const station = holiday.station || "ALL";

      const { data: existingHoliday, error: existingHolidayError } = await supabase
        .from("holidays")
        .select("id")
        .eq("holiday_date", holiday.holiday_date)
        .eq("station", station)
        .maybeSingle();

      if (existingHolidayError) throw existingHolidayError;

      if (existingHoliday) {
        const { data, error } = await supabase
          .from("holidays")
          .update({
            name: holiday.name,
            holiday_date: holiday.holiday_date,
            type: holiday.type,
            year: holiday.year,
            station,
            selectable: holiday.selectable,
            comp_off_eligible: holiday.comp_off_eligible,
          })
          .eq("id", existingHoliday.id)
          .select()
          .single();

        if (error) throw error;
        return { holiday: data, mode: "updated" as const };
      }

      const { data, error } = await supabase
        .from("holidays")
        .insert({ ...holiday, station })
        .select()
        .single();

      if (error) throw error;
      return { holiday: data, mode: "created" as const };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      logSupervisorEdit({
        action: result.mode === "updated" ? "update" : "insert",
        table: "holidays",
        description: result.mode === "updated"
          ? `Holiday updated: ${result.holiday.name} on ${result.holiday.holiday_date}`
          : `Holiday created: ${result.holiday.name} on ${result.holiday.holiday_date}`,
        recordId: result.holiday.id,
        after: { name: result.holiday.name, holiday_date: result.holiday.holiday_date, station: result.holiday.station },
      });
    },
  });
}

export function useUpdateHoliday() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: HolidayUpdate & { id: string }) => {
      const nextDate = updates.holiday_date;
      const nextStation = updates.station;

      if (nextDate && nextStation) {
        const { data: conflictingHoliday, error: conflictingHolidayError } = await supabase
          .from("holidays")
          .select("id")
          .eq("holiday_date", nextDate)
          .eq("station", nextStation)
          .neq("id", id)
          .maybeSingle();

        if (conflictingHolidayError) throw conflictingHolidayError;
        if (conflictingHoliday) {
          throw new Error("A holiday already exists for this date and station. Edit the existing holiday instead.");
        }
      }

      const { data, error } = await supabase
        .from("holidays")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      logSupervisorEdit({
        action: "update",
        table: "holidays",
        description: `Holiday updated: ${data.name} on ${data.holiday_date}`,
        recordId: data.id,
        after: { name: data.name, holiday_date: data.holiday_date, station: data.station },
      });
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
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      logSupervisorEdit({
        action: "delete",
        table: "holidays",
        description: `Holiday deleted`,
        recordId: id,
      });
    },
  });
}
