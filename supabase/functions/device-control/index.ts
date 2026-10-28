import { createClient } from 'npm:@supabase/supabase-js@2'

const C = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const J = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...C, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function clients() {
  let publishable = ''
  let secret = ''
  try { publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')?.default || '' } catch {}
  try { secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')?.default || '' } catch {}
  publishable ||= Deno.env.get('SUPABASE_ANON_KEY') || ''
  secret ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const url = Deno.env.get('SUPABASE_URL') || ''
  if (!url || !publishable || !secret) throw new Error('supabase_keys_unavailable')
  return {
    url,
    publishable,
    admin: createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}


// Firebase Admin credentials remain in the server's encrypted environment,
// NEVER in the APK, Master JavaScript, database row, or git.
let cachedFcmAccessToken: { token:string; expiresAt:number } | null = null;
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
}
async function getFcmAccessToken(credentials: any): Promise<string> {
  if (cachedFcmAccessToken && Date.now() < cachedFcmAccessToken.expiresAt) {
    return cachedFcmAccessToken.token;
  }
  const issued = Math.floor(Date.now() / 1000);
  const claim = { iss: credentials.client_email,
    scope:'https://www.googleapis.com/auth/firebase.messaging',
    aud:'https://oauth2.googleapis.com/token', iat:issued, exp:issued + 3600 };
  const header = base64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload = base64url(new TextEncoder().encode(JSON.stringify(claim)));
  const signingInput = header + '.' + payload;
  const pem = String(credentials.private_key || '');
  const raw = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\s/g,'');
  const key = await crypto.subtle.importKey('pkcs8',
    Uint8Array.from(atob(raw), x => x.charCodeAt(0)),
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(signingInput));
  const assertion = signingInput + '.' + base64url(new Uint8Array(signature));
  const oauth = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', signal:AbortSignal.timeout(5000),
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
  });
  if (!oauth.ok) throw new Error('fcm_auth_failed_' + oauth.status);
  const data = await oauth.json();
  if (!data.access_token) throw new Error('fcm_auth_token_missing');
  cachedFcmAccessToken = {token:String(data.access_token),
    expiresAt: Date.now() + Math.max(60,Math.min(3300, Number(data.expires_in || 3600)-120))*1000};
  return cachedFcmAccessToken.token;
}
async function dispatchDeviceCommandPush(admin: any, companyId:string, deviceId:string, commandId:string): Promise<string> {
  if (Deno.env.get('VISION_FCM_ENABLED') !== 'true') return 'not_configured';
  const raw = Deno.env.get('VISION_FCM_SERVICE_ACCOUNT_JSON');
  if (!raw) return 'not_configured';
  try {
    const service = JSON.parse(raw);
    if (!service.project_id || !service.client_email || !service.private_key) return 'invalid_configuration';
    const {data:reg,error} = await admin.from('device_push_tokens').select('fcm_token')
      .eq('company_id',companyId).eq('device_id',deviceId).maybeSingle();
    if (error) throw error;
    if (!reg?.fcm_token) return 'not_registered';
    const bearer = await getFcmAccessToken(service);
    const result = await fetch('https://fcm.googleapis.com/v1/projects/' +
      encodeURIComponent(service.project_id) + '/messages:send', {
      method:'POST',signal:AbortSignal.timeout(5000),
      headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},
      body:JSON.stringify({message:{
        token:reg.fcm_token,
        data:{kind:'vision_command',command_id:commandId},
        android:{priority:'high',ttl:'3600s'},
      }}),
    });
    if (!result.ok) {
      console.warn('Vision push delivery HTTP status',result.status);
      return 'failed';
    }
    return 'sent';
  } catch (_error) {
    // The already-stored command is durable; offline devices pick it up on
    // their next authenticated reconnect/fallback reconciliation.
    console.warn('Vision push unavailable; queued command preserved');
    return 'failed';
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: C })
  if (req.method !== 'POST') return J({ error: 'method_not_allowed' }, 405)

  try {
    const auth = req.headers.get('authorization') || ''
    if (!auth.startsWith('Bearer ')) return J({ error: 'authentication_required' }, 401)

    const { url, publishable, admin } = clients()
    const userClient = createClient(url, publishable, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser(auth.slice(7))
    if (userError || !userData?.user) return J({ error: 'invalid_session' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '').trim()
    const companyId = String(body?.company_id || '').trim()
    const deviceId = String(body?.device_id || '').trim()
    if (!companyId || !deviceId) return J({ error: 'company_and_device_required' }, 400)

    const { data: membership, error: membershipError } = await admin
      .from('company_members')
      .select('role,status')
      .eq('company_id', companyId)
      .eq('user_id', userData.user.id)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership || membership.status !== 'active' || !['owner','admin','operator'].includes(membership.role)) {
      return J({ error: 'device_control_forbidden' }, 403)
    }

    const { data: device, error: deviceError } = await admin
      .from('devices')
      .select('id,company_id,name,retired_at,status,apk_version')
      .eq('id', deviceId)
      .eq('company_id', companyId)
      .maybeSingle()
    if (deviceError) throw deviceError
    if (!device || device.retired_at) return J({ error: 'device_not_found' }, 404)

    const allowedCommands = ['restart_player','sync_now','clear_cache','reload_programming','update_apk']
    if (!allowedCommands.includes(action)) return J({ error: 'unknown_action' }, 400)

    if (action === 'update_apk') {
      const match = String(device.apk_version || '').match(/^(\d+)\.(\d+)\.(\d+)/)
      if (!match || Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 5) || (Number(match[1]) === 1 && Number(match[2]) === 5 && Number(match[3]) < 12)) {
        return J({ error: 'apk_updater_requires_initial_install_1_5_12' }, 409)
      }
    }

    const { data: pending, error: pendingError } = await admin
      .from('device_commands')
      .select('id,status,requested_at')
      .eq('company_id', companyId)
      .eq('device_id', deviceId)
      .eq('command_type', action)
      .in('status', ['pending','sent'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (pendingError) throw pendingError
    if (pending) {
      const push = await dispatchDeviceCommandPush(admin, companyId, deviceId, pending.id);
      return J({ ok: true, duplicate: true, command: pending, push });
    }

    const { data: command, error: commandError } = await admin
      .from('device_commands')
      .insert({
        company_id: companyId,
        device_id: deviceId,
        command_type: action,
        requested_by: userData.user.id,
        status: 'pending',
      })
      .select('id,command_type,status,requested_at')
      .single()
    if (commandError) {
      if (commandError.code === '23505') {
        const { data: duplicate, error: duplicateError } = await admin
          .from('device_commands')
          .select('id,status,requested_at')
          .eq('company_id', companyId)
          .eq('device_id', deviceId)
          .eq('command_type', action)
          .in('status', ['pending','sent'])
          .order('requested_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (duplicateError) throw duplicateError
        if (duplicate) {
          const push = await dispatchDeviceCommandPush(admin, companyId, deviceId, duplicate.id);
          return J({ ok: true, duplicate: true, command: duplicate, push });
        }
      }
      throw commandError
    }

    try {
      const { error: auditError } = await admin.from('master_audit_logs').insert({
        actor_user_id: userData.user.id,
        action: `device_${action}_requested`,
        company_id: companyId,
        details: { device_id: deviceId, device_name: device.name, command_id: command.id },
      })
      if (auditError) console.warn('device-control audit', auditError.message)
    } catch (auditError) {
      console.warn('device-control audit', auditError)
    }

    const push = await dispatchDeviceCommandPush(admin, companyId, deviceId, command.id);
    return J({ ok: true, command, push })
  } catch (error: any) {
    console.error('device-control', error)
    return J({ error: error?.message || 'internal_error' }, Number(error?.status || 500))
  }
})
