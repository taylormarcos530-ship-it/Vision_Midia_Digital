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
type ClientEmailJob = {
  id: string
  recipient_email: string
  title: string
  message: string
}
const htmlEscape = (value: string) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')


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
    // Client notifications use the advertiser's verified login e-mail.
    // This is separate from Master Push, and cannot reach partner-company push devices.
    let emailSent = 0
    let emailFailed = 0
    let emailSkipped = 'delivery_disabled'
    try {
      const { data: cfg, error: cfgError } = await admin
        .from('platform_public_config')
        .select('resend_sender_email,resend_sender_name,resend_enabled')
        .eq('id', 1).maybeSingle()
      if (cfgError) throw cfgError
      const senderEmail = String(cfg?.resend_sender_email || '').trim()
      const senderName = String(cfg?.resend_sender_name || 'Vision Mídia Digital').trim()
      if (cfg?.resend_enabled === true && senderEmail) {
        const { data: rawKey, error: keyError } = await admin.rpc(
          'get_vision_midia_service_secret',
          { p_name: 'vision_midia_resend_api_key' },
        )
        if (keyError) throw keyError
        const resendKey = String(rawKey || '').trim()
        if (!resendKey) throw new Error('resend_key_unavailable')
        emailSkipped = ''
        const { data: emailJobs, error: jobError } = await admin.rpc('claim_vision_commercial_client_alerts')
        if (jobError) throw jobError
        for (const job of (emailJobs || []) as ClientEmailJob[]) {
          let result: Record<string, unknown>
          let retry = false
          try {
            const html = `<!doctype html><html lang="pt-BR"><body style="font:16px Arial,sans-serif;color:#15233a;background:#f5f7fc;padding:24px">
              <div style="max-width:560px;margin:auto;background:white;padding:28px;border-radius:14px">
              <h2 style="color:#192e4b">Vision Mídia Digital</h2>
              <p>${htmlEscape(job.message)}</p>
              <p style="color:#67738a;font-size:13px">Esta é uma notificação informativa sobre o período de divulgação da sua campanha. Você também pode consultar o Portal do Anunciante.</p>
              </div></body></html>`
            const response = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `vision-commercial-${job.id}`,
              },
              body: JSON.stringify({
                from: `${senderName} <${senderEmail}>`,
                to: [job.recipient_email],
                subject: job.title,
                html,
                text: job.message,
              }),
              signal: AbortSignal.timeout(10000),
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok || !payload?.id) throw new Error(`email_provider_status_${response.status}`)
            result = { sent: true, provider: 'resend', message_id: String(payload.id).slice(0, 120) }
            emailSent++
          } catch (sendError) {
            // Never expose recipient addresses, API secrets or message content in logs.
            console.error('commercial-expiry email failed', job.id, String(sendError))
            result = { sent: false, error: 'email_delivery_failed' }
            retry = true
            emailFailed++
          }
          const { error: finishError } = await admin.rpc('finish_vision_commercial_client_alert', {
            p_id: job.id, p_result: result, p_retry: retry,
          })
          if (finishError) throw finishError
        }
      } else emailSkipped = 'resend_not_configured'
    } catch (emailError) {
      console.error('commercial-expiry client email subsystem failed', String(emailError))
      emailSkipped = 'email_worker_error'
    }
    return json({
      ok: true,
      processed: outcomes.length,
      outcomes,
      client_email: { sent: emailSent, failed: emailFailed, skipped: emailSkipped || undefined },
    })
  } catch (error) {
    console.error('commercial-expiry worker failure', error)
    return json({ error: 'worker_failed' }, 500)
  }
})
