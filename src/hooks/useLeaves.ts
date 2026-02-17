import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

type Leave = Tables<"leaves">;
type LeaveInsert = TablesInsert<"leaves">;
type LeaveUpdate = TablesUpdate<"leaves">;

export function useLeaves(userId?: string) {
  return useQuery({
    queryKey: ["leaves", userId],
    queryFn: async () => {
      let query = supabase
        .from("leaves")
        .select(`
          *,
          user:user_id(full_name, employee_id),
          wso_approver:wso_approved_by(full_name),
          supervisor_approver:supervisor_approved_by(full_name)
        `)
        .order("created_at", { ascending: false });

      if (userId) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Leave[];
    },
    staleTime: 3 * 60 * 1000, // 3 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function useLeaveBalances(userId?: string) {
  return useQuery({
    queryKey: ["leave_balances", userId],
    queryFn: async () => {
      let query = supabase
        .from("leave_balances")
        .select("*")
        .order("year", { ascending: false });

      if (userId) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
    staleTime: 10 * 60 * 1000, // 10 minutes (balances don't change frequently)
    gcTime: 30 * 60 * 1000, // 30 minutes
  });
}

export function useCreateLeave() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leave: LeaveInsert) => {
      const { data, error } = await supabase
        .from("leaves")
        .insert(leave)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
    },
  });
}

export function useUpdateLeave() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: LeaveUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("leaves")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      queryClient.invalidateQueries({ queryKey: ["leave_balances"] });
    },
  });
}

export function useUpdateLeaveBalance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<"leave_balances"> & { id: string }) => {
      const { data, error } = await supabase
        .from("leave_balances")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave_balances"] });
    },
  });
}
