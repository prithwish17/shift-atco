/**
 * Queue Processor — dequeues pending notification jobs and delivers them.
 * Runs every 2 minutes via pg_cron.
 *
 * Processing strategy:
 *   - FOR UPDATE SKIP LOCKED on pending/failed jobs past their next_attempt_at
 *   - Batch size: 50 per invocation
 *   - Email: uses _shared/email.ts (Resend/Brevo failover)
 *   - Push: uses _shared/notify.ts (already handled at enqueue time — skip here)
 *   - Retry: exponential backoff (2^attempts * 30s, capped at 1 hour)
 *   - Dead letter: after max_attempts exhausted
 */

declare const Deno: any

import { supabase } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'
import { sendEmail, checkDailyBudget, incrementDailyCount } from '../_shared/email.ts'
import {
  leaveStatusEmail,
  leaveRequestEmail,
  dutyExchangeEmail,
  opeReminderEmail,
  expiryAlertEmail,
  expiredLicenseEmail,
  compOffExpiryEmail,
  expiredCompOffEmail,
  dutyChangeEmail,
  genericEmail,
} from '../_shared/emailTemplates.ts'

const BATCH_SIZE = 50
const MAX_BACKOFF_MS = 60 * 60 * 1000 // 1 hour

interface QueueJob {
  id: string
  user_id: string
  channel: string
  event_type: string
  priority: number
  payload: Record<string, any>
  attempts: number
  max_attempts: number
}

/** Compute next retry time with exponential backoff */
function nextRetryAt(attempts: number): string {
  const delayMs = Math.min(Math.pow(2, attempts) * 30_000, MAX_BACKOFF_MS)
  return new Date(Date.now() + delayMs).toISOString()
}

/** Resolve user email from profiles or auth.users */
async function getUserEmail(userId: string): Promise<string | null> {
  // Try profiles.email first
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .single()

  if (profile?.email) return profile.email

  // Fallback: auth.users (service role can query this)
  const { data: authUser } = await supabase.auth.admin.getUserById(userId)
  return authUser?.user?.email ?? null
}

/** Resolve user display name */
async function getUserName(userId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single()
  return (data as any)?.full_name || 'User'
}

/** Render email subject + HTML from queue job */
function renderEmail(
  job: QueueJob,
  userName: string,
): { subject: string; html: string } | null {
  const p = job.payload
  const appUrl = Deno.env.get('APP_URL') || 'https://atcora.in'
  const templateData = p.templateData as Record<string, any> || {}

  switch (p.template || job.event_type) {
    case 'leave_status':
      return leaveStatusEmail({
        employeeName: userName,
        leaveType: templateData.leave_type || p.metadata?.leave_type || 'Leave',
        startDate: templateData.start_date || p.metadata?.start_date || '',
        endDate: templateData.end_date || p.metadata?.end_date || '',
        status: templateData.status || p.metadata?.status || 'Approved',
        remarks: templateData.remarks,
        appUrl,
      })

    case 'leave_request':
      return leaveRequestEmail({
        approverName: templateData.approver_name || userName,
        employeeName: templateData.employee_name || 'Employee',
        leaveType: templateData.leave_type || 'Leave',
        startDate: templateData.start_date || '',
        endDate: templateData.end_date || '',
        reason: templateData.reason,
        appUrl,
      })

    case 'duty_exchange':
      return dutyExchangeEmail({
        employeeName: userName,
        partnerName: templateData.partner_name || p.metadata?.partner_name || 'Partner',
        dutyDate: templateData.duty_date || p.metadata?.duty_date || '',
        status: templateData.status || 'Approved',
        appUrl,
      })

    case 'ope_reminder':
      return opeReminderEmail({
        employeeName: userName,
        dutyCode: templateData.duty_code || p.metadata?.duty_code || '',
        dutyDate: templateData.duty_date || p.metadata?.duty_date || '',
        daysAhead: templateData.days_ahead || p.metadata?.days_ahead || 0,
        appUrl,
      })

    case 'license_expiry':
      return expiryAlertEmail({
        employeeName: userName,
        itemType: templateData.item_type || p.metadata?.item_type || p.metadata?.type || 'License',
        expiryDate: templateData.expiry_date || p.metadata?.expiry_date || '',
        daysUntil: templateData.days_until ?? p.metadata?.days_until ?? 0,
        appUrl,
      })

    case 'license_expired':
      return expiredLicenseEmail({
        employeeName: userName,
        itemType: templateData.item_type || p.metadata?.item_type || p.metadata?.type || 'License',
        expiryDate: templateData.expiry_date || p.metadata?.expiry_date || '',
        appUrl,
      })

    case 'compoff_expiry':
      return compOffExpiryEmail({
        employeeName: userName,
        dutyDate: templateData.duty_date || p.metadata?.duty_date,
        expiryDate: templateData.expiry_date || p.metadata?.expiry_date || '',
        daysAhead: templateData.days_ahead ?? p.metadata?.days_ahead ?? 0,
        appUrl,
      })

    case 'compoff_expired':
      return expiredCompOffEmail({
        employeeName: userName,
        dutyDate: templateData.duty_date || p.metadata?.duty_date,
        expiryDate: templateData.expiry_date || p.metadata?.expiry_date || '',
        appUrl,
      })

    case 'duty_change':
      return dutyChangeEmail({
        employeeName: userName,
        dutyDate: templateData.duty_date || p.metadata?.duty_date || '',
        oldDutyCode: templateData.old_duty_code || p.metadata?.old_duty_code || '',
        newDutyCode: templateData.new_duty_code || p.metadata?.new_duty_code || '',
        appUrl,
      })

    default:
      return genericEmail({
        title: p.title || job.event_type,
        body: p.body || '',
        ctaUrl: p.url ? `${appUrl}${p.url}` : undefined,
      })
  }
}

