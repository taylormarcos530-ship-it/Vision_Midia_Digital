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

function decodeBase64(value) {
  const raw = String(value || '').replace(/^data:image\/jpeg;base64,/, '')
  if (!raw || raw.length > 7_500_000) throw new Error('invalid_screenshot_payload')
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (bytes.length < 100 || bytes.length > 5 * 1024 * 1024) throw new Error('invalid_screenshot_size')
  return bytes
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


function itemScheduleIsActive(item, clock) {
  if (!item?.schedule_enabled) return true
  return campaignIsActive(item, clock)
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

    if (action === 'commands') {
      const { data: commands, error: commandsError } = await admin.from('device_commands')
        .select('id,command_type,status,requested_at,delivered_at')
        .eq('company_id', device.company_id)
        .eq('device_id', device.id)
        .in('status', ['pending','sent'])
        .order('requested_at', { ascending: true })
        .limit(3)
      if (commandsError) throw commandsError
      if (commands?.length) {
        const ids = commands.map(row => row.id)
        await admin.from('device_commands').update({ status:'sent', delivered_at:new Date().toISOString() }).in('id', ids)
      }
      return json({ ok:true, commands: commands || [] })
    }

    if (action === 'screenshot_result') {
      const commandId = String(body?.command_id || '')
      const { data: command, error: commandError } = await admin.from('device_commands')
        .select('id,company_id,device_id,command_type,status')
        .eq('id', commandId).eq('company_id', device.company_id).eq('device_id', device.id).maybeSingle()
      if (commandError) throw commandError
      if (!command || command.command_type !== 'screenshot') return json({ error:'invalid_screenshot_command' }, 404)
      const { data: existing } = await admin.from('device_screenshots').select('id,storage_path').eq('command_id', commandId).maybeSingle()
      if (existing) {
        await admin.from('device_commands').update({ status:'completed', completed_at:new Date().toISOString() }).eq('id', commandId)
        return json({ ok:true, screenshot_id:existing.id, duplicate:true })
      }
      const bytes = decodeBase64(body?.image_base64)
      const width = safeNumber(body?.width, 1, 10000)
      const height = safeNumber(body?.height, 1, 10000)
      const { data: oldShots, error: oldError } = await admin.from('device_screenshots').select('id,storage_path,size_bytes').eq('company_id',device.company_id).eq('device_id',device.id)
      if (oldError) throw oldError
      const oldBytes = (oldShots || []).reduce((sum,row)=>sum+Number(row.size_bytes||0),0)
      const { data: usage, error: usageError } = await admin.rpc('get_platform_storage_usage',{p_company_id:device.company_id})
      if (usageError) throw usageError
      const u = usage?.[0] || usage || {}
      const projectedGlobal = Math.max(0, Number(u.global_used_bytes||0) - oldBytes) + bytes.length
      const projectedCompany = Math.max(0, Number(u.company_used_bytes||0) - oldBytes) + bytes.length
      if (projectedGlobal > Number(u.capacity_mb||1024)*1024*1024 || projectedCompany > Number(u.company_limit_mb||0)*1024*1024) {
        await admin.from('device_commands').update({ status:'failed', completed_at:new Date().toISOString(), error_message:'screenshot_storage_limit' }).eq('id',commandId)
        return json({ error:'screenshot_storage_limit' }, 409)
      }
      const storagePath = `${device.company_id}/screenshots/${device.id}/${commandId}.jpg`
      const { error: uploadError } = await admin.storage.from('vision-media').upload(storagePath, bytes, { contentType:'image/jpeg', upsert:false })
      if (uploadError) throw uploadError
      const now = new Date().toISOString()
      const { data: shot, error: shotError } = await admin.from('device_screenshots').insert({ company_id:device.company_id, device_id:device.id, command_id:commandId, storage_path:storagePath, captured_at:now, width:width==null?null:Math.round(width), height:height==null?null:Math.round(height), size_bytes:bytes.length }).select('id,storage_path,captured_at').single()
      if (shotError) { await admin.storage.from('vision-media').remove([storagePath]).catch(()=>null); throw shotError }
      await admin.from('device_commands').update({ status:'completed', completed_at:now, result:{screenshot_id:shot.id,storage_path:storagePath} }).eq('id',commandId)
      const oldPaths=(oldShots||[]).map(row=>row.storage_path).filter(Boolean)
      if(oldPaths.length) await admin.storage.from('vision-media').remove(oldPaths).catch(()=>null)
      const oldIds=(oldShots||[]).map(row=>row.id)
      if(oldIds.length) await admin.from('device_screenshots').delete().in('id',oldIds)
      return json({ ok:true, screenshot:shot })
    }

    if (action === 'screenshot_error') {
      const commandId=String(body?.command_id||'')
      const message=String(body?.error_message||'Falha ao capturar tela').slice(0,500)
      const { error } = await admin.from('device_commands').update({status:'failed',completed_at:new Date().toISOString(),error_message:message}).eq('id',commandId).eq('company_id',device.company_id).eq('device_id',device.id).in('status',['pending','sent'])
      if(error)throw error
      return json({ok:true})
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
        .select('id,media_id,position,duration_override_seconds,enabled,schedule_enabled,start_date,end_date,start_time,end_time,weekdays,updated_at')
        .eq('playlist_id', playlist.id)
        .eq('company_id', device.company_id)
        .eq('enabled', true)
        .order('position', { ascending: true })
      if (itemsError) throw itemsError

      const itemClock = localDateParts(new Date(), resolved.program?.timezone || 'America/Sao_Paulo')
      const supportsItemSchedules = body?.supports_item_schedules === true
      const effectivePlaylistItems = supportsItemSchedules ? (playlistItems || []) : (playlistItems || []).filter(item => itemScheduleIsActive(item, itemClock))
      const mediaIds = [...new Set(effectivePlaylistItems.map((item) => item.media_id))]
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
      for (const item of effectivePlaylistItems) {
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
          schedule: { enabled: Boolean(item.schedule_enabled), start_date: item.start_date || null, end_date: item.end_date || null, start_time: item.start_time || null, end_time: item.end_time || null, weekdays: Array.isArray(item.weekdays) ? item.weekdays.map(Number) : [0,1,2,3,4,5,6] },
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
        items: items.map((item) => [item.id, item.media.id, item.media.checksum, item.duration_seconds, item.schedule]),
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
