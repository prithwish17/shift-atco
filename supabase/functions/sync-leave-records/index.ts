import { logApiCall } from '../_shared/logger.ts'

const JOB_NAME = 'sync-leave-records'
const ENDPOINT = '/functions/v1/sync-leave-records'

/**
 * Retired. This read the same Apps Script feed as fetch-leave-data but expected
 * flat rows the feed never sends, so it failed on every run; had it ever
 * succeeded it would have upserted straight into the register, bypassing the
 * staged sync and its guards.
 *
 * The leave register is synced by fetch-leave-data only — see
 * docs/leave/SHEET_INDEPENDENCE.md. Its cron job is unscheduled by
 * supabase/migrations/20261005100000_leave_sheet_sources_and_safe_sync.sql;
 * this stub stays so a stray caller gets a clear answer instead of a 404.
 */
Deno.serve(async () => {
  const message = 'sync-leave-records is retired; the leave register is synced by fetch-leave-data'

  await logApiCall({
    endpoint:         ENDPOINT,
    status:           'error',
    message,
    duration_ms:      0,
    triggered_by:     'unknown',
    job_name:         JOB_NAME,
    records_affected: 0,
  })

  return new Response(JSON.stringify({ status: 'gone', message }), {
    headers: { 'Content-Type': 'application/json' },
    status:  410,
  })
})
