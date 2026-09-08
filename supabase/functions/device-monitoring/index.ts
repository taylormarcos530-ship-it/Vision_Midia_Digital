import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-device-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function safeNumber(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(min, Math.min(max, number))
}

function safeUuid(value) {
  const text = String(value || '')
  return UUID_PATTERN.test(text) ? text : null
}

async function authenticateDevice(admin, req) {
  const rawToken = String(req.headers.get('x-device-token') || '')
  if (rawToken.length < 30) return null
  const tokenHash = await sha256Hex(rawToken)
  const { data: credential, error } = await admin
    .from('device_credentials')
    .select('device_id,revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) throw error
  if (!credential || credential.revoked_at) return null

  const { data: device, error: deviceError } = await admin
    .from('devices')
    .select('*')
    .eq('id', credential.device_id)
    .maybeSingle()
  if (deviceError) throw deviceError
  if (!device || device.status === 'disabled') return null

  await admin.from('device_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('device_id', device.id)

  return device
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const admin = adminClient()
    const device = await authenticateDevice(admin, req)
    if (!device) return json({ error: 'invalid_device_token' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'heartbeat') {
      const now = new Date().toISOString()
      const screenWidth = safeNumber(body?.screen_width, 1, 100000)
      const screenHeight = safeNumber(body?.screen_height, 1, 100000)
      const storageFreeMb = safeNumber(body?.storage_free_mb, 0, 10_000_000)
      const appVersion = String(body?.app_version || '').slice(0, 80) || null
      const orientation = String(body?.orientation || '').slice(0, 40) || null
      const lastSyncAt = body?.last_sync_at ? new Date(body.last_sync_at) : null
      const cacheItems = safeNumber(body?.cache_items, 0, 100000)
      const cacheBytes = safeNumber(body?.cache_bytes, 0, Number.MAX_SAFE_INTEGER)
      const playbackQueueSize = safeNumber(body?.playback_queue_size, 0, 100000)
      const eventQueueSize = safeNumber(body?.event_queue_size, 0, 100000)
      const currentCampaignId = safeUuid(body?.current_campaign_id)
      const currentPlaylistId = safeUuid(body?.current_playlist_id)
      const currentMediaId = safeUuid(body?.current_media_id)

      const { error: updateError } = await admin.from('devices').update({
        status: 'online',
        last_seen_at: now,
        app_version: appVersion,
        screen_width: screenWidth,
        screen_height: screenHeight,
        storage_free_mb: storageFreeMb == null ? null : Math.round(storageFreeMb),
        last_sync_at: lastSyncAt && !Number.isNaN(lastSyncAt.getTime()) ? lastSyncAt.toISOString() : device.last_sync_at,
        current_campaign_id: currentCampaignId,
        current_playlist_id: currentPlaylistId,
        current_media_id: currentMediaId,
        cache_items: cacheItems == null ? 0 : Math.round(cacheItems),
        cache_bytes: cacheBytes == null ? 0 : Math.round(cacheBytes),
        playback_queue_size: playbackQueueSize == null ? 0 : Math.round(playbackQueueSize),
        event_queue_size: eventQueueSize == null ? 0 : Math.round(eventQueueSize),
      }).eq('id', device.id)
      if (updateError) throw updateError

      const { data: lastHeartbeat, error: heartbeatReadError } = await admin
        .from('device_heartbeats')
        .select('received_at')
        .eq('device_id', device.id)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (heartbeatReadError) throw heartbeatReadError

      const shouldRecord = !lastHeartbeat || (Date.now() - new Date(lastHeartbeat.received_at).getTime()) >= 5 * 60 * 1000
      if (shouldRecord) {
        const details = body?.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : {}
        const { error: heartbeatError } = await admin.from('device_heartbeats').insert({
          company_id: device.company_id,
          device_id: device.id,
          app_version: appVersion,
          screen_width: screenWidth,
          screen_height: screenHeight,
          orientation,
          storage_free_mb: storageFreeMb == null ? null : Math.round(storageFreeMb),
          details: {
            ...details,
            last_sync_at: lastSyncAt && !Number.isNaN(lastSyncAt.getTime()) ? lastSyncAt.toISOString() : null,
            cache_items: cacheItems == null ? 0 : Math.round(cacheItems),
            cache_bytes: cacheBytes == null ? 0 : Math.round(cacheBytes),
            playback_queue_size: playbackQueueSize == null ? 0 : Math.round(playbackQueueSize),
            event_queue_size: eventQueueSize == null ? 0 : Math.round(eventQueueSize),
          },
        })
        if (heartbeatError) throw heartbeatError
      }

      return json({ ok: true, device_id: device.id, server_time: now })
    }

    if (action === 'event' || action === 'event_batch') {
      const events = action === 'event_batch' ? body?.events : [body]
      if (!Array.isArray(events) || events.length < 1 || events.length > 50) {
        return json({ error: 'invalid_event_batch' }, 400)
      }

      const rows = []
      for (const event of events) {
        const clientEventId = String(event?.client_event_id || '').slice(0, 120)
        const severity = ['info', 'warning', 'error', 'critical'].includes(event?.severity) ? event.severity : 'info'
        const eventCode = String(event?.event_code || '').trim().slice(0, 80)
        const message = String(event?.message || '').trim().slice(0, 500)
        const occurredAt = new Date(event?.occurred_at || Date.now())
        const details = event?.details && typeof event.details === 'object' && !Array.isArray(event.details) ? event.details : {}
        if (!clientEventId || !eventCode || !message || Number.isNaN(occurredAt.getTime())) continue
        rows.push({
          client_event_id: clientEventId,
          company_id: device.company_id,
          device_id: device.id,
          severity,
          event_code: eventCode,
          message,
          details,
          occurred_at: occurredAt.toISOString(),
        })
      }
      if (!rows.length) return json({ error: 'invalid_device_event' }, 400)

      const { error: eventError } = await admin
        .from('device_events')
        .upsert(rows, { onConflict: 'device_id,client_event_id', ignoreDuplicates: true })
      if (eventError) return json({ error: 'device_event_failed', message: eventError.message }, 400)

      const latestError = [...rows].reverse().find(event => ['error', 'critical'].includes(event.severity))
      const latestRecovery = [...rows].reverse().find(event => event.event_code.endsWith('_recovered'))
      const updates = {}
      if (latestError) {
        updates.last_error_at = latestError.occurred_at
        updates.last_error_code = latestError.event_code
        updates.last_error_message = latestError.message
      }
      if (latestRecovery) updates.last_recovered_at = latestRecovery.occurred_at
      if (Object.keys(updates).length) {
        const { error: deviceUpdateError } = await admin.from('devices').update(updates).eq('id', device.id)
        if (deviceUpdateError) throw deviceUpdateError
      }

      return json({ ok: true, accepted: rows.length })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('device-monitoring', error)
    return json({ error: 'internal_error', message: error?.message || 'Falha interna.' }, 500)
  }
})
