from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)

# ---------------- player.html ----------------
p = Path('player.html')
s = p.read_text()
s = replace_once(s, '<strong>Vision Mídia Digital</strong><small>Vision Player</small>', '<strong id="pairing-brand-title">Vision Mídia Digital</strong><small>Vision Player</small>', 'pairing brand title')
s = replace_once(s, '<h1>Digite este código no painel</h1>', '<h1 id="pairing-heading">Digite este código no painel</h1>', 'pairing heading')
s = replace_once(s, '<p>No painel Vision, abra <strong>TVs → Parear TV</strong> e informe o código acima.</p>', '<p id="pairing-instruction">No painel Vision, abra <strong>TVs → Parear TV</strong> e informe o código acima.</p>', 'pairing instruction')
p.write_text(s)

# ---------------- player.css ----------------
p = Path('player.css')
s = p.read_text()
s = replace_once(s, '.pairing-screen { display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 20% 0%, #17335f 0, #08111f 35%, #03070d 72%, #000 100%); }', '.pairing-screen { display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 20% 0%, #17335f 0, #08111f 35%, #03070d 72%, #000 100%); background-size: cover; background-position: center; }', 'pairing background')
s = replace_once(s, '.player-status { position: absolute; top: 16px; right: 16px; z-index: 5; padding: 8px 12px; border-radius: 999px; background: rgba(0,0,0,.55); backdrop-filter: blur(10px); color: #aebbd0; font-size: 12px; opacity: .75; transition: opacity .2s; }', '.player-status { display:none !important; }', 'hide player status')
s = replace_once(s, '.player-controls { position: absolute; right: 16px; bottom: 16px; z-index: 6; display: flex; gap: 8px; opacity: .12; transition: opacity .2s; }\n.player-controls:hover, .player-controls:focus-within { opacity: 1; }\n.player-controls button { width: 44px; height: 44px; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.6); color: #fff; cursor: pointer; font-size: 20px; }', '.player-controls { display:none !important; }', 'hide player controls')
p.write_text(s)

# ---------------- player.js ----------------
p = Path('player.js')
s = p.read_text()
s = replace_once(s, "  const APP_VERSION = 'vision-player-web-1.2.0';", "  const APP_VERSION = 'vision-player-web-1.3.0';", 'player version')
s = replace_once(s, "  const DEVICE_EVENT_QUEUE_KEY = 'vision_player_device_event_queue_v1';", "  const DEVICE_EVENT_QUEUE_KEY = 'vision_player_device_event_queue_v1';\n  const SETUP_CODE_KEY = 'vision_player_setup_code_v1';\n  const querySetupCode = new URLSearchParams(location.search).get('setup');\n  if (querySetupCode) localStorage.setItem(SETUP_CODE_KEY, String(querySetupCode).slice(0,128));", 'setup key')
s = replace_once(s, "    syncTimer: null,\n    lastSyncAt:", "    syncTimer: null,\n    commandTimer: null,\n    processingCommands: new Set(),\n    lastSyncAt:", 'command state')

# Pairing branding helper before showPairing.
marker = "  function showPairing() {\n"
helper = r'''  function applyPairingBranding(branding = null) {
    const screen = $('#pairing-screen');
    const title = branding?.title || 'Vision Mídia Digital';
    const message = branding?.message || 'No painel Vision, abra TVs → Parear TV e informe o código acima.';
    $('#pairing-brand-title').textContent = title;
    $('#pairing-heading').textContent = branding ? 'Vincule esta TV pelo código' : 'Digite este código no painel';
    $('#pairing-instruction').textContent = message;
    if (branding?.splash_url) {
      screen.style.backgroundImage = `linear-gradient(rgba(0,0,0,.32),rgba(0,0,0,.58)),url("${branding.splash_url}")`;
    } else {
      screen.style.backgroundImage = '';
    }
  }

'''
s = replace_once(s, marker, helper + marker, 'pairing branding helper')
s = replace_once(s, "      const pairing = await functionRequest('device-bootstrap', { action: 'start', platform: detectPlatform() });", "      const pairing = await functionRequest('device-bootstrap', { action: 'start', platform: detectPlatform(), setup_code: localStorage.getItem(SETUP_CODE_KEY) || null });", 'bootstrap setup code')
s = replace_once(s, "      state.pairing = pairing;\n      writeJson(PAIRING_KEY, pairing);\n      renderPairing(pairing);", "      state.pairing = pairing;\n      writeJson(PAIRING_KEY, pairing);\n      applyPairingBranding(pairing.branding || null);\n      renderPairing(pairing);", 'render branding new')
s = replace_once(s, "      renderPairing(state.pairing);\n      pollPairing(state.pairing);", "      applyPairingBranding(state.pairing.branding || null);\n      renderPairing(state.pairing);\n      pollPairing(state.pairing);", 'render branding saved')

