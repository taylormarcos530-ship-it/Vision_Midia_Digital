import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendCompanyPush } from '../_shared/web-push.ts'

Deno.serve(async (req) => {
 const json = (data: unknown, status=200) => new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
 if (req.method !== 'POST') return json({error:'method_not_allowed'},405)
 const token = (req.headers.get('authorization') || '').replace(/^Bearer /,'')
 if (!token || token.length<32) return json({error:'unauthorized'},401)
 try {
  let secret=''
  try { secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')?.default || '' } catch {}
  secret ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const admin=createClient(Deno.env.get('SUPABASE_URL') || '',secret,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:valid,error:authError}=await admin.rpc('verify_subscription_alert_token',{p_token:token})
  if(authError || valid!==true) return json({error:'unauthorized'},401)
  const {data:jobs,error}=await admin.rpc('claim_subscription_alerts')
  if(error) throw error
  const results=[]
  for(const job of jobs || []) {
   let result: any
   try { result=await sendCompanyPush(admin,job.company_id,{title:job.title,body:job.message,url:'https://visionmidiadigitalgo.netlify.app/',tag:`subscription-${job.id}`},false) }
   catch { result={failed:1,error:'push_delivery_failed'} }
   const {error:finishError}=await admin.rpc('finish_subscription_alert',{p_id:job.id,p_result:result,p_retry:Number(result.failed || 0)>0})
   if(finishError) throw finishError
   results.push({id:job.id,...result})
  }
  return json({ok:true,processed:results.length,results})
 } catch(error) { console.error('subscription-alerts',error);return json({error:'scheduler_failed'},500) }
})
