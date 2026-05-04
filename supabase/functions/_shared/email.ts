/**
 * Email delivery service with Resend (primary) + Brevo (fallback).
 * Uses REST APIs directly — no npm deps needed in Deno.
 *
 * Routing strategy:
 *   - Priority 1-3 (critical): Resend (instant, low-latency)
 *   - Priority 4-10 (normal/bulk): Brevo (generous free tier)
 *   - Failover: if primary fails, try the other provider
 */

declare const Deno: any

export interface EmailParams {
  to: string
  subject: string
  html: string
  from?: string
  replyTo?: string
  priority?: number // 1-10
  tags?: string[]
}

export interface EmailResult {
  success: boolean
  provider: 'resend' | 'brevo'
  messageId?: string
  error?: string
}

const RESEND_API_KEY = () => Deno.env.get('RESEND_API_KEY') || ''
const BREVO_API_KEY = () => Deno.env.get('BREVO_API_KEY') || ''
const FROM_EMAIL = () => Deno.env.get('EMAIL_FROM') || 'ATCORA <admin@atcora.in>'
const FROM_NAME = () => Deno.env.get('EMAIL_FROM_NAME') || 'ATCORA'

// ─── Provider implementations ───

async function sendViaResend(params: EmailParams): Promise<EmailResult> {
  const apiKey = RESEND_API_KEY()
  if (!apiKey) return { success: false, provider: 'resend', error: 'RESEND_API_KEY not configured' }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from || FROM_EMAIL(),
      to: [params.to],
      subject: params.subject,
      html: params.html,
      reply_to: params.replyTo,
      tags: params.tags?.map(t => ({ name: t, value: 'true' })),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    return { success: false, provider: 'resend', error: `Resend ${response.status}: ${body}` }
  }

  const data = await response.json().catch(() => ({}))
  return { success: true, provider: 'resend', messageId: data.id }
}

async function sendViaBrevo(params: EmailParams): Promise<EmailResult> {
  const apiKey = BREVO_API_KEY()
  if (!apiKey) return { success: false, provider: 'brevo', error: 'BREVO_API_KEY not configured' }

  const fromParts = (params.from || FROM_EMAIL()).match(/^(.+?)\s*<(.+)>$/)
  const senderName = fromParts ? fromParts[1].trim() : FROM_NAME()
  const senderEmail = fromParts ? fromParts[2] : (params.from || 'admin@atcora.in')

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: params.to }],
      subject: params.subject,
      htmlContent: params.html,
      replyTo: params.replyTo ? { email: params.replyTo } : undefined,
      tags: params.tags,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    return { success: false, provider: 'brevo', error: `Brevo ${response.status}: ${body}` }
  }

  const data = await response.json().catch(() => ({}))
  return { success: true, provider: 'brevo', messageId: data.messageId }
}

// ─── Main send function with failover ───

export async function sendEmail(params: EmailParams): Promise<EmailResult> {
  const priority = params.priority ?? 5

  // Route: critical (1-3) → Resend first, normal (4+) → Brevo first
  const usePrimaryResend = priority <= 3
  const primaryProvider: EmailResult['provider'] = usePrimaryResend ? 'resend' : 'brevo'
  const fallbackProvider: EmailResult['provider'] = usePrimaryResend ? 'brevo' : 'resend'

  const primary = usePrimaryResend ? sendViaResend : sendViaBrevo
  const fallback = usePrimaryResend ? sendViaBrevo : sendViaResend

  // Try primary
  const primaryResult = await primary(params).catch(err => ({
    success: false,
    provider: primaryProvider,
    error: (err as Error).message,
  }))

  if (primaryResult.success) return primaryResult

  console.warn(`[email] Primary (${primaryResult.provider}) failed: ${primaryResult.error}. Trying fallback...`)

  // Try fallback
  const fallbackResult = await fallback(params).catch(err => ({
    success: false,
    provider: fallbackProvider,
    error: (err as Error).message,
  }))

  if (fallbackResult.success) return fallbackResult

  // Both failed
  return {
    success: false,
    provider: primaryResult.provider,
    error: `Both providers failed. Primary: ${primaryResult.error}. Fallback: ${fallbackResult.error}`,
  }
}

// ─── Budget guard (optional soft limit) ───

let _dailySendCount = 0
let _dailyResetDate = ''

export function checkDailyBudget(limit: number = 250): boolean {
  const today = new Date().toISOString().split('T')[0]
  if (_dailyResetDate !== today) {
    _dailySendCount = 0
    _dailyResetDate = today
  }
  return _dailySendCount < limit
}

export function incrementDailyCount(): void {
  _dailySendCount++
}
