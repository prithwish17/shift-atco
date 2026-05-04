/**
 * Notification queue helper — enqueues jobs into notification_queue with dedup.
 * Used by detection functions and notifyUsers() to schedule email delivery.
 */

import { supabase } from './supabase.ts'

export interface EnqueueParams {
  userId: string
  channel: 'email' | 'push' | 'in_app'
  eventType: string
  priority?: number // 1-10, default 5
  payload: Record<string, unknown>
  idempotencyKey?: string
  dedupWindowMinutes?: number // default 60
}

/**
 * Compute a simple content hash for deduplication.
 * Uses userId + eventType + sorted JSON of key payload fields.
 */
function computeContentHash(userId: string, eventType: string, payload: Record<string, unknown>): string {
  const core = JSON.stringify({ u: userId, e: eventType, t: payload.title, b: payload.body })
  // Simple hash using built-in — not cryptographic, just for dedup matching
  let hash = 0
  for (let i = 0; i < core.length; i++) {
    const chr = core.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return `${eventType}:${Math.abs(hash).toString(36)}`
}

/**
 * Check if a similar notification was already sent within the dedup window.
 */
async function isDuplicate(
  userId: string,
  contentHash: string,
  windowMinutes: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString()

  const { data, error } = await supabase
    .from('notification_queue')
    .select('id')
    .eq('user_id', userId)
    .eq('content_hash', contentHash)
    .gte('created_at', cutoff)
    .in('status', ['pending', 'processing', 'sent'])
    .limit(1)

  if (error) {
    console.warn('[enqueue] Dedup check failed:', error.message)
    return false // fail open — allow the notification
  }

  return (data?.length ?? 0) > 0
}

/**
 * Check user notification preferences for the given event type + channel.
 * Returns true if the user has NOT opted out.
 */
async function isChannelEnabled(
  userId: string,
  eventType: string,
  channel: 'email' | 'push' | 'in_app',
): Promise<boolean> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select(channel)
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .single()

  if (error || !data) return true // default = enabled if no preference row

  return (data as Record<string, boolean>)[channel] !== false
}

/**
 * Enqueue a notification job. Handles dedup + preference checks.
 * Returns the queue row ID if enqueued, null if skipped (dedup/preference/paused).
 */
export async function enqueueNotification(params: EnqueueParams): Promise<string | null> {
  const {
    userId,
    channel,
    eventType,
    priority = 5,
    payload,
    idempotencyKey,
    dedupWindowMinutes = 60,
  } = params

  // 0. Check global email system toggle (admin can pause all non-auth emails)
  if (channel === 'email') {
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'email_system_enabled')
      .single()
    if (setting?.value === 'false') {
      console.log(`[enqueue] Email system paused — discarding ${eventType} for user ${userId}`)
      return null
    }
  }

  // 1. Check user preference
  const enabled = await isChannelEnabled(userId, eventType, channel)
  if (!enabled) {
    console.log(`[enqueue] Skipping ${channel}/${eventType} for user ${userId} — opted out`)
    return null
  }

  // 2. Content-hash dedup
  const contentHash = computeContentHash(userId, eventType, payload)
  const dup = await isDuplicate(userId, contentHash, dedupWindowMinutes)
  if (dup) {
    console.log(`[enqueue] Skipping duplicate ${channel}/${eventType} for user ${userId}`)
    return null
  }

  // 3. Idempotency key dedup (hard dedup — regardless of time window)
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('notification_queue')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .limit(1)

    if (existing?.length) {
      console.log(`[enqueue] Skipping — idempotency key exists: ${idempotencyKey}`)
      return null
    }
  }

  // 4. Insert into queue
  const { data, error } = await supabase
    .from('notification_queue')
    .insert({
      user_id: userId,
      channel,
      event_type: eventType,
      priority,
      payload,
      idempotency_key: idempotencyKey || null,
      content_hash: contentHash,
      next_attempt_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    // Could be idempotency_key UNIQUE violation — safe to ignore
    if (error.code === '23505') {
      console.log(`[enqueue] Unique constraint hit — skipping duplicate`)
      return null
    }
    console.error(`[enqueue] Insert failed:`, error.message)
    return null
  }

  return data?.id ?? null
}

/**
 * Batch enqueue email notifications for multiple users.
 * Convenience wrapper for detection functions.
 */
export async function enqueueEmailsForUsers(params: {
  userIds: string[]
  eventType: string
  priority?: number
  payloadFactory: (userId: string) => Record<string, unknown>
  dedupWindowMinutes?: number
}): Promise<number> {
  const { userIds, eventType, priority, payloadFactory, dedupWindowMinutes } = params
  let enqueued = 0

  for (const userId of [...new Set(userIds)]) {
    const id = await enqueueNotification({
      userId,
      channel: 'email',
      eventType,
      priority,
      payload: payloadFactory(userId),
      dedupWindowMinutes,
    })
    if (id) enqueued++
  }

  return enqueued
}
