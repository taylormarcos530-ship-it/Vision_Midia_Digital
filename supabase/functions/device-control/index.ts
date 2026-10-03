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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: C })
  if (req.method !== 'POST') return J({ error: 'method_not_allowed' }, 405)

  try {
    const auth = req.headers.get('authorization') || ''
    if (!auth.startsWith('Bearer ')) return J({ error: 'authentication_required' }, 401)

    const { url, publishable, admin } = clients()
    const userClient = createClient(url, publishable, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser(auth.slice(7))
    if (userError || !userData?.user) return J({ error: 'invalid_session' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '').trim()
    const companyId = String(body?.company_id || '').trim()
    const deviceId = String(body?.device_id || '').trim()
    if (!companyId || !deviceId) return J({ error: 'company_and_device_required' }, 400)

    const { data: membership, error: membershipError } = await admin
      .from('company_members')
      .select('role,status')
      .eq('company_id', companyId)
      .eq('user_id', userData.user.id)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership || membership.status !== 'active' || !['owner','admin','operator'].includes(membership.role)) {
      return J({ error: 'device_control_forbidden' }, 403)
    }

    const { data: device, error: deviceError } = await admin
      .from('devices')
      .select('id,company_id,name,retired_at,status')
      .eq('id', deviceId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (deviceError) throw deviceError
    if (!device || device.retired_at) return J({ error: 'device_not_found' }, 404)

    if (action !== 'restart_player') return J({ error: 'unknown_action' }, 400)

    const { data: pending, error: pendingError } = await admin
      .from('device_commands')
      .select('id,status,requested_at')
      .eq('company_id', companyId)
      .eq('device_id', deviceId)
      .eq('command_type', 'restart_player')
      .in('status', ['pending','sent'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (pendingError) throw pendingError
    if (pending) return J({ ok: true, duplicate: true, command: pending })

    const { data: command, error: commandError } = await admin
      .from('device_commands')
      .insert({
        company_id: companyId,
        device_id: deviceId,
        command_type: 'restart_player',
        requested_by: userData.user.id,
        status: 'pending',
      })
      .select('id,command_type,status,requested_at')
      .single()
    if (commandError) throw commandError

    await admin.from('master_audit_logs').insert({
      actor_user_id: userData.user.id,
      action: 'device_restart_requested',
      company_id: companyId,
      details: { device_id: deviceId, device_name: device.name, command_id: command.id },
    }).catch(() => null)

    return J({ ok: true, command })
  } catch (error: any) {
    console.error('device-control', error)
    return J({ error: error?.message || 'internal_error' }, Number(error?.status || 500))
  }
})
