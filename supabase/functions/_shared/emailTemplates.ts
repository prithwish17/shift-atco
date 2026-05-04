/**
 * Email templates for notification system.
 * Each template returns { subject, html } for the given event data.
 */

// ─── Base layout ───

function baseLayout(title: string, body: string, ctaUrl?: string, ctaLabel?: string): string {
  const cta = ctaUrl
    ? `<tr><td style="padding:24px 0 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">${escapeHtml(ctaLabel || 'View Details')}</a></td></tr>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:100%">
  <tr><td style="background:#1e293b;padding:20px 24px">
    <span style="color:#fff;font-size:18px;font-weight:700">ATCORA</span>
  </td></tr>
  <tr><td style="padding:24px">
    <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px">${title}</h2>
    <div style="color:#374151;font-size:15px;line-height:1.6">${body}</div>
    ${cta}
  </td></tr>
  <tr><td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
    <p style="margin:0;font-size:12px;color:#9ca3af">
      You received this email because of your notification settings in ATCORA.
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── Template: Leave Status ───

export function leaveStatusEmail(data: {
  employeeName: string
  leaveType: string
  startDate: string
  endDate: string
  status: 'Approved' | 'Rejected' | 'Cancelled'
  remarks?: string
  appUrl: string
}): { subject: string; html: string } {
  const statusColors: Record<string, string> = {
    Approved: '#16a34a',
    Rejected: '#dc2626',
    Cancelled: '#d97706',
  }
  const color = statusColors[data.status] || '#374151'

  const body = `
    <p>Hi ${escapeHtml(data.employeeName)},</p>
    <p>Your <strong>${escapeHtml(data.leaveType)}</strong> leave request has been
      <span style="color:${color};font-weight:600">${data.status}</span>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:120px">Period</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.startDate)} — ${escapeHtml(data.endDate)}</td></tr>
      <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Leave Type</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.leaveType)}</td></tr>
      ${data.remarks ? `<tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Remarks</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.remarks)}</td></tr>` : ''}
    </table>`

  return {
    subject: `Leave ${data.status}: ${data.leaveType} (${data.startDate} – ${data.endDate})`,
    html: baseLayout(`Leave ${data.status}`, body, `${data.appUrl}/employee/leave`, 'View Leave Status'),
  }
}

// ─── Template: Leave Request (to supervisor/WSO) ───

export function leaveRequestEmail(data: {
  approverName: string
  employeeName: string
  leaveType: string
  startDate: string
  endDate: string
  reason?: string
  appUrl: string
}): { subject: string; html: string } {
  const body = `
    <p>Hi ${escapeHtml(data.approverName)},</p>
    <p><strong>${escapeHtml(data.employeeName)}</strong> has submitted a leave request that requires your review.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:120px">Employee</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.employeeName)}</td></tr>
      <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Period</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.startDate)} — ${escapeHtml(data.endDate)}</td></tr>
      <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Leave Type</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.leaveType)}</td></tr>
      ${data.reason ? `<tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600">Reason</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb">${escapeHtml(data.reason)}</td></tr>` : ''}
    </table>`

  return {
    subject: `Leave Request: ${data.employeeName} — ${data.leaveType}`,
    html: baseLayout('New Leave Request', body, `${data.appUrl}/supervisor/leave`, 'Review Request'),
  }
}

// ─── Template: Duty Exchange ───

export function dutyExchangeEmail(data: {
  employeeName: string
  partnerName: string
  dutyDate: string
  status: 'Approved' | 'Rejected'
  appUrl: string
}): { subject: string; html: string } {
  const body = `
    <p>Hi ${escapeHtml(data.employeeName)},</p>
    <p>Your duty exchange with <strong>${escapeHtml(data.partnerName)}</strong>
       for <strong>${escapeHtml(data.dutyDate)}</strong> has been
       <span style="font-weight:600">${data.status.toLowerCase()}</span>.</p>`

  return {
    subject: `Duty Exchange ${data.status}: ${data.dutyDate}`,
    html: baseLayout(`Duty Exchange ${data.status}`, body, `${data.appUrl}/employee`, 'View Schedule'),
  }
}

// ─── Template: OPE Duty Reminder ───

export function opeReminderEmail(data: {
  employeeName: string
  dutyCode: string
  dutyDate: string
  daysAhead: number
  appUrl: string
}): { subject: string; html: string } {
  const label = data.daysAhead === 1 ? 'tomorrow' : `in ${data.daysAhead} days`
  const body = `
    <p>Hi ${escapeHtml(data.employeeName)},</p>
    <p>You have an OPE duty (<strong>${escapeHtml(data.dutyCode)}</strong>) scheduled
       on <strong>${escapeHtml(data.dutyDate)}</strong> (${label}).</p>
    <p>Please ensure you are prepared and available.</p>`

  return {
    subject: `OPE Duty Reminder: ${data.dutyCode} on ${data.dutyDate}`,
    html: baseLayout('OPE Duty Reminder', body, `${data.appUrl}/employee`, 'View Schedule'),
  }
}

// ─── Template: License/Rating/Medical Expiry ───

export function expiryAlertEmail(data: {
  employeeName: string
  itemType: string // e.g. 'ADC Rating', 'Medical Certificate', 'ELPA'
  expiryDate: string
  daysUntil: number
  appUrl: string
}): { subject: string; html: string } {
  const urgency = data.daysUntil <= 7 ? 'color:#dc2626;font-weight:700' : 'font-weight:600'
  const body = `
    <p>Hi ${escapeHtml(data.employeeName)},</p>
    <p>Your <strong>${escapeHtml(data.itemType)}</strong> is set to expire on
       <strong>${escapeHtml(data.expiryDate)}</strong>
       (<span style="${urgency}">${data.daysUntil} day${data.daysUntil !== 1 ? 's' : ''} remaining</span>).</p>
    <p>Please complete the necessary renewal procedures.</p>
    <p style="color:#6b7280;font-size:13px">If you have already taken action, kindly ignore this message.</p>`

  return {
    subject: `⚠ ${data.itemType} Expiry: ${data.daysUntil} day${data.daysUntil !== 1 ? 's' : ''} left`,
    html: baseLayout(`${data.itemType} Expiry Alert`, body, `${data.appUrl}/employee/licenses`, 'View Licenses'),
  }
}

// ─── Template: License/Rating/Medical Already Expired ───

export function expiredLicenseEmail(data: {
  employeeName: string
  itemType: string
  expiryDate: string
  appUrl: string
}): { subject: string; html: string } {
  const body = `
    <p>Hi ${escapeHtml(data.employeeName)},</p>
    <p>Your <strong>${escapeHtml(data.itemType)}</strong> expired on
       <strong>${escapeHtml(data.expiryDate)}</strong>.</p>
    <p style="color:#dc2626;font-weight:600">Please take immediate action to renew your license to remain compliant.</p>`

  return {
    subject: `🚨 ${data.itemType} Expired`,
    html: baseLayout(`${data.itemType} Expired`, body, `${data.appUrl}/employee/licenses`, 'View Licenses'),
  }
}

// ─── Template: Comp-Off Expiry ───

export function compOffExpiryEmail(data: {
  employeeName: string
  dutyDate?: string
  expiryDate: string
  daysAhead: number
  appUrl: string
}): { subject: string; html: string } {
  const body = `
    <p>Hi ${escapeHtml(data.employeeName)},</p>
    <p>Your comp-off${data.dutyDate ? ` dated <strong>${escapeHtml(data.dutyDate)}</strong>` : ''}
       will expire on <strong>${escapeHtml(data.expiryDate)}</strong>
       (<strong>${data.daysAhead} day${data.daysAhead !== 1 ? 's' : ''} remaining</strong>).</p>
    <p>Please avail it before expiry.</p>
    <p style="color:#6b7280;font-size:13px">If already used, kindly ignore this message.</p>`

  return {
    subject: `Comp-Off Expiry: ${data.daysAhead} day${data.daysAhead !== 1 ? 's' : ''} left`,
    html: baseLayout('Comp-Off Expiry Reminder', body, `${data.appUrl}/employee/comp-off`, 'Apply Comp-Off'),
  }
}

// ─── Template: Comp-Off Already Expired ───

export function expiredCompOffEmail(data: {
  employeeName: string
  dutyDate?: string
  expiryDate: string
  appUrl: string
}): { subject: string; html: string } {
  const body = `
    <p>Hi ${escapeHtml(data.employeeName)},</p>
    <p>Your comp-off${data.dutyDate ? ` dated <strong>${escapeHtml(data.dutyDate)}</strong>` : ''}
       expired on <strong>${escapeHtml(data.expiryDate)}</strong> and is no longer valid.</p>`

  return {
    subject: `Comp-Off Expired: ${data.expiryDate}`,
    html: baseLayout('Comp-Off Expired', body, `${data.appUrl}/employee/comp-off`, 'View Comp-Off'),
  }
}

// ─── Template: Duty Change ───

export function dutyChangeEmail(data: {
  employeeName: string
  dutyDate: string
  oldDutyCode: string
  newDutyCode: string
  appUrl: string
}): { subject: string; html: string } {
  const oldDuty = (data.oldDutyCode || '').trim()
  const newDuty = (data.newDutyCode || '').trim()
  const hasOldDuty = !!oldDuty && oldDuty.toLowerCase() !== 'previous' && oldDuty.toLowerCase() !== 'unknown'

  const body = `
    <p>Hi ${escapeHtml(data.employeeName)},</p>
    <p>Your duty on <strong>${escapeHtml(data.dutyDate)}</strong> has been changed:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      ${hasOldDuty
        ? `<tr><td style="padding:8px 12px;background:#fef2f2;border:1px solid #e5e7eb;font-weight:600;width:120px">Previous</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;text-decoration:line-through;color:#9ca3af">${escapeHtml(oldDuty)}</td></tr>`
        : ''}
      <tr><td style="padding:8px 12px;background:#f0fdf4;border:1px solid #e5e7eb;font-weight:600">New</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;color:#16a34a">${escapeHtml(newDuty || 'Updated')}</td></tr>
    </table>`

  return {
    subject: hasOldDuty
      ? `Duty Changed: ${data.dutyDate} — ${oldDuty} → ${newDuty || 'Updated'}`
      : `Duty Changed: ${data.dutyDate} — Now ${newDuty || 'Updated'}`,
    html: baseLayout('Duty Change Notification', body, `${data.appUrl}/employee`, 'View Schedule'),
  }
}

// ─── Template: Generic / Catch-all ───

export function genericEmail(data: {
  title: string
  body: string
  ctaUrl?: string
  ctaLabel?: string
}): { subject: string; html: string } {
  return {
    subject: data.title,
    html: baseLayout(data.title, `<p>${escapeHtml(data.body)}</p>`, data.ctaUrl, data.ctaLabel),
  }
}
