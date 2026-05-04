/**
 * Email Logs API — returns sent email logs and queued email jobs for admin/supervisor viewing.
 *
 * Params:
 *   ?limit=50           — max rows (default 50, max 200)
 *   ?offset=0           — pagination offset
 *   ?event_type=...     — filter by event_type
 *   ?status=...         — filter by status
 *   ?search=...         — search by email_to or subject/title
 *   ?view=logs|queue    — choose sent email logs or queued emails
 *   action=delete_queue — delete a queued email row by id
 *
 * Requires authenticated user with admin or supervisor role.
 */

declare const Deno: any

import { supabase } from '../_shared/supabase.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
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

  // Check role — only admin or supervisor
  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('approved', true)

  const userRoles = (roles || []).map((r: any) => r.role)
  if (!userRoles.includes('admin') && !userRoles.includes('supervisor')) {
    return new Response(JSON.stringify({ error: 'Forbidden — admin or supervisor role required' }), {
      status: 403,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    // Accept params from both GET query string and POST body
    let params: Record<string, string> = {}
    if (req.method === 'GET') {
      const url = new URL(req.url)
      url.searchParams.forEach((v, k) => { params[k] = v })
    } else {
      try { params = await req.json() } catch { params = {} }
    }

    const limit = Math.min(parseInt(params.limit || '50'), 200)
    const offset = parseInt(params.offset || '0')
    const view = params.view === 'queue' ? 'queue' : 'logs'
    const action = params.action || ''
    const eventType = params.event_type || ''
    const statusFilter = params.status || ''
    const search = (params.search || '').trim()

    // ── Email system status ─────────────────────────────────────────────────
    if (action === 'get_email_system_status') {
      // Only admin role can access this
      if (!userRoles.includes('admin')) {
        return new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      const { data: setting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'email_system_enabled')
        .maybeSingle()

      const enabled = setting?.value !== 'false'

      // Count pending email jobs
      const { count: pendingCount } = await supabase
        .from('notification_queue')
        .select('id', { count: 'exact', head: true })
        .eq('channel', 'email')
        .in('status', ['pending', 'failed'])

      return new Response(JSON.stringify({ enabled, pending_count: pendingCount ?? 0 }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ── Toggle email system ─────────────────────────────────────────────────
    if (action === 'set_email_system') {
      // Only admin role can access this
      if (!userRoles.includes('admin')) {
        return new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      const enabledParam = params.enabled
      if (enabledParam === undefined || enabledParam === null) {
        return new Response(JSON.stringify({ error: 'enabled (boolean) is required' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      const enabledBool = String(enabledParam) === 'true'

      // Persist the setting
      const { error: upsertError } = await supabase
        .from('app_settings')
        .upsert(
          { key: 'email_system_enabled', value: String(enabledBool), label: 'Email Notification System', updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )

      if (upsertError) throw upsertError

      let cancelledCount = 0

      // On pause: count first, then mark all pending/failed email jobs as cancelled
      // (Supabase JS update() does not support count: 'exact' directly)
      if (!enabledBool) {
        const { count: pendingCount } = await supabase
          .from('notification_queue')
          .select('id', { count: 'exact', head: true })
          .eq('channel', 'email')
          .in('status', ['pending', 'failed'])

        cancelledCount = pendingCount ?? 0

        if (cancelledCount > 0) {
          await supabase
            .from('notification_queue')
            .update({
              status: 'cancelled',
              last_error: 'Email system paused by admin',
              processed_at: new Date().toISOString(),
            })
            .eq('channel', 'email')
            .in('status', ['pending', 'failed'])
        }
      }

      return new Response(JSON.stringify({ enabled: enabledBool, cancelled_count: cancelledCount }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ── Delete individual queued email ──────────────────────────────────────
    if (action === 'delete_queue') {
      const queueId = params.queue_id || ''
      if (!queueId) {
        return new Response(JSON.stringify({ error: 'queue_id is required' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      const { error: deleteError, count } = await supabase
        .from('notification_queue')
        .delete({ count: 'exact' })
        .eq('id', queueId)
        .eq('channel', 'email')
        .in('status', ['pending', 'failed', 'dead_letter'])

      if (deleteError) throw deleteError

      return new Response(JSON.stringify({ deleted: count ?? 0 }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (view === 'queue') {
      const ACTIVE_QUEUE_STATUSES = ['pending', 'processing', 'failed', 'dead_letter']

      let matchingUserIds: string[] = []
      let hasSearchProfileFilter = false
      if (search) {
        const { data: matchedProfiles, error: profileSearchError } = await supabase
          .from('profiles')
          .select('id')
          .or(`email.ilike.%${search}%,full_name.ilike.%${search}%`)
          .limit(500)

        if (profileSearchError) throw profileSearchError
        matchingUserIds = (matchedProfiles || [])
          .map((profile: any) => profile.id)
          .filter(Boolean)
        hasSearchProfileFilter = true

        const searchLower = search.toLowerCase()
        if (matchingUserIds.length === 0 && !eventType.toLowerCase().includes(searchLower) && !ACTIVE_QUEUE_STATUSES.some((status) => status.includes(searchLower))) {
          return new Response(JSON.stringify({
            logs: [],
            total: 0,
            limit,
            offset,
            summary: {
              total: 0,
              pending: 0,
              processing: 0,
              failed: 0,
              dead_letter: 0,
            },
          }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
      }

      let queueQuery = supabase
        .from('notification_queue')
        .select('id, user_id, event_type, priority, status, payload, attempts, max_attempts, next_attempt_at, last_error, created_at, processed_at', { count: 'exact' })
        .eq('channel', 'email')
        .in('status', ACTIVE_QUEUE_STATUSES)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })

      if (eventType) {
        queueQuery = queueQuery.eq('event_type', eventType)
      }
      if (statusFilter) {
        queueQuery = queueQuery.eq('status', statusFilter)
      }
      if (hasSearchProfileFilter) {
        queueQuery = matchingUserIds.length > 0
          ? queueQuery.in('user_id', matchingUserIds)
          : queueQuery.in('user_id', ['00000000-0000-0000-0000-000000000000'])
      }

      queueQuery = queueQuery.range(offset, offset + limit - 1)

      const { data: queueLogs, error: queueError, count } = await queueQuery
      if (queueError) throw queueError

      const queueUserIds = [...new Set((queueLogs || []).map((entry: any) => entry.user_id).filter(Boolean))]
      let queueUserMap: Record<string, { full_name: string; email: string }> = {}
      if (queueUserIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', queueUserIds)

        if (profilesError) throw profilesError

        for (const profile of (profiles || []) as any[]) {
          if (profile.id) {
            queueUserMap[profile.id] = {
              full_name: profile.full_name || 'Unknown',
              email: profile.email || '',
            }
          }
        }
      }

      const enrichedQueueLogs = (queueLogs || []).map((entry: any) => ({
        id: entry.id,
        user_id: entry.user_id,
        user_name: queueUserMap[entry.user_id]?.full_name || 'Unknown',
        email_to: queueUserMap[entry.user_id]?.email || '',
        subject: entry.payload?.title || entry.event_type,
        body: entry.payload?.body || '',
        event_type: entry.event_type,
        priority: entry.priority,
        status: entry.status,
        attempts: entry.attempts,
        max_attempts: entry.max_attempts,
        next_attempt_at: entry.next_attempt_at,
        processed_at: entry.processed_at,
        error_message: entry.last_error || null,
        created_at: entry.created_at,
      }))

      const { data: queueStats, error: queueStatsError } = await supabase
        .from('notification_queue')
        .select('status')
        .eq('channel', 'email')
        .in('status', ACTIVE_QUEUE_STATUSES)

      if (queueStatsError) throw queueStatsError

      const summary = {
        total: (queueStats || []).length,
        pending: (queueStats || []).filter((row: any) => row.status === 'pending').length,
        processing: (queueStats || []).filter((row: any) => row.status === 'processing').length,
        failed: (queueStats || []).filter((row: any) => row.status === 'failed').length,
        dead_letter: (queueStats || []).filter((row: any) => row.status === 'dead_letter').length,
      }

      return new Response(JSON.stringify({
        logs: enrichedQueueLogs,
        total: count ?? 0,
        limit,
        offset,
        summary,
      }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Build query
    let query = supabase
      .from('email_logs')
      .select('id, queue_id, user_id, email_to, subject, event_type, provider, provider_id, status, error_message, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (eventType) {
      query = query.eq('event_type', eventType)
    }
    if (statusFilter) {
      query = query.eq('status', statusFilter)
    }
    if (search) {
      query = query.or(`email_to.ilike.%${search}%,subject.ilike.%${search}%`)
    }

    query = query.range(offset, offset + limit - 1)

    const { data: logs, error: logsError, count } = await query

    if (logsError) throw logsError

    // Fetch user names for the logs
    const userIds = [...new Set((logs || []).map((l: any) => l.user_id).filter(Boolean))]
    let userMap: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)

      for (const p of (profiles || []) as any[]) {
        if (p.id) userMap[p.id] = p.full_name || 'Unknown'
      }
    }

    // Enrich logs with user names
    const enrichedLogs = (logs || []).map((log: any) => ({
      ...log,
      user_name: userMap[log.user_id] || 'Unknown',
    }))

    // Get summary stats
    const { data: stats } = await supabase
      .from('email_logs')
      .select('status, event_type')

    const summary = {
      total: (stats || []).length,
      sent: (stats || []).filter((s: any) => s.status === 'sent').length,
      failed: (stats || []).filter((s: any) => s.status === 'failed').length,
      bounced: (stats || []).filter((s: any) => s.status === 'bounced').length,
      by_event_type: {} as Record<string, number>,
    }
    for (const s of (stats || []) as any[]) {
      summary.by_event_type[s.event_type] = (summary.by_event_type[s.event_type] || 0) + 1
    }

    return new Response(JSON.stringify({
      logs: enrichedLogs,
      total: count ?? 0,
      limit,
      offset,
      summary,
    }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[email-logs]', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
