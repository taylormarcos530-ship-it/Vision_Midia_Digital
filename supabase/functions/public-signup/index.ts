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

const clean = (value: unknown, max = 160) => String(value ?? '').trim().slice(0, max)

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function adminClient() {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'
  let secret = ''
  try { secret = JSON.parse(raw).default || '' } catch { secret = '' }
  secret ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const url = Deno.env.get('SUPABASE_URL') || ''
  if (!secret || !url) throw new Error('backend_keys_unavailable')
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const body = await req.json().catch(() => ({}))
  const email = clean(body.email, 320).toLowerCase()
  const password = String(body.password ?? '')
  const displayName = clean(body.display_name, 120)

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400)
  if (password.length < 8 || password.length > 72) return json({ error: 'invalid_password' }, 400)
  if (displayName.length < 2) return json({ error: 'invalid_display_name' }, 400)

  let admin
  try { admin = adminClient() } catch (error) {
    console.error('public-signup backend init', error)
    return json({ error: 'signup_backend_unavailable' }, 503)
  }

  try {
    const forwarded = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown'
    const source = forwarded.split(',')[0].trim().slice(0, 120)
    const sourceHash = await sha256(`vision-signup:${source}`)
    const emailHash = await sha256(`vision-signup:${email}`)

    const { data: attemptId, error: rateError } = await admin.rpc('consume_public_signup_attempt', {
      p_source_hash: sourceHash,
      p_email_hash: emailHash,
    })
    if (rateError) {
      console.error('public-signup rate-limit', rateError)
      return json({ error: 'signup_rate_limit_backend_error' }, 503)
    }
    if (attemptId == null) return json({ error: 'signup_rate_limited' }, 429)

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    })

    if (error) {
      const msg = String(error.message || '')
      if (/already|registered|exists/i.test(msg)) return json({ error: 'email_already_registered' }, 409)
      console.error('public-signup createUser', { status: error.status, code: error.code, message: error.message })
      return json({ error: 'signup_create_user_failed' }, Number(error.status) || 400)
    }

    const { error: markError } = await admin.rpc('mark_public_signup_attempt_success', { p_attempt_id: attemptId })
    if (markError) console.error('public-signup mark success', markError)

    return json({ ok: true, user_id: data.user?.id || null }, 201)
  } catch (error) {
    console.error('public-signup unexpected', error)
    return json({ error: 'signup_unexpected_error' }, 500)
  }
})
