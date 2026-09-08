import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store'}})
const clean=(v:unknown,max=160)=>String(v??'').trim().slice(0,max)
const slugify=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,52)||'cliente'

async function sha256(value:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function adminClient(){const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');const url=Deno.env.get('SUPABASE_URL')||'';if(!secret||!url)throw new Error('backend_keys_unavailable');return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS})
  if(req.method!=='POST')return json({error:'method_not_allowed'},405)
  let createdUserId:string|null=null
  try{
    const body=await req.json().catch(()=>({}))
    const email=clean(body.email,320).toLowerCase()
    const password=String(body.password??'')
    const displayName=clean(body.display_name,120)
    const companyName=clean(body.company_name,120)
    const planId=clean(body.plan_id,80)
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'invalid_email'},400)
    if(password.length<8||password.length>72)return json({error:'invalid_password'},400)
    if(displayName.length<2)return json({error:'invalid_display_name'},400)
    if(companyName.length<2)return json({error:'invalid_company_name'},400)
    if(!planId)return json({error:'plan_required'},400)

    const admin=adminClient()
    const {data:config,error:configError}=await admin.from('platform_public_config').select('signup_enabled').eq('id',1).maybeSingle()
    if(configError)throw configError
    if(config?.signup_enabled===false)return json({error:'signup_disabled'},403)

    const forwarded=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')||'unknown'
    const source=forwarded.split(',')[0].trim().slice(0,120)
    const sourceHash=await sha256(`vision-signup:${source}`)
    const emailHash=await sha256(`vision-signup:${email}`)
    const attempts=admin.from('public_signup_attempts')
    const tenMinutesAgo=new Date(Date.now()-10*60*1000).toISOString()
    const oneHourAgo=new Date(Date.now()-60*60*1000).toISOString()
    const [{count:sourceCount,error:sourceError},{count:emailCount,error:emailError}]=await Promise.all([
      attempts.select('id',{count:'exact',head:true}).eq('source_hash',sourceHash).gte('attempted_at',tenMinutesAgo),
      attempts.select('id',{count:'exact',head:true}).eq('email_hash',emailHash).gte('attempted_at',oneHourAgo),
    ])
    if(sourceError)throw sourceError
    if(emailError)throw emailError
    if((sourceCount||0)>=5||(emailCount||0)>=5)return json({error:'signup_rate_limited'},429)
    const {data:attempt,error:attemptError}=await attempts.insert({source_hash:sourceHash,email_hash:emailHash,success:false}).select('id').single()
    if(attemptError)throw attemptError

    const {data:userData,error:userError}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:displayName}})
    if(userError){const msg=String(userError.message||'');if(/already|registered|exists/i.test(msg))return json({error:'email_already_registered'},409);return json({error:'signup_failed'},Number(userError.status)||400)}
    createdUserId=userData.user?.id||null
    if(!createdUserId)throw new Error('user_creation_failed')

    const slug=`${slugify(companyName)}-${crypto.randomUUID().slice(0,8)}`.slice(0,70)
    const {data:pending,error:pendingError}=await admin.rpc('create_pending_signup_company',{p_user_id:createdUserId,p_company_name:companyName,p_slug:slug,p_plan_id:planId})
    if(pendingError)throw pendingError

    await attempts.update({success:true}).eq('id',attempt.id)
    await attempts.delete().lt('attempted_at',new Date(Date.now()-24*60*60*1000).toISOString()).catch(()=>null)
    return json({ok:true,user_id:createdUserId,company:pending?.company||null,plan:pending?.plan||null,status:'pending_approval'},201)
  }catch(error){
    console.error('public-signup-v2',error)
    if(createdUserId){try{await adminClient().auth.admin.deleteUser(createdUserId)}catch{}}
    const msg=String(error?.message||'internal_error')
    if(/platform_client_limit_reached/i.test(msg))return json({error:'platform_client_limit_reached'},409)
    if(/platform_storage_allocation_exceeded/i.test(msg))return json({error:'platform_storage_allocation_exceeded'},409)
    if(/plan_not_available/i.test(msg))return json({error:'plan_not_available'},400)
    return json({error:'internal_error'},500)
  }
})
