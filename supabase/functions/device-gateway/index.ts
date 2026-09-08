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

function safeNumber(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(min, Math.min(max, number))
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function timeToSeconds(value) {
  if (!value) return null
  const [h = '0', m = '0', sec = '0'] = String(value).split(':')
  const total = Number(h) * 3600 + Number(m) * 60 + Number(sec)
  return Number.isFinite(total) ? total : null
}

function localDateParts(date, timeZone) {
  let zone = timeZone || 'America/Sao_Paulo'
  let formatter
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short', hourCycle: 'h23',
    })
  } catch {
    zone = 'America/Sao_Paulo'
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short', hourCycle: 'h23',
    })
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]))
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const second = Number(parts.second)
  const calendar = new Date(Date.UTC(year, month - 1, day))
  const previous = new Date(calendar.getTime() - 86400000)
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const previousDateKey = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`
  return {
    timeZone: zone,
    dateKey,
    previousDateKey,
    weekday: WEEKDAY_INDEX[parts.weekday] ?? calendar.getUTCDay(),
    previousWeekday: previous.getUTCDay(),
    seconds: hour * 3600 + minute * 60 + second,
  }
}

function campaignIsActive(campaign, clock) {
  const start = timeToSeconds(campaign.start_time)
  const end = timeToSeconds(campaign.end_time)
  let anchorDate = clock.dateKey
  let anchorWeekday = clock.weekday

  if (start != null && end != null) {
    if (start < end) {
      if (clock.seconds < start || clock.seconds >= end) return false
    } else {
      if (clock.seconds >= start) {
        // same calendar day
      } else if (clock.seconds < end) {
        anchorDate = clock.previousDateKey
        anchorWeekday = clock.previousWeekday
      } else {
        return false
      }
    }
  }

  if (campaign.start_date && anchorDate < campaign.start_date) return false
  if (campaign.end_date && anchorDate > campaign.end_date) return false
  const weekdays = Array.isArray(campaign.weekdays) ? campaign.weekdays.map(Number) : [0,1,2,3,4,5,6]
  if (!weekdays.includes(anchorWeekday)) return false
  return true
}

async function resolveProgram(admin, device) {
  const [{ data: company, error: companyError }, { data: campaigns, error: campaignsError }, { data: targets, error: targetsError }, { data: assignment, error: assignmentError }] = await Promise.all([
    admin.from('companies').select('timezone').eq('id', device.company_id).maybeSingle(),
    admin.from('campaigns')
      .select('id,name,playlist_id,start_date,end_date,start_time,end_time,weekdays,priority,all_devices,updated_at,created_at')
      .eq('company_id', device.company_id)
      .eq('is_active', true)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false }),
    admin.from('campaign_devices').select('campaign_id').eq('company_id', device.company_id).eq('device_id', device.id),
    admin.from('device_playlist_assignments').select('playlist_id,updated_at').eq('device_id', device.id).maybeSingle(),
  ])
  if (companyError) throw companyError
  if (campaignsError) throw campaignsError
  if (targetsError) throw targetsError
  if (assignmentError) throw assignmentError

  const clock = localDateParts(new Date(), company?.timezone || 'America/Sao_Paulo')
  const targeted = new Set((targets || []).map(row => row.campaign_id))
  const campaign = (campaigns || []).find(item => (item.all_devices || targeted.has(item.id)) && campaignIsActive(item, clock)) || null

  if (campaign) {
    return {
      playlistId: campaign.playlist_id,
      assignmentUpdatedAt: assignment?.updated_at || null,
      program: {
        source: 'campaign',
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        priority: campaign.priority,
        schedule_updated_at: campaign.updated_at,
        timezone: clock.timeZone,
      },
    }
  }

  return {
    playlistId: assignment?.playlist_id || null,
    assignmentUpdatedAt: assignment?.updated_at || null,
    program: { source: assignment ? 'default' : 'none', campaign_id: null, campaign_name: null, priority: null, schedule_updated_at: null, timezone: clock.timeZone },
  }
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

  const [{ data: company, error: companyError }, { data: subscription, error: subscriptionError }] = await Promise.all([
    admin.from('companies').select('status').eq('id', device.company_id).maybeSingle(),
    admin.from('company_subscriptions').select('status').eq('company_id', device.company_id).maybeSingle(),
  ])
  if (companyError) throw companyError
  if (subscriptionError) throw subscriptionError
  if (!company || company.status !== 'active') return { ...device, account_blocked: true }
  if (subscription && ['suspended', 'cancelled'].includes(subscription.status)) return { ...device, account_blocked: true }

  await admin.from('device_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('device_id', device.id)
  await admin.from('device_pairing_requests')
    .update({ issued_token: null })
    .eq('device_id', device.id)
    .eq('status', 'issued')

  return device
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const admin = adminClient()
    const device = await authenticateDevice(admin, req)
    if (!device) return json({ error: 'invalid_device_token' }, 401)
    if (device.account_blocked) return json({ error: 'account_suspended', message: 'Conta suspensa. Entre em contato com o administrador da plataforma.' }, 403)

    const body = await req.json().catch(() => ({}))
    const action = body?.action

    if (action === 'unpair') {
      const { error: deleteError } = await admin
        .from('devices')
        .delete()
        .eq('id', device.id)
        .eq('company_id', device.company_id)
      if (deleteError) throw deleteError
      return json({ ok: true, unpaired: true })
    }

    if (action === 'heartbeat') {
      const now = new Date().toISOString()
      const screenWidth = safeNumber(body?.screen_width, 1, 100000)
      const screenHeight = safeNumber(body?.screen_height, 1, 100000)
      const storageFreeMb = safeNumber(body?.storage_free_mb, 0, 10_000_000)
      const appVersion = String(body?.app_version || '').slice(0, 80) || null
      const orientation = String(body?.orientation || '').slice(0, 40) || null

      const { error: updateError } = await admin.from('devices').update({
        status: 'online',
        last_seen_at: now,
        app_version: appVersion,
        screen_width: screenWidth,
        screen_height: screenHeight,
        storage_free_mb: storageFreeMb == null ? null : Math.round(storageFreeMb),
      }).eq('id', device.id)
      if (updateError) throw updateError

      const { data: lastHeartbeat } = await admin
        .from('device_heartbeats')
        .select('received_at')
        .eq('device_id', device.id)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const shouldRecord = !lastHeartbeat || (Date.now() - new Date(lastHeartbeat.received_at).getTime()) >= 5 * 60 * 1000
      if (shouldRecord) {
        const details = body?.details && typeof body.details === 'object' ? body.details : {}
        const { error: heartbeatError } = await admin.from('device_heartbeats').insert({
          company_id: device.company_id,
          device_id: device.id,
          app_version: appVersion,
          screen_width: screenWidth,
          screen_height: screenHeight,
          orientation,
          storage_free_mb: storageFreeMb == null ? null : Math.round(storageFreeMb),
          details,
        })
        if (heartbeatError) throw heartbeatError
      }

      return json({ ok: true, device_id: device.id, server_time: now })
    }

    if (action === 'manifest') {
      const resolved = await resolveProgram(admin, device)

      if (!resolved.playlistId) {
        return json({
          version: await sha256Hex(JSON.stringify({ device: device.updated_at, program: resolved.program })),
          device: { id: device.id, name: device.name, orientation: device.orientation, settings: device.settings || {} },
          program: resolved.program,
          playlist: null,
          items: [],
          generated_at: new Date().toISOString(),
        })
      }

      const { data: playlist, error: playlistError } = await admin
        .from('playlists')
        .select('id,name,shuffle,repeat_mode,updated_at')
        .eq('id', resolved.playlistId)
        .eq('company_id', device.company_id)
        .maybeSingle()
      if (playlistError) throw playlistError
      if (!playlist) return json({ error: 'assigned_playlist_missing' }, 409)

      const { data: playlistItems, error: itemsError } = await admin
        .from('playlist_items')
        .select('id,media_id,position,duration_override_seconds,enabled,updated_at')
        .eq('playlist_id', playlist.id)
        .eq('company_id', device.company_id)
        .eq('enabled', true)
        .order('position', { ascending: true })
      if (itemsError) throw itemsError

      const mediaIds = [...new Set((playlistItems || []).map((item) => item.media_id))]
      let media = []
      if (mediaIds.length) {
        const { data: mediaRows, error: mediaError } = await admin
          .from('media_assets')
          .select('id,name,media_type,mime_type,storage_path,source_url,duration_seconds,size_bytes,checksum_sha256,width,height,processing_status,updated_at')
          .eq('company_id', device.company_id)
          .in('id', mediaIds)
          .eq('processing_status', 'ready')
        if (mediaError) throw mediaError
        media = mediaRows || []
      }

      const mediaById = new Map(media.map((item) => [item.id, item]))
      const items = []
      for (const item of playlistItems || []) {
        const asset = mediaById.get(item.media_id)
        if (!asset) continue
        let url = asset.source_url || null
        if (asset.storage_path) {
          const { data: signed, error: signedError } = await admin.storage
            .from('vision-media')
            .createSignedUrl(asset.storage_path, 6 * 60 * 60)
          if (signedError) {
            console.error('signed url failed', asset.id, signedError)
            continue
          }
          url = signed?.signedUrl || null
        }
        if (!url) continue
        items.push({
          id: item.id,
          position: item.position,
          duration_seconds: item.duration_override_seconds || asset.duration_seconds || (asset.media_type === 'image' ? 10 : null),
          media: {
            id: asset.id,
            name: asset.name,
            type: asset.media_type,
            mime_type: asset.mime_type,
            url,
            size_bytes: asset.size_bytes,
            checksum: asset.checksum_sha256 || asset.updated_at,
            width: asset.width,
            height: asset.height,
          },
        })
      }

      const versionSource = JSON.stringify({
        device: device.updated_at,
        assignment: resolved.assignmentUpdatedAt,
        program: resolved.program,
        playlist: playlist.updated_at,
        items: items.map((item) => [item.id, item.media.id, item.media.checksum, item.duration_seconds]),
      })

      return json({
        version: await sha256Hex(versionSource),
        device: { id: device.id, name: device.name, orientation: device.orientation, settings: device.settings || {} },
        program: resolved.program,
        playlist: { id: playlist.id, name: playlist.name, shuffle: playlist.shuffle, repeat_mode: playlist.repeat_mode },
        items,
        generated_at: new Date().toISOString(),
      })
    }

    if (action === 'playback' || action === 'playback_batch') {
      const events = action === 'playback_batch' ? body?.events : [body]
      if (!Array.isArray(events) || events.length < 1 || events.length > 100) {
        return json({ error: 'invalid_playback_batch' }, 400)
      }

      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      const parsedEvents = []
      for (const event of events) {
        const clientEventId = String(event?.client_event_id || '').slice(0, 120)
        const startedAt = new Date(event?.started_at || Date.now())
        const endedAt = event?.ended_at ? new Date(event.ended_at) : null
        if (!clientEventId || Number.isNaN(startedAt.getTime()) || (endedAt && Number.isNaN(endedAt.getTime()))) continue
        parsedEvents.push({
          client_event_id: clientEventId,
          campaign_id: uuidPattern.test(String(event?.campaign_id || '')) ? event.campaign_id : null,
          playlist_id: uuidPattern.test(String(event?.playlist_id || '')) ? event.playlist_id : null,
          media_id: uuidPattern.test(String(event?.media_id || '')) ? event.media_id : null,
          started_at: startedAt.toISOString(),
          ended_at: endedAt ? endedAt.toISOString() : null,
          duration_seconds: safeNumber(event?.duration_seconds, 0, 7 * 24 * 60 * 60),
          completed: Boolean(event?.completed),
        })
      }
      if (!parsedEvents.length) return json({ error: 'invalid_playback_event' }, 400)

      const campaignIds = [...new Set(parsedEvents.map(item => item.campaign_id).filter(Boolean))]
      const playlistIds = [...new Set(parsedEvents.map(item => item.playlist_id).filter(Boolean))]
      const mediaIds = [...new Set(parsedEvents.map(item => item.media_id).filter(Boolean))]

      const [campaignResult, playlistResult, mediaResult] = await Promise.all([
        campaignIds.length
          ? admin.from('campaigns').select('id,name').eq('company_id', device.company_id).in('id', campaignIds)
          : Promise.resolve({ data: [], error: null }),
        playlistIds.length
          ? admin.from('playlists').select('id,name').eq('company_id', device.company_id).in('id', playlistIds)
          : Promise.resolve({ data: [], error: null }),
        mediaIds.length
          ? admin.from('media_assets').select('id,name').eq('company_id', device.company_id).in('id', mediaIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (campaignResult.error) throw campaignResult.error
      if (playlistResult.error) throw playlistResult.error
      if (mediaResult.error) throw mediaResult.error

      const campaignNames = new Map((campaignResult.data || []).map(row => [row.id, row.name]))
      const playlistNames = new Map((playlistResult.data || []).map(row => [row.id, row.name]))
      const mediaNames = new Map((mediaResult.data || []).map(row => [row.id, row.name]))

      const rows = parsedEvents.map(event => ({
        ...event,
        company_id: device.company_id,
        device_id: device.id,
        device_name: device.name,
        campaign_name: event.campaign_id ? (campaignNames.get(event.campaign_id) || 'Campanha removida') : 'Conteúdo padrão',
        playlist_name: event.playlist_id ? (playlistNames.get(event.playlist_id) || 'Playlist removida') : null,
        media_name: event.media_id ? (mediaNames.get(event.media_id) || 'Mídia removida') : null,
      }))

      const { error: logError } = await admin
        .from('playback_logs')
        .upsert(rows, { onConflict: 'device_id,client_event_id', ignoreDuplicates: true })
      if (logError) return json({ error: 'playback_log_failed', message: logError.message }, 400)
      return json({ ok: true, accepted: rows.length })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    console.error('device-gateway', error)
    return json({ error: 'internal_error', message: error?.message || 'Falha interna.' }, 500)
  }
})
