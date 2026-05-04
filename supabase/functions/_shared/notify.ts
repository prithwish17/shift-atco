/**
 * Shared notification helper for Supabase Edge Functions.
 * Sends Web Push notifications and inserts in-app notification records.
 */

declare const Deno: any

import { supabase } from './supabase.ts'
import { enqueueNotification } from './enqueue.ts'

interface NotifyParams {
  user_ids: string[]
  title:    string
  body:     string
  url?:     string
  category: string
  metadata?: Record<string, unknown>
  /** Set to false to skip email queueing (default: true) */
  sendEmail?: boolean
  /** Email priority 1-10 (default: 5) */
  emailPriority?: number
  /** Email template name — queue processor uses this to render HTML */
  emailTemplate?: string
  /** Extra data for email template rendering */
  emailData?: Record<string, unknown>
}

interface PushSubscription {
  id:       string
  user_id:  string
  endpoint: string
  p256dh:   string
  auth_key: string
}

/**
 * Send push notifications to specified users, insert in-app notification rows,
 * and enqueue email delivery jobs.
 * Silently skips push delivery if VAPID keys are not configured.
 */
export async function notifyUsers(params: NotifyParams): Promise<{ sent: number; failed: number; inApp: number; emailQueued: number }> {
  const { user_ids, title, body, url, category, metadata, sendEmail = true, emailPriority = 5, emailTemplate, emailData } = params
  if (!user_ids.length) return { sent: 0, failed: 0, inApp: 0, emailQueued: 0 }
  // Deduplicate user IDs
  const uniqueUserIds = [...new Set(user_ids)]

  // 1. Insert in-app notification rows
  const notificationRows = uniqueUserIds.map((uid) => ({
    user_id:    uid,
    title,
    body,
    category,
    metadata:   { ...metadata, url: url || '/' },
    read:       false,
  }))

  const { error: insertError } = await supabase
    .from('notifications')
    .insert(notificationRows)
  if (insertError) {
    console.error('[notify] Failed to insert notifications:', insertError.message)
  }

  // 2. Enqueue email delivery (best-effort, non-blocking)
  let emailQueued = 0
  if (sendEmail) {
    for (const uid of uniqueUserIds) {
      try {
        const queueId = await enqueueNotification({
          userId: uid,
          channel: 'email',
          eventType: category,
          priority: emailPriority,
          payload: {
            title,
            body,
            url: url || '/',
            category,
            metadata,
            template: emailTemplate || category,
            templateData: emailData,
          },
        })
        if (queueId) emailQueued++
      } catch (err) {
        console.warn(`[notify] Email enqueue failed for ${uid}:`, (err as Error).message)
      }
    }
  }

  // 2. Send Web Push (best-effort — skip if VAPID not configured)
  const vapidPublicKey  = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn('[notify] VAPID keys not configured — skipping push delivery')
    return { sent: 0, failed: 0, inApp: uniqueUserIds.length, emailQueued }
  }

  // Fetch push subscriptions for target users
  const { data: subscriptions, error: subError } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth_key')
    .in('user_id', uniqueUserIds)

  if (subError || !subscriptions?.length) {
    return { sent: 0, failed: 0, inApp: uniqueUserIds.length, emailQueued }
  }

  const payload = JSON.stringify({ title, body, url: url || '/' })
  let sent = 0
  let failed = 0
  const expiredIds: string[] = []

  for (const sub of subscriptions as unknown as PushSubscription[]) {
    try {
      const result = await sendWebPush(sub, payload, vapidPublicKey, vapidPrivateKey)
      if (result.ok) {
        sent++
      } else if (result.status === 410) {
        // Subscription expired — mark for cleanup
        expiredIds.push(sub.id)
        failed++
      } else {
        failed++
        console.warn(`[notify] Push failed for ${sub.endpoint}: ${result.status}`)
      }
    } catch (err) {
      failed++
      console.error('[notify] Push error:', err)
    }
  }

  // 3. Clean up expired subscriptions
  if (expiredIds.length) {
    await supabase.from('push_subscriptions').delete().in('id', expiredIds)
  }

  return { sent, failed, inApp: uniqueUserIds.length, emailQueued }
}

// ─── Web Push implementation using Web Crypto API (no npm deps) ───

