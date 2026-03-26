import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface NotificationPreference {
  event_type: string;
  email: boolean;
  push: boolean;
  in_app: boolean;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  ba_test_selected: "BA Test Selection Alerts",
  leave_status: "Leave Approvals / Rejections",
  leave_request: "New Leave Requests (Approvers)",
  duty_exchange: "Duty Exchange Updates",
  duty_change: "Duty Schedule Changes",
  ope_reminder: "OPE Duty Reminders",
  license_expiry: "License / Rating Expiry Alerts",
  compoff_expiry: "Comp-Off Expiry Alerts",
  compoff_expired: "Comp-Off Expired",
  license_expired: "License / Rating Expired",
  general: "General Notifications",
};

export function getEventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] || eventType;
}

export function useNotificationPreferences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notification-preferences", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "notification-preferences",
        { method: "GET" }
      );
      if (error) throw error;
      return (data || []) as NotificationPreference[];
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateNotificationPreference() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (pref: NotificationPreference) => {
      const { error } = await supabase.functions.invoke(
        "notification-preferences",
        {
          method: "PUT",
          body: pref,
        }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      if (user?.id) {
        qc.invalidateQueries({
          queryKey: ["notification-preferences", user.id],
        });
      }
    },
  });
}
