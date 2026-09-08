import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function keys() {
  const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default
    || Deno.env.get('SUPABASE_ANON_KEY')
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default
    || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!publishable || !secret) throw new Error('Supabase keys unavailable')
  return { publishable, secret }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const authHeader = req.headers.get('authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'authentication_required' }, 401)

    const { publishable, secret } = keys()
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const userClient = createClient(supabaseUrl, publishable, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const admin = createClient(supabaseUrl, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const token = authHeader.slice('Bearer '.length)
    const { data: userData, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userData?.user) return json({ error: 'invalid_session' }, 401)
    const user = userData.user

    const body = await req.json().catch(() => ({}))
    const companyId = String(body?.company_id || '')
    const code = String(body?.code || '').replace(/\D/g, '')
    const name = String(body?.name || '').trim().slice(0, 120)
    const orientation = ['auto', 'landscape', 'portrait'].includes(body?.orientation) ? body.orientation : 'auto'

    if (!companyId || code.length !== 6 || name.length < 1) return json({ error: 'invalid_input' }, 400)

    const { data: membership, error: membershipError } = await admin
      .from('company_members')
      .select('role,status')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership || membership.status !== 'active' || !['owner', 'admin', 'operator'].includes(membership.role)) {
      return json({ error: 'forbidden' }, 403)
    }

    const rateSince = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { count } = await admin
      .from('device_claim_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('attempted_at', rateSince)
    if ((count || 0) >= 20) return json({ error: 'rate_limited', message: 'Muitas tentativas de pareamento. Tente novamente em alguns minutos.' }, 429)

    const codeHash = await sha256Hex(code)
    const { data: pairing, error: pairingError } = await admin
      .from('device_pairing_requests')
      .select('id,status,expires_at,platform')
      .eq('code_hash', codeHash)
      .eq('status', 'pending')
      .maybeSingle()
    if (pairingError) throw pairingError

    if (!pairing) {
      await admin.from('device_claim_attempts').insert({ user_id: user.id, success: false })
      return json({ error: 'invalid_code', message: 'Código inválido ou já utilizado.' }, 404)
    }

    if (new Date(pairing.expires_at).getTime() <= Date.now()) {
      await admin.from('device_pairing_requests').update({ status: 'expired', issued_token: null }).eq('id', pairing.id)
      await admin.from('device_claim_attempts').insert({ user_id: user.id, success: false })
      return json({ error: 'expired_code', message: 'Esse código expirou. Gere um novo código na TV.' }, 410)
    }

    const now = new Date().toISOString()
    const { data: claimed, error: claimError } = await admin
      .from('device_pairing_requests')
      .update({
        status: 'claimed',
        company_id: companyId,
        claimed_by: user.id,
        claimed_at: now,
      })
      .eq('id', pairing.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (claimError) throw claimError
    if (!claimed) return json({ error: 'code_already_claimed' }, 409)

    const { data: device, error: deviceError } = await admin
      .from('devices')
      .insert({
        company_id: companyId,
        name,
        platform: pairing.platform,
        orientation,
        status: 'offline',
        paired_at: now,
        settings: { player: 'vision-web-v1' },
      })
      .select('*')
      .single()

    if (deviceError) {
      await admin.from('device_pairing_requests')
        .update({ status: 'pending', company_id: null, claimed_by: null, claimed_at: null })
        .eq('id', pairing.id)
        .eq('status', 'claimed')
      throw deviceError
    }

    const { error: linkError } = await admin
      .from('device_pairing_requests')
      .update({ device_id: device.id })
      .eq('id', pairing.id)
    if (linkError) {
      await admin.from('devices').delete().eq('id', device.id)
      await admin.from('device_pairing_requests')
        .update({ status: 'pending', company_id: null, claimed_by: null, claimed_at: null, device_id: null })
        .eq('id', pairing.id)
      throw linkError
    }

    await admin.from('device_claim_attempts').insert({ user_id: user.id, success: true })
    return json({ ok: true, device })
  } catch (error) {
    console.error('claim-device', error)
    return json({ error: 'internal_error', message: error?.message || 'Falha interna.' }, 500)
  }
})