async function sendWebPush(
  sub: PushSubscription,
  payload: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<{ ok: boolean; status: number }> {
  const endpoint = sub.endpoint
  const audience = new URL(endpoint).origin

  // Create VAPID JWT
  const jwt = await createVapidJwt(audience, vapidPublicKey, vapidPrivateKey)
  const vapidAuth = `vapid t=${jwt}, k=${vapidPublicKey}`

  // Encrypt payload using sub.p256dh and sub.auth_key
  const { ciphertext, salt, serverPublicKey } = await encryptPayload(
    payload,
    sub.p256dh,
    sub.auth_key,
  )

  const headers: Record<string, string> = {
    'Authorization': vapidAuth,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    'TTL': '86400',
    'Crypto-Key': `p256ecdsa=${vapidPublicKey}`,
  }

  const body = buildAes128gcmBody(ciphertext, salt, serverPublicKey)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
  })

  return { ok: response.ok, status: response.status }
}

async function createVapidJwt(audience: string, publicKey: string, privateKey: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const claims = { aud: audience, exp: now + 86400, sub: 'mailto:admin@atcora.in' }

  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)))
  const claimsB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(claims)))
  const unsignedToken = `${headerB64}.${claimsB64}`

  // Import VAPID private key for signing
  const keyData = base64urlDecode(privateKey)
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  ).catch(async () => {
    // Try JWK raw format if PKCS8 fails (web-push generates raw 32-byte keys)
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      d: privateKey,
      x: publicKey.length > 43 ? publicKey.slice(0, 43) : publicKey,
      y: publicKey.length > 43 ? publicKey.slice(43) : '',
    }
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  })

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsignedToken),
  )

  // Convert DER signature to raw r||s format if needed
  const sigBytes = new Uint8Array(signature)
  const rawSig = sigBytes.length === 64 ? sigBytes : derToRaw(sigBytes)
  const sigB64 = base64urlEncode(rawSig)

  return `${unsignedToken}.${sigB64}`
}

async function encryptPayload(
  payload: string,
  clientPublicKeyB64: string,
  clientAuthB64: string,
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  // Generate ephemeral ECDH key pair
  const serverKey = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )

  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKey.publicKey))

  // Import client's public key
  const clientPublicKeyBytes = base64urlDecode(clientPublicKeyB64)
  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  // Derive shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: clientPublicKey },
      serverKey.privateKey,
      256,
    ),
  )

  const clientAuth = base64urlDecode(clientAuthB64)

  // Derive encryption key and nonce using HKDF
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const authInfo = concatBuffers(
    new TextEncoder().encode('WebPush: info\0'),
    clientPublicKeyBytes,
    serverPublicKeyRaw,
  )

  const prkKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveBits'])
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: clientAuth, info: authInfo },
      prkKey,
      256,
    ),
  )

  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits'])

  const keyInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0')
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0')

  const contentKey = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: keyInfo },
      ikmKey,
      128,
    ),
  )

  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo },
      ikmKey,
      96,
    ),
  )

  // Encrypt with AES-128-GCM
  const paddedPayload = concatBuffers(new TextEncoder().encode(payload), new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['encrypt'])
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, paddedPayload),
  )

  return { ciphertext: encrypted, salt, serverPublicKey: serverPublicKeyRaw }
}

function buildAes128gcmBody(ciphertext: Uint8Array, salt: Uint8Array, serverPublicKey: Uint8Array): Uint8Array {
  // Header: salt (16) + rs (4) + idlen (1) + keyid (65) + ciphertext
  const rs = 4096
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKey.length)
  header.set(salt, 0)
  const rsView = new DataView(header.buffer, 16, 4)
  rsView.setUint32(0, rs, false)
  header[20] = serverPublicKey.length
  header.set(serverPublicKey, 21)
  return concatBuffers(header, ciphertext)
}

// ─── Utility functions ───

function base64urlEncode(data: Uint8Array): string {
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Uint8Array {
  const padding = '='.repeat((4 - (str.length % 4)) % 4)
  const base64 = (str + padding).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function concatBuffers(...buffers: Uint8Array[]): Uint8Array {
  const totalLength = buffers.reduce((sum, b) => sum + b.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const buffer of buffers) {
    result.set(buffer, offset)
    offset += buffer.length
  }
  return result
}

function derToRaw(der: Uint8Array): Uint8Array {
  // DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  if (der[0] !== 0x30) return der
  let offset = 2
  const rLen = der[offset + 1]
  const r = der.slice(offset + 2, offset + 2 + rLen)
  offset += 2 + rLen
  const sLen = der[offset + 1]
  const s = der.slice(offset + 2, offset + 2 + sLen)

  // Pad/trim to 32 bytes each
  const rPad = new Uint8Array(32)
  const sPad = new Uint8Array(32)
  rPad.set(r.length > 32 ? r.slice(r.length - 32) : r, 32 - Math.min(r.length, 32))
  sPad.set(s.length > 32 ? s.slice(s.length - 32) : s, 32 - Math.min(s.length, 32))

  return concatBuffers(rPad, sPad)
}
