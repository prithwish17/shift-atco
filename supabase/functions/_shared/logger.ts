import { supabase } from './supabase.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Structured logger for Supabase Edge Functions
// Writes to api_call_logs + edge_function_errors + sync_jobs
// Optional Sentry HTTP envelope forwarding (if SENTRY_DSN is set)
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

// ── Sentry HTTP forwarding ──────────────────────────────────────────────────

const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? ''
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

interface ParsedDsn {
  publicKey: string
  host: string
  projectId: string
}

function parseSentryDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn)
    const publicKey = url.username
    const projectId = url.pathname.replace('/', '')
    const host = url.host
    if (!publicKey || !projectId || !host) return null
    return { publicKey, host, projectId }
  } catch {
    return null
  }
}

function isRateLimited(functionName: string): boolean {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(functionName)
  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(functionName, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  if (bucket.count >= RATE_LIMIT_MAX) return true
  bucket.count++
  return false
}

async function forwardToSentry(
  functionName: string,
  error: Error,
  severity: string,
  traceId: string,
  meta?: Record<string, unknown>,
) {
  if (!SENTRY_DSN) return
  const parsed = parseSentryDsn(SENTRY_DSN)
  if (!parsed) return
  if (isRateLimited(functionName)) return

  const eventId = crypto.randomUUID().replace(/-/g, '')
  const timestamp = Date.now() / 1000

  const envelope = [
    JSON.stringify({ event_id: eventId, dsn: SENTRY_DSN }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify({
      event_id: eventId,
      timestamp,
      platform: 'node',
      level: severity === 'fatal' ? 'fatal' : 'error',
      server_name: functionName,
      transaction: functionName,
      tags: { function_name: functionName, trace_id: traceId, runtime: 'deno-edge' },
      exception: {
        values: [{
          type: error.name,
          value: error.message,
          stacktrace: error.stack ? { frames: parseStack(error.stack) } : undefined,
        }],
      },
      extra: meta ?? {},
    }),
  ].join('\n')

  const url = `https://${parsed.host}/api/${parsed.projectId}/envelope/`
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7,sentry_client=shift-edge/1.0,sentry_key=${parsed.publicKey}`,
      },
      body: envelope,
    })
  } catch (e) {
    console.error(`[sentry:${functionName}] Forward failed:`, e)
  }
}

function parseStack(stack: string): Array<{ filename: string; function: string; lineno: number }> {
  return stack
    .split('\n')
    .filter((l) => l.trim().startsWith('at '))
    .slice(0, 10)
    .map((line) => {
      const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/) ??
                    line.match(/at\s+(.+?):(\d+):\d+/)
      if (match && match.length >= 4) {
        return { function: match[1], filename: match[2], lineno: parseInt(match[3], 10) }
      }
      return { function: '<anonymous>', filename: line.trim(), lineno: 0 }
    })
}

export interface LogParams {
  endpoint:          string
  status:            'success' | 'error'
  message:           string
  duration_ms:       number
  triggered_by:      string
  job_name:          string
  records_affected?: number
  // New fields (optional — backward compatible)
  log_level?:        LogLevel
  user_id?:          string
  error_stack?:      string
  metadata?:         Record<string, unknown>
  trace_id?:         string
}

/**
 * Generate a short trace ID for correlating log entries within a single
 * edge function invocation. Call once at the top of your handler.
 */
export function generateTraceId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ts}-${rand}`
}

/**
 * Create a scoped logger for an edge function invocation.
 * Carries function name, trace ID, and start time so each call site
 * only needs to pass the fields specific to that log entry.
 *
 * Usage:
 *   const log = createLogger('process-notification-queue')
 *   await log.info('Started processing', { batch_size: 50 })
 *   await log.complete('success', 'Processed 50 jobs', 50)
 *   // or on error:
 *   await log.captureError(err, { batch_size: 50 })
 */
export function createLogger(functionName: string, triggeredBy = 'pg_cron') {
  const traceId = generateTraceId()
  const startTime = Date.now()
  const endpoint = `/functions/v1/${functionName}`

  return {
    traceId,

    /** Log a structured message at any level */
    async log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
      const now = Date.now()
      try {
        await supabase.from('api_call_logs').insert({
          endpoint,
          method: 'POST',
          status: level === 'error' || level === 'fatal' ? 'error' : 'success',
          message,
          duration_ms: now - startTime,
          triggered_by: triggeredBy,
          job_name: functionName,
          log_level: level,
          trace_id: traceId,
          metadata: meta ?? {},
          records_affected: 0,
        })
      } catch (e) {
        console.error(`[logger:${functionName}] Insert failed:`, e)
      }
    },

    async info(message: string, meta?: Record<string, unknown>) {
      console.log(`[${functionName}] ${message}`)
      await this.log('info', message, meta)
    },

    async warn(message: string, meta?: Record<string, unknown>) {
      console.warn(`[${functionName}] ${message}`)
      await this.log('warn', message, meta)
    },

    /**
     * Capture a caught error — writes to both api_call_logs and edge_function_errors.
     * Does NOT call complete() — call complete() separately if needed.
     */
    async captureError(
      err: unknown,
      meta?: Record<string, unknown>,
      severity: 'warn' | 'error' | 'fatal' = 'error',
    ) {
      const error = err instanceof Error ? err : new Error(String(err))
      const stack = error.stack ?? ''
      const fingerprint = computeFingerprint(functionName, error)

      console.error(`[${functionName}]`, error)

      try {
        await supabase.from('edge_function_errors').insert({
          function_name: functionName,
          error_message: error.message,
          error_stack: stack,
          fingerprint,
          severity,
          trace_id: traceId,
          metadata: meta ?? {},
          request_path: endpoint,
        })
      } catch (e) {
        console.error(`[logger:${functionName}] Error insert failed:`, e)
      }

      // Forward to Sentry (best-effort, rate-limited)
      await forwardToSentry(functionName, error, severity, traceId, meta)
    },

    /**
     * Final log entry: writes success/error to api_call_logs + updates sync_jobs.
     * Call this once at the end of your handler.
     */
    async complete(
      status: 'success' | 'error',
      message: string,
      recordsAffected = 0,
      meta?: Record<string, unknown>,
    ) {
      const durationMs = Date.now() - startTime

      try {
        await supabase.from('api_call_logs').insert({
          endpoint,
          method: 'POST',
          status,
          message,
          duration_ms: durationMs,
          triggered_by: triggeredBy,
          job_name: functionName,
          log_level: status === 'error' ? 'error' : 'info',
          trace_id: traceId,
          records_affected: recordsAffected,
          metadata: meta ?? {},
        })
      } catch (e) {
        console.error(`[logger:${functionName}] Complete insert failed:`, e)
      }

      try {
        await supabase
          .from('sync_jobs')
          .update({
            last_run_at: new Date().toISOString(),
            last_run_status: status,
            updated_at: new Date().toISOString(),
          })
          .eq('job_name', functionName)
      } catch (e) {
        console.error(`[logger:${functionName}] sync_jobs update failed:`, e)
      }
    },
  }
}

/**
 * Compute a stable fingerprint for error grouping.
 * Uses function name + first meaningful line of stack trace.
 */
function computeFingerprint(functionName: string, error: Error): string {
  const firstLine = (error.stack ?? error.message)
    .split('\n')
    .find((l) => l.trim().startsWith('at ') || !l.includes('Error:'))
    ?.trim() ?? error.message

  let hash = 0
  const input = `${functionName}:${firstLine}`
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  return `${functionName}:${Math.abs(hash).toString(36)}`
}


// ─────────────────────────────────────────────────────────────────────────────
// Backward-compatible logApiCall (existing callers keep working)
// ─────────────────────────────────────────────────────────────────────────────

export async function logApiCall(params: LogParams) {
  try {
    await supabase.from('api_call_logs').insert({
      endpoint:         params.endpoint,
      method:           'POST',
      status:           params.status,
      message:          params.message,
      duration_ms:      params.duration_ms,
      triggered_by:     params.triggered_by,
      job_name:         params.job_name,
      records_affected: params.records_affected ?? 0,
      log_level:        params.log_level ?? (params.status === 'error' ? 'error' : 'info'),
      user_id:          params.user_id ?? null,
      error_stack:      params.error_stack ?? null,
      metadata:         params.metadata ?? {},
      trace_id:         params.trace_id ?? null,
    })
  } catch (e) {
    console.error('[logger] Failed to insert api_call_logs:', e)
  }

  try {
    await supabase
      .from('sync_jobs')
      .update({
        last_run_at:     new Date().toISOString(),
        last_run_status: params.status,
        updated_at:      new Date().toISOString(),
      })
      .eq('job_name', params.job_name)
  } catch (e) {
    console.error('[logger] Failed to update sync_jobs:', e)
  }
}
