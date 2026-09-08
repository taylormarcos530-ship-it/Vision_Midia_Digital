import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-device-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function adminClient() {
  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
  const secret = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret) throw new Error('Supabase secret key unavailable')
  return createClient(Deno.env.get('SUPABASE_URL') || '', secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomBase64Url(bytes = 32) {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  let binary = ''
  for (const value of data) binary += String.fromCharCode(value)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function randomInt(max) {
  const values = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / max) * max
  do crypto.getRandomValues(values)
  while (values[0] >= limit)
  return values[0] % max
}

function pairingCode() {
  return String(randomInt(1_000_000)).padStart(6, '0')
}

async function playerBranding(admin, setupCode) {
  const code = String(setupCode || '').trim().toUpperCase().slice(0, 12)
  if (!code) return null
  const { data, error } = await admin.from('company_player_branding').select('company_id,title,message,splash_path').eq('setup_code', code).maybeSingle()
  if (error) throw error
  if (!data) return null
  let splashUrl = null
  if (data.splash_path) {
    const { data: signed, error: signedError } = await admin.storage.from('vision-media').createSignedUrl(data.splash_path, 60 * 60)
    if (!signedError) splashUrl = signed?.signedUrl || null
  }
  return { company_id: data.company_id, title: data.title || null, message: data.message || null, splash_url: splashUrl }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const action = body?.action
    const admin = adminClient()

    if (action === 'start') {
      const now = new Date()
      const cleanupBefore = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      await admin.from('device_pairing_requests').delete().lt('created_at', cleanupBefore)
      await admin.from('device_pairing_requests')
        .update({ status: 'expired', issued_token: null })
        .eq('status', 'pending')
        .lt('expires_at', now.toISOString())

      const forwarded = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
      const source = forwarded || req.headers.get('cf-connecting-ip') || req.headers.get('user-agent') || 'unknown'
      const sourceHash = await sha256Hex(source)
      const rateSince = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
      const { count } = await admin
        .from('device_pairing_requests')
        .select('id', { count: 'exact', head: true })
        .eq('request_source_hash', sourceHash)
        .gte('created_at', rateSince)

      if ((count || 0) >= 10) {
        return json({ error: 'rate_limited', message: 'Muitas solicitações de pareamento. Tente novamente em alguns minutos.' }, 429)
      }

      const requestSecret = randomBase64Url(32)
      const requestSecretHash = await sha256Hex(requestSecret)
      const platform = ['android', 'windows', 'web', 'firetv', 'smarttv', 'other'].includes(body?.platform)
        ? body.platform
        : 'web'
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString()
      const branding = await playerBranding(admin, body?.setup_code)

      for (let attempt = 0; attempt < 6; attempt++) {
        const code = pairingCode()
        const codeHash = await sha256Hex(code)
        const { data, error } = await admin
          .from('device_pairing_requests')
          .insert({
            code_hash: codeHash,
            request_secret_hash: requestSecretHash,
            request_source_hash: sourceHash,
            platform,
            user_agent: String(req.headers.get('user-agent') || '').slice(0, 500),
            setup_company_id: branding?.company_id || null,
            expires_at: expiresAt,
          })
          .select('id,expires_at')
          .single()

        if (!error && data) {
          return json({
            status: 'pending',
            request_id: data.id,
            request_secret: requestSecret,
            pairing_code: code,
            expires_at: data.expires_at,
            branding: branding ? { title: branding.title, message: branding.message, splash_url: branding.splash_url } : null,
          })
        }
        if (error?.code !== '23505') throw error
      }

      return json({ error: 'pairing_code_unavailable' }, 503)
    }

    if (action === 'poll') {
      const requestId = String(body?.request_id || '')
      const requestSecret = String(body?.request_secret || '')
      if (!requestId || requestSecret.length < 20) return json({ error: 'invalid_pairing_request' }, 400)

      const { data: pairing, error } = await admin
        .from('device_pairing_requests')
        .select('id,request_secret_hash,status,device_id,expires_at,issued_token')
        .eq('id', requestId)
        .maybeSingle()

      if (error) throw error
      if (!pairing) return json({ error: 'pairing_not_found' }, 404)
      if ((await sha256Hex(requestSecret)) !== pairing.request_secret_hash) return json({ error: 'invalid_pairing_secret' }, 401)

      const now = new Date()
      await admin.from('device_pairing_requests').update({ last_poll_at: now.toISOString() }).eq('id', requestId)

      if (new Date(pairing.expires_at).getTime() <= now.getTime()) {
        await admin.from('device_pairing_requests').update({ status: 'expired', issued_token: null }).eq('id', requestId)
        return json({ status: 'expired' }, 410)
      }

      if (pairing.status === 'pending') return json({ status: 'pending', expires_at: pairing.expires_at })
      if (pairing.status === 'cancelled' || pairing.status === 'expired') return json({ status: pairing.status }, 410)

      if (pairing.status === 'claimed' && !pairing.device_id) {
        return json({ status: 'claimed', finalizing: true })
      }

      if (pairing.status === 'claimed' && pairing.device_id) {
        const deviceToken = randomBase64Url(32)
        const tokenHash = await sha256Hex(deviceToken)
        const { error: credentialError } = await admin
          .from('device_credentials')
          .upsert({
            device_id: pairing.device_id,
            token_hash: tokenHash,
            created_at: now.toISOString(),
            rotated_at: null,
            last_used_at: null,
            revoked_at: null,
          }, { onConflict: 'device_id' })
        if (credentialError) throw credentialError

        const { error: issueError } = await admin
          .from('device_pairing_requests')
          .update({ status: 'issued', issued_at: now.toISOString(), issued_token: deviceToken })
          .eq('id', requestId)
        if (issueError) throw issueError

        return json({ status: 'issued', device_id: pairing.device_id, device_token: deviceToken })
      }

      if (pairing.status === 'issued') {
        return json({
          status: 'issued',
          device_id: pairing.device_id,
          device_token: pairing.issued_token || null,
          token_already_delivered: !pairing.issued_token,
        })
      }

      return json({ status: pairing.status })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('device-bootstrap', error)
    return json({ error: 'internal_error', message: error?.message || 'Falha interna.' }, 500)
  }
})
