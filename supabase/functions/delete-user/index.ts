declare const Deno: any

import { supabase } from '../_shared/supabase.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}

type DeleteUserRequest = {
  userId?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.replace('Bearer ', '')
  const {
    data: { user: requester },
    error: authError,
  } = await supabase.auth.getUser(token)

  if (authError || !requester) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const { data: requesterRoles, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', requester.id)
    .eq('approved', true)

  if (roleError) {
    return new Response(JSON.stringify({ error: 'Unable to verify permissions' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const roles = (requesterRoles || []).map((row: { role: string }) => row.role)
  if (!roles.includes('admin')) {
    return new Response(JSON.stringify({ error: 'Forbidden - admin role required' }), {
      status: 403,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  let payload: DeleteUserRequest
  try {
    payload = (await req.json()) as DeleteUserRequest
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const userId = typeof payload.userId === 'string' ? payload.userId.trim() : ''
  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId is required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  if (userId === requester.id) {
    return new Response(JSON.stringify({ error: 'You cannot delete your own account' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { error } = await supabase.auth.admin.deleteUser(userId)

    if (error) {
      throw error
    }

    return new Response(JSON.stringify({ success: true, userId }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})