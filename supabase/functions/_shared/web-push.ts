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

export async function sendCompanyPush(admin: any, companyId: string, payload: VisionPushPayload, persistInbox = true, recipientUserId?: string) {
  if (!companyId) return { sent: 0, failed: 0, skipped: 'company_required' }

  if (persistInbox) await persistCompanyNotificationBestEffort(admin, companyId, payload)

  const { data: cfg, error: cfgError } = await admin
    .from('web_push_config')
    .select('vapid_public_key,vapid_private_key,subject')
    .eq('id', 1)
    .maybeSingle()

  if (cfgError) throw cfgError
  if (!cfg?.vapid_public_key || !cfg?.vapid_private_key || !cfg?.subject) {
    return { sent: 0, failed: 0, skipped: 'vapid_not_configured' }
  }

  // Optional user scope prevents master-only alerts leaking to other users of a company.
  let subscriptionQuery = admin
    .from('web_push_subscriptions')
    .select('id,endpoint,p256dh,auth_key')
    .eq('company_id', companyId)
    .is('disabled_at', null)
  if (recipientUserId) subscriptionQuery = subscriptionQuery.eq('user_id', recipientUserId)
  const { data: subscriptions, error: subError } = await subscriptionQuery

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


// Advertiser-targeted pushes are independent of company/TV notifications.
// Never persist these messages in company_notifications or use company_id.
export async function sendAdvertiserPush(
  admin: any, advertiserId: string, recipientUserId: string, payload: VisionPushPayload,
  onlyEndpoint?: string,
) {
  if (!advertiserId || !recipientUserId) return { sent: 0, failed: 0, skipped: 'recipient_required' }

  const { data: advertiser, error: advertiserError } = await admin
    .from('vision_advertisers')
    .select('id,user_id,status,archived_at')
    .eq('id', advertiserId).eq('user_id', recipientUserId).maybeSingle()
  if (advertiserError) throw advertiserError
  if (!advertiser || advertiser.status !== 'active' || advertiser.archived_at) {
    return { sent: 0, failed: 0, skipped: 'advertiser_inactive' }
  }

  const { data: cfg, error: cfgError } = await admin
    .from('web_push_config')
    .select('vapid_public_key,vapid_private_key,subject')
    .eq('id', 1).maybeSingle()
  if (cfgError) throw cfgError
  if (!cfg?.vapid_public_key || !cfg?.vapid_private_key || !cfg?.subject)
    return { sent: 0, failed: 0, skipped: 'vapid_not_configured' }

  let subscriptionsQuery = admin
    .from('vision_advertiser_push_subscriptions')
    .select('id,endpoint,p256dh,auth_key')
    .eq('advertiser_id', advertiserId)
    .eq('user_id', recipientUserId)
    .is('disabled_at', null)
  if (onlyEndpoint) subscriptionsQuery = subscriptionsQuery.eq('endpoint', onlyEndpoint)
  const { data: subs, error: subError } = await subscriptionsQuery
  if (subError) throw subError
  if (!subs?.length) return { sent: 0, failed: 0, skipped: 'no_subscriptions' }

  webpush.setVapidDetails(cfg.subject, cfg.vapid_public_key, cfg.vapid_private_key)
  let sent = 0, failed = 0
  await Promise.all(subs.map(async (sub: any) => {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      }, JSON.stringify({
        title: String(payload.title || 'Vision Mídia Digital').slice(0,120),
        body: String(payload.body || '').slice(0,500),
        // Fixed same-origin route; do not accept an arbitrary notification URL.
        url: 'https://vision-midia-digital.vercel.app/anunciante.html',
        tag: String(payload.tag || 'vision-advertiser-expiry').slice(0,120),
      }), { TTL: 86400, urgency: 'normal' })
      sent++
      await admin.from('vision_advertiser_push_subscriptions')
        .update({ last_seen_at: new Date().toISOString() }).eq('id', sub.id)
    } catch (err: any) {
      failed++
      const status = Number(err?.statusCode || err?.status || 0)
      if ([404,410].includes(status)) {
        await admin.from('vision_advertiser_push_subscriptions')
          .update({ disabled_at: new Date().toISOString() }).eq('id', sub.id)
      } else console.warn('advertiser push delivery failed', sub.id, status)
    }
  }))
  return { sent, failed }
}
