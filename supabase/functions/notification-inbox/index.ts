import { createClient } from 'npm:@supabase/supabase-js@2'

const C = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const J = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...C, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const txt = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)

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

async function assertNotificationCompany(admin: any, notificationId: string, companyId: string) {
  const { data, error } = await admin
    .from('company_notifications')
    .select('id')
    .eq('id', notificationId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw Object.assign(new Error('notification_not_found'), { status: 404 })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: C })
  if (req.method !== 'POST') return J({ error: 'method_not_allowed' }, 405)

  try {
    const { admin, user } = await context(req)
    const body = await req.json().catch(() => ({}))
    const action = txt(body?.action, 40)

    if (action === 'create') {
      await assertMaster(admin, user.id)
      const companyId = txt(body?.company_id, 60)
      const title = txt(body?.title, 120)
      const message = txt(body?.message, 500)
      if (!companyId || !title || !message) return J({ error: 'invalid_input' }, 400)

      const { data: company, error: companyError } = await admin
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .maybeSingle()
      if (companyError) throw companyError
      if (!company) return J({ error: 'company_not_found' }, 404)

      const { data, error } = await admin
        .from('company_notifications')
        .insert({ company_id: companyId, title, message, created_by: user.id })
        .select('id,company_id,title,message,created_at')
        .single()
      if (error) throw error
      return J({ ok: true, notification: data })
    }

    const companyId = txt(body?.company_id, 60)
    if (!companyId) return J({ error: 'company_required' }, 400)
    await assertCompanyAccess(admin, user.id, companyId)

    if (action === 'list') {
      const { data: notifications, error: notificationsError } = await admin
        .from('company_notifications')
        .select('id,company_id,title,message,created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(100)
      if (notificationsError) throw notificationsError

      const ids = (notifications || []).map((item: any) => item.id)
      let states: any[] = []
      if (ids.length) {
        const { data, error } = await admin
          .from('company_notification_states')
          .select('notification_id,read_at,deleted_at')
          .eq('user_id', user.id)
          .in('notification_id', ids)
        if (error) throw error
        states = data || []
      }
      const stateById = new Map(states.map((item: any) => [item.notification_id, item]))
      const items = (notifications || [])
        .map((item: any) => {
          const local = stateById.get(item.id) || {}
          return { ...item, read_at: local.read_at || null, is_read: Boolean(local.read_at), deleted_at: local.deleted_at || null }
        })
        .filter((item: any) => !item.deleted_at)

      return J({ ok: true, items, unread_count: items.filter((item: any) => !item.is_read).length })
    }

    if (action === 'set_read') {
      const notificationId = txt(body?.notification_id, 60)
      if (!notificationId) return J({ error: 'notification_required' }, 400)
      await assertNotificationCompany(admin, notificationId, companyId)
      const isRead = body?.is_read !== false
      const now = new Date().toISOString()
      const { error } = await admin
        .from('company_notification_states')
        .upsert({
          notification_id: notificationId,
          user_id: user.id,
          read_at: isRead ? now : null,
          deleted_at: null,
          updated_at: now,
        }, { onConflict: 'notification_id,user_id' })
      if (error) throw error
      return J({ ok: true, is_read: isRead })
    }

    if (action === 'delete_many') {
      const ids = [...new Set((Array.isArray(body?.notification_ids) ? body.notification_ids : [])
        .map((value: unknown) => txt(value, 60))
        .filter(Boolean))]
        .slice(0, 100)
      if (!ids.length) return J({ error: 'notifications_required' }, 400)

      const { data: allowed, error: allowedError } = await admin
        .from('company_notifications')
        .select('id')
        .eq('company_id', companyId)
        .in('id', ids)
      if (allowedError) throw allowedError
      const allowedIds = (allowed || []).map((item: any) => item.id)
      if (!allowedIds.length) return J({ ok: true, deleted: 0 })

      const now = new Date().toISOString()
      const rows = allowedIds.map((notificationId: string) => ({
        notification_id: notificationId,
        user_id: user.id,
        read_at: now,
        deleted_at: now,
        updated_at: now,
      }))
      const { error } = await admin
        .from('company_notification_states')
        .upsert(rows, { onConflict: 'notification_id,user_id' })
      if (error) throw error
      return J({ ok: true, deleted: rows.length })
    }

    return J({ error: 'unknown_action' }, 400)
  } catch (error: any) {
    console.error('notification-inbox', error)
    return J({ error: error?.message || 'internal_error' }, Number(error?.status || 500))
  }
})
