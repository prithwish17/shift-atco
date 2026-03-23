import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables, TablesUpdate } from "@/integrations/supabase/types";

type DutyExchange = Tables<"duty_exchanges">;
type DutyExchangeUpdate = TablesUpdate<"duty_exchanges">;

export interface ExchangeApprovalStep {
  id: string;
  request_id: string;
  approver_id: string | null;
  approver_role: string;
  sequence_order: number;
  status: string;
  remarks: string | null;
  action_at: string | null;
  approver_name: string | null;
}

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

      // Fetch employee schedules for duty display (more reliable than shifts table)
      // Build unique (employee_code, duty_date) pairs
      const scheduleLookups: { employee_code: string; duty_date: string }[] = [];
      for (const ex of exchanges) {
        if (ex.duty_date) {
          const reqProfile = profileMap[ex.requesting_user_id];
          const partProfile = profileMap[ex.exchange_partner_id];
          if (reqProfile?.employee_id) scheduleLookups.push({ employee_code: reqProfile.employee_id, duty_date: ex.duty_date });
          if (partProfile?.employee_id) scheduleLookups.push({ employee_code: partProfile.employee_id, duty_date: ex.duty_date });
        }
      }

      // scheduleMap keyed by "employee_code|duty_date"
      let scheduleMap: Record<string, { duty_code: string; duty_description: string }> = {};
      if (scheduleLookups.length > 0) {
        const uniqueCodes = [...new Set(scheduleLookups.map((l) => l.employee_code))];
        const uniqueDates = [...new Set(scheduleLookups.map((l) => l.duty_date))];
        const { data: schedules } = await supabase
          .from("employee_schedules" as any)
          .select("employee_code, duty_date, duty_code, duty_description")
          .in("employee_code", uniqueCodes)
          .in("duty_date", uniqueDates);
        if (schedules) {
          for (const s of schedules as any[]) {
            scheduleMap[`${s.employee_code}|${s.duty_date}`] = {
              duty_code: s.duty_code,
              duty_description: s.duty_description,
            };
          }
        }
      }

      // Fetch current pending approval steps for all exchanges
      // so the frontend can determine which approver is assigned to the current step
      const exchangeIds = exchanges.map((ex) => ex.id);
      let currentStepMap: Record<string, { approver_id: string | null; approver_role: string; sequence_order: number }> = {};
      let pendingWsoApproverMap: Record<string, string[]> = {};
      let approvedWsoApproverMap: Record<string, string[]> = {};
      let hasUnassignedWsoStep: Record<string, boolean> = {};
      if (exchangeIds.length > 0) {
        // Fetch both pending AND approved WSO steps so the frontend can show
        // "approved by you, waiting for other WSO" state after one WSO approves
        const { data: allSteps } = await supabase
          .from("duty_exchange_approvals")
          .select("request_id, approver_id, approver_role, sequence_order, status")
          .in("request_id", exchangeIds)
          .in("status", ["pending", "approved"])
          .order("sequence_order", { ascending: true });
        if (allSteps) {
          for (const step of allSteps as any[]) {
            if (step.status === 'pending') {
              // Track the lowest-order pending step per exchange (for partner/supervisor sequential flow)
              if (!currentStepMap[step.request_id]) {
                currentStepMap[step.request_id] = {
                  approver_id: step.approver_id,
                  approver_role: step.approver_role,
                  sequence_order: step.sequence_order,
                };
              }
              // Collect ALL pending WSO approver IDs per exchange (for parallel WSO visibility)
              if (step.approver_role === 'wso') {
                if (step.approver_id) {
                  if (!pendingWsoApproverMap[step.request_id]) {
                    pendingWsoApproverMap[step.request_id] = [];
                  }
                  pendingWsoApproverMap[step.request_id].push(step.approver_id);
                } else {
                  // NULL approver_id means any WSO can act on this step
                  hasUnassignedWsoStep[step.request_id] = true;
                }
              }
            }
            // Collect WSO IDs that already approved their step (exchange may still be pending_wso)
            if (step.status === 'approved' && step.approver_role === 'wso' && step.approver_id) {
              if (!approvedWsoApproverMap[step.request_id]) {
                approvedWsoApproverMap[step.request_id] = [];
              }
              approvedWsoApproverMap[step.request_id].push(step.approver_id);
            }
          }
        }
      }

      // Attach resolved data
      return exchanges.map((ex) => {
        const reqProfile = profileMap[ex.requesting_user_id] || null;
        const partProfile = profileMap[ex.exchange_partner_id] || null;
        const reqScheduleKey = reqProfile?.employee_id && ex.duty_date ? `${reqProfile.employee_id}|${ex.duty_date}` : null;
        const partScheduleKey = partProfile?.employee_id && ex.duty_date ? `${partProfile.employee_id}|${ex.duty_date}` : null;
        const currentStep = currentStepMap[ex.id] || null;

        return {
          ...ex,
          requesting_user: reqProfile,
          exchange_partner: partProfile,
          requesting_shift: ex.requesting_user_shift_id ? shiftMap[ex.requesting_user_shift_id] || null : null,
          partner_shift: ex.exchange_partner_shift_id ? shiftMap[ex.exchange_partner_shift_id] || null : null,
          requesting_schedule: reqScheduleKey ? scheduleMap[reqScheduleKey] || null : null,
          partner_schedule: partScheduleKey ? scheduleMap[partScheduleKey] || null : null,
          wso_approver: ex.wso_approved_by ? profileMap[ex.wso_approved_by] || null : null,
          supervisor_approver: ex.supervisor_approved_by ? profileMap[ex.supervisor_approved_by] || null : null,
          current_step_approver_id: currentStep?.approver_id || null,
          current_step_role: currentStep?.approver_role || null,
          pending_wso_approver_ids: pendingWsoApproverMap[ex.id] || [],
          approved_wso_approver_ids: approvedWsoApproverMap[ex.id] || [],
          has_unassigned_wso_step: hasUnassignedWsoStep[ex.id] || false,
        };
      });
    },
  });
}

