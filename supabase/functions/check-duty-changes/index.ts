/**
 * Duty Change Detection — standalone duty change notifications are disabled.
 *
 * Duty-change email/notification delivery now happens only at final supervisor
 * approval time inside the duty exchange approval flow, where the app can send
 * personalized previous -> new duty details to each participant.
 *
 * Runs daily at 03:00 UTC (09:00 IST) via pg_cron.
 */

import { supabase } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

Deno.serve(async (_req) => {
  const log = createLogger('check-duty-changes', 'pg_cron')
  let status: 'success' | 'error' = 'success'
  let message = ''
  let total = 0

  try {
    // 1. Fetch duty exchanges approved/completed within the last 25 hours
    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()

    const { data: approvedExchanges, error: exchError } = await supabase
      .from('duty_exchanges')
      .select('id, requesting_user_id, exchange_partner_id, requesting_user_shift_id, exchange_partner_shift_id, duty_date, status, updated_at')
      .in('status', ['approved', 'completed'])
      .gt('updated_at', cutoff)
      .order('updated_at', { ascending: false })

    if (exchError) throw exchError
    if (!approvedExchanges?.length) {
      message = 'No recently approved duty exchanges'
      await log.complete(status, message, 0)
      return new Response(JSON.stringify({ status, message, total: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }

    message = `Standalone duty change notifications are disabled; ${approvedExchanges.length} approved exchange(s) observed`
  } catch (err) {
    status = 'error'
    message = (err as Error).message
    await log.captureError(err)
  }

  await log.complete(status, message, total)

  return new Response(JSON.stringify({ status, message, total }), {
    headers: { 'Content-Type': 'application/json' },
    status: status === 'error' ? 500 : 200,
  })
})
