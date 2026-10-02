import { createClient } from 'npm:@supabase/supabase-js@2'

const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const J=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}})
const clean=(v:unknown,max=500)=>String(v??'').trim().slice(0,max)
const LOGIN_VISUAL_BUCKET='platform-public'
const LOGIN_VISUAL_PATH='login/login-visual.webp'
function decodeDataUrl(value:unknown){
  const raw=String(value||'')
  const match=raw.match(/^data:image\/webp;base64,(.+)$/i)
  if(!match)throw Object.assign(new Error('invalid_login_image'),{status:400})
  const binary=atob(match[1])
  if(binary.length>2*1024*1024)throw Object.assign(new Error('login_image_too_large'),{status:400})
  const bytes=new Uint8Array(binary.length)
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)
  return bytes
}
async function withLoginVisualUrl(admin:any,config:any){
  if(!config?.login_image_path)return config||{}
  const {data}=admin.storage.from(LOGIN_VISUAL_BUCKET).getPublicUrl(config.login_image_path)
  return {...config,login_image_url:data?.publicUrl||null}
}
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
      return J({ok:true,config:await withLoginVisualUrl(admin,data||{})})
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
      const {error:auditError}=await admin.from('master_audit_logs').insert({actor_user_id:user.id,action:'platform_public_settings_updated',details:{support_whatsapp:phone?`***${phone.slice(-4)}`:null,signup_enabled:payload.signup_enabled}})
      if(auditError)console.warn('platform-settings audit',auditError)
      return J({ok:true,config:await withLoginVisualUrl(admin,data)})
    }

    if(action==='update_login_visual'){
      if(!['super_admin','admin'].includes(role))return J({error:'master_read_only'},403)
      const fit=['cover','contain'].includes(clean(body.fit,20))?clean(body.fit,20):'cover'
      const position=['center','top','bottom','left','right'].includes(clean(body.position,20))?clean(body.position,20):'center'
      const overlay=Math.max(0,Math.min(80,Number(body.overlay??42)))
      const title=clean(body.title,120)||'Sua operação visual, organizada em um só lugar.'
      const subtitle=clean(body.subtitle,220)||'Gerencie telas, conteúdos, playlists e campanhas com controle profissional.'
      let imagePath:string|null=LOGIN_VISUAL_PATH

      if(body.remove_image===true){
        await admin.storage.from(LOGIN_VISUAL_BUCKET).remove([LOGIN_VISUAL_PATH])
        imagePath=null
      }else if(body.image_base64){
        const bytes=decodeDataUrl(body.image_base64)
        const {error:uploadError}=await admin.storage.from(LOGIN_VISUAL_BUCKET).upload(LOGIN_VISUAL_PATH,bytes,{contentType:'image/webp',upsert:true,cacheControl:'3600'})
        if(uploadError)throw uploadError
      }else{
        const {data:current,error:currentError}=await admin.from('platform_public_config').select('login_image_path').eq('id',1).maybeSingle()
        if(currentError)throw currentError
        imagePath=current?.login_image_path||null
      }

      const payload={
        login_image_path:imagePath,
        login_image_fit:fit,
        login_image_position:position,
        login_image_overlay:overlay,
        login_image_title:title,
        login_image_subtitle:subtitle,
        updated_at:new Date().toISOString(),
      }
      const {data,error}=await admin.from('platform_public_config').update(payload).eq('id',1).select('*').single()
      if(error)throw error
      const {error:auditError}=await admin.from('master_audit_logs').insert({actor_user_id:user.id,action:'platform_login_visual_updated',details:{has_image:Boolean(imagePath),fit,position,overlay}})
      if(auditError)console.warn('platform login visual audit',auditError)
      return J({ok:true,config:await withLoginVisualUrl(admin,data)})
    }

    return J({error:'unknown_action'},400)
  }catch(error){
    console.error('platform-settings',error)
    return J({error:String(error?.message||'internal_error')},Number(error?.status)||500)
  }
})
