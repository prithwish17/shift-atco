import { supabase } from '../_shared/supabase.ts'
import { logApiCall } from '../_shared/logger.ts'
import { notifyUsers } from '../_shared/notify.ts'

const JOB_NAME = 'check-license-expiry'
const ENDPOINT = '/functions/v1/check-license-expiry'

const ALERT_DAYS = [60, 30, 15, 7, 3]

const RATING_LABELS: Record<string, string> = {
  adc: 'ADC',
  app: 'APP',
  rdr: 'ACC',
  acc_s: 'ACC(S)',
  plr: 'PLR',
  occ: 'OCC',
}

function addDaysIso(date: Date, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function diffDays(a: string, b: Date): number {
  const ms = new Date(a + 'T00:00:00').getTime() - new Date(b.toISOString().split('T')[0] + 'T00:00:00').getTime()
  return Math.round(ms / 86_400_000)
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Replicate getRatingValidityWindow from useLicenseDashboard.ts */
function getRatingExpiry(entry: any): string | null {
  const candidates: Date[] = []

  // Latest proficiency from proficiency_history or last_proficiency
  const history = entry?.proficiency_history || {}
  for (const val of Object.values(history)) {
    const d = (val as any)?.date
    if (d && typeof d === 'string') {
      const parsed = new Date(d)
      if (!isNaN(parsed.getTime())) candidates.push(parsed)
    }
  }
  const lp = entry?.last_proficiency?.date
  if (lp && typeof lp === 'string') {
    const parsed = new Date(lp)
    if (!isNaN(parsed.getTime())) candidates.push(parsed)
  }

  // Endorsement date
  const ed = entry?.endorsement_date
  if (ed && typeof ed === 'string') {
    const parsed = new Date(ed)
    if (!isNaN(parsed.getTime())) candidates.push(parsed)
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => b.getTime() - a.getTime())

  const anchor = candidates[0]
  const expiry = new Date(anchor)
  expiry.setDate(expiry.getDate() + 364)
  return expiry.toISOString().split('T')[0]
}

function hasValidAccSRating(ratingData: Record<string, any>, today: Date): boolean {
  const accsEntry = ratingData?.acc_s
  if (!accsEntry || accsEntry.status !== '1') return false

  const expiry = getRatingExpiry(accsEntry)
  if (!expiry) return false

  return diffDays(expiry, today) >= 0
}

type AlertEntry = { userId: string; title: string; body: string; category: string; metadata: Record<string, any> }

Deno.serve(async (_req) => {
  const start = Date.now()
  let status: 'success' | 'error' = 'success'
  let message = ''
  let total = 0

  try {
    const today = new Date()
    const todayIso = today.toISOString().split('T')[0]
    const alerts: AlertEntry[] = []

    // ── 1. Ratings, Training, ELPA, Medical from employee_training_records ──
    const { data: trainingRows, error: trErr } = await supabase
      .from('employee_training_records')
      .select('emp_id, employee_name, rating_data, instructor_validity, examiner_validity, elpa_endorsed_upto, elpa_valid_upto, med_endorsed_upto, med_status')

    if (trErr) throw trErr

    // Build emp_id → user_id map
    const empIds = (trainingRows || []).map((r: any) => r.emp_id).filter(Boolean)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, employee_id')
      .in('employee_id', empIds)

    const empToUser = new Map<string, string>()
    for (const p of (profiles || []) as any[]) {
      if (p.employee_id && p.id) empToUser.set(p.employee_id, p.id)
    }

    for (const row of (trainingRows || []) as any[]) {
      const userId = empToUser.get(row.emp_id)
      if (!userId) continue

      // ── Ratings ──
      const ratingData = row.rating_data || {}
      const validAccS = hasValidAccSRating(ratingData, today)
      for (const [key, entry] of Object.entries(ratingData)) {
        if ((entry as any)?.status !== '1') continue // skip inactive
        if (key === 'plr' && validAccS) continue
        const expiry = getRatingExpiry(entry)
        if (!expiry) continue
        const days = diffDays(expiry, today)
        if (days < 0 || !ALERT_DAYS.includes(days)) continue

        const label = RATING_LABELS[key] || key.toUpperCase()
        alerts.push({
          userId,
          title: `${label} Rating Expiry`,
          body: `Your ${label} rating expires on ${formatDate(expiry)} (${days} day${days !== 1 ? 's' : ''} left).`,
          category: 'license_expiry',
          metadata: { type: 'rating', key, expiry_date: expiry, days_until: days },
        })
      }

      // ── Instructor validity ──
      const instrValidity = row.instructor_validity || {}
      for (const [key, val] of Object.entries(instrValidity)) {
        const expiry = typeof val === 'string' ? val : (val as any)?.valid_upto || (val as any)?.expiry_date
        if (!expiry || typeof expiry !== 'string') continue
        const days = diffDays(expiry, today)
        if (days < 0 || !ALERT_DAYS.includes(days)) continue

        alerts.push({
          userId,
          title: 'Instructor Validity Expiry',
          body: `Your ${key.toUpperCase()} instructor validity expires on ${formatDate(expiry)} (${days}d left).`,
          category: 'license_expiry',
          metadata: { type: 'instructor', key, expiry_date: expiry, days_until: days },
        })
      }

      // ── Examiner validity ──
      const examValidity = row.examiner_validity || {}
      for (const [key, val] of Object.entries(examValidity)) {
        const expiry = typeof val === 'string' ? val : (val as any)?.valid_upto || (val as any)?.expiry_date
        if (!expiry || typeof expiry !== 'string') continue
        const days = diffDays(expiry, today)
        if (days < 0 || !ALERT_DAYS.includes(days)) continue

        alerts.push({
          userId,
          title: 'Examiner Validity Expiry',
          body: `Your ${key.toUpperCase()} examiner validity expires on ${formatDate(expiry)} (${days}d left).`,
          category: 'license_expiry',
          metadata: { type: 'examiner', key, expiry_date: expiry, days_until: days },
        })
      }

      // ── ELPA ──
      const elpaExpiry = row.elpa_endorsed_upto || row.elpa_valid_upto
      if (elpaExpiry) {
        const isoDate = typeof elpaExpiry === 'string'
          ? elpaExpiry.split('T')[0]
          : new Date(elpaExpiry).toISOString().split('T')[0]
        const days = diffDays(isoDate, today)
        if (days >= 0 && ALERT_DAYS.includes(days)) {
          alerts.push({
            userId,
            title: 'ELPA Expiry Alert',
            body: `Your ELPA endorsement expires on ${formatDate(isoDate)} (${days}d left).`,
            category: 'license_expiry',
            metadata: { type: 'elpa', expiry_date: isoDate, days_until: days },
          })
        }
      }

      // ── Medical (skip CA35) ──
      if (row.med_endorsed_upto && String(row.med_status || '').toUpperCase() !== 'CA35') {
        const isoDate = typeof row.med_endorsed_upto === 'string'
          ? row.med_endorsed_upto.split('T')[0]
          : new Date(row.med_endorsed_upto).toISOString().split('T')[0]
        const days = diffDays(isoDate, today)
        if (days >= 0 && ALERT_DAYS.includes(days)) {
          alerts.push({
            userId,
            title: 'Medical Certificate Expiry',
            body: `Your medical certificate expires on ${formatDate(isoDate)} (${days}d left).`,
            category: 'license_expiry',
            metadata: { type: 'medical_training', expiry_date: isoDate, days_until: days },
          })
        }
      }
    }

    // ── 2. employee_licenses table ──
    for (const daysAhead of ALERT_DAYS) {
      const targetDate = addDaysIso(today, daysAhead)
      const { data: licenses } = await supabase
        .from('employee_licenses')
        .select('user_id, license_type, expiry_date')
        .eq('status', 'valid')
        .eq('expiry_date', targetDate)

      for (const lic of (licenses || []) as any[]) {
        if (!lic.user_id) continue
        alerts.push({
          userId: lic.user_id,
          title: 'License Expiry Alert',
          body: `Your ${(lic.license_type || 'license').toUpperCase()} license expires on ${formatDate(targetDate)} (${daysAhead}d left).`,
          category: 'license_expiry',
          metadata: { type: 'license', license_type: lic.license_type, expiry_date: targetDate, days_until: daysAhead },
        })
      }
    }

    // ── 3. unit_endorsements table ──
    for (const daysAhead of ALERT_DAYS) {
      const targetDate = addDaysIso(today, daysAhead)
      const { data: endorsements } = await supabase
        .from('unit_endorsements')
        .select('employee_id, position, airport, expiry_date')
        .eq('status', 'valid')
        .eq('expiry_date', targetDate)

      for (const ue of (endorsements || []) as any[]) {
        if (!ue.employee_id) continue
        alerts.push({
          userId: ue.employee_id,
          title: 'Unit Endorsement Expiry',
          body: `Your ${ue.position || ''} endorsement${ue.airport ? ' at ' + ue.airport : ''} expires on ${formatDate(targetDate)} (${daysAhead}d left).`,
          category: 'license_expiry',
          metadata: { type: 'endorsement', position: ue.position, expiry_date: targetDate, days_until: daysAhead },
        })
      }
    }

    // ── 4. medical_certificates table (cross-check CA35) ──
    // Collect employee_ids with CA35 from training_records
    const ca35Set = new Set<string>()
    for (const row of (trainingRows || []) as any[]) {
      if (String(row.med_status || '').toUpperCase() === 'CA35') {
        const userId = empToUser.get(row.emp_id)
        if (userId) ca35Set.add(userId)
      }
    }

    for (const daysAhead of ALERT_DAYS) {
      const targetDate = addDaysIso(today, daysAhead)
      const { data: medCerts } = await supabase
        .from('medical_certificates')
        .select('employee_id, medical_class, expiry_date')
        .eq('status', 'valid')
        .eq('expiry_date', targetDate)

      for (const mc of (medCerts || []) as any[]) {
        if (!mc.employee_id || ca35Set.has(mc.employee_id)) continue
        alerts.push({
          userId: mc.employee_id,
          title: 'Medical Certificate Expiry',
          body: `Your ${mc.medical_class || ''} medical certificate expires on ${formatDate(targetDate)} (${daysAhead}d left).`,
          category: 'license_expiry',
          metadata: { type: 'medical', medical_class: mc.medical_class, expiry_date: targetDate, days_until: daysAhead },
        })
      }
    }

    // ── Send all alerts ──
    for (const alert of alerts) {
      const itemType = alert.title.replace(' Expiry', '').replace(' Alert', '')
      await notifyUsers({
        user_ids: [alert.userId],
        title: alert.title,
        body: alert.body,
        url: '/employee/licenses',
        category: alert.category,
        metadata: { ...alert.metadata, item_type: itemType },
        emailTemplate: 'license_expiry',
        emailData: {
          item_type: itemType,
          expiry_date: alert.metadata.expiry_date ? formatDate(alert.metadata.expiry_date) : '',
          days_until: alert.metadata.days_until || 0,
        },
      })
      total++
    }

    message = `Sent ${total} license/rating/medical expiry alert(s)`
  } catch (err) {
    status = 'error'
    message = (err as Error).message
    console.error('[check-license-expiry]', err)
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