# manifest supports schedules
s = replace_once(s, "      const manifest = await gateway({ action: 'manifest' });", "      const manifest = await gateway({ action: 'manifest', supports_item_schedules: true });", 'manifest capability')

# Scheduling helpers before shuffled.
marker = "  function shuffled(items) {\n"
helper = r'''  const LOCAL_WEEKDAY_INDEX = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  function localClock(timeZone) {
    let zone = timeZone || 'America/Sao_Paulo';
    let formatter;
    try { formatter = new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',weekday:'short',hourCycle:'h23'}); }
    catch { zone='America/Sao_Paulo'; formatter = new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',weekday:'short',hourCycle:'h23'}); }
    const parts=Object.fromEntries(formatter.formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const year=Number(parts.year),month=Number(parts.month),day=Number(parts.day);
    const calendar=new Date(Date.UTC(year,month-1,day));
    const previous=new Date(calendar.getTime()-86400000);
    return {dateKey:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,previousDateKey:`${previous.getUTCFullYear()}-${String(previous.getUTCMonth()+1).padStart(2,'0')}-${String(previous.getUTCDate()).padStart(2,'0')}`,weekday:LOCAL_WEEKDAY_INDEX[parts.weekday]??calendar.getUTCDay(),previousWeekday:previous.getUTCDay(),seconds:Number(parts.hour)*3600+Number(parts.minute)*60+Number(parts.second)};
  }
  function timeSeconds(value){if(!value)return null;const [h='0',m='0',sec='0']=String(value).split(':');const n=Number(h)*3600+Number(m)*60+Number(sec);return Number.isFinite(n)?n:null}
  function itemScheduleActive(item, timeZone) {
    const schedule=item?.schedule;
    if(!schedule?.enabled)return true;
    const clock=localClock(timeZone),start=timeSeconds(schedule.start_time),end=timeSeconds(schedule.end_time);
    let dateKey=clock.dateKey,weekday=clock.weekday;
    if(start!=null&&end!=null){if(start<end){if(clock.seconds<start||clock.seconds>=end)return false}else{if(clock.seconds>=start){}else if(clock.seconds<end){dateKey=clock.previousDateKey;weekday=clock.previousWeekday}else return false}}
    if(schedule.start_date&&dateKey<schedule.start_date)return false;
    if(schedule.end_date&&dateKey>schedule.end_date)return false;
    const days=Array.isArray(schedule.weekdays)?schedule.weekdays.map(Number):[0,1,2,3,4,5,6];
    return days.includes(weekday);
  }

  function blobToBase64(blob) {
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.onerror=()=>reject(reader.error||new Error('Falha ao ler captura.'));reader.readAsDataURL(blob);});
  }

  async function captureCurrentFrame() {
    const media = $('#media-stage img, #media-stage video');
    if (!media) throw new Error('Nenhuma imagem ou vídeo está sendo exibido agora.');
    const viewW=Math.max(1,innerWidth||screen.width||1920),viewH=Math.max(1,innerHeight||screen.height||1080);
    const scale=Math.min(1,1920/Math.max(viewW,viewH));
    const width=Math.max(1,Math.round(viewW*scale)),height=Math.max(1,Math.round(viewH*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas indisponível.');ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
    const sourceW=media.tagName==='VIDEO'?(media.videoWidth||0):(media.naturalWidth||0),sourceH=media.tagName==='VIDEO'?(media.videoHeight||0):(media.naturalHeight||0);
    if(!sourceW||!sourceH)throw new Error('A mídia ainda não está pronta para captura.');
    const contain=Math.min(width/sourceW,height/sourceH),drawW=sourceW*contain,drawH=sourceH*contain,x=(width-drawW)/2,y=(height-drawH)/2;
    ctx.drawImage(media,x,y,drawW,drawH);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
    if(!blob)throw new Error('Não foi possível gerar a captura.');
    return {image_base64:await blobToBase64(blob),width,height,size_bytes:blob.size};
  }

  async function pollDeviceCommands() {
    if(!state.deviceToken||!navigator.onLine)return;
    const result=await gateway({action:'commands'});
    for(const command of result?.commands||[]){
      if(command.command_type!=='screenshot'||state.processingCommands.has(command.id))continue;
      state.processingCommands.add(command.id);
      try{
        const capture=await captureCurrentFrame();
        await gateway({action:'screenshot_result',command_id:command.id,...capture});
      }catch(error){
        await gateway({action:'screenshot_error',command_id:command.id,error_message:String(error?.message||error).slice(0,400)}).catch(()=>{});
      }finally{state.processingCommands.delete(command.id)}
    }
  }

'''
s = replace_once(s, marker, helper + marker, 'schedule and screenshot helpers')

