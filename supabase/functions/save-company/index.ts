import { createClient } from 'npm:@supabase/supabase-js@2'

const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const J=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}})
function clients(){
  const publishable=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY')
  const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url=Deno.env.get('SUPABASE_URL')||''
  if(!url||!publishable||!secret)throw new Error('keys_unavailable')
  return{url,publishable,admin:createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})}
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C})
  if(req.method!=='POST')return J({error:'method_not_allowed'},405)
  try{
    const authHeader=req.headers.get('authorization')||''
    if(!authHeader.startsWith('Bearer '))return J({error:'authentication_required'},401)
    const {url,publishable,admin}=clients()
    const userClient=createClient(url,publishable,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}})
    const {data:userData,error:userError}=await userClient.auth.getUser(authHeader.slice(7))
    if(userError||!userData?.user)return J({error:'invalid_session'},401)
    const {data:platformAdmin,error:roleError}=await admin.from('platform_admins').select('role,status').eq('user_id',userData.user.id).maybeSingle()
    if(roleError)throw roleError
    if(!platformAdmin||platformAdmin.status!=='active'||!['super_admin','admin'].includes(platformAdmin.role))return J({error:'master_forbidden'},403)

    const body=await req.json().catch(()=>({}))
    const companyId=String(body.company_id||'').trim()
    if(!companyId)return J({error:'company_required'},400)
    const [{data:current,error:currentError},{data:currentCompany,error:companyError}]=await Promise.all([
      admin.from('company_subscriptions').select('*').eq('company_id',companyId).maybeSingle(),
      admin.from('companies').select('settings').eq('id',companyId).maybeSingle(),
    ])
    if(currentError)throw currentError
    if(companyError)throw companyError

    const companyName=String(body.company_name||'').trim()
    const companyStatus=String(body.company_status||'').trim()
    const planId=String(body.plan_id||'').trim()
    const subscriptionStatus=String(body.subscription_status||current?.status||'pending_approval').trim()
    const paymentStatus=String(body.payment_status||current?.payment_status||'pending').trim()
    const dueDate=body.due_date===undefined
      ? (current?.current_period_end?String(current.current_period_end).slice(0,10):null)
      : (String(body.due_date||'').trim()||null)
    const manualPrice=body.manual_price_cents===null||body.manual_price_cents===''||body.manual_price_cents===undefined
      ? null
      : Math.max(0,Math.round(Number(body.manual_price_cents)))
    const paymentUrl=body.payment_url===undefined
      ? (String(current?.payment_url||'').trim()||null)
      : (String(body.payment_url||'').trim()||null)
    if(!companyName||companyName.length<2||!planId)return J({error:'invalid_input'},400)
    if(manualPrice!==null&&!Number.isFinite(manualPrice))return J({error:'invalid_manual_price'},400)
    if(paymentUrl&&(!/^https:\/\/\S+$/i.test(paymentUrl)||paymentUrl.length>1200))return J({error:'invalid_payment_url'},400)
    const overrides=body.limit_overrides&&typeof body.limit_overrides==='object'&&!Array.isArray(body.limit_overrides)?body.limit_overrides:{}
    const notes=String(body.billing_notes||'').trim()
    const previousSettings=(currentCompany?.settings&&typeof currentCompany.settings==='object')?currentCompany.settings:{}
    const audioEnabled=body.player_audio_enabled===undefined?previousSettings.player_audio_enabled!==false:body.player_audio_enabled!==false
    const autostartEnabled=body.player_autostart_enabled===undefined?previousSettings.player_autostart_enabled!==false:body.player_autostart_enabled!==false
    const previousRevision=Math.max(0,Number(previousSettings.player_cache_revision||0))
    const cacheRevision=body.clear_cache===true?previousRevision+1:previousRevision

    const {data,error}=await admin.rpc('master_save_company_billing_v2',{
      p_company_id:companyId,
      p_company_name:companyName,
      p_company_status:companyStatus,
      p_plan_id:planId,
      p_subscription_status:subscriptionStatus,
      p_payment_status:paymentStatus,
      p_due_date:dueDate,
      p_manual_price_cents:manualPrice,
      p_limit_overrides:overrides,
      p_billing_notes:notes||null,
      p_actor_user_id:userData.user.id,
    })
    if(error)throw error

    const {data:persistedSubscription,error:paymentUrlError}=await admin
      .from('company_subscriptions')
      .update({payment_url:paymentUrl})
      .eq('company_id',companyId)
      .select('*')
      .single()
    if(paymentUrlError)throw paymentUrlError

    const companySettings={
      ...previousSettings,
      player_audio_enabled:audioEnabled,
      player_autostart_enabled:autostartEnabled,
      player_cache_revision:cacheRevision,
    }
    const {error:settingsError}=await admin.from('companies').update({settings:companySettings}).eq('id',companyId)
    if(settingsError)throw settingsError

    const dueOk=!dueDate||new Date(`${dueDate}T23:59:59`).getTime()>Date.now()
    const licenseAllowed=companyStatus==='active'&&(
      (subscriptionStatus==='trialing')||
      (subscriptionStatus==='active'&&['paid','waived'].includes(paymentStatus)&&dueOk)
    )
    if(licenseAllowed){
      const {data:devices,error:devicesError}=await admin.from('devices').select('id,settings').eq('company_id',companyId)
      if(devicesError)throw devicesError
      for(const device of devices||[]){
        const deviceSettings=(device.settings&&typeof device.settings==='object')?device.settings:{}
        const merged={...deviceSettings,audio_enabled:audioEnabled,autostart_enabled:autostartEnabled,cache_revision:cacheRevision}
        const {error:deviceError}=await admin.from('devices').update({settings:merged}).eq('id',device.id).eq('company_id',companyId)
        if(deviceError)throw deviceError
      }
    }

    await admin.from('master_audit_logs').insert({
      actor_user_id:userData.user.id,
      action:body.clear_cache===true?'company_player_cache_clear_requested':'company_billing_updated',
      company_id:companyId,
      details:{plan_id:persistedSubscription?.plan_id||data?.subscription?.plan_id||planId,subscription_status:persistedSubscription?.status||data?.subscription?.status||subscriptionStatus,payment_status:persistedSubscription?.payment_status||data?.subscription?.payment_status||paymentStatus,due_date:dueDate,payment_url_configured:Boolean(paymentUrl),audio_enabled:audioEnabled,autostart_enabled:autostartEnabled,cache_revision:cacheRevision,source:'save-company-v4'},
    }).catch(()=>null)
    return J({...data,subscription:persistedSubscription,player_settings:{audio_enabled:audioEnabled,autostart_enabled:autostartEnabled,cache_revision:cacheRevision}})
  }catch(error){
    console.error('save-company',error)
    const msg=String(error?.message||'internal_error')
    if(/platform_storage_allocation_exceeded/i.test(msg))return J({error:'platform_storage_allocation_exceeded'},409)
    return J({error:msg},500)
  }
})
