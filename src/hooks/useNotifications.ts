import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { scheduleKeys } from "@/lib/scheduleQueryConfig";

// Notification categories sent when someone's duty or leave on the schedule changed.
const SCHEDULE_CHANGE_CATEGORIES = new Set(["duty_change", "duty_exchange", "leave_status"]);

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
  const qc = useQueryClient();
  const query = useQuery({
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
    // No polling: useUnreadCount refetches the list when the count moves.
  });

  // Users without web push learn of a duty or leave change from this list: a
  // new unread one means their cached schedule is out of date.
  const seenScheduleChanges = useRef<{ userId: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!query.data || !user?.id) return;
    const ids = query.data
      .filter((n) => !n.read && SCHEDULE_CHANGE_CATEGORIES.has(n.category ?? ""))
      .map((n) => n.id);
    const seen = seenScheduleChanges.current?.userId === user.id ? seenScheduleChanges.current.ids : null;
    if (seen && ids.some((id) => !seen.has(id))) {
      qc.invalidateQueries({ queryKey: scheduleKeys.all });
    }
    seenScheduleChanges.current = { userId: user.id, ids: new Set([...(seen ?? []), ...ids]) };
  }, [query.data, user?.id, qc]);

  return query;
}

/**
 * The one notification poller. The bell is on every page, so this runs for
 * every signed-in user: it polls a cheap count every 5 minutes and on window
 * focus, and refreshes at once when a web push arrives. The list follows it.
 */
export function useUnreadCount() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
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
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  // A changed count means the list is out of date: a new notification, or one
  // read or cleared on another device.
  const lastCount = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (query.data === undefined || !user?.id) return;
    if (lastCount.current !== undefined && lastCount.current !== query.data) {
      qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.list(user.id) });
    }
    lastCount.current = query.data;
  }, [query.data, user?.id, qc]);

  // public/sw.js posts PUSH_RECEIVED to open windows when a push arrives.
  // notifyUsers inserts the notification row before sending the push.
  useEffect(() => {
    if (!user?.id || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "PUSH_RECEIVED") return;
      qc.invalidateQueries({ queryKey: NOTIFICATION_KEYS.unread(user.id) });
      // Schedules are cached for minutes; a push saying a duty or leave
      // changed must not sit next to the old duty.
      if (SCHEDULE_CHANGE_CATEGORIES.has(event.data.category)) {
        qc.invalidateQueries({ queryKey: scheduleKeys.all });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [user?.id, qc]);

  return query;
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

export function useClearNotification() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications" as any)
        .delete()
        .eq("id", notificationId)
        .eq("user_id", user!.id);
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

export function useClearAllNotifications() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications" as any)
        .delete()
        .eq("user_id", user!.id);
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
