import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

type DutyExchange = Tables<"duty_exchanges">;
type DutyExchangeInsert = TablesInsert<"duty_exchanges">;
type DutyExchangeUpdate = TablesUpdate<"duty_exchanges">;

export function useDutyExchanges(userId?: string) {
  return useQuery({
    queryKey: ["duty_exchanges", userId],
    queryFn: async () => {
      let query = supabase
        .from("duty_exchanges")
        .select("*")
        .order("created_at", { ascending: false });

      if (userId) {
        query = query.or(`requesting_user_id.eq.${userId},exchange_partner_id.eq.${userId}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      const exchanges = (data || []) as DutyExchange[];

      // Collect unique user IDs and shift IDs
      const userIds = new Set<string>();
      const shiftIds = new Set<string>();
      for (const ex of exchanges) {
        if (ex.requesting_user_id) userIds.add(ex.requesting_user_id);
        if (ex.exchange_partner_id) userIds.add(ex.exchange_partner_id);
        if (ex.wso_approved_by) userIds.add(ex.wso_approved_by);
        if (ex.supervisor_approved_by) userIds.add(ex.supervisor_approved_by);
        if (ex.requesting_user_shift_id) shiftIds.add(ex.requesting_user_shift_id);
        if (ex.exchange_partner_shift_id) shiftIds.add(ex.exchange_partner_shift_id);
      }

      // Fetch profiles
      let profileMap: Record<string, { full_name: string; employee_id: string }> = {};
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

      // Fetch shifts
      let shiftMap: Record<string, any> = {};
      if (shiftIds.size > 0) {
        const { data: shifts } = await supabase
          .from("shifts")
          .select("*")
          .in("id", Array.from(shiftIds));
        if (shifts) {
          for (const s of shifts) {
            shiftMap[s.id] = s;
          }
        }
      }

      // Attach resolved data
      return exchanges.map((ex) => ({
        ...ex,
        requesting_user: profileMap[ex.requesting_user_id] || null,
        exchange_partner: profileMap[ex.exchange_partner_id] || null,
        requesting_shift: ex.requesting_user_shift_id ? shiftMap[ex.requesting_user_shift_id] || null : null,
        partner_shift: ex.exchange_partner_shift_id ? shiftMap[ex.exchange_partner_shift_id] || null : null,
        wso_approver: ex.wso_approved_by ? profileMap[ex.wso_approved_by] || null : null,
        supervisor_approver: ex.supervisor_approved_by ? profileMap[ex.supervisor_approved_by] || null : null,
      }));
    },
  });
}

export function useCreateDutyExchange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (exchange: DutyExchangeInsert) => {
      const { data, error } = await supabase
        .from("duty_exchanges")
        .insert(exchange)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duty_exchanges"] });
    },
  });
}

export function useUpdateDutyExchange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: DutyExchangeUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("duty_exchanges")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duty_exchanges"] });
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}
