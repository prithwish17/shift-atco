import { Sentry } from '@/lib/sentry';

type CriticalEventType =
  | 'leave_approval_failure'
  | 'comp_off_allocation_error'
  | 'schedule_sync_failure'
  | 'duty_exchange_conflict'
  | 'roster_generation_failure'
  | 'license_expiry_error'
  | 'notification_delivery_failure';

/**
 * Set user context for Sentry. Only sends id + role (no PII).
 */
export function setUserContext(user: { id: string; role: string }) {
  Sentry.setUser({ id: user.id, role: user.role });
}

/**
 * Clear user context on sign-out.
 */
export function clearUserContext() {
  Sentry.setUser(null);
}

/**
 * Log a critical HR workflow failure to Sentry.
 * Only use for events that require immediate attention.
 */
export function logCriticalEvent(
  type: CriticalEventType,
  metadata: Record<string, unknown> = {},
) {
  Sentry.withScope((scope) => {
    scope.setTag('critical_event', type);
    scope.setLevel('error');
    scope.setExtras(metadata);
    Sentry.captureMessage(`[Critical] ${type}`, 'error');
  });
}

/**
 * Capture an exception with additional context.
 * Use this instead of bare Sentry.captureException for richer context.
 */
export function captureError(
  error: unknown,
  context?: { tags?: Record<string, string>; extras?: Record<string, unknown> },
) {
  Sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }
    if (context?.extras) {
      scope.setExtras(context.extras);
    }
    Sentry.captureException(error);
  });
}
