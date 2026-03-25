import { supabase } from '../_shared/supabase.ts'
import { logApiCall } from '../_shared/logger.ts'
import { notifyUsers } from '../_shared/notify.ts'

const JOB_NAME = 'check-ope-reminders'
const ENDPOINT = '/functions/v1/check-ope-reminders'

const OPE_CODES = [
  'M+A', 'NO+N', 'SAT+NO', 'SUN+N', 'SUN+M', 'SUN+A',
  'SUN+NO', 'SAT+N', 'CO+N', 'CO+A', 'CO+M', 'A+M',
]

const ALERT_DAYS = [3, 1]

function addDays(date: Date, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

Deno.serve(async (_req) => {
  const start = Date.now()
  let status: 'success' | 'error' = 'success'
  let message = ''
  let total = 0

  try {
    const today = new Date()

    for (const daysAhead of ALERT_DAYS) {
      const targetDate = addDays(today, daysAhead)

      // Fetch schedules with OPE codes on the target date
      const { data: schedules, error: schedError } = await supabase
        .from('employee_schedules')
        .select('employee_code, employee_name, duty_code')
        .eq('duty_date', targetDate)
        .in('duty_code', OPE_CODES)

      if (schedError) throw schedError
      if (!schedules?.length) continue

      // Gather unique employee_codes
      const empCodes = [...new Set(schedules.map((s: any) => s.employee_code))]

      // Map employee_code → user_id via profiles table
      const { data: profiles, error: profError } = await supabase
        .from('profiles')
        .select('id, employee_id')
        .in('employee_id', empCodes)

      if (profError) throw profError
      const codeToUserId = new Map<string, string>()
      for (const p of (profiles || []) as any[]) {
        if (p.employee_id && p.id) codeToUserId.set(p.employee_id, p.id)
      }

      // Group by employee and send notifications
      for (const sched of schedules as any[]) {
        const userId = codeToUserId.get(sched.employee_code)
        if (!userId) continue

        const label = daysAhead === 1 ? 'tomorrow' : `in ${daysAhead} days`

        await notifyUsers({
          user_ids: [userId],
          title: 'OPE Duty Reminder',
          body: `You have ${sched.duty_code} extra duty on ${formatDate(targetDate)} (${label}).`,
          url: '/employee',
          category: 'ope_reminder',
          metadata: {
            duty_code: sched.duty_code,
            duty_date: targetDate,
            days_ahead: daysAhead,
          },
        })
        total++
      }
    }

    message = `Sent ${total} OPE reminder(s)`
  } catch (err) {
    status = 'error'
    message = (err as Error).message
    console.error('[check-ope-reminders]', err)
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
