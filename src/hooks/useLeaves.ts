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
        .select("*")
        .order("created_at", { ascending: false });

      if (userId) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;
      if (error) throw error;
      const leaves = (data || []) as Leave[];

      // Collect unique user IDs to resolve names from profiles
      const userIds = new Set<string>();
      for (const leave of leaves) {
        if (leave.user_id) userIds.add(leave.user_id);
        if (leave.wso_approved_by) userIds.add(leave.wso_approved_by);
        if (leave.supervisor_approved_by) userIds.add(leave.supervisor_approved_by);
      }

      // Fetch profile names for all referenced users in one query
      const profileMap: Record<string, { full_name: string; employee_id: string }> = {};
      if (userIds.size > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, employee_id")
          .in("id", Array.from(userIds));
        if (profiles) {
          for (const p of profiles) {
            profileMap[p.id] = { full_name: p.full_name, employee_id: p.employee_id };
          }
        }
      }

      // Attach resolved profile data to each leave record
      return leaves.map((leave) => ({
        ...leave,
        user: profileMap[leave.user_id] || null,
        wso_approver: leave.wso_approved_by ? profileMap[leave.wso_approved_by] || null : null,
        supervisor_approver: leave.supervisor_approved_by ? profileMap[leave.supervisor_approved_by] || null : null,
      }));
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
