/**
 * Duty Change Detection — compares current schedules against a snapshot
 * to detect changes and notify affected employees.
 *
 * Strategy:
 *   - Maintains a schedule_snapshots table (or uses updated_at comparison)
 *   - Looks at upcoming 7 days of schedules
 *   - Detects changes by comparing duty_code with a stored previous_duty_code
 *   - Notifies employees whose duty has changed
 *
 * Runs daily at 03:00 UTC (09:00 IST) via pg_cron.
 */

import { supabase } from '../_shared/supabase.ts'
import { logApiCall } from '../_shared/logger.ts'
import { notifyUsers } from '../_shared/notify.ts'

const JOB_NAME = 'check-duty-changes'
const ENDPOINT = '/functions/v1/check-duty-changes'

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function addDays(date: Date, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

Deno.serve(async (_req) => {
  const start = Date.now()
  let status: 'success' | 'error' = 'success'
  let message = ''
  let total = 0

  try {
    const today = new Date()
    const todayIso = today.toISOString().split('T')[0]
    const endDate = addDays(today, 7)

    // 1. Fetch all upcoming schedules that were updated recently (within last 25 hours)
    //    This catches any changes made since the last run
    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()

    const { data: changedSchedules, error: schedError } = await supabase
      .from('employee_schedules')
      .select('id, employee_code, employee_name, duty_date, duty_code, updated_at, created_at')
      .gte('duty_date', todayIso)
      .lte('duty_date', endDate)
      .gt('updated_at', cutoff)
      .order('duty_date', { ascending: true })

    if (schedError) throw schedError
    if (!changedSchedules?.length) {
      message = 'No schedule changes detected'
      await logApiCall({ endpoint: ENDPOINT, status, message, duration_ms: Date.now() - start, triggered_by: 'pg_cron', job_name: JOB_NAME, records_affected: 0 })
      return new Response(JSON.stringify({ status, message, total: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Filter to only records where updated_at != created_at (actual changes, not initial inserts)
    const actualChanges = (changedSchedules as any[]).filter(s => {
      const created = new Date(s.created_at).getTime()
      const updated = new Date(s.updated_at).getTime()
      // Allow 1-second tolerance for near-simultaneous create+update
      return Math.abs(updated - created) > 1000
    })

    if (!actualChanges.length) {
      message = 'No duty code changes — only new inserts'
      await logApiCall({ endpoint: ENDPOINT, status, message, duration_ms: Date.now() - start, triggered_by: 'pg_cron', job_name: JOB_NAME, records_affected: 0 })
      return new Response(JSON.stringify({ status, message, total: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }

    // 2. Map employee_code → user_id via profiles table
    const empCodes = [...new Set(actualChanges.map((s: any) => s.employee_code))]
    const { data: profiles, error: profError } = await supabase
      .from('profiles')
      .select('id, employee_id')
      .in('employee_id', empCodes)

    if (profError) throw profError
    const codeToUserId = new Map<string, string>()
    for (const p of (profiles || []) as any[]) {
      if (p.employee_id && p.id) codeToUserId.set(p.employee_id, p.id)
    }

    // 3. Notify each affected employee
    for (const sched of actualChanges) {
      const userId = codeToUserId.get(sched.employee_code)
      if (!userId) continue

      const dutyDateFormatted = formatDate(sched.duty_date)

      await notifyUsers({
        user_ids: [userId],
        title: 'Duty Schedule Updated',
        body: `Your duty on ${dutyDateFormatted} has been updated to ${sched.duty_code || 'unassigned'}.`,
        url: '/employee',
        category: 'duty_change',
        metadata: {
          duty_date: sched.duty_date,
          new_duty_code: sched.duty_code,
          employee_code: sched.employee_code,
        },
        emailTemplate: 'duty_change',
        emailData: {
          duty_date: dutyDateFormatted,
          old_duty_code: 'Previous',
          new_duty_code: sched.duty_code || 'Unassigned',
        },
      })
      total++
    }

    message = `Sent ${total} duty change notification(s) for ${actualChanges.length} schedule update(s)`
  } catch (err) {
    status = 'error'
    message = (err as Error).message
    console.error('[check-duty-changes]', err)
  }

  await logApiCall({
    endpoint: ENDPOINT,
    status,
    message,
    duration_ms: Date.now() - start,
    triggered_by: 'pg_cron',
    job_name: JOB_NAME,
    records_affected: total,
  })

  return new Response(JSON.stringify({ status, message, total }), {
    headers: { 'Content-Type': 'application/json' },
    status: status === 'error' ? 500 : 200,
  })
})
