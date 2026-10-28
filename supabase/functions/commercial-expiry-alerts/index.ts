// Dedicated advertiser-expiry worker. It does not mutate campaigns or Player state.
// Deploy with verify_jwt=false only because the request authenticates using the
// existing private subscription-alert token (validated server-side via RPC).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendCompanyPush } from '../_shared/web-push.ts'

type Job = {
  id: string
  company_id: string
  user_id: string
  title: string
  message: string
}

const json = (value: unknown, status = 200) => new Response(
  JSON.stringify(value),
  { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
)

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const auth = request.headers.get('authorization') || ''
  if (!/^Bearer [A-Za-z0-9_-]{32,}$/.test(auth)) return json({ error: 'unauthorized' }, 401)

  try {
    let secret = ''
    try { secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')?.default || '' } catch {}
    secret ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const url = Deno.env.get('SUPABASE_URL') || ''
    if (!secret || !url) return json({ error: 'server_not_configured' }, 503)

    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    const token = auth.slice(7)
    const { data: accepted, error: verifyError } = await admin.rpc(
      'verify_subscription_alert_token',
      { p_token: token },
    )
    if (verifyError || accepted !== true) return json({ error: 'unauthorized' }, 401)

    const { data, error } = await admin.rpc('claim_vision_commercial_alerts')
    if (error) throw error
    const jobs = (data || []) as Job[]
    const outcomes: Array<{ id: string, sent: number, failed: number, skipped?: string }> = []

    for (const job of jobs) {
      let result: { sent: number, failed: number, skipped?: string }
      try {
        // Fifth argument scopes push to the designated administrator, not everyone
        // associated with the partner/company inbox.
        result = await sendCompanyPush(admin, job.company_id, {
          title: job.title,
          body: job.message,
          tag: `commercial-expiry-${job.id}`,
          url: 'https://vision-midia-digital.vercel.app/index.html',
        }, false, job.user_id)
      } catch (pushError) {
        console.error('commercial-expiry push failed', job.id, pushError)
        result = { sent: 0, failed: 1 }
      }

      const { error: finishError } = await admin.rpc('finish_vision_commercial_alert', {
        p_id: job.id,
        p_result: result,
        p_retry: result.failed > 0,
      })
      if (finishError) throw finishError
      outcomes.push({ id: job.id, ...result })
    }
    return json({ ok: true, processed: outcomes.length, outcomes })
  } catch (error) {
    console.error('commercial-expiry worker failure', error)
    return json({ error: 'worker_failed' }, 500)
  }
})
