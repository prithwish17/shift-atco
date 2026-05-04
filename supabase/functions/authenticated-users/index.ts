declare const Deno: any

import { supabase } from '../_shared/supabase.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}

type AuthUser = {
  id: string
  email?: string | null
  created_at?: string | null
  last_sign_in_at?: string | null
  email_confirmed_at?: string | null
  phone_confirmed_at?: string | null
  banned_until?: string | null
  app_metadata?: Record<string, unknown> | null
  user_metadata?: Record<string, unknown> | null
}

function getProviders(user: AuthUser) {
  const metadata = user.app_metadata || {}
  const providers = Array.isArray(metadata.providers)
    ? metadata.providers.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  if (providers.length > 0) {
    return providers
  }

  const provider = typeof metadata.provider === 'string' ? metadata.provider : ''
  return provider ? [provider] : ['email']
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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.replace('Bearer ', '')
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token)

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const { data: adminRoleRows, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('approved', true)

  if (roleError) {
    return new Response(JSON.stringify({ error: 'Unable to verify permissions' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const requesterRoles = (adminRoleRows || []).map((row: { role: string }) => row.role)
  if (!requesterRoles.includes('admin')) {
    return new Response(JSON.stringify({ error: 'Forbidden - admin role required' }), {
      status: 403,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const allUsers: AuthUser[] = []
    const perPage = 200

    for (let page = 1; page <= 50; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })

      if (error) {
        throw error
      }

      const pageUsers = (data?.users || []) as AuthUser[]
      allUsers.push(...pageUsers)

      if (pageUsers.length < perPage) {
        break
      }
    }

    const userIds = allUsers.map((authUser) => authUser.id)
    const profilesById = new Map<string, Record<string, unknown>>()
    const rolesByUserId = new Map<string, { role: string; approved: boolean }>()

    for (let index = 0; index < userIds.length; index += 500) {
      const chunk = userIds.slice(index, index + 500)
      if (chunk.length === 0) {
        continue
      }

      const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, employee_id, current_shift')
          .in('id', chunk),
        supabase
          .from('user_roles')
          .select('user_id, role, approved, created_at')
          .in('user_id', chunk)
          .order('created_at', { ascending: true }),
      ])

      if (profilesError) {
        throw profilesError
      }

      if (rolesError) {
        throw rolesError
      }

      for (const profile of profiles || []) {
        profilesById.set(profile.id, profile as Record<string, unknown>)
      }

      for (const role of roles || []) {
        if (!rolesByUserId.has(role.user_id)) {
          rolesByUserId.set(role.user_id, {
            role: role.role,
            approved: role.approved,
          })
        }
      }
    }

    const users = allUsers.map((authUser) => {
      const profile = profilesById.get(authUser.id)
      const role = rolesByUserId.get(authUser.id)
      const providers = getProviders(authUser)
      const userMetadata = authUser.user_metadata || {}

      return {
        id: authUser.id,
        email: authUser.email || '',
        full_name:
          (typeof profile?.full_name === 'string' && profile.full_name) ||
          (typeof userMetadata.full_name === 'string' && userMetadata.full_name) ||
          '',
        employee_id:
          (typeof profile?.employee_id === 'string' && profile.employee_id) ||
          (typeof userMetadata.employee_id === 'string' && userMetadata.employee_id) ||
          '',
        current_shift: typeof profile?.current_shift === 'string' ? profile.current_shift : null,
        role: role?.role || null,
        approved: role?.approved ?? false,
        has_profile: profilesById.has(authUser.id),
        email_confirmed: Boolean(authUser.email_confirmed_at),
        phone_confirmed: Boolean(authUser.phone_confirmed_at),
        created_at: authUser.created_at || null,
        last_sign_in_at: authUser.last_sign_in_at || null,
        banned_until: authUser.banned_until || null,
        provider: providers[0] || 'email',
        providers,
        registration_source:
          typeof userMetadata.registration_source === 'string'
            ? userMetadata.registration_source
            : null,
      }
    })

    return new Response(JSON.stringify({ users, total: users.length }), {
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