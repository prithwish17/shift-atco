import { supabase } from '@/integrations/supabase/client';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const SAVE_SUBSCRIPTION_ENDPOINT = '/api/save-subscription';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    !!VAPID_PUBLIC_KEY
  );
}

export function isNotificationPermissionSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (!isNotificationPermissionSupported()) return 'unsupported';
  return Notification.permission;
}

async function saveSubscriptionToBackend(subscription: PushSubscription, userId: string, accessToken: string) {
  const keys = subscription.toJSON().keys;

  if (!keys?.p256dh || !keys?.auth) {
    throw new Error('Missing push subscription keys');
  }

  const payload = {
    user_id: userId,
    endpoint: subscription.endpoint,
    keys: {
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  };

  try {
    const response = await fetch(SAVE_SUBSCRIPTION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || 'Failed to save push subscription');
    }
  } catch (error) {
    if (!import.meta.env.DEV) {
      throw error;
    }

    await supabase
      .from('push_subscriptions' as any)
      .upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh: keys.p256dh,
          auth_key: keys.auth,
        } as any,
        { onConflict: 'user_id,endpoint' }
      );
  }
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    if (!VAPID_PUBLIC_KEY) throw new Error('Push notification configuration (VAPID key) is missing. Contact admin.');
    if (!('serviceWorker' in navigator)) throw new Error('Service workers are not supported on this browser.');
    if (!('PushManager' in window)) throw new Error('Push notifications are not supported on this browser.');
    return null;
  }
  if (getNotificationPermissionState() !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user || !session.access_token) {
      throw new Error('You must be signed in to enable notifications on this device.');
    }

    const registration = await navigator.serviceWorker.ready;

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
      });
    }

    await saveSubscriptionToBackend(subscription, session.user.id, session.access_token);
    return subscription;
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Push] Subscription failed:', err);
    throw err instanceof Error ? err : new Error('Push subscription failed');
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const { data: { user } } = await supabase.auth.getUser();

    // Unsubscribe from browser push
    await subscription.unsubscribe();

    // Remove from DB
    if (user) {
      await supabase
        .from('push_subscriptions' as any)
        .delete()
        .eq('user_id', user.id)
        .eq('endpoint', subscription.endpoint);
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[Push] Unsubscribe failed:', err);
  }
}