Deno.serve(async (_req: Request) => {
  const log = createLogger('process-notification-queue', 'pg_cron')
  let status: 'success' | 'error' = 'success'
  let message = ''
  let processed = 0
  let succeeded = 0
  let failed = 0
  let skipped = 0

  try {
    // 0. Check if email system is globally paused by admin
    const { data: emailToggle } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'email_system_enabled')
      .single()

    if (emailToggle?.value === 'false') {
      message = 'Email system paused by admin — skipping queue processing'
      status = 'success'
      await log.complete(status, message, 0)
      return new Response(JSON.stringify({ status, message }), { headers: { 'Content-Type': 'application/json' } })
    }

    // 1. Recover stale jobs first
    await supabase.rpc('recover_stale_notification_jobs')

    // 2. Claim a batch of pending jobs (FOR UPDATE SKIP LOCKED via RPC or direct query)
    const now = new Date().toISOString()
    const { data: jobs, error: fetchError } = await supabase
      .from('notification_queue')
      .select('id, user_id, channel, event_type, priority, payload, attempts, max_attempts')
      .in('status', ['pending', 'failed'])
      .lte('next_attempt_at', now)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (fetchError) throw fetchError
    if (!jobs?.length) {
      message = 'No pending jobs'
      await log.complete(status, message, 0)
      return new Response(JSON.stringify({ status, message }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Mark all claimed jobs as processing
    const jobIds = (jobs as QueueJob[]).map(j => j.id)
    await supabase
      .from('notification_queue')
      .update({ status: 'processing', processed_at: now })
      .in('id', jobIds)

    // 3. Process each job
    for (const job of jobs as QueueJob[]) {
      processed++

      // Only handle email channel — push/in_app are handled synchronously in notifyUsers
      if (job.channel !== 'email') {
        await supabase.from('notification_queue').update({ status: 'sent', processed_at: new Date().toISOString() }).eq('id', job.id)
        succeeded++
        continue
      }

      // Budget guard
      if (!checkDailyBudget(300)) {
        console.warn(`[queue] Daily email budget exhausted — skipping ${job.id}`)
        await supabase.from('notification_queue').update({
          status: 'pending',
          next_attempt_at: new Date(Date.now() + 3600_000).toISOString(),
          last_error: 'Daily budget exhausted — deferred',
        }).eq('id', job.id)
        skipped++
        continue
      }

      try {
        // Resolve email address
        const email = await getUserEmail(job.user_id)
        if (!email) {
          console.warn(`[queue] No email for user ${job.user_id} — marking sent (no-op)`)
          await supabase.from('notification_queue').update({
            status: 'sent',
            processed_at: new Date().toISOString(),
            last_error: 'No email address on file',
          }).eq('id', job.id)
          succeeded++
          continue
        }

        // Render template
        const userName = await getUserName(job.user_id)
        const rendered = renderEmail(job, userName)
        if (!rendered) {
          await supabase.from('notification_queue').update({
            status: 'sent',
            processed_at: new Date().toISOString(),
            last_error: 'No template matched — skipped',
          }).eq('id', job.id)
          succeeded++
          continue
        }

        // Send email
        const result = await sendEmail({
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          priority: job.priority,
        })

        if (result.success) {
          incrementDailyCount()

          // Log to email_logs
          await supabase.from('email_logs').insert({
            queue_id: job.id,
            user_id: job.user_id,
            email_to: email,
            subject: rendered.subject,
            event_type: job.event_type,
            provider: result.provider,
            provider_id: result.messageId,
            status: 'sent',
          })

          await supabase.from('notification_queue').update({
            status: 'sent',
            provider: result.provider,
            processed_at: new Date().toISOString(),
          }).eq('id', job.id)

          succeeded++
        } else {
          throw new Error(result.error || 'Email send failed')
        }
      } catch (err) {
        const errorMsg = (err as Error).message
        const newAttempts = job.attempts + 1
        const isDead = newAttempts >= job.max_attempts

        await supabase.from('notification_queue').update({
          status: isDead ? 'dead_letter' : 'failed',
          attempts: newAttempts,
          last_error: errorMsg,
          next_attempt_at: isDead ? undefined : nextRetryAt(newAttempts),
          processed_at: new Date().toISOString(),
        }).eq('id', job.id)

        // Log failed attempt
        const email = await getUserEmail(job.user_id)
        if (email) {
          await supabase.from('email_logs').insert({
            queue_id: job.id,
            user_id: job.user_id,
            email_to: email,
            subject: job.payload?.title || job.event_type,
            event_type: job.event_type,
            provider: 'resend', // last attempted
            status: 'failed',
            error_message: errorMsg,
          }).catch(() => {}) // best-effort logging
        }

        failed++
        console.error(`[queue] Job ${job.id} failed (attempt ${newAttempts}/${job.max_attempts}):`, errorMsg)
      }
    }

    message = `Processed ${processed}: ${succeeded} sent, ${failed} failed, ${skipped} deferred`
  } catch (err) {
    status = 'error'
    message = (err as Error).message
    await log.captureError(err, { processed, succeeded, failed, skipped })
  }

  await log.complete(status, message, processed, { succeeded, failed, skipped })

  return new Response(JSON.stringify({ status, message, processed, succeeded, failed, skipped }), {
    headers: { 'Content-Type': 'application/json' },
    status: status === 'error' ? 500 : 200,
  })
})
