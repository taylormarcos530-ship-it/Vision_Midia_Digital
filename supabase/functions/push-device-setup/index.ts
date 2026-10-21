import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// Separate opt-in endpoint: does not alter the existing web-push release/marketing actions.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}
const J = (obj: unknown, status=200) => new Response(JSON.stringify(obj), { status, headers })
function err(reason: string, status=400) {
  return Object.assign(new Error(reason), { status })
}
function clients() {
  let pub='',secret=''
  try { pub=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}')?.default||'' } catch {}
  try { secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')?.default||'' } catch {}
  pub ||= Deno.env.get('SUPABASE_ANON_KEY')||''
  secret ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
  const url=Deno.env.get('SUPABASE_URL')||''
  if (!url||!pub||!secret) throw err('server_credentials_unavailable',500)
  return { url, pub, admin:createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}) }
}
async function context(req: Request) {
  const bearer=req.headers.get('authorization')||''
  if (!bearer.startsWith('Bearer ')) throw err('authentication_required',401)
  const {url,pub,admin}=clients()
  const userClient=createClient(url,pub,{global:{headers:{Authorization:bearer}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await userClient.auth.getUser(bearer.slice(7))
  if (error||!data?.user) throw err('invalid_session',401)
  return {user:data.user,admin}
}
async function assertMaster(admin:any,uid:string) {
  const {data,error}=await admin.from('platform_admins')
    .select('role,status').eq('user_id',uid).maybeSingle()
  if(error)throw error
  if(data?.status!=='active'||!['admin','super_admin'].includes(data?.role))throw err('master_forbidden',403)
}
async function assertCompany(admin:any,companyId:string) {
  const {data,error}=await admin.from('companies').select('id').eq('id',companyId).maybeSingle()
  if(error)throw error
  if(!data)throw err('company_not_found',404)
}
async function assertUserAccess(admin:any,uid:string,companyId:string) {
  const {data:company,error}=await admin.from('companies').select('owner_user_id').eq('id',companyId).maybeSingle()
  if(error)throw error
  if(!company)throw err('company_not_found',404)
  if(company.owner_user_id===uid)return
  const {data:member,error:e}=await admin.from('company_members')
    .select('id').eq('company_id',companyId).eq('user_id',uid).eq('status','active').maybeSingle()
  if(e)throw e
  if(!member)throw err('company_forbidden',403)
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers})
  if(req.method!=='POST')return J({error:'method_not_allowed'},405)
  try{
    const {user,admin}=await context(req)
    const body=await req.json().catch(()=>({}))
    const action=String(body?.action||'').trim()
    if(action==='subscribe_master'){
      await assertMaster(admin,user.id)
      const companyId=String(body?.company_id||'')
      const sub=body?.subscription||{}
      const endpoint=String(sub.endpoint||'').trim()
      const p256dh=String(sub.keys?.p256dh||'')
      const auth=String(sub.keys?.auth||'')
      if(!companyId||!endpoint.startsWith('https://')||endpoint.length>2000||p256dh.length<20||auth.length<10){
        return J({error:'invalid_subscription'},400)
      }
      await assertCompany(admin,companyId)
      // Endpoint ownership may only be moved when the user authenticated on this device.
      // Existing Web Push endpoint/key pair cannot be forged to receive content.
      const {data,error}=await admin.from('web_push_subscriptions').upsert({
        user_id:user.id,company_id:companyId,endpoint,p256dh,auth_key:auth,
        user_agent:String(req.headers.get('user-agent')||'').slice(0,500)||null,
        updated_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),disabled_at:null,
      },{onConflict:'endpoint'}).select('id').single()
      if(error)throw error
      return J({ok:true,registered:true})
    }
    if(action==='test_self'){
      const endpoint=String(body?.endpoint||'').trim()
      if(!endpoint)return J({error:'endpoint_required'},400)
      const {data:sub,error:readError}=await admin.from('web_push_subscriptions')
        .select('id,company_id,endpoint,p256dh,auth_key,last_test_at')
        .eq('user_id',user.id).eq('endpoint',endpoint).is('disabled_at',null).maybeSingle()
      if(readError)throw readError
      if(!sub)return J({error:'push_subscription_not_registered_on_this_account'},404)
      const {data:role,error:roleError}=await admin.from('platform_admins')
        .select('role,status').eq('user_id',user.id).maybeSingle()
      if(roleError)throw roleError
      const isMaster=role?.status==='active'&&['admin','super_admin'].includes(role.role)
      if(!isMaster)await assertUserAccess(admin,user.id,sub.company_id)

      // Atomic rate-limit to one test per subscription each minute.
      const cutoff=new Date(Date.now()-60000).toISOString()
      const {data:claimed,error:claimError}=await admin.from('web_push_subscriptions')
        .update({last_test_at:new Date().toISOString()})
        .eq('id',sub.id).eq('user_id',user.id).is('disabled_at',null)
        .or('last_test_at.is.null,last_test_at.lt.'+cutoff)
        .select('id').maybeSingle()
      if(claimError)throw claimError
      if(!claimed)return J({error:'test_rate_limited',retry_after_seconds:60},429)

      const {data:config,error:configError}=await admin.from('web_push_config')
        .select('vapid_public_key,vapid_private_key,subject').eq('id',1).maybeSingle()
      if(configError)throw configError
      if(!config?.vapid_public_key||!config?.vapid_private_key||!config?.subject)throw err('vapid_not_configured',503)
      webpush.setVapidDetails(config.subject,config.vapid_public_key,config.vapid_private_key)
      try {
        await webpush.sendNotification({
          endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_key},
        },JSON.stringify({
          title:'Vision Mídia Digital • Teste de push',
          body:'Teste enviado diretamente ao seu celular. Os alertas das TVs poderão aparecer mesmo com o PWA fechado.',
          url:'https://vision-midia-digital.vercel.app/',
          icon:'https://vision-midia-digital.vercel.app/icon.svg',
          tag:'vision-push-self-test',
          renotify:true,
        }),{TTL:3600,urgency:'high'})
        return J({ok:true,accepted_by_push_service:true,device_delivery_unconfirmed:true})
      } catch(error:any) {
        const status=Number(error?.statusCode||error?.status||0)
        if([404,410].includes(status)){
          await admin.from('web_push_subscriptions').update({disabled_at:new Date().toISOString()}).eq('id',sub.id)
          return J({error:'push_subscription_expired_reactivate',status},410)
        }
        console.error('push self-test send failed',status,error?.message||error)
        return J({error:'push_gateway_rejected',status},502)
      }
    }
    return J({error:'unknown_action'},400)
  }catch(error:any){
    console.error('push-device-setup',error?.message||error)
    return J({error:error?.message||'internal_error'},Number(error?.status||500))
  }
})
