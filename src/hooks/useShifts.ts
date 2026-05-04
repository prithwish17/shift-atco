import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tables, TablesInsert } from "@/integrations/supabase/types";

export type Shift = Tables<"shifts">;
export type ShiftInsert = Omit<TablesInsert<"shifts">, "id" | "created_at" | "updated_at">;

export function useShifts(userId?: string, startDate?: string, endDate?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: shifts, isLoading } = useQuery({
    queryKey: ["shifts", userId, startDate, endDate],
    queryFn: async () => {
      let query = supabase.from("shifts").select("*");

      if (userId) {
        query = query.eq("user_id", userId);
      }

      if (startDate) {
        query = query.gte("shift_date", startDate);
      }

      if (endDate) {
        query = query.lte("shift_date", endDate);
      }

      const { data, error } = await query.order("shift_date");

      if (error) throw error;
      return data as Shift[];
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });

  const createShift = useMutation({
    mutationFn: async (shift: ShiftInsert) => {
      const { error } = await supabase.from("shifts").insert(shift);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({
        title: "Shift created",
        description: "Shift has been successfully created.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error creating shift",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateShift = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Shift> }) => {
      const { error } = await supabase
        .from("shifts")
        .update(updates)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({
        title: "Shift updated",
        description: "Shift has been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating shift",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteShift = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({
        title: "Shift deleted",
        description: "Shift has been successfully deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting shift",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    shifts,
    isLoading,
    createShift: createShift.mutate,
    updateShift: updateShift.mutate,
    deleteShift: deleteShift.mutate,
    isCreating: createShift.isPending,
    isUpdating: updateShift.isPending,
    isDeleting: deleteShift.isPending,
  };
}

export function useUserShifts(userId: string) {
  const { data: shifts, isLoading } = useQuery({
    queryKey: ["user-shifts", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .eq("user_id", userId)
        .order("shift_date");

      if (error) throw error;
      return data as Shift[];
    },
  });

  return { shifts, isLoading };
}
