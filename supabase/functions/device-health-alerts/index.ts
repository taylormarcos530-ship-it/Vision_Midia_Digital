import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// Invoked by Supabase Cron, never by the TV Box or an unauthenticated browser.
// Uses the already-provisioned subscription-alert scheduler token and VAPID pair.
const ORIGIN = 'https://vision-midia-digital.vercel.app'
const OFFLINE_AFTER_MS = 3 * 60 * 1000
const MAX_DEVICES = 500
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const clip = (value: unknown, limit: number) => String(value ?? '').trim().slice(0, limit)

type Device = {
  id: string; company_id: string; name: string; status: string | null
  last_seen_at: string | null; apk_version: string | null
  last_error_at: string | null; last_error_code: string | null
  last_error_message: string | null; last_recovered_at: string | null
}
type State = {
  device_id: string; company_id: string; connected: boolean
  active_error_key: string | null; outdated_apk_key: string | null
}
type QueueRow = {
  id: string; company_id: string; device_id: string; kind: string
  title: string; message: string; attempts: number
}
type PushSub = { id: string; endpoint: string; p256dh: string; auth_key: string }

function adminClient() {
  let key = ''
  try { key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')?.default || '' } catch {}
  key ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const url = Deno.env.get('SUPABASE_URL') || ''
  if (!key || !url) throw new Error('server_credentials_unavailable')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function versionParts(raw: unknown): number[] | null {
  const match = clip(raw, 45).match(/^(\d+)\.(\d+)\.(\d+)(?:[^\d].*)?$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}
function olderThan(installed: unknown, available: unknown) {
  const left = versionParts(installed)
  const right = versionParts(available)
  if (!left || !right) return false // Unknown version must never be labelled updated.
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i]
  }
  return false
}
async function officialApkVersion() {
  try {
    const res = await fetch(ORIGIN + '/downloads/Vision-Player.source.json', {
      cache: 'no-store', signal: AbortSignal.timeout(7000),
    })
    if (!res.ok) return null
    const manifest = await res.json()
    if (manifest?.application_id !== 'com.visionmidia.player.stable') return null
    if (Number(manifest?.version_code) < 16) return null
    const value = clip(manifest?.apk_version, 45)
    return versionParts(value) ? value : null
  } catch { return null } // Fail closed on update notifications if release metadata is unavailable.
}

async function enqueue(admin: any, device: Device, kind: string, incident: string, title: string, message: string) {
  const { error } = await admin.from('device_health_push_outbox').upsert({
    device_id: device.id, company_id: device.company_id,
    kind, incident_key: clip(incident, 180),
    title: clip(title, 120), message: clip(message, 500),
  }, { onConflict: 'device_id,kind,incident_key', ignoreDuplicates: true })
  if (error) throw error
}

async function scanDevices(admin: any) {
  const devices: Device[] = []
  for (let from = 0; from < MAX_DEVICES; from += 100) {
    const { data, error } = await admin.from('devices')
      .select('id,company_id,name,status,last_seen_at,apk_version,last_error_at,last_error_code,last_error_message,last_recovered_at')
      .is('retired_at', null)
      .not('paired_at', 'is', null)
      .not('last_seen_at', 'is', null)
      .range(from, from + 99)
      .order('id')
    if (error) throw error
    devices.push(...(data || []))
    if ((data || []).length < 100) break
  }
  if (!devices.length) return { scanned: 0, queued: 0, initialized: 0 }

  const ids = devices.map(device => device.id)
  const { data: saved, error: readError } = await admin.from('device_health_push_state')
    .select('device_id,company_id,connected,active_error_key,outdated_apk_key')
    .in('device_id', ids)
  if (readError) throw readError
  const byId = new Map<string, State>((saved || []).map((row: State) => [row.device_id, row]))
  const target = await officialApkVersion()
  const now = Date.now()
  let queued = 0
  let initialized = 0

  for (const device of devices) {
    if (!device.id || !device.company_id || device.status === 'disabled') continue
    const seenAt = Date.parse(device.last_seen_at || '')
    if (!Number.isFinite(seenAt)) continue

    const connected = now - seenAt <= OFFLINE_AFTER_MS
    const errorAt = Date.parse(device.last_error_at || '')
    const recoveredAt = Date.parse(device.last_recovered_at || '')
    const activeError = Number.isFinite(errorAt) &&
      (!Number.isFinite(recoveredAt) || errorAt > recoveredAt)
      ? clip(device.last_error_at, 80) + ':' + clip(device.last_error_code, 80)
      : null
    const outdated = target && olderThan(device.apk_version, target)
      ? clip(device.apk_version, 45) + '→' + target
      : null
    const previous = byId.get(device.id)
    const next: State & { updated_at: string } = {
      device_id: device.id, company_id: device.company_id, connected,
      active_error_key: activeError, outdated_apk_key: outdated,
      updated_at: new Date().toISOString(),
    }
    // First scan takes a quiet baseline: old, already-offline TVs do not spam on rollout.
    if (!previous) {
      const { error } = await admin.from('device_health_push_state')
        .upsert(next, { onConflict: 'device_id', ignoreDuplicates: true })
      if (error) throw error
      initialized++
      continue
    }
    const name = clip(device.name || 'TV', 80)
    if (previous.connected !== connected) {
      if (connected) {
        await enqueue(admin, device, 'online', device.last_seen_at || '', 'TV reconectada',
          name + ' voltou a se comunicar com a Vision Mídia Digital.')
      } else {
        await enqueue(admin, device, 'offline', device.last_seen_at || '', 'TV sem comunicação',
          name + ' está há mais de 3 minutos sem enviar sinal. Verifique energia e internet do TV Box.')
      }
      queued++
    }
    if (previous.active_error_key !== activeError) {
      if (activeError) {
        await enqueue(admin, device, 'failure', activeError, 'Falha detectada na TV',
          name + ': ' + clip(device.last_error_message || device.last_error_code || 'Falha do player', 230))
        queued++
      } else if (previous.active_error_key && connected) {
        await enqueue(admin, device, 'recovered', device.last_recovered_at || device.last_seen_at || '',
          'Falha recuperada', name + ' informou recuperação e voltou a operar.')
        queued++
      }
    }
    if (outdated && outdated !== previous.outdated_apk_key) {
      await enqueue(admin, device, 'update', outdated, 'Atualização do Vision Player',
        name + ' usa o APK ' + clip(device.apk_version, 45) + '. Versão oficial disponível: ' + target + '.')
      queued++
    }
    const { error: stateError } = await admin.from('device_health_push_state')
      .upsert(next, { onConflict: 'device_id' })
    if (stateError) throw stateError
  }
  return { scanned: devices.length, queued, initialized, latest_apk: target || 'not_verified' }
}

async function subscriptionsForAlert(admin: any, companyId: string): Promise<PushSub[]> {
  const { data: company, error: ownershipError } = await admin.from('companies')
    .select('owner_user_id').eq('id', companyId).maybeSingle()
  if (ownershipError) throw ownershipError
  if (!company) return []
  const { data: members, error: membershipError } = await admin.from('company_members')
    .select('user_id').eq('company_id', companyId).eq('status', 'active')
  if (membershipError) throw membershipError
  const allowed = new Set([company.owner_user_id, ...(members || []).map((m: any) => m.user_id)])
  const { data: companySubs, error: companyError } = await admin.from('web_push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth_key')
    .eq('company_id', companyId).is('disabled_at', null)
  if (companyError) throw companyError
  const authorizedSubs = (companySubs || []).filter((s: any) => allowed.has(s.user_id))

  // Active Masters receive events for *all* their companies, even if the PWA
  // was installed while viewing just one company. Other users stay company-scoped.
  const { data: masters, error: masterError } = await admin.from('platform_admins')
    .select('user_id').eq('status', 'active').in('role', ['admin', 'super_admin'])
  if (masterError) throw masterError
  let masterSubs: PushSub[] = []
  const masterIds = (masters || []).map((row: any) => row.user_id).filter(Boolean)
  if (masterIds.length) {
    const { data, error } = await admin.from('web_push_subscriptions')
      .select('id,endpoint,p256dh,auth_key')
      .in('user_id', masterIds).is('disabled_at', null)
    if (error) throw error
    masterSubs = data || []
  }
  const unique = new Map<string, PushSub>()
  for (const sub of [...authorizedSubs, ...masterSubs]) {
    if (sub.endpoint && sub.p256dh && sub.auth_key) unique.set(sub.endpoint, sub)
  }
  return [...unique.values()]
}

async function deliver(admin: any, job: QueueRow) {
  const subs = await subscriptionsForAlert(admin, job.company_id)
  if (!subs.length) return { sent: 0, failed: 0, skipped: 'no_subscribers' }
  const { data: cfg, error } = await admin.from('web_push_config')
    .select('vapid_public_key,vapid_private_key,subject').eq('id', 1).maybeSingle()
  if (error) throw error
  if (!cfg?.vapid_public_key || !cfg?.vapid_private_key || !cfg?.subject) {
    throw new Error('vapid_not_configured')
  }
  webpush.setVapidDetails(cfg.subject, cfg.vapid_public_key, cfg.vapid_private_key)
  let sent = 0
  let failed = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      }, JSON.stringify({
        title: 'Vision Mídia Digital • ' + clip(job.title, 100),
        body: clip(job.message, 450),
        url: ORIGIN + '/#monitoring',
        icon: ORIGIN + '/icon.svg',
        // Stable for retries of one incident, unique across different reconnections.
        // Avoid silently replacing a previous Android notification from this same TV.
        tag: 'vision-health-' + job.kind + '-' + job.device_id + '-' + job.id,
        renotify: true,
      }), { TTL: 3600, urgency: 'high' })
      sent++
    } catch (e: any) {
      failed++
      const status = Number(e?.statusCode || e?.status || 0)
      if ([404, 410].includes(status)) {
        await admin.from('web_push_subscriptions')
          .update({ disabled_at: new Date().toISOString() }).eq('id', sub.id)
      } else {
        console.warn('device health push rejected', job.id, status, e?.message || e)
      }
    }
  }
  return { sent, failed }
}

