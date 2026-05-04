import { supabase } from '../_shared/supabase.ts'
import { logApiCall } from '../_shared/logger.ts'

const JOB_NAME = 'sync-leave-records'
const ENDPOINT = '/functions/v1/sync-leave-records'

Deno.serve(async (req) => {
  const start = Date.now()
  let status: 'success' | 'error' = 'success'
  let message = ''
  let recordsAffected = 0

  try {
    const body   = await req.json().catch(() => ({}))
    const source = (body.source ?? 'google_sheets') as string

    // Resolve the Apps Script webhook URL: prefer env var, fall back to app_settings
    let webhookUrl = Deno.env.get('SHEETS_WEBHOOK_URL') ?? ''
    if (!webhookUrl) {
      const { data: setting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'leave_data_webapp_url')
        .single()
      webhookUrl = setting?.value ?? ''
    }
    if (!webhookUrl) throw new Error('SHEETS_WEBHOOK_URL not configured')

    const sheetRes = await fetch(webhookUrl, {
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
    })
    if (!sheetRes.ok) throw new Error(`Sheets fetch failed: ${sheetRes.status}`)

    const json = await sheetRes.json()
    const raw: any[] = Array.isArray(json) ? json : json?.data
    if (!Array.isArray(raw)) throw new Error('Unexpected response format: expected array')

    const batchId = new Date().toISOString()

    const records = raw.map((row) => ({
      emp_id:             row.emp_id,
      employee_name:      row.employee_name,
      sl_no:              row.sl_no              ?? null,
      status:             row.status             ?? null,
      leave_category:     row.leave_category,
      leave_date:         row.leave_date,            // 'YYYY-MM-DD'
      source,
      source_event_type:  row.event_type          ?? '',
      event_kind:         row.event_kind          ?? 'other',
      duty_code:          row.duty_code           ?? '',
      raw_date_value:     row.raw_date            ?? null,
      raw_shift_value:    row.raw_shift           ?? null,
      raw_event:          row,
      sync_batch_id:      batchId,
      metadata:           row.metadata            ?? {},
    }))

    const { error, count } = await supabase
      .from('employee_leave_records')
      .upsert(records, {
        onConflict:       'emp_id,leave_category,source_event_type,leave_date,duty_code',
        ignoreDuplicates: false,
        count:            'exact',
      })

    if (error) throw error
    recordsAffected = count ?? records.length
    message = `Synced ${recordsAffected} leave records from ${source}`

  } catch (err) {
    status  = 'error'
    message = (err as Error).message
    console.error('[sync-leave-records]', err)
  }

  await logApiCall({
    endpoint:         ENDPOINT,
    status,
    message,
    duration_ms:      Date.now() - start,
    triggered_by:     'pg_cron',
    job_name:         JOB_NAME,
    records_affected: recordsAffected,
  })

  return new Response(JSON.stringify({ status, message, recordsAffected }), {
    headers: { 'Content-Type': 'application/json' },
    status:  status === 'error' ? 500 : 200,
  })
})
