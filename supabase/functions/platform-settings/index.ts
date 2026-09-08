import { createClient } from 'npm:@supabase/supabase-js@2'

const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const J=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}})
const clean=(v:unknown,max=500)=>String(v??'').trim().slice(0,max)
function clients(){
  const pub=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY')
  const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url=Deno.env.get('SUPABASE_URL')||''
  if(!pub||!secret||!url)throw new Error('keys_unavailable')
  return{url,pub,admin:createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})}
}
async function context(req:Request){
  const h=req.headers.get('authorization')||''
  if(!h.startsWith('Bearer '))throw Object.assign(new Error('authentication_required'),{status:401})
  const {url,pub,admin}=clients()
  const uc=createClient(url,pub,{global:{headers:{Authorization:h}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await uc.auth.getUser(h.slice(7))
  if(error||!data?.user)throw Object.assign(new Error('invalid_session'),{status:401})
  const {data:pa,error:pe}=await admin.from('platform_admins').select('role,status').eq('user_id',data.user.id).maybeSingle()
  if(pe)throw pe
  if(!pa||pa.status!=='active')throw Object.assign(new Error('master_forbidden'),{status:403})
  return{admin,user:data.user,role:pa.role}
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C})
  if(req.method!=='POST')return J({error:'method_not_allowed'},405)
  try{
    const {admin,user,role}=await context(req)
    const body=await req.json().catch(()=>({}))
    const action=clean(body.action,40)
    if(action==='get'){
      const {data,error}=await admin.from('platform_public_config').select('*').eq('id',1).maybeSingle()
      if(error)throw error
      return J({ok:true,config:data||{}})
    }
    if(action==='update'){
      if(!['super_admin','admin'].includes(role))return J({error:'master_read_only'},403)
      const phone=clean(body.support_whatsapp,24).replace(/[^0-9]/g,'')
      if(phone&&phone.length<10)return J({error:'invalid_support_whatsapp'},400)
      const signupMessage=clean(body.signup_whatsapp_message,500)
      const renewalMessage=clean(body.renewal_whatsapp_message,500)
      if(!signupMessage||!renewalMessage)return J({error:'messages_required'},400)
      const payload={
        support_whatsapp:phone||null,
        signup_whatsapp_message:signupMessage,
        renewal_whatsapp_message:renewalMessage,
        signup_enabled:body.signup_enabled!==false,
        updated_at:new Date().toISOString(),
      }
      const {data,error}=await admin.from('platform_public_config').update(payload).eq('id',1).select('*').single()
      if(error)throw error
      await admin.from('master_audit_logs').insert({actor_user_id:user.id,action:'platform_public_settings_updated',details:{support_whatsapp:phone?`***${phone.slice(-4)}`:null,signup_enabled:payload.signup_enabled}}).catch(()=>null)
      return J({ok:true,config:data})
    }
    return J({error:'unknown_action'},400)
  }catch(error){
    console.error('platform-settings',error)
    return J({error:String(error?.message||'internal_error')},Number(error?.status)||500)
  }
})