# Playback loop: local active schedules and black when none.
old = """        const queue = manifest.playlist.shuffle ? shuffled(manifest.items) : [...manifest.items];
        if (manifest.playlist.repeat_mode === 'single' && queue.length) {
"""
new = """        const activeItems = (manifest.items || []).filter(item => itemScheduleActive(item, manifest.program?.timezone));
        if (!activeItems.length) {
          hideIdle();
          $('#media-stage').replaceChildren();
          await sleep(1000);
          continue;
        }
        const queue = manifest.playlist.shuffle ? shuffled(activeItems) : [...activeItems];
        if (manifest.playlist.repeat_mode === 'single' && queue.length) {
"""
s = replace_once(s, old, new, 'offline item schedule filter')

# start timers
s = replace_once(s, "    if (state.syncTimer) clearInterval(state.syncTimer);\n    state.heartbeatTimer = setInterval", "    if (state.syncTimer) clearInterval(state.syncTimer);\n    if (state.commandTimer) clearInterval(state.commandTimer);\n    state.heartbeatTimer = setInterval", 'clear command timer start')
s = replace_once(s, "    state.syncTimer = setInterval(() => syncManifest().catch(() => {}), 15_000);", "    state.syncTimer = setInterval(() => syncManifest().catch(() => {}), 15_000);\n    state.commandTimer = setInterval(() => pollDeviceCommands().catch(() => {}), 5_000);\n    pollDeviceCommands().catch(() => {});", 'command timer')
s = replace_once(s, "    if (state.syncTimer) clearInterval(state.syncTimer);\n    state.heartbeatTimer = null;\n    state.syncTimer = null;", "    if (state.syncTimer) clearInterval(state.syncTimer);\n    if (state.commandTimer) clearInterval(state.commandTimer);\n    state.heartbeatTimer = null;\n    state.syncTimer = null;\n    state.commandTimer = null;\n    state.processingCommands.clear();", 'reset command timer')
p.write_text(s)

# ---------------- device-bootstrap ----------------
p = Path('supabase/functions/device-bootstrap/index.ts')
s = p.read_text()
marker = "function pairingCode() {\n  return String(randomInt(1_000_000)).padStart(6, '0')\n}\n"
helper = marker + r'''
async function playerBranding(admin, setupCode) {
  const code = String(setupCode || '').trim().slice(0, 128)
  if (!code) return null
  const { data, error } = await admin.from('company_player_branding').select('company_id,title,message,splash_path').eq('setup_code', code).maybeSingle()
  if (error) throw error
  if (!data) return null
  let splashUrl = null
  if (data.splash_path) {
    const { data: signed, error: signedError } = await admin.storage.from('vision-media').createSignedUrl(data.splash_path, 60 * 60)
    if (!signedError) splashUrl = signed?.signedUrl || null
  }
  return { company_id: data.company_id, title: data.title || null, message: data.message || null, splash_url: splashUrl }
}
'''
s = replace_once(s, marker, helper, 'bootstrap branding helper')
s = replace_once(s, "      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString()\n\n      for (let attempt", "      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString()\n      const branding = await playerBranding(admin, body?.setup_code)\n\n      for (let attempt", 'bootstrap branding lookup')
s = replace_once(s, "            user_agent: String(req.headers.get('user-agent') || '').slice(0, 500),\n            expires_at: expiresAt,", "            user_agent: String(req.headers.get('user-agent') || '').slice(0, 500),\n            setup_company_id: branding?.company_id || null,\n            expires_at: expiresAt,", 'bootstrap bind company')
s = replace_once(s, "            pairing_code: code,\n            expires_at: data.expires_at,", "            pairing_code: code,\n            expires_at: data.expires_at,\n            branding: branding ? { title: branding.title, message: branding.message, splash_url: branding.splash_url } : null,", 'bootstrap return branding')
p.write_text(s)