async function flushQueue(admin: any) {
  const { data: jobs, error } = await admin.rpc('claim_device_health_pushes', { p_limit: 25 })
  if (error) throw error
  let sent = 0
  let failed = 0
  for (const job of (jobs || []) as QueueRow[]) {
    let result: { sent: number; failed: number; skipped?: string }
    try { result = await deliver(admin, job) }
    catch (e: any) {
      console.warn('health notification delivery failed', job.id, e?.message || e)
      result = { sent: 0, failed: 1 }
    }
    sent += result.sent
    failed += result.failed
    const final = result.sent > 0 || result.failed === 0 || job.attempts >= 3
    const { error: writeError } = await admin.from('device_health_push_outbox')
      .update({
        sent: result.sent, failed: result.failed,
        completed_at: final ? new Date().toISOString() : null,
        last_error: result.failed ? 'push_delivery_failed' : null,
      }).eq('id', job.id)
    if (writeError) throw writeError
  }
  return { processed: (jobs || []).length, sent, failed }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
  if (!token || token.length < 32) return json({ error: 'unauthorized' }, 401)
  try {
    const admin = adminClient()
    const { data: allowed, error } = await admin.rpc('verify_subscription_alert_token', { p_token: token })
    if (error || allowed !== true) return json({ error: 'unauthorized' }, 401)
    const scanned = await scanDevices(admin)
    const delivery = await flushQueue(admin)
    return json({ ok: true, ...scanned, ...delivery })
  } catch (error: any) {
    console.error('device-health-alerts', error)
    return json({ error: 'device_health_push_failed' }, 500)
  }
})
