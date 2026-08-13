import { supabase } from '../_shared/supabase.ts'
import { logApiCall } from '../_shared/logger.ts'

const ENDPOINT  = '/functions/v1/sync-roster'
const ALL_TEAMS = ['A', 'B', 'C', 'D', 'E']

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
  /** Row the cell was read from, so the grid can reproduce the sheet's order. */
  row_index:     number | null
}

// Normalise shift values to title-case ("NIGHT" → "Night") so queries
// and the frontend work consistently regardless of the API's casing.
const normaliseShift = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s

const normaliseTeam = (value: string) => {
  const normalized = String(value || '').trim().toUpperCase().replace(/^TEAM\s+/, '')
  if (normalized === 'ALPHA') return 'A'
  if (normalized === 'BRAVO') return 'B'
  if (normalized === 'CHARLIE') return 'C'
  if (normalized === 'DELTA') return 'D'
  if (normalized === 'ECHO') return 'E'
  if (normalized === 'GENERAL') return 'G'
  return normalized
}

// ── Date canonicalisation ─────────────────────────────────────────────────────
// The sheet emits at least four shapes depending on the team/shift tab:
//   "2-Aug-2026" | "2-August-26" | "9-May-26" | "07-30-2026"
// Anything not stored as ISO is invisible to the frontend's date filters, which
// is why Bravo-night and Echo rows never showed up.  Everything is converted to
// "yyyy-MM-dd" before it reaches the database.
// Mirrors src/lib/rosterDate.ts (edge functions cannot import from src/).
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const pad = (n: number) => String(n).padStart(2, '0')

const expandYear = (raw: string) => {
  const n = Number(raw)
  if (raw.length <= 2) return 2000 + n
  return n
}

function toIsoRosterDate(value: string): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  // d-MMM(M)-yy(yy)  e.g. 2-Aug-2026, 2-August-26, 9-May-26
  let m = raw.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2,4})$/)
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()]
    const day = Number(m[1])
    if (month && day >= 1 && day <= 31) {
      return `${expandYear(m[3])}-${pad(month)}-${pad(day)}`
    }
    return null
  }

  // Numeric dashed.  Observed data is MM-dd-yyyy ("07-30-2026"); fall back to
  // dd-MM-yyyy only when the first field cannot be a month.
  m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const year = Number(m[3])
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return `${year}-${pad(a)}-${pad(b)}`
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return `${year}-${pad(b)}-${pad(a)}`
    return null
  }

  // Slash formats: dd/MM/yyyy
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const year = Number(m[3])
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return `${year}-${pad(b)}-${pad(a)}`
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return `${year}-${pad(a)}-${pad(b)}`
    return null
  }

  return null
}

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

const FETCH_TIMEOUT_MS = 25_000
const RETRY_DELAY_MS   = 1_500
const TEAM_GAP_MS      = 500
const MAX_ATTEMPTS     = 3

// Retrying five teams three times could in principle outlast the edge function's
// wall-clock limit, so the whole fetch phase works to a deadline: once it passes,
// remaining attempts are abandoned and whatever has been collected is written.
const FETCH_BUDGET_MS = 110_000
let runDeadline = Number.POSITIVE_INFINITY

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type TeamFetchResult = { records: RosterRecord[]; skippedDates: number }

