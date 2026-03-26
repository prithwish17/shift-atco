/**
 * Notification Preferences API — manages per-user, per-event channel preferences.
 *
 * GET:  Returns all preferences for the authenticated user
 * PUT:  Upsert preferences for a specific event_type
 *
 * Request body (PUT):
 *   { event_type: string, email: boolean, push: boolean, in_app: boolean }
 */

import { supabase } from '../_shared/supabase.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}

const EVENT_TYPES = [
  'leave_status',
  'leave_request',
  'duty_exchange',
  'duty_change',
  'ope_reminder',
  'license_expiry',
  'compoff_expiry',
  'compoff_expired',
  'license_expired',
  'general',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  // Authenticate
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    if (req.method === 'GET') {
      // Return all preferences, filling defaults for missing event types
      const { data: prefs, error } = await supabase
        .from('notification_preferences')
        .select('event_type, email, push, in_app')
        .eq('user_id', user.id)

      if (error) throw error

      const prefMap = new Map<string, { email: boolean; push: boolean; in_app: boolean }>()
      for (const p of (prefs || []) as any[]) {
        prefMap.set(p.event_type, { email: p.email, push: p.push, in_app: p.in_app })
      }

      // Fill defaults
      const result = EVENT_TYPES.map(et => ({
        event_type: et,
        email: prefMap.get(et)?.email ?? true,
        push: prefMap.get(et)?.push ?? true,
        in_app: prefMap.get(et)?.in_app ?? true,
      }))

      return new Response(JSON.stringify(result), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (req.method === 'PUT') {
      const body = await req.json()
      const { event_type, email, push, in_app } = body

      if (!event_type || !EVENT_TYPES.includes(event_type)) {
        return new Response(JSON.stringify({ error: `Invalid event_type. Must be one of: ${EVENT_TYPES.join(', ')}` }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          event_type,
          email: email ?? true,
          push: push ?? true,
          in_app: in_app ?? true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,event_type' })

      if (error) throw error

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[notification-preferences]', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
