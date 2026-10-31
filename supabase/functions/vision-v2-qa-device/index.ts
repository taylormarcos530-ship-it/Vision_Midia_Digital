// Vision V2 QA - API exclusiva do projeto yuwvgpvwgeowhgtxssvr.
// NÃO usar com TVs reais; credenciais QA no banco são zero por padrão.
// Toda autenticação ocorre via token por dispositivo, validado na RPC
// service_role, nunca no browser. Sem service_role/segredos no código cliente.
import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const origin = 'https://appassets.androidplatform.net'
const common = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-device-token, apikey',
  'Vary': 'Origin',
}

function respond(code: number, data: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status: code, headers: {...common, ...extra} })
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  let secrets: Record<string, string> = {}
  try { secrets = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') } catch {}
  const secret = secrets.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !secret) return null
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, {status:204, headers:common})
  if (req.method !== 'POST') return respond(405, {ok:false,error:'method_not_allowed'})
  const token = req.headers.get('x-device-token') || ''
  if (!/^[0-9a-f]{64}$/.test(token)) return respond(401, {ok:false,error:'unauthorized'})
  if (req.headers.get('content-length') && Number(req.headers.get('content-length')) > 80_000)
    return respond(413, {ok:false,error:'payload_too_large'})
  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 80_000) return respond(413, {ok:false,error:'payload_too_large'})
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return respond(400, {ok:false,error:'invalid_json'})
    body = parsed as Record<string, unknown>
  } catch {
    return respond(400, {ok:false,error:'invalid_json'})
  }
  const action = body.action
  if (action !== 'sync' && action !== 'playback_batch')
    return respond(400, {ok:false,error:'unknown_action'})
  const revision = body.known_revision
  if (action === 'sync' && revision != null &&
      (!Number.isSafeInteger(revision) || (revision as number) < 0))
    return respond(400, {ok:false,error:'invalid_revision'})
  const events = body.events
  if (action === 'playback_batch' &&
      (!Array.isArray(events) || events.length < 1 || events.length > 50))
    return respond(400, {ok:false,error:'invalid_batch'})
  const admin = adminClient()
  if (!admin) return respond(503, {ok:false,error:'gateway_unavailable'}, {'Retry-After':'60'})
  try {
    const {data, error} = await admin.rpc('vision_v2_qa_device_api',{
      p_token:token,
      p_action:action,
      p_known_revision:action==='sync'? (revision ?? null):null,
      p_events:action==='playback_batch'?events:null,
    })
    if (error) {
      // Não revelar detalhes internos da base; a transação SQL foi revertida.
      const validation = error.code === '22023'
      return respond(validation?400:503,
        {ok:false,error:validation?'invalid_playback_event':'gateway_unavailable'},
        validation?{}:{'Retry-After':'60'})
    }
    if (!data || typeof data !== 'object') return respond(503, {ok:false,error:'gateway_unavailable'})
    if (data.ok === false) {
      return respond(data.error === 'unauthorized' ? 401 : 400, data)
    }
    return respond(200, data)
  } catch {
    return respond(503, {ok:false,error:'gateway_unavailable'}, {'Retry-After':'60'})
  }
})
