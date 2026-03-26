import { supabase } from '../_shared/supabase.ts'
import { logApiCall } from '../_shared/logger.ts'

const ENDPOINT  = '/functions/v1/sync-roster'
const ALL_TEAMS = ['A', 'B', 'C', 'D']

// Same fallback URL used by fetch-roster (manual fetch)
const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycby0ZL9nspDkRuln1JRpr8llBRaNxvaO9Zo1X6zMg89i_inQSeDBJd6EyQE9Wj6dhQ-S1Q/exec'

type RosterRecord = {
  date:          string
  shift:         string
  team:          string
  unit:          string
  employee_name: string
  position:      string
}

// Normalise shift values to title-case ("NIGHT" → "Night") so queries
// and the frontend work consistently regardless of the API's casing.
const normaliseShift = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s

// ── Date helpers (IST = UTC + 5:30) ──────────────────────────────────────────

function getISTDateString(offsetDays = 0): string {
  const now = new Date()
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
  ist.setUTCDate(ist.getUTCDate() + offsetDays)
  return ist.toISOString().split('T')[0]
}

function getTargetDate(shift: string): string {
  const nowUTC  = new Date()
  const istHour = Math.floor((nowUTC.getUTCHours() * 60 + nowUTC.getUTCMinutes() + 330) / 60) % 24
  if (shift === 'Morning' && istHour >= 18 && istHour <= 23) {
    return getISTDateString(1)
  }
  return getISTDateString(0)
}

// Derive the sync_jobs job_name from shift + current IST hour
function deriveJobName(shift: string): string {
  const nowUTC  = new Date()
  const istHour = Math.floor((nowUTC.getUTCHours() * 60 + nowUTC.getUTCMinutes() + 330) / 60) % 24
  const paddedHour = String(istHour).padStart(2, '0')
  return `roster-${shift.toLowerCase()}-${paddedHour}h`
}

// ── Per-team fetch ────────────────────────────────────────────────────────────

async function fetchTeamRoster(
  rosterUrl: string,
  shift: string,
  team: string,
  date: string,
): Promise<RosterRecord[]> {
  const url = new URL(rosterUrl)
  url.searchParams.set('shift', shift)
  url.searchParams.set('team',  team)
  url.searchParams.set('date',  date)

  const res = await fetch(url.toString(), {
    method:   'GET',
    redirect: 'follow',
    headers:  { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const raw: any[] = await res.json()

  return raw.map((row) => {
    // Strip designation suffixes from employee name (matches fetch-roster logic)
    let empName = (row.employee_name ?? row.name ?? '').split('/')[0].trim()
    empName = empName.replace(/-(SM|DGM|MGR|JE|AM|AGM)$/i, '').trim()
    empName = empName.replace(/-+$/, '').trim()

    const unit = (row.unit ?? '').toUpperCase().trim() === 'HQ' ? 'WSO' : (row.unit ?? '')

    // IMPORTANT: Use the date/shift/team values returned by Google Apps Script,
    // NOT our computed values. This ensures the same format as fetch-roster
    // (manual fetch), so the frontend can query both consistently.
    return {
      date:          row.date || date,
      shift:         normaliseShift(row.shift || shift),
      team:          row.team || team,
      unit,
      employee_name: empName,
      position:      row.position ?? row.mark ?? row.remark ?? row.half ?? '',
    }
  })
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const start = Date.now()
  let status: 'success' | 'error' = 'success'
  let message   = ''
  let totalRows = 0

  const body  = await req.json().catch(() => ({}))
  const shift: string = body.shift ?? 'Morning'

  try {
    const targetDate    = getTargetDate(shift)

    console.log(`[sync-roster] shift=${shift} targetDate=${targetDate}`)

    // Resolve roster URL: env var first, then app_settings, then hardcoded default
    let rosterUrl = Deno.env.get('ROSTER_SHEETS_URL') ?? ''
    if (!rosterUrl) {
      const { data: setting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'roster_webapp_url')
        .single()
      rosterUrl = setting?.value ?? ''
    }
    if (!rosterUrl) {
      rosterUrl = DEFAULT_APPS_SCRIPT_URL
    }

    // Fetch all teams in parallel
    const results = await Promise.allSettled(
      ALL_TEAMS.map((team) => fetchTeamRoster(rosterUrl, shift, team, targetDate))
    )

    const allRecords: RosterRecord[] = []
    const errors: string[] = []

    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        allRecords.push(...result.value)
      } else {
        errors.push(`Team ${ALL_TEAMS[i]}: ${(result.reason as Error).message}`)
      }
    }

    if (errors.length === ALL_TEAMS.length) {
      throw new Error('All team fetches failed: ' + errors.join('; '))
    }

    if (allRecords.length > 0) {
      // Delete stale entries per unique (date, shift, team) combo from fetched data.
      // This matches fetch-roster's delete pattern and ensures correct format matching.
      const combos = new Set<string>()
      allRecords.forEach(r => combos.add(`${r.date}|${r.shift}|${r.team}`))

      for (const combo of combos) {
        const [d, s, t] = combo.split('|')
        const { error: delErr } = await supabase
          .from('rosters')
          .delete()
          .eq('date', d)
          .eq('shift', s)
          .eq('team', t)
        if (delErr) console.error(`[sync-roster] Delete error for ${combo}:`, delErr)
      }

      const { error: insErr, count } = await supabase
        .from('rosters')
        .insert(allRecords, { count: 'exact' })

      if (insErr) throw insErr
      totalRows = count ?? allRecords.length
    }

    message = errors.length > 0
      ? `Partial: ${totalRows} rows inserted, ${errors.length} team(s) failed — ${errors.join('; ')}`
      : `Synced ${totalRows} rows for ${shift} on ${targetDate}`

  } catch (err) {
    status  = 'error'
    message = (err as Error).message
    console.error('[sync-roster] Fatal:', err)
  }

  // Use derived per-shift job name so each sync_jobs row gets its own last_run update
  const jobName = deriveJobName(shift)

  await logApiCall({
    endpoint:         ENDPOINT,
    status,
    message,
    duration_ms:      Date.now() - start,
    triggered_by:     'pg_cron',
    job_name:         jobName,
    records_affected: totalRows,
  })

  return new Response(JSON.stringify({ status, message, totalRows }), {
    headers: { 'Content-Type': 'application/json' },
    status:  status === 'error' ? 500 : 200,
  })
})