async function fetchTeamRosterOnce(
  rosterUrl: string,
  shift: string,
  team: string,
  date: string,
): Promise<TeamFetchResult> {
  const url = new URL(rosterUrl)
  url.searchParams.set('shift', shift)
  url.searchParams.set('team',  team)
  url.searchParams.set('date',  date)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let body: string
  try {
    const res = await fetch(url.toString(), {
      method:   'GET',
      redirect: 'follow',
      signal:   controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    body = await res.text()
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`timed out after ${FETCH_TIMEOUT_MS / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  // Apps Script reports failures (e.g. a spreadsheet the deployment owner can no
  // longer open) as an HTML error page with HTTP 200.  Surface the real reason
  // instead of letting JSON.parse produce "Unexpected token '<'".
  if (body.trim().startsWith('<')) {
    const detail = /do not have permission/i.test(body)
      ? 'permission denied on the source spreadsheet'
      : 'HTML error page'
    throw new Error(`Apps Script returned ${detail}`)
  }

  let json: any
  try {
    json = JSON.parse(body)
  } catch {
    throw new Error(`non-JSON response (${body.slice(0, 80)})`)
  }

  if (json && !Array.isArray(json) && json.error) {
    throw new Error(`Apps Script error: ${json.error}`)
  }

  const raw: any[] = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : [])

  let skippedDates = 0
  const records: RosterRecord[] = []

  for (const row of raw) {
    // The sheet writes each cell as "NAME/ GRADE - RATING-[SAR]", e.g.
    // "BIBHAS SARKAR/ JGM - RSR+UBN-".  This used to be cut down to the bare
    // name, throwing away the grade and rating printed under every name on the
    // published roster.  The full cell is stored instead and split for display
    // by parsePersonCell in src/lib/rosterGrid.ts, which also tolerates the bare
    // names older rows still hold.  Kept in step with fetch-roster.
    const empName = (row.employee_name ?? row.name ?? '').trim().replace(/\s+/g, ' ')

    const unit = (row.unit ?? '').toUpperCase().trim() === 'HQ' ? 'WSO' : (row.unit ?? '')

    // The sheet's own date wins (it is the roster's real date — the webapp
    // ignores the requested one), but it is canonicalised to ISO first.  A row
    // whose date cannot be understood is dropped rather than written as an
    // unqueryable string.
    const isoDate = toIsoRosterDate(row.date) ?? toIsoRosterDate(date)
    if (!isoDate) {
      skippedDates++
      continue
    }

    records.push({
      date:          isoDate,
      shift:         normaliseShift(row.shift || shift),
      team:          normaliseTeam(row.team || team),
      unit,
      employee_name: empName,
      position:      row.position ?? row.mark ?? row.remark ?? row.half ?? '',
      // Absent from supervision and special rows, and from any deployment older
      // than the merge-aware scraper — stored as NULL rather than guessed.
      row_index:     Number.isInteger(row.row_index) ? row.row_index : null,
    })
  }

  return { records, skippedDates }
}

// Retries on failure *and* on an empty result.  The webapp is flaky under load:
// firing all five teams at once made Apps Script drop a request per batch (only
// 4 of 5 executions ever reached its log, which is why Team E never synced), and
// Team A intermittently answers with a permission error page — roughly 1 attempt
// in 3 even when requested on its own.  Sequential requests plus a couple of
// retries turn both into non-events.
async function fetchTeamRoster(
  rosterUrl: string,
  shift: string,
  team: string,
  date: string,
): Promise<TeamFetchResult> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (Date.now() > runDeadline) {
      throw lastError ?? new Error('skipped — sync ran out of time')
    }
    if (attempt > 1) await sleep(RETRY_DELAY_MS * (attempt - 1))

    try {
      const result = await fetchTeamRosterOnce(rosterUrl, shift, team, date)
      if (result.records.length > 0) return result

      lastError = new Error('returned 0 rows')
      console.warn(`[sync-roster] Team ${team} attempt ${attempt}/${MAX_ATTEMPTS}: 0 rows`)
    } catch (err) {
      lastError = err as Error
      console.warn(
        `[sync-roster] Team ${team} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError.message}`,
      )
    }
  }

  // Exhausted every attempt with an empty result rather than a hard failure.
  if (lastError?.message === 'returned 0 rows') {
    return { records: [], skippedDates: 0 }
  }
  throw lastError ?? new Error('unknown fetch failure')
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
    runDeadline = start + FETCH_BUDGET_MS

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

    // Fetch teams one at a time.  Issuing all five at once made Apps Script drop
    // a request per batch, so one team (Echo) silently synced nothing for weeks.
    const allRecords: RosterRecord[] = []
    const errors: string[] = []
    const perTeamCounts: string[] = []
    let skippedDates = 0

    for (const [i, team] of ALL_TEAMS.entries()) {
      if (i > 0) await sleep(TEAM_GAP_MS)
      try {
        const { records, skippedDates: skipped } = await fetchTeamRoster(
          rosterUrl, shift, team, targetDate,
        )
        allRecords.push(...records)
        skippedDates += skipped
        perTeamCounts.push(`${team}:${records.length}`)
        // An empty result is not an error, but it is never expected — surface it
        // so a team that stops returning data cannot hide behind a "success".
        if (records.length === 0) errors.push(`Team ${team}: returned 0 rows`)
      } catch (err) {
        perTeamCounts.push(`${team}:failed`)
        errors.push(`Team ${team}: ${(err as Error).message}`)
      }
    }

    if (allRecords.length === 0) {
      throw new Error('All team fetches failed: ' + errors.join('; '))
    }

    if (allRecords.length > 0) {
      // Deduplicate by unique constraint columns (date, shift, employee_name, unit, position)
      // to avoid duplicate key violations within the same batch.
      const seen = new Set<string>()
      const dedupedRecords = allRecords.filter(r => {
        const key = `${r.date}|${r.shift}|${r.team}|${r.employee_name}|${r.unit}|${r.position}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Replace each (date, shift, team) slice the fetch covered.  The order here
      // matters: this used to DELETE the slice and then upsert, so any upsert
      // failure left the shift with no data at all and no way back — exactly what
      // happened when the ON CONFLICT target did not match a real constraint.
      // Now the new rows go in first and stale ones are removed only afterwards,
      // so a failure leaves the previous roster untouched.
      const combos = new Set<string>()
      dedupedRecords.forEach(r => combos.add(`${r.date}|${r.shift}|${r.team}`))

      const rowKey = (r: { date: string; shift: string; team: string;
                           employee_name: string; unit: string; position: string }) =>
        `${r.date}|${r.shift}|${r.team}|${r.employee_name}|${r.unit}|${r.position}`

      // 1. Snapshot what is currently stored for these slices, before any write.
      const existing: Array<{ id: string; key: string }> = []
      for (const combo of combos) {
        const [d, s, t] = combo.split('|')
        const { data, error: selErr } = await supabase
          .from('rosters')
          .select('id, date, shift, team, employee_name, unit, position')
          .eq('date', d)
          .eq('shift', s)
          .eq('team', t)
        if (selErr) throw selErr
        for (const r of data ?? []) existing.push({ id: r.id, key: rowKey(r) })
      }

      // 2. Write the fresh roster.  Nothing has been removed yet, so if this
      //    throws the previous data is still intact.
      const { error: insErr, count } = await supabase
        .from('rosters')
        .upsert(dedupedRecords, {
          count: 'exact',
          onConflict: 'date,shift,team,employee_name,unit,position',
        })

      if (insErr) throw insErr
      totalRows = count ?? dedupedRecords.length

      // 3. Only now drop rows the new roster no longer contains (a duty that was
      //    removed or reassigned).  Failures here are non-fatal: the current
      //    roster is already correct, at worst a stale row lingers until the next
      //    sync, which is far safer than deleting first.
      const freshKeys = new Set(dedupedRecords.map(rowKey))
      const staleIds = existing.filter(r => !freshKeys.has(r.key)).map(r => r.id)

      for (let i = 0; i < staleIds.length; i += 100) {
        const chunk = staleIds.slice(i, i + 100)
        const { error: delErr } = await supabase.from('rosters').delete().in('id', chunk)
        if (delErr) console.error('[sync-roster] Stale row cleanup failed:', delErr)
      }

      if (staleIds.length > 0) {
        console.log(`[sync-roster] Removed ${staleIds.length} stale row(s)`)
      }
    }

    const breakdown = perTeamCounts.join(' ')
    const skippedNote = skippedDates > 0 ? `; ${skippedDates} row(s) skipped (unparseable date)` : ''

    message = errors.length > 0
      ? `Partial: ${totalRows} rows [${breakdown}], ${errors.length} team(s) affected — ${errors.join('; ')}${skippedNote}`
      : `Synced ${totalRows} rows for ${shift} on ${targetDate} [${breakdown}]${skippedNote}`

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
