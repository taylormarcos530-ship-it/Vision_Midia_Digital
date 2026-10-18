import webpush from 'npm:web-push@3.6.7'

export type VisionPushPayload = {
  title: string
  body: string
  url?: string
  icon?: string
  image?: string | null
  tag?: string
}

async function persistCompanyNotificationBestEffort(admin: any, companyId: string, payload: VisionPushPayload) {
  try {
    const title = String(payload.title || 'Vision Mídia Digital').slice(0, 120)
    const message = String(payload.body || '').slice(0, 500)
    if (!title || !message) return
    const { error } = await admin
      .from('company_notifications')
      .insert({ company_id: companyId, title, message })
    if (error) console.warn('notification inbox save failed', companyId, error.message || error)
  } catch (error: any) {
    console.warn('notification inbox save failed', companyId, error?.message || error)
  }
}

export async function sendCompanyPush(admin: any, companyId: string, payload: VisionPushPayload) {
  if (!companyId) return { sent: 0, failed: 0, skipped: 'company_required' }

  await persistCompanyNotificationBestEffort(admin, companyId, payload)

  const { data: cfg, error: cfgError } = await admin
    .from('web_push_config')
    .select('vapid_public_key,vapid_private_key,subject')
    .eq('id', 1)
    .maybeSingle()

  if (cfgError) throw cfgError
  if (!cfg?.vapid_public_key || !cfg?.vapid_private_key || !cfg?.subject) {
    return { sent: 0, failed: 0, skipped: 'vapid_not_configured' }
  }

  const { data: subscriptions, error: subError } = await admin
    .from('web_push_subscriptions')
    .select('id,endpoint,p256dh,auth_key')
    .eq('company_id', companyId)
    .is('disabled_at', null)

  if (subError) throw subError
  if (!subscriptions?.length) return { sent: 0, failed: 0, skipped: 'no_subscriptions' }

  webpush.setVapidDetails(cfg.subject, cfg.vapid_public_key, cfg.vapid_private_key)

  let sent = 0
  let failed = 0
  await Promise.all(subscriptions.map(async (sub: any) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        },
        JSON.stringify({
          title: String(payload.title || 'Vision Mídia Digital').slice(0, 120),
          body: String(payload.body || '').slice(0, 500),
          url: payload.url || './',
          icon: payload.icon || './icon.svg',
          image: payload.image || null,
          tag: payload.tag || 'vision-midia',
        }),
        { TTL: 3600, urgency: 'high' },
      )
      sent += 1
      await admin
        .from('web_push_subscriptions')
        .update({ last_seen_at: new Date().toISOString(), disabled_at: null })
        .eq('id', sub.id)
    } catch (error: any) {
      failed += 1
      const status = Number(error?.statusCode || error?.status || 0)
      if (status === 404 || status === 410) {
        await admin
          .from('web_push_subscriptions')
          .update({ disabled_at: new Date().toISOString() })
          .eq('id', sub.id)
      } else {
        console.warn('web-push send failed', sub.id, status, error?.message || error)
      }
    }
  }))

  return { sent, failed }
}
