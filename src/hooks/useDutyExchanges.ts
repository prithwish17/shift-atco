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
        .select(`
          *,
          requesting_user:requesting_user_id(full_name, employee_id),
          exchange_partner:exchange_partner_id(full_name, employee_id),
          requesting_shift:requesting_user_shift_id(*),
          partner_shift:exchange_partner_shift_id(*),
          wso_approver:wso_approved_by(full_name),
          supervisor_approver:supervisor_approved_by(full_name)
        `)
        .order("created_at", { ascending: false });

      if (userId) {
        query = query.or(`requesting_user_id.eq.${userId},exchange_partner_id.eq.${userId}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as DutyExchange[];
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
