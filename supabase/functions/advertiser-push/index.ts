// Advertiser-only Web Push registration; never accepts a company_id or another user_id.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendAdvertiserPush } from '../_shared/web-push.ts'

const C = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const J = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...C, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const clean = (value: unknown, length: number) => String(value ?? '').trim().slice(0,length)
const keyValid = (value: string) => /^[A-Za-z0-9_-]{16,300}$/.test(value)
function validPushEndpoint(value: string) {
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false
    const h = u.hostname.toLowerCase()
    return h === 'fcm.googleapis.com' ||
      h === 'updates.push.services.mozilla.com' ||
      h === 'web.push.apple.com' ||
      h.endsWith('.push.apple.com') ||
      h.endsWith('.notify.windows.com')
  } catch { return false }
}

async function context(req: Request) {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('authentication_required'), { status: 401 })
  let publishable = '', secret = ''
  try { publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')?.default || '' } catch {}
  try { secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')?.default || '' } catch {}
  publishable ||= Deno.env.get('SUPABASE_ANON_KEY') || ''
  secret ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const url = Deno.env.get('SUPABASE_URL') || ''
  if (!url || !publishable || !secret) throw Object.assign(new Error('server_not_configured'), { status: 503 })
  const admin = createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
  const client = createClient(url,publishable,{
    global:{headers:{Authorization:auth}},
    auth:{persistSession:false,autoRefreshToken:false},
  })
  const { data: identity, error: authError } = await client.auth.getUser(auth.slice(7))
  if (authError || !identity?.user) throw Object.assign(new Error('invalid_session'), { status: 401 })
  const user = identity.user
  const { data: advertiser, error: advertiserError } = await admin
    .from('vision_advertisers')
    .select('id,user_id,email,status,archived_at')
    .eq('user_id',user.id).maybeSingle()
  if (advertiserError) throw advertiserError
  if (!advertiser || advertiser.archived_at || advertiser.status !== 'active' ||
      String(advertiser.email||'').trim().toLowerCase() !== String(user.email||'').trim().toLowerCase()) {
    throw Object.assign(new Error('advertiser_unavailable'),{status:403})
  }
  return { admin, user, advertiser }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:C})
  if (req.method !== 'POST') return J({error:'method_not_allowed'},405)
  try {
    const { admin, user, advertiser } = await context(req)
    const body = await req.json().catch(() => ({}))
    const action = clean(body?.action,40)

    if (action === 'status') {
      const { data: vapid, error: vapidError } = await admin.from('web_push_config')
        .select('vapid_public_key').eq('id',1).maybeSingle()
      if(vapidError) throw vapidError
      const { count, error: countError } = await admin.from('vision_advertiser_push_subscriptions')
        .select('id',{count:'exact',head:true})
        .eq('advertiser_id',advertiser.id).eq('user_id',user.id).is('disabled_at',null)
      if(countError) throw countError
      return J({ok:true, public_key:clean(vapid?.vapid_public_key,400),
        subscribed:Number(count||0)>0})
    }

    const endpoint = clean(body?.endpoint,2001)
    if (!validPushEndpoint(endpoint)) return J({error:'invalid_push_endpoint'},400)

    if (action === 'subscribe') {
      const p256dh=clean(body?.subscription?.keys?.p256dh,301)
      const authKey=clean(body?.subscription?.keys?.auth,301)
      if (!keyValid(p256dh) || !keyValid(authKey) ||
          String(body?.subscription?.endpoint || '') !== endpoint)
        return J({error:'invalid_subscription'},400)
      const now=new Date().toISOString()
      const { error } = await admin.from('vision_advertiser_push_subscriptions')
        .upsert({
          advertiser_id:advertiser.id, user_id:user.id,
          endpoint, p256dh, auth_key:authKey,
          user_agent:clean(req.headers.get('user-agent'),500) || null,
          updated_at:now, last_seen_at:now, disabled_at:null,
        },{onConflict:'endpoint'})
      if(error) throw error
      return J({ok:true,subscribed:true})
    }
    if (action === 'unsubscribe') {
      const { error } = await admin.from('vision_advertiser_push_subscriptions')
        .delete().eq('advertiser_id',advertiser.id).eq('user_id',user.id).eq('endpoint',endpoint)
      if(error) throw error
      return J({ok:true,subscribed:false})
    }
    if (action === 'test') {
      const {data:sub,error} = await admin.from('vision_advertiser_push_subscriptions')
        .select('id,last_test_at').eq('advertiser_id',advertiser.id)
        .eq('user_id',user.id).eq('endpoint',endpoint).is('disabled_at',null).maybeSingle()
      if(error) throw error
      if(!sub) return J({error:'push_not_registered'},409)
      if(sub.last_test_at && Date.now()-new Date(sub.last_test_at).getTime()<300000)
        return J({error:'push_test_cooldown'},429)
      const {error:updateError} = await admin.from('vision_advertiser_push_subscriptions')
        .update({last_test_at:new Date().toISOString()}).eq('id',sub.id)
      if(updateError) throw updateError
      const result = await sendAdvertiserPush(admin,advertiser.id,user.id,{
        title:'Vision Mídia Digital • teste de notificação',
        body:'Seu celular está preparado para receber alertas das suas campanhas.',
        tag:'vision-advertiser-push-test',
      },endpoint)
      return J({ok:true,...result})
    }
    return J({error:'unknown_action'},400)
  } catch (error: any) {
    console.error('advertiser-push',error?.message||'internal_error')
    return J({error:clean(error?.message||'internal_error',120)},Number(error?.status||500))
  }
})
