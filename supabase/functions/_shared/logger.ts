import { supabase } from './supabase.ts'

interface LogParams {
  endpoint:          string
  status:            'success' | 'error'
  message:           string
  duration_ms:       number
  triggered_by:      string
  job_name:          string
  records_affected?: number
}

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
