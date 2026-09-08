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
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function adminClient() {
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url = Deno.env.get('SUPABASE_URL') || ''
  if (!secret || !url) throw new Error('backend_keys_unavailable')
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const email = clean(body.email, 320).toLowerCase()
    const password = String(body.password ?? '')
    const displayName = clean(body.display_name, 120)

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400)
    if (password.length < 8 || password.length > 72) return json({ error: 'invalid_password' }, 400)
    if (displayName.length < 2) return json({ error: 'invalid_display_name' }, 400)

    const forwarded = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown'
    const source = forwarded.split(',')[0].trim().slice(0, 120)
    const sourceHash = await sha256(`vision-signup:${source}`)
    const emailHash = await sha256(`vision-signup:${email}`)
    const admin = adminClient()
    const attempts = admin.from('public_signup_attempts')

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const [{ count: sourceCount, error: sourceError }, { count: emailCount, error: emailError }] = await Promise.all([
      attempts.select('id', { count: 'exact', head: true }).eq('source_hash', sourceHash).gte('attempted_at', tenMinutesAgo),
      attempts.select('id', { count: 'exact', head: true }).eq('email_hash', emailHash).gte('attempted_at', oneHourAgo),
    ])
    if (sourceError) throw sourceError
    if (emailError) throw emailError
    if ((sourceCount || 0) >= 5 || (emailCount || 0) >= 5) return json({ error: 'signup_rate_limited' }, 429)

    const { data: attempt, error: attemptError } = await attempts
      .insert({ source_hash: sourceHash, email_hash: emailHash, success: false })
      .select('id')
      .single()
    if (attemptError) throw attemptError

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    })

    if (error) {
      const msg = String(error.message || '')
      if (/already|registered|exists/i.test(msg)) return json({ error: 'email_already_registered' }, 409)
      console.error('public-signup createUser', { status: error.status, code: error.code })
      return json({ error: 'signup_failed' }, Number(error.status) || 400)
    }

    const { error: markError } = await attempts.update({ success: true }).eq('id', attempt.id)
    if (markError) console.error('public-signup mark success', markError)
    const { error: cleanupError } = await attempts.delete().lt('attempted_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    if (cleanupError) console.error('public-signup cleanup', cleanupError)

    return json({ ok: true, user_id: data.user?.id || null }, 201)
  } catch (error) {
    console.error('public-signup', error)
    return json({ error: 'internal_error' }, 500)
  }
})
