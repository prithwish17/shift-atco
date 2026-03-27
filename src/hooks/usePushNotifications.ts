import { useCallback, useEffect, useState } from "react";
import { safeStorage } from "@/lib/safeStorage";
import {
  getNotificationPermissionState,
  isPushSupported,
  isNotificationPermissionSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/utils/pushSubscription";

// ── localStorage keys ──
const PERMISSION_KEY = "notificationPermission";
const PROMPT_SHOWN_KEY = "notificationPromptShown";

export type PushStatus = "idle" | "subscribing" | "unsubscribing";

export interface UsePushNotificationsReturn {
  /** Current browser permission: granted | denied | default | unsupported */
  permission: NotificationPermission | "unsupported";
  /** Whether push APIs + VAPID key are available */
  isSupported: boolean;
  /** Network/subscription in progress */
  status: PushStatus;
  /** Whether the soft-ask prompt has been shown this install */
  promptShown: boolean;
  /** Request browser permission + subscribe. Call only on user gesture. */
  requestAndSubscribe: () => Promise<"granted" | "denied" | "default">;
  /** Unsubscribe from push */
  unsubscribe: () => Promise<void>;
  /** Mark the soft-ask prompt as shown */
  markPromptShown: () => void;
  /** Ensure subscription exists when permission is already granted */
  ensureSubscription: () => Promise<void>;
}

/**
 * Standalone hook for push notification permission + subscription.
 *
 * Does NOT trigger the browser permission dialog on mount.
 * Callers must invoke `requestAndSubscribe()` on an explicit user gesture.
 */
export function usePushNotifications(): UsePushNotificationsReturn {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    getNotificationPermissionState
  );
  const [status, setStatus] = useState<PushStatus>("idle");
  const [promptShown, setPromptShown] = useState(
    () => safeStorage.getItem(PROMPT_SHOWN_KEY) === "true"
  );

  // Keep permission state in sync across focus / visibility changes
  useEffect(() => {
    const sync = () => setPermission(getNotificationPermissionState());
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const markPromptShown = useCallback(() => {
    setPromptShown(true);
    safeStorage.setItem(PROMPT_SHOWN_KEY, "true");
  }, []);

  /**
   * Request browser permission then subscribe to push.
   * Must be called inside a user-gesture handler (click / tap).
   */
  const requestAndSubscribe = useCallback(async (): Promise<NotificationPermission> => {
    if (!isPushSupported() || !isNotificationPermissionSupported()) {
      return "default";
    }

    setStatus("subscribing");

    try {
      // Safari compat: try promise first, fall back to callback
      let result: NotificationPermission;
      try {
        result = await Notification.requestPermission();
      } catch {
        result = await new Promise<NotificationPermission>((resolve) => {
          Notification.requestPermission(resolve);
        });
      }

      setPermission(result);
      safeStorage.setItem(PERMISSION_KEY, result);

      if (result === "granted") {
        await subscribeToPush();
      }

      return result;
    } finally {
      setStatus("idle");
    }
  }, []);

  /** Unsubscribe and clear stored state */
  const unsubscribe = useCallback(async () => {
    setStatus("unsubscribing");
    try {
      await unsubscribeFromPush();
      safeStorage.removeItem(PERMISSION_KEY);
    } finally {
      setStatus("idle");
    }
  }, []);

  /**
   * If permission is already granted, ensure a push subscription exists
   * (e.g. user cleared browser data but permission persists).
   * Safe to call on mount — it never shows a permission dialog.
   */
  const ensureSubscription = useCallback(async () => {
    if (getNotificationPermissionState() !== "granted" || !isPushSupported()) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!existing) {
        await subscribeToPush();
      }
    } catch {
      // Silently ignore — no user-facing impact
    }
  }, []);

  return {
    permission,
    isSupported: isPushSupported() && isNotificationPermissionSupported(),
    status,
    promptShown,
    requestAndSubscribe,
    unsubscribe,
    markPromptShown,
    ensureSubscription,
  };
}
