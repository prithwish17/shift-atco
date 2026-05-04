type SentryModule = typeof import('@sentry/react');
type SentryScopeCallback = Parameters<SentryModule['withScope']>[0];
type SentryUser = Parameters<SentryModule['setUser']>[0];
type SentryCaptureContext = Parameters<SentryModule['captureException']>[1];
type SentrySeverityLevel = Parameters<SentryModule['captureMessage']>[1];

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
let sentryModulePromise: Promise<SentryModule | null> | null = null;
let sentryInitPromise: Promise<SentryModule | null> | null = null;

// PII field names to strip from event data
const PII_KEYS = /aadhaar|salary|phone|mobile|email|password|token|authorization|secret|ssn/i;

function scrubPII(obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') return obj;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_KEYS.test(key)) {
      cleaned[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      cleaned[key] = scrubPII(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

// Routes worth tracing — everything else is dropped
const TRACED_ROUTE_PATTERNS = [
  '/supervisor/roster',
  '/supervisor/leave',
  '/supervisor/duty-exchange',
  '/supervisor/daily-roster',
  '/employee/leave',
  '/employee/roster',
  '/employee/duty-exchange',
  '/wso/roster',
  '/wso/duty-exchange',
  '/atc/',
];

// Errors to ignore — high volume, low signal
const IGNORED_ERROR_PATTERNS = [
  /loading.*(chunk|module)/i,
  /dynamically imported module/i,
  /failed to fetch/i,
  /ResizeObserver/i,
  /AbortError/i,
  /network\s*(error|timeout)/i,
  /NotAllowedError/i,
  /supabase.*realtime/i,
  /REALTIME_SUBSCRIBE/i,
];

async function loadSentryModule(): Promise<SentryModule | null> {
  if (!SENTRY_DSN) return null;
  if (sentryModulePromise) return sentryModulePromise;

  sentryModulePromise = import('@sentry/react')
    .then((module) => module)
    .catch((error) => {
      if (import.meta.env.DEV) {
        console.warn('[Sentry] Failed to load SDK:', error);
      }
      sentryModulePromise = null;
      return null;
    });

  return sentryModulePromise;
}

async function ensureSentryInitialized(): Promise<SentryModule | null> {
  if (!SENTRY_DSN) return null;
  if (sentryInitPromise) return sentryInitPromise;

  sentryInitPromise = loadSentryModule()
    .then((SentrySdk) => {
      if (!SentrySdk) return null;

      SentrySdk.init({
        dsn: SENTRY_DSN,
        environment: import.meta.env.MODE,
        enabled: true,
        release: __APP_VERSION__,
        debug: import.meta.env.DEV,

        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,

        integrations: [
          SentrySdk.browserTracingIntegration(),
          SentrySdk.replayIntegration({
            maskAllText: true,
            blockAllMedia: true,
          }),
        ],

        beforeSend(event) {
          const message = event.exception?.values?.[0]?.value || '';

          if (IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
            return null;
          }

          const statusCode = (event.contexts?.response as Record<string, unknown>)?.status_code as number | undefined;
          if (statusCode && statusCode >= 400 && statusCode < 500) {
            return null;
          }

          if (event.extra) {
            event.extra = scrubPII(event.extra as Record<string, unknown>);
          }
          if (event.breadcrumbs) {
            for (const crumb of event.breadcrumbs) {
              if (crumb.data) {
                crumb.data = scrubPII(crumb.data as Record<string, unknown>);
              }
            }
          }
          if (event.request?.data && typeof event.request.data === 'object') {
            event.request.data = scrubPII(event.request.data as Record<string, unknown>);
          }

          return event;
        },

        beforeSendTransaction(event) {
          const name = event.transaction || '';
          if (TRACED_ROUTE_PATTERNS.some((pattern) => name.includes(pattern))) {
            return event;
          }
          return null;
        },

        beforeBreadcrumb(breadcrumb) {
          if (breadcrumb.category === 'console' && breadcrumb.level === 'log') {
            return null;
          }
          return breadcrumb;
        },
      });

      return SentrySdk;
    })
    .catch((error) => {
      if (import.meta.env.DEV) {
        console.warn('[Sentry] Initialization failed:', error);
      }
      sentryInitPromise = null;
      return null;
    });

  return sentryInitPromise;
}

function withSentry(action: (SentrySdk: SentryModule) => void) {
  void ensureSentryInitialized().then((SentrySdk) => {
    if (SentrySdk) {
      action(SentrySdk);
    }
  });
}

export function initSentry() {
  return ensureSentryInitialized();
}

export const Sentry = {
  captureException(error: unknown, context?: SentryCaptureContext) {
    withSentry((SentrySdk) => {
      SentrySdk.captureException(error, context);
    });
  },
  captureMessage(message: string, level?: SentrySeverityLevel) {
    withSentry((SentrySdk) => {
      SentrySdk.captureMessage(message, level);
    });
  },
  setUser(user: SentryUser) {
    withSentry((SentrySdk) => {
      SentrySdk.setUser(user);
    });
  },
  withScope(callback: SentryScopeCallback) {
    withSentry((SentrySdk) => {
      SentrySdk.withScope(callback);
    });
  },
};

// Type declaration for the build-time version
declare const __APP_VERSION__: string;
