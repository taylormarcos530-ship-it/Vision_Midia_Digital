import { createClient } from 'npm:@supabase/supabase-js@2'

const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const J=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}})

function publicClient(){
  const keysRaw=Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}'
  let publishable=''
  try{publishable=JSON.parse(keysRaw)?.default||''}catch{}
  const pub=publishable||Deno.env.get('SUPABASE_ANON_KEY')||''
  const url=Deno.env.get('SUPABASE_URL')||''
  if(!pub||!url)throw new Error('public_keys_unavailable')
  return createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}})
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C})
  if(req.method!=='POST')return J({error:'method_not_allowed'},405)
  try{
    const client=publicClient()
    const [{data:config,error:ce},{data:plans,error:pe}]=await Promise.all([
      client.from('platform_public_config').select('support_whatsapp,signup_whatsapp_message,renewal_whatsapp_message,signup_enabled,login_image_path,login_image_fit,login_image_position,login_image_overlay,login_image_title,login_image_subtitle').eq('id',1).maybeSingle(),
      client.from('plans').select('id,name,description,monthly_price_cents,max_devices,storage_limit_mb,max_users,max_campaigns,sort_order').eq('is_active',true).order('sort_order')
    ])
    if(ce)throw ce
    if(pe)throw pe
    const publicConfig:any={...(config||{})}
    if(publicConfig.login_image_path){
      const {data}=client.storage.from('platform-public').getPublicUrl(publicConfig.login_image_path)
      publicConfig.login_image_url=data?.publicUrl||null
    }
    return J({ok:true,config:publicConfig,plans:plans||[]})
  }catch(error){
    console.error('public-config',error)
    return J({error:'public_config_unavailable'},500)
  }
})
