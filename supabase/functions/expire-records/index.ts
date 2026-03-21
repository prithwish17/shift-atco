import { supabase } from '../_shared/supabase.ts'
import { logApiCall } from '../_shared/logger.ts'

const JOB_NAME = 'expire-records'
const ENDPOINT = '/functions/v1/expire-records'

Deno.serve(async (_req) => {
  const start = Date.now()
  let status: 'success' | 'error' = 'success'
  let message = ''
  let total   = 0

  try {
    const today = new Date().toISOString().split('T')[0]

    const tasks = [
      supabase.from('comp_off_ledger')
        .update({ status: 'expired' }, { count: 'exact' })
        .eq('status', 'available').lt('expiry_date', today),

      supabase.from('employee_licenses')
        .update({ status: 'expired' }, { count: 'exact' })
        .eq('status', 'valid').lt('expiry_date', today),

      supabase.from('unit_endorsements')
        .update({ status: 'expired' }, { count: 'exact' })
        .eq('status', 'valid').lt('expiry_date', today),

      supabase.from('medical_certificates')
        .update({ status: 'expired' }, { count: 'exact' })
        .eq('status', 'valid').lt('expiry_date', today),
    ]

    const results = await Promise.all(tasks)
    const errors  = results.filter((r) => r.error).map((r) => r.error!.message)

    if (errors.length) throw new Error(errors.join('; '))

    const counts = results.map((r) => r.count ?? 0)
    total = counts.reduce((a, b) => a + b, 0)
    message = [
      `comp_off=${counts[0]}`,
      `licenses=${counts[1]}`,
      `endorsements=${counts[2]}`,
      `medicals=${counts[3]}`,
    ].join(', ')

  } catch (err) {
    status  = 'error'
    message = (err as Error).message
    console.error('[expire-records]', err)
  }

  await logApiCall({
    endpoint:         ENDPOINT,
    status,
    message,
    duration_ms:      Date.now() - start,
    triggered_by:     'pg_cron',
    job_name:         JOB_NAME,
    records_affected: total,
  })

  return new Response(JSON.stringify({ status, message, total }), {
    headers: { 'Content-Type': 'application/json' },
    status:  status === 'error' ? 500 : 200,
  })
})
