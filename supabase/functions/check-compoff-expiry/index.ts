import { supabase } from '../_shared/supabase.ts'
import { logApiCall } from '../_shared/logger.ts'
import { notifyUsers } from '../_shared/notify.ts'

const JOB_NAME = 'check-compoff-expiry'
const ENDPOINT = '/functions/v1/check-compoff-expiry'

const ALERT_DAYS = [30, 15]

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

      // comp_off_ledger.employee_id is UUID (auth.users.id)
      const { data: entries, error } = await supabase
        .from('comp_off_ledger')
        .select('employee_id, duty_date, expiry_date')
        .eq('status', 'available')
        .eq('expiry_date', targetDate)

      if (error) throw error
      if (!entries?.length) continue

      for (const entry of entries as any[]) {
        if (!entry.employee_id) continue

        await notifyUsers({
          user_ids: [entry.employee_id],
          title: 'Comp-Off Expiry Alert',
          body: `Your comp-off${entry.duty_date ? ' earned on ' + formatDate(entry.duty_date) : ''} expires in ${daysAhead} days (${formatDate(targetDate)}).`,
          url: '/employee/comp-off',
          category: 'compoff_expiry',
          metadata: {
            duty_date: entry.duty_date,
            expiry_date: entry.expiry_date,
            days_ahead: daysAhead,
          },
        })
        total++
      }
    }

    message = `Sent ${total} comp-off expiry alert(s)`
  } catch (err) {
    status = 'error'
    message = (err as Error).message
    console.error('[check-compoff-expiry]', err)
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
