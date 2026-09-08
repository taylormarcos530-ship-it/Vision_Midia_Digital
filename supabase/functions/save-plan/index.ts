import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function clients() {
  const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default || Deno.env.get('SUPABASE_ANON_KEY')
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url = Deno.env.get('SUPABASE_URL') || ''
  if (!publishable || !secret || !url) throw new Error('backend_keys_unavailable')
  return {
    url,
    publishable,
    admin: createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'authentication_required' }, 401)

    const { url, publishable, admin } = clients()
    const userClient = createClient(url, publishable, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser(authHeader.slice(7))
    if (userError || !userData?.user) return json({ error: 'invalid_session' }, 401)

    const body = await req.json().catch(() => ({}))
    const { data, error } = await admin.rpc('save_platform_plan_internal', {
      p_actor_user_id: userData.user.id,
      p_id: body.id || null,
      p_name: String(body.name || '').trim(),
      p_slug: String(body.slug || '').trim(),
      p_description: String(body.description || '').trim(),
      p_monthly_price_cents: Number(body.monthly_price_cents),
      p_max_devices: body.max_devices === null || body.max_devices === '' ? null : Number(body.max_devices),
      p_storage_limit_mb: body.storage_limit_mb === null || body.storage_limit_mb === '' ? null : Number(body.storage_limit_mb),
      p_max_users: body.max_users === null || body.max_users === '' ? null : Number(body.max_users),
      p_max_campaigns: body.max_campaigns === null || body.max_campaigns === '' ? null : Number(body.max_campaigns),
      p_is_active: body.is_active !== false,
      p_sort_order: Number(body.sort_order || 0),
    })

    if (error) {
      const message = String(error.message || '')
      const code = String(error.code || '')
      if (/super_admin_required/i.test(message) || code === '42501') return json({ error: 'super_admin_required' }, 403)
      if (/plans_slug_key|duplicate key/i.test(message) || code === '23505') return json({ error: 'plan_slug_already_exists' }, 409)
      if (/invalid_plan_|plan_not_found/i.test(message)) return json({ error: message }, 400)
      console.error('save-plan rpc', { code, message })
      return json({ error: 'plan_save_failed' }, 500)
    }

    return json({ ok: true, plan: data }, 200)
  } catch (error) {
    console.error('save-plan', error)
    return json({ error: 'plan_save_unexpected_error' }, 500)
  }
})
