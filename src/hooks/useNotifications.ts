import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  category: string | null;
  metadata: Record<string, any>;
  read: boolean;
  created_at: string;
}

const NOTIFICATION_KEYS = {
  all: ["notifications"] as const,
  list: (userId: string) => ["notifications", "list", userId] as const,
  unread: (userId: string) => ["notifications", "unread", userId] as const,
};

export function useNotifications(limit = 50) {
  const { user } = useAuth();
  return useQuery({
    queryKey: NOTIFICATION_KEYS.list(user?.id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications" as any)
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as unknown as Notification[];
    },
    enabled: !!user?.id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useUnreadCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: NOTIFICATION_KEYS.unread(user?.id ?? ""),
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications" as any)
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("read", false);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user?.id,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useMarkAsRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications" as any)
        .update({ read: true } as any)
        .eq("id", notificationId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (user?.id) {
        qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.list(user.id) });
        qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.unread(user.id) });
      }
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications" as any)
        .update({ read: true } as any)
        .eq("user_id", user!.id)
        .eq("read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      if (user?.id) {
        qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.list(user.id) });
        qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.unread(user.id) });
      }
    },
  });
}