# ---------------- claim-device ----------------
p = Path('supabase/functions/claim-device/index.ts')
s = p.read_text()
s = replace_once(s, ".select('id,status,expires_at,platform')", ".select('id,status,expires_at,platform,setup_company_id')", 'claim setup company select')
s = replace_once(s, "    if (new Date(pairing.expires_at).getTime() <= Date.now()) {", "    if (pairing.setup_company_id && pairing.setup_company_id !== companyId) {\n      await admin.from('device_claim_attempts').insert({ user_id: user.id, success: false })\n      return json({ error: 'branded_player_company_mismatch', message: 'Este Player foi configurado para outra empresa.' }, 403)\n    }\n\n    if (new Date(pairing.expires_at).getTime() <= Date.now()) {", 'claim branded company check')
p.write_text(s)

# ---------------- device-gateway ----------------
p = Path('supabase/functions/device-gateway/index.ts')
s = p.read_text()
marker = "function safeNumber(value, min, max) {\n  const number = Number(value)\n  if (!Number.isFinite(number)) return null\n  return Math.max(min, Math.min(max, number))\n}\n"
helper = marker + r'''
function decodeBase64(value) {
  const raw = String(value || '').replace(/^data:image\/jpeg;base64,/, '')
  if (!raw || raw.length > 7_500_000) throw new Error('invalid_screenshot_payload')
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  if (bytes.length < 100 || bytes.length > 5 * 1024 * 1024) throw new Error('invalid_screenshot_size')
  return bytes
}
'''
s = replace_once(s, marker, helper, 'gateway base64 helper')

marker = "function campaignIsActive(campaign, clock) {"
# insert item helper after campaign function by identifying following resolveProgram marker.
resolve_marker = "\nasync function resolveProgram(admin, device) {"
item_helper = r'''
function itemScheduleIsActive(item, clock) {
  if (!item?.schedule_enabled) return true
  return campaignIsActive(item, clock)
}
'''
s = replace_once(s, resolve_marker, "\n" + item_helper + resolve_marker.lstrip('\n'), 'gateway item schedule helper')

# Commands actions before manifest.
manifest_marker = "    if (action === 'manifest') {\n"
commands = r'''    if (action === 'commands') {
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

'''
s = replace_once(s, manifest_marker, commands + manifest_marker, 'gateway command actions')

s = replace_once(s, ".select('id,media_id,position,duration_override_seconds,enabled,updated_at')", ".select('id,media_id,position,duration_override_seconds,enabled,schedule_enabled,start_date,end_date,start_time,end_time,weekdays,updated_at')", 'gateway schedule select')
s = replace_once(s, "      const mediaIds = [...new Set((playlistItems || []).map((item) => item.media_id))]", "      const itemClock = localDateParts(new Date(), resolved.program?.timezone || 'America/Sao_Paulo')\n      const supportsItemSchedules = body?.supports_item_schedules === true\n      const effectivePlaylistItems = supportsItemSchedules ? (playlistItems || []) : (playlistItems || []).filter(item => itemScheduleIsActive(item, itemClock))\n      const mediaIds = [...new Set(effectivePlaylistItems.map((item) => item.media_id))]", 'gateway active items')
s = replace_once(s, "      for (const item of playlistItems || []) {", "      for (const item of effectivePlaylistItems) {", 'gateway effective loop')
s = replace_once(s, "          duration_seconds: item.duration_override_seconds || asset.duration_seconds || (asset.media_type === 'image' ? 10 : null),\n          media: {", "          duration_seconds: item.duration_override_seconds || asset.duration_seconds || (asset.media_type === 'image' ? 10 : null),\n          schedule: { enabled: Boolean(item.schedule_enabled), start_date: item.start_date || null, end_date: item.end_date || null, start_time: item.start_time || null, end_time: item.end_time || null, weekdays: Array.isArray(item.weekdays) ? item.weekdays.map(Number) : [0,1,2,3,4,5,6] },\n          media: {", 'gateway schedule output')
s = replace_once(s, "        items: items.map((item) => [item.id, item.media.id, item.media.checksum, item.duration_seconds]),", "        items: items.map((item) => [item.id, item.media.id, item.media.checksum, item.duration_seconds, item.schedule]),", 'gateway version schedule')
p.write_text(s)

print('signage v2 player protocol patch applied')
