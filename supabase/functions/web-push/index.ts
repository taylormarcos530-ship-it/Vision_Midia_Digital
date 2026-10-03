import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendCompanyPush } from '../_shared/web-push.ts'

const C = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const J = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...C, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function clients() {
  let publishable = ''
  let secret = ''
  try { publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')?.default || '' } catch {}
  try { secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')?.default || '' } catch {}
  publishable ||= Deno.env.get('SUPABASE_ANON_KEY') || ''
  secret ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const url = Deno.env.get('SUPABASE_URL') || ''
  if (!url || !publishable || !secret) throw new Error('supabase_keys_unavailable')
  return {
    url,
    publishable,
    admin: createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}

async function context(req: Request) {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('authentication_required'), { status: 401 })
  const { url, publishable, admin } = clients()
  const userClient = createClient(url, publishable, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await userClient.auth.getUser(auth.slice(7))
  if (error || !data?.user) throw Object.assign(new Error('invalid_session'), { status: 401 })
  return { admin, user: data.user }
}

async function assertCompanyAccess(admin: any, userId: string, companyId: string) {
  const { data: company, error: companyError } = await admin
    .from('companies')
    .select('id,owner_user_id')
    .eq('id', companyId)
    .maybeSingle()
  if (companyError) throw companyError
  if (!company) throw Object.assign(new Error('company_not_found'), { status: 404 })
  if (company.owner_user_id === userId) return

  const { data: member, error: memberError } = await admin
    .from('company_members')
    .select('id')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (memberError) throw memberError
  if (!member) throw Object.assign(new Error('company_forbidden'), { status: 403 })
}

async function assertMaster(admin: any, userId: string) {
  const { data, error } = await admin
    .from('platform_admins')
    .select('role,status')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.status !== 'active' || !['super_admin', 'admin'].includes(data.role)) {
    throw Object.assign(new Error('master_forbidden'), { status: 403 })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: C })
  if (req.method !== 'POST') return J({ error: 'method_not_allowed' }, 405)

  try {
    const { admin, user } = await context(req)
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '').trim()

    if (action === 'subscribe') {
      const companyId = String(body?.company_id || '').trim()
      const subscription = body?.subscription || {}
      const endpoint = String(subscription?.endpoint || '').trim()
      const p256dh = String(subscription?.keys?.p256dh || '').trim()
      const authKey = String(subscription?.keys?.auth || '').trim()
      if (!companyId || !endpoint || !p256dh || !authKey) return J({ error: 'invalid_subscription' }, 400)

      await assertCompanyAccess(admin, user.id, companyId)

      const now = new Date().toISOString()
      const { data, error } = await admin
        .from('web_push_subscriptions')
        .upsert({
          user_id: user.id,
          company_id: companyId,
          endpoint,
          p256dh,
          auth_key: authKey,
          user_agent: String(req.headers.get('user-agent') || '').slice(0, 500) || null,
          updated_at: now,
          last_seen_at: now,
          disabled_at: null,
        }, { onConflict: 'endpoint' })
        .select('id,company_id,last_seen_at')
        .single()
      if (error) throw error
      return J({ ok: true, subscription: data })
    }

    if (action === 'unsubscribe') {
      const endpoint = String(body?.endpoint || '').trim()
      if (!endpoint) return J({ error: 'endpoint_required' }, 400)
      const { error } = await admin
        .from('web_push_subscriptions')
        .delete()
        .eq('endpoint', endpoint)
        .eq('user_id', user.id)
      if (error) throw error
      return J({ ok: true })
    }

    if (action === 'send_company') {
      await assertMaster(admin, user.id)
      const companyId = String(body?.company_id || '').trim()
      if (!companyId) return J({ error: 'company_required' }, 400)
      const result = await sendCompanyPush(admin, companyId, {
        title: String(body?.title || 'Vision Mídia Digital').slice(0, 120),
        body: String(body?.message || '').slice(0, 500),
        url: String(body?.url || './').slice(0, 500),
        icon: './icon.svg',
        image: body?.image ? String(body.image).slice(0, 1200) : null,
        tag: String(body?.tag || 'vision-master').slice(0, 120),
      })
      return J({ ok: true, ...result })
    }

    if (action === 'status') {
      const companyId = String(body?.company_id || '').trim()
      if (!companyId) return J({ error: 'company_required' }, 400)
      await assertCompanyAccess(admin, user.id, companyId)
      const { count, error } = await admin
        .from('web_push_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('user_id', user.id)
        .is('disabled_at', null)
      if (error) throw error
      return J({ ok: true, subscribed: Number(count || 0) > 0 })
    }

    return J({ error: 'unknown_action' }, 400)
  } catch (error: any) {
    console.error('web-push', error)
    return J({ error: error?.message || 'internal_error' }, Number(error?.status || 500))
  }
})