/** Fetch approval steps for one exchange request */
export function useExchangeApprovals(requestId?: string) {
  return useQuery({
    queryKey: ["exchange_approvals", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_exchange_approvals", {
        p_request_id: requestId!,
      });
      if (error) throw error;
      return (data || []) as ExchangeApprovalStep[];
    },
  });
}

/** Create a new duty exchange request via the atomic RPC */
export function useCreateDutyExchange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      requester_id: string;
      partner_id: string;
      requester_shift_id: string;
      partner_shift_id: string;
      duty_date: string;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("create_duty_exchange_request", {
        p_requester_id: params.requester_id,
        p_partner_id: params.partner_id,
        p_requester_shift_id: params.requester_shift_id,
        p_partner_shift_id: params.partner_shift_id,
        p_duty_date: params.duty_date,
        p_reason: params.reason,
      });

      if (error) throw error;
      return data as string; // returns the new request_id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duty_exchanges"] });
      queryClient.invalidateQueries({ queryKey: ["exchange_approvals"] });
    },
  });
}

/** Process an approval step (approve/reject) via RPC */
export function useProcessExchangeApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      request_id: string;
      approver_id: string;
      action: "approve" | "reject";
      remarks?: string;
    }) => {
      const { data, error } = await supabase.rpc("process_exchange_approval", {
        p_request_id: params.request_id,
        p_approver_id: params.approver_id,
        p_action: params.action,
        p_remarks: params.remarks ?? null,
      });

      if (error) throw error;
      return data as { status: string; step: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["duty_exchanges"] });
      queryClient.invalidateQueries({ queryKey: ["exchange_approvals"] });
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}

/** Legacy: direct update on duty_exchanges row (kept for backward compat) */
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
