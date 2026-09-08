import { createClient } from 'npm:@supabase/supabase-js@2'

const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const J=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}})
const clean=(v:unknown,max=160)=>String(v??'').trim().slice(0,max)

function clients(){
  const pub=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY')
  const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url=Deno.env.get('SUPABASE_URL')||''
  if(!pub||!secret||!url)throw new Error('keys_unavailable')
  return{url,pub,admin:createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})}
}
async function sha256(value:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C})
  if(req.method!=='POST')return J({error:'method_not_allowed'},405)
  try{
    const h=req.headers.get('authorization')||''
    if(!h.startsWith('Bearer '))return J({error:'authentication_required'},401)
    const {url,pub,admin}=clients()
    const uc=createClient(url,pub,{global:{headers:{Authorization:h}},auth:{persistSession:false,autoRefreshToken:false}})
    const {data:u,error:ue}=await uc.auth.getUser(h.slice(7))
    if(ue||!u?.user)return J({error:'invalid_session'},401)
    const user=u.user
    const body=await req.json().catch(()=>({}))
    const companyId=clean(body.company_id,80)
    const oldDeviceId=clean(body.old_device_id,80)
    const code=clean(body.code,12).replace(/\D/g,'')
    const name=clean(body.name,120)
    const orientation=['auto','landscape','portrait'].includes(body.orientation)?body.orientation:'auto'
    if(!companyId||!oldDeviceId||code.length!==6||!name)return J({error:'invalid_input'},400)

    const [{data:member,error:me},{data:pa,error:pe}]=await Promise.all([
      admin.from('company_members').select('role,status').eq('company_id',companyId).eq('user_id',user.id).maybeSingle(),
      admin.from('platform_admins').select('role,status').eq('user_id',user.id).maybeSingle(),
    ])
    if(me)throw me
    if(pe)throw pe
    const companyAllowed=member?.status==='active'&&['owner','admin','operator'].includes(member.role)
    const masterAllowed=pa?.status==='active'&&['super_admin','admin'].includes(pa.role)
    if(!companyAllowed&&!masterAllowed)return J({error:'forbidden'},403)

    const since=new Date(Date.now()-10*60*1000).toISOString()
    const {count}=await admin.from('device_claim_attempts').select('id',{count:'exact',head:true}).eq('user_id',user.id).gte('attempted_at',since)
    if((count||0)>=20)return J({error:'rate_limited',message:'Muitas tentativas. Tente novamente em alguns minutos.'},429)

    const codeHash=await sha256(code)
    const {data:pair,error:pairError}=await admin.from('device_pairing_requests')
      .select('id,status,expires_at,setup_company_id')
      .eq('code_hash',codeHash).eq('status','pending').maybeSingle()
    if(pairError)throw pairError
    if(!pair){await admin.from('device_claim_attempts').insert({user_id:user.id,success:false});return J({error:'invalid_code',message:'Código inválido ou já utilizado.'},404)}
    if(pair.setup_company_id&&pair.setup_company_id!==companyId)return J({error:'branded_player_company_mismatch',message:'Este Player pertence a outra empresa.'},403)
    if(new Date(pair.expires_at).getTime()<=Date.now())return J({error:'expired_code',message:'O código expirou. Gere um novo código na TV.'},410)

    const {data,error}=await admin.rpc('replace_device_from_pairing',{
      p_company_id:companyId,
      p_old_device_id:oldDeviceId,
      p_pairing_id:pair.id,
      p_claimed_by:user.id,
      p_name:name,
      p_orientation:orientation,
    })
    if(error)throw error

    await admin.from('device_claim_attempts').insert({user_id:user.id,success:true})
    await admin.from('master_audit_logs').insert({
      actor_user_id:user.id,
      action:'device_replaced',
      company_id:companyId,
      details:{old_device_id:oldDeviceId,new_device_id:data?.device?.id||null,source:masterAllowed&&!companyAllowed?'master':'company_panel'}
    }).catch(()=>null)
    return J(data||{ok:true,replaced:true})
  }catch(error){
    console.error('replace-device',error)
    const msg=String(error?.message||'internal_error')
    if(/old_device_not_found/i.test(msg))return J({error:'old_device_not_found',message:'A TV antiga não foi encontrada.'},404)
    if(/old_device_already_replaced/i.test(msg))return J({error:'old_device_already_replaced',message:'Essa TV já foi substituída.'},409)
    if(/plan_device_limit_reached/i.test(msg))return J({error:'plan_device_limit_reached',message:'O limite de TVs do plano foi atingido.'},409)
    if(/subscription_inactive|company_suspended/i.test(msg))return J({error:'subscription_inactive',message:'A assinatura precisa estar ativa para substituir a TV.'},403)
    return J({error:'internal_error',message:msg},500)
  }
})
