import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tables, TablesInsert } from "@/integrations/supabase/types";

export type Attendance = Tables<"attendance">;
export type AttendanceInsert = Omit<TablesInsert<"attendance">, "id" | "created_at" | "updated_at">;

export function useAttendance(date?: string, shiftType?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: attendance, isLoading } = useQuery({
    queryKey: ["attendance", date, shiftType],
    queryFn: async () => {
      let query = supabase.from("attendance").select(`
        *,
        profiles:user_id (
          full_name,
          employee_id,
          photo_url
        )
      `);

      if (date) {
        query = query.eq("attendance_date", date);
      }

      const { data, error } = await query.order("attendance_date", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!date,
    staleTime: 1 * 60 * 1000, // 1 minute
    gcTime: 3 * 60 * 1000, // 3 minutes
    refetchOnWindowFocus: true, // Refetch on focus for real-time accuracy
  });

  const markAttendance = useMutation({
    mutationFn: async (record: AttendanceInsert) => {
      const user = await supabase.auth.getUser();
      const { error } = await supabase.from("attendance").insert({
        ...record,
        marked_by: user.data.user?.id || "",
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast({
        title: "Attendance marked",
        description: "Attendance has been successfully recorded.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error marking attendance",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateAttendance = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Attendance> }) => {
      const { error } = await supabase
        .from("attendance")
        .update(updates)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast({
        title: "Attendance updated",
        description: "Attendance has been successfully updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating attendance",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkMarkAttendance = useMutation({
    mutationFn: async (records: AttendanceInsert[]) => {
      const user = await supabase.auth.getUser();
      const recordsWithMarker = records.map(r => ({
        ...r,
        marked_by: user.data.user?.id || "",
      }));

      const { error } = await supabase.from("attendance").insert(recordsWithMarker);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      toast({
        title: "Bulk attendance marked",
        description: "All attendance records have been saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error marking attendance",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    attendance,
    isLoading,
    markAttendance: markAttendance.mutate,
    updateAttendance: updateAttendance.mutate,
    bulkMarkAttendance: bulkMarkAttendance.mutate,
    isMarking: markAttendance.isPending,
    isUpdating: updateAttendance.isPending,
    isBulkMarking: bulkMarkAttendance.isPending,
  };
}
