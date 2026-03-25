import { supabase } from '../_shared/supabase.ts'
import { logApiCall } from '../_shared/logger.ts'
import { notifyUsers } from '../_shared/notify.ts'

const JOB_NAME = 'expire-records'
const ENDPOINT = '/functions/v1/expire-records'

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

Deno.serve(async (_req) => {
  const start = Date.now()
  let status: 'success' | 'error' = 'success'
  let message = ''
  let total   = 0

  try {
    const today = new Date().toISOString().split('T')[0]

    // ── Pre-update: Collect records about to expire and notify ──

    // Comp-off (employee_id is UUID)
    const { data: expiringCompOffs } = await supabase
      .from('comp_off_ledger')
      .select('employee_id, duty_date, expiry_date')
      .eq('status', 'available')
      .lt('expiry_date', today)

    for (const co of (expiringCompOffs || []) as any[]) {
      if (!co.employee_id) continue
      await notifyUsers({
        user_ids: [co.employee_id],
        title: 'Comp-Off Expired',
        body: `Your comp-off${co.duty_date ? ' earned on ' + formatDate(co.duty_date) : ''} has expired.`,
        url: '/employee/comp-off',
        category: 'compoff_expired',
        metadata: { duty_date: co.duty_date, expiry_date: co.expiry_date },
      })
    }

    // Licenses (user_id is UUID)
    const { data: expiringLicenses } = await supabase
      .from('employee_licenses')
      .select('user_id, license_type, expiry_date')
      .eq('status', 'valid')
      .lt('expiry_date', today)

    for (const lic of (expiringLicenses || []) as any[]) {
      if (!lic.user_id) continue
      await notifyUsers({
        user_ids: [lic.user_id],
        title: 'License Expired',
        body: `Your ${(lic.license_type || 'license').toUpperCase()} license has expired.`,
        url: '/employee/licenses',
        category: 'license_expired',
        metadata: { license_type: lic.license_type, expiry_date: lic.expiry_date },
      })
    }

    // Endorsements (employee_id is UUID)
    const { data: expiringEndorsements } = await supabase
      .from('unit_endorsements')
      .select('employee_id, position, airport, expiry_date')
      .eq('status', 'valid')
      .lt('expiry_date', today)

    for (const ue of (expiringEndorsements || []) as any[]) {
      if (!ue.employee_id) continue
      await notifyUsers({
        user_ids: [ue.employee_id],
        title: 'Unit Endorsement Expired',
        body: `Your ${ue.position || ''} endorsement${ue.airport ? ' at ' + ue.airport : ''} has expired.`,
        url: '/employee/licenses',
        category: 'license_expired',
        metadata: { position: ue.position, expiry_date: ue.expiry_date },
      })
    }

    // Medical certificates (employee_id is UUID, skip CA35)
    const { data: expiringMedCerts } = await supabase
      .from('medical_certificates')
      .select('employee_id, medical_class, expiry_date')
      .eq('status', 'valid')
      .lt('expiry_date', today)

    if (expiringMedCerts?.length) {
      // Collect CA35 user IDs from training records
      const medEmpIds = (expiringMedCerts as any[]).map((m) => m.employee_id).filter(Boolean)
      const { data: trRecords } = await supabase
        .from('profiles')
        .select('id, employee_id')
        .in('id', medEmpIds)

      const userToEmpId = new Map<string, string>()
      for (const p of (trRecords || []) as any[]) {
        if (p.id && p.employee_id) userToEmpId.set(p.id, p.employee_id)
      }

      const { data: ca35Records } = await supabase
        .from('employee_training_records')
        .select('emp_id, med_status')
        .in('emp_id', [...userToEmpId.values()])

      const ca35EmpIds = new Set(
        ((ca35Records || []) as any[])
          .filter((r) => String(r.med_status || '').toUpperCase() === 'CA35')
          .map((r) => r.emp_id)
      )

      for (const mc of expiringMedCerts as any[]) {
        if (!mc.employee_id) continue
        const empId = userToEmpId.get(mc.employee_id)
        if (empId && ca35EmpIds.has(empId)) continue // skip CA35
        await notifyUsers({
          user_ids: [mc.employee_id],
          title: 'Medical Certificate Expired',
          body: `Your ${mc.medical_class || ''} medical certificate has expired.`,
          url: '/employee/licenses',
          category: 'license_expired',
          metadata: { medical_class: mc.medical_class, expiry_date: mc.expiry_date },
        })
      }
    }

    // ── Original expiration updates ──
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
