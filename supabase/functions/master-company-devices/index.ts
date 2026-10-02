import { createClient } from 'npm:@supabase/supabase-js@2'

const C = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const J = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...C, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function clients() {
  const pub = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default || Deno.env.get('SUPABASE_ANON_KEY')
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url = Deno.env.get('SUPABASE_URL') || ''
  if (!pub || !secret || !url) throw new Error('keys_unavailable')
  return {
    url,
    pub,
    admin: createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}

function accessLabel(device: any) {
  if (device.access_status === 'pending') return 'pending'
  if (device.access_status === 'blocked') return 'blocked'
  if (device.access_expires_at && new Date(device.access_expires_at).getTime() <= Date.now()) return 'expired'
  return device.access_expires_at ? 'temporary' : 'permanent'
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: C })
  if (req.method !== 'POST') return J({ error: 'method_not_allowed' }, 405)

  try {
    const h = req.headers.get('authorization') || ''
    if (!h.startsWith('Bearer ')) return J({ error: 'authentication_required' }, 401)

    const { url, pub, admin } = clients()
    const uc = createClient(url, pub, {
      global: { headers: { Authorization: h } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: u, error: ue } = await uc.auth.getUser(h.slice(7))
    if (ue || !u?.user) return J({ error: 'invalid_session' }, 401)

    const { data: pa, error: pe } = await admin
      .from('platform_admins')
      .select('role,status')
      .eq('user_id', u.user.id)
      .maybeSingle()
    if (pe) throw pe
    if (!pa || pa.status !== 'active') return J({ error: 'master_forbidden' }, 403)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || 'list')
    const companyId = String(body.company_id || '').trim()
    if (!companyId) return J({ error: 'company_required' }, 400)

    if (action === 'set_access') {
      if (!['super_admin', 'admin'].includes(pa.role)) return J({ error: 'master_read_only' }, 403)

      const deviceId = String(body.device_id || '').trim()
      const mode = String(body.mode || '').trim()
      if (!deviceId) return J({ error: 'device_required' }, 400)

      const { data: device, error: deviceError } = await admin
        .from('devices')
        .select('id,company_id,name,access_status,access_expires_at,retired_at')
        .eq('id', deviceId)
        .eq('company_id', companyId)
        .maybeSingle()
      if (deviceError) throw deviceError
      if (!device || device.retired_at) return J({ error: 'device_not_found' }, 404)

      const now = new Date()
      let accessStatus = 'active'
      let expiresAt: string | null = null

      if (mode === 'permanent') {
        accessStatus = 'active'
      } else if (mode === '10_minutes') {
        expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString()
      } else if (['7_days', '30_days', '90_days'].includes(mode)) {
        const days = Number(mode.split('_')[0])
        expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
      } else if (mode === 'date') {
        const parsed = new Date(String(body.expires_at || ''))
        if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= now.getTime()) {
          return J({ error: 'invalid_expiry', message: 'Escolha uma data futura para a autorização.' }, 400)
        }
        expiresAt = parsed.toISOString()
      } else if (mode === 'block') {
        accessStatus = 'blocked'
      } else if (mode === 'pending') {
        accessStatus = 'pending'
      } else {
        return J({ error: 'invalid_access_mode' }, 400)
      }

      const update = {
        access_status: accessStatus,
        access_expires_at: expiresAt,
        access_updated_at: now.toISOString(),
        access_updated_by: u.user.id,
      }
      const { data: updated, error: updateError } = await admin
        .from('devices')
        .update(update)
        .eq('id', deviceId)
        .eq('company_id', companyId)
        .select('id,name,platform,orientation,status,last_seen_at,paired_at,retired_at,access_status,access_expires_at,access_updated_at')
        .single()
      if (updateError) throw updateError

      await admin.from('master_audit_logs').insert({
        actor_user_id: u.user.id,
        action: 'device_access_updated',
        company_id: companyId,
        details: {
          device_id: deviceId,
          device_name: device.name,
          previous_status: device.access_status,
          previous_expires_at: device.access_expires_at,
          access_status: accessStatus,
          access_expires_at: expiresAt,
          mode,
        },
      })

      return J({ ok: true, device: { ...updated, access_state: accessLabel(updated) } })
    }

    if (action !== 'list') return J({ error: 'unknown_action' }, 400)

    const [{ data: devices, error: de }, { data: sub, error: se }] = await Promise.all([
      admin.from('devices')
        .select('id,name,platform,orientation,status,last_seen_at,paired_at,retired_at,access_status,access_expires_at,access_updated_at')
        .eq('company_id', companyId)
        .is('retired_at', null)
        .order('created_at', { ascending: false }),
      admin.from('company_subscriptions')
        .select('plan_id,limit_overrides')
        .eq('company_id', companyId)
        .maybeSingle(),
    ])
    if (de) throw de
    if (se) throw se

    let maxDevices = null
    if (sub) {
      const override = sub.limit_overrides?.max_devices
      if (override !== undefined && override !== null && override !== '') maxDevices = Number(override)
      else {
        const { data: p, error: e } = await admin.from('plans').select('max_devices').eq('id', sub.plan_id).maybeSingle()
        if (e) throw e
        maxDevices = p?.max_devices ?? null
      }
    }

    return J({
      ok: true,
      devices: (devices || []).map(device => ({ ...device, access_state: accessLabel(device) })),
      max_devices: maxDevices,
    })
  } catch (e) {
    console.error('master-company-devices', e)
    return J({ error: 'internal_error', message: String(e?.message || 'internal_error') }, 500)
  }
})
