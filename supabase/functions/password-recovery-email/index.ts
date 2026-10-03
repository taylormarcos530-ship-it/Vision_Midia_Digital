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
  return{
    url,
    pub,
    admin:createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}),
  }
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
  if(!pa||pa.status!=='active'||!['super_admin','admin'].includes(pa.role))throw Object.assign(new Error('master_forbidden'),{status:403})
  return{admin,user:data.user}
}

function safeRedirect(value:unknown){
  const raw=clean(value,500)
  try{
    const url=new URL(raw)
    const host=url.hostname.toLowerCase()
    if(url.protocol!=='https:'||host==='localhost'||host==='127.0.0.1'||host==='0.0.0.0')throw new Error('invalid')
    return url.href
  }catch{
    throw Object.assign(new Error('invalid_redirect_url'),{status:400})
  }
}

function escapeHtml(value:unknown){
  return String(value??'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;')
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C})
  if(req.method!=='POST')return J({error:'method_not_allowed'},405)

  try{
    const {admin,user}=await context(req)
    const body=await req.json().catch(()=>({}))
    const email=clean(body.email,254).toLowerCase()
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return J({error:'invalid_email'},400)
    const redirectTo=safeRedirect(body.redirect_to)

    const {data:config,error:configError}=await admin
      .from('platform_public_config')
      .select('resend_sender_email,resend_sender_name,resend_enabled')
      .eq('id',1)
      .maybeSingle()
    if(configError)throw configError
    if(config?.resend_enabled!==true)return J({error:'resend_not_configured'},503)

    const senderEmail=clean(config?.resend_sender_email,254).toLowerCase()
    const senderName=clean(config?.resend_sender_name,80)||'Vision Mídia Digital'
    if(!senderEmail)return J({error:'sender_email_required'},503)

    const {data:apiKey,error:keyError}=await admin.rpc('get_vision_midia_service_secret',{p_name:'vision_midia_resend_api_key'})
    if(keyError)throw keyError
    const resendKey=clean(apiKey,500)
    if(!resendKey)return J({error:'resend_api_key_required'},503)

    const {data:linkData,error:linkError}=await admin.auth.admin.generateLink({
      type:'recovery',
      email,
      options:{redirectTo},
    })
    if(linkError){
      if(/not found|user/i.test(String(linkError.message||'')))return J({ok:true})
      throw linkError
    }

    const actionLink=clean(linkData?.properties?.action_link,3000)
    if(!actionLink)throw new Error('recovery_link_unavailable')

    const subject='Redefinição de senha • Vision Mídia Digital'
    const html=`<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#142033">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:18px;padding:32px;border:1px solid #e6eaf0">
          <tr><td>
            <div style="font-size:13px;font-weight:700;color:#2563eb;letter-spacing:.08em">VISION MÍDIA DIGITAL</div>
            <h1 style="font-size:26px;line-height:1.2;margin:14px 0;color:#111827">Redefina sua senha</h1>
            <p style="font-size:16px;line-height:1.6;color:#4b5563">Recebemos uma solicitação para criar uma nova senha para sua conta.</p>
            <p style="margin:28px 0">
              <a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Criar nova senha</a>
            </p>
            <p style="font-size:14px;line-height:1.6;color:#6b7280">Se você não solicitou a redefinição, ignore esta mensagem. O link é temporário e deve ser usado somente por você.</p>
            <hr style="border:0;border-top:1px solid #e5e7eb;margin:28px 0">
            <p style="font-size:12px;color:#9ca3af;margin:0">Vision Mídia Digital • Segurança da conta</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{
        Authorization:`Bearer ${resendKey}`,
        'Content-Type':'application/json',
      },
      body:JSON.stringify({
        from:`${senderName} <${senderEmail}>`,
        to:[email],
        subject,
        html,
        text:`Vision Mídia Digital — Redefinição de senha\n\nAbra o link para criar uma nova senha: ${actionLink}\n\nSe você não solicitou, ignore esta mensagem.`,
      }),
    })

    const resendPayload=await response.json().catch(()=>({}))
    if(!response.ok){
      console.error('password-recovery-email resend',response.status,resendPayload)
      return J({
        error:'resend_send_failed',
        provider_status:response.status,
        provider_message:clean(resendPayload?.message||resendPayload?.name||'Falha ao enviar e-mail.',240),
      },502)
    }

    const {error:auditError}=await admin.from('master_audit_logs').insert({
      actor_user_id:user.id,
      action:'password_recovery_email_sent',
      details:{provider:'resend',target_user_id:linkData?.user?.id||null},
    })
    if(auditError)console.warn('password recovery audit',auditError)

    return J({ok:true,provider:'resend',message_id:clean(resendPayload?.id,120)||null})
  }catch(error){
    console.error('password-recovery-email',error)
    return J({error:String(error?.message||'internal_error')},Number(error?.status)||500)
  }
})
