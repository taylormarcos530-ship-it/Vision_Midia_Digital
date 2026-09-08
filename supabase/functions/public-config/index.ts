import { createClient } from 'npm:@supabase/supabase-js@2'

const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const J=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}})
function admin(){
  const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url=Deno.env.get('SUPABASE_URL')||''
  if(!secret||!url)throw new Error('keys_unavailable')
  return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C})
  if(req.method!=='POST')return J({error:'method_not_allowed'},405)
  try{
    const a=admin()
    const [{data:config,error:ce},{data:plans,error:pe}]=await Promise.all([
      a.from('platform_public_config').select('support_whatsapp,signup_whatsapp_message,renewal_whatsapp_message,signup_enabled').eq('id',1).maybeSingle(),
      a.from('plans').select('id,name,description,monthly_price_cents,max_devices,storage_limit_mb,max_users,max_campaigns,sort_order').eq('is_active',true).order('sort_order')
    ])
    if(ce)throw ce
    if(pe)throw pe
    return J({ok:true,config:config||{},plans:plans||[]})
  }catch(error){
    console.error('public-config',error)
    return J({error:'internal_error'},500)
  }
})
