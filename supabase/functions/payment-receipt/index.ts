import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import QRCode from 'npm:qrcode@1.5.4'

const BUCKET='payment-receipts'
const MAX_BYTES=8*1024*1024
const ALLOWED_MIME=new Set(['image/jpeg','image/png','image/webp','application/pdf'])
const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const J=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'}})
const text=(v:unknown,max=500)=>String(v??'').trim().slice(0,max)

function clients(){
  const publishable=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY')
  const secret=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url=Deno.env.get('SUPABASE_URL')||''
  if(!url||!publishable||!secret)throw new Error('keys_unavailable')
  return{url,publishable,admin:createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})}
}

async function context(req:Request){
  const authHeader=req.headers.get('authorization')||''
  if(!authHeader.startsWith('Bearer '))throw Object.assign(new Error('authentication_required'),{status:401})
  const {url,publishable,admin}=clients()
  const userClient=createClient(url,publishable,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await userClient.auth.getUser(authHeader.slice(7))
  if(error||!data?.user)throw Object.assign(new Error('invalid_session'),{status:401})
  return{admin,user:data.user}
}

async function cleanupExpired(admin:any){
  const now=new Date().toISOString()
  const {data:rows,error}=await admin.from('payment_receipts')
    .select('id,company_id,storage_path')
    .is('file_deleted_at',null)
    .not('purge_after','is',null)
    .lte('purge_after',now)
    .limit(25)
  if(error)throw error
  for(const row of rows||[]){
    const {error:removeError}=await admin.storage.from(BUCKET).remove([row.storage_path])
    if(removeError){console.warn('payment-receipt cleanup storage',row.id,removeError.message);continue}
    const deletedAt=new Date().toISOString()
    const {error:updateError}=await admin.from('payment_receipts').update({file_deleted_at:deletedAt}).eq('id',row.id).is('file_deleted_at',null)
    if(updateError){console.warn('payment-receipt cleanup db',row.id,updateError.message);continue}
    const {error:auditError}=await admin.from('master_audit_logs').insert({
      action:'payment_receipt_file_purged',
      company_id:row.company_id,
      details:{receipt_id:row.id,retention_days:30}
    })
    if(auditError)console.warn('payment-receipt cleanup audit',row.id,auditError.message)
  }
}

async function companyAccess(admin:any,userId:string,companyId:string){
  const {data:company,error}=await admin.from('companies').select('id,owner_user_id').eq('id',companyId).maybeSingle()
  if(error)throw error
  if(!company)return false
  if(company.owner_user_id===userId)return true
  const {data:member,error:memberError}=await admin.from('company_members').select('id').eq('company_id',companyId).eq('user_id',userId).eq('status','active').maybeSingle()
  if(memberError)throw memberError
  return Boolean(member)
}

async function masterRole(admin:any,userId:string){
  const {data,error}=await admin.from('platform_admins').select('role,status').eq('user_id',userId).maybeSingle()
  if(error)throw error
  if(!data||data.status!=='active'||!['super_admin','admin'].includes(data.role))return null
  return data.role
}

async function billing(admin:any,companyId:string){
  const {data:subscription,error}=await admin.from('company_subscriptions').select('*').eq('company_id',companyId).maybeSingle()
  if(error)throw error
  if(!subscription)throw Object.assign(new Error('subscription_not_found'),{status:404})
  let plan:any=null
  if(subscription.plan_id){
    const r=await admin.from('plans').select('id,name,monthly_price_cents').eq('id',subscription.plan_id).maybeSingle()
    if(r.error)throw r.error
    plan=r.data
  }
  const amountCents=Math.max(0,Number(subscription.manual_price_cents??plan?.monthly_price_cents??0))
  return{subscription,plan,amountCents}
}

async function latestReceipt(admin:any,companyId:string){
  const {data,error}=await admin.from('payment_receipts')
    .select('id,company_id,original_name,mime_type,size_bytes,amount_cents,status,submitted_at,reviewed_at,review_notes,purge_after,file_deleted_at')
    .eq('company_id',companyId)
    .order('submitted_at',{ascending:false})
    .limit(1)
    .maybeSingle()
  if(error)throw error
  return data||null
}

function tlv(id:string,value:string){
  const len=new TextEncoder().encode(value).length
  if(len>99)throw new Error('pix_field_too_long')
  return `${id}${String(len).padStart(2,'0')}${value}`
}
function cleanMerchant(value:string,max:number,fallback:string){
  const v=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 .,'-]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
  return v||fallback
}
function crc16(value:string){
  const bytes=new TextEncoder().encode(value)
  let crc=0xFFFF
  for(const byte of bytes){
    crc^=byte<<8
    for(let i=0;i<8;i++)crc=(crc&0x8000)?((crc<<1)^0x1021):(crc<<1)
    crc&=0xFFFF
  }
  return crc.toString(16).toUpperCase().padStart(4,'0')
}
function buildPixPayload(keyRaw:string,nameRaw:string,cityRaw:string,amountCents:number){
  const key=keyRaw.trim()
  if(!key||new TextEncoder().encode(key).length>77)throw new Error('invalid_pix_key')
  const name=cleanMerchant(nameRaw,25,'VISION MIDIA')
  const city=cleanMerchant(cityRaw,15,'BRASIL')
  const merchantAccount=tlv('00','BR.GOV.BCB.PIX')+tlv('01',key)
  let payload=tlv('00','01')+tlv('26',merchantAccount)+tlv('52','0000')+tlv('53','986')
  if(amountCents>0)payload+=tlv('54',(amountCents/100).toFixed(2))
  payload+=tlv('58','BR')+tlv('59',name)+tlv('60',city)+tlv('62',tlv('05','***'))+'6304'
  return payload+crc16(payload)
}
async function pixData(subscription:any,amountCents:number){
  const key=text(subscription?.pix_key,77)
  const name=text(subscription?.pix_receiver_name,25)
  const city=text(subscription?.pix_receiver_city,15)
  if(!key||!name||!city)return{enabled:false}
  const payload=buildPixPayload(key,name,city,amountCents)
  const qrSvg=await QRCode.toString(payload,{type:'svg',width:260,margin:1,errorCorrectionLevel:'M'})
  return{enabled:true,key,key_type:subscription?.pix_key_type||'other',receiver_name:name,receiver_city:city,payload,qr_svg:qrSvg}
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C})
  if(req.method!=='POST')return J({error:'method_not_allowed'},405)
  try{
    const {admin,user}=await context(req)
    cleanupExpired(admin).catch(error=>console.warn('payment-receipt cleanup',error?.message||error))
    const body=await req.json().catch(()=>({}))
    const action=text(body.action,60)
    const companyId=text(body.company_id,60)

    if(action==='client_status'){
      if(!companyId)return J({error:'company_required'},400)
      if(!await companyAccess(admin,user.id,companyId))return J({error:'company_forbidden'},403)
      const [{subscription,plan,amountCents},receipt]=await Promise.all([billing(admin,companyId),latestReceipt(admin,companyId)])
      const pix=await pixData(subscription,amountCents)
      return J({ok:true,payment_status:subscription.payment_status,subscription_status:subscription.status,amount_cents:amountCents,plan_name:plan?.name||null,pix,receipt})
    }

    if(action==='submit'){
      if(!companyId)return J({error:'company_required'},400)
      if(!await companyAccess(admin,user.id,companyId))return J({error:'company_forbidden'},403)
      const {subscription,plan,amountCents}=await billing(admin,companyId)
      if(['paid','waived'].includes(subscription.payment_status||''))return J({error:'payment_already_settled'},409)
      if(!subscription.pix_key||!subscription.pix_receiver_name||!subscription.pix_receiver_city)return J({error:'pix_not_configured'},409)
      const storagePath=text(body.storage_path,500)
      const expectedPrefix=`${companyId}/receipts/${user.id}/`
      if(!storagePath.startsWith(expectedPrefix)||storagePath.includes('..'))return J({error:'invalid_storage_path'},400)
      const originalName=text(body.original_name,180).replace(/[\\/]+/g,'-')||'comprovante'
      const requestedMime=text(body.mime_type,100).toLowerCase()
      const requestedSize=Math.round(Number(body.size_bytes||0))
      if(!ALLOWED_MIME.has(requestedMime)||requestedSize<=0||requestedSize>MAX_BYTES)return J({error:'invalid_receipt_file'},400)
      const slash=storagePath.lastIndexOf('/')
      const folder=storagePath.slice(0,slash)
      const filename=storagePath.slice(slash+1)
      const {data:objects,error:storageError}=await admin.storage.from(BUCKET).list(folder,{limit:20,search:filename})
      if(storageError)throw storageError
      const object=(objects||[]).find((x:any)=>x.name===filename)
      if(!object)return J({error:'receipt_file_not_found'},409)
      const actualSize=Math.round(Number(object.metadata?.size||requestedSize))
      const actualMime=text(object.metadata?.mimetype||requestedMime,100).toLowerCase()
      if(actualSize<=0||actualSize>MAX_BYTES||!ALLOWED_MIME.has(actualMime))return J({error:'invalid_receipt_file'},400)
      const {data:receipt,error:insertError}=await admin.from('payment_receipts').insert({
        company_id:companyId,
        submitted_by:user.id,
        storage_path:storagePath,
        original_name:originalName,
        mime_type:actualMime,
        size_bytes:actualSize,
        amount_cents:amountCents,
        status:'pending',
        purge_after:null,
        file_deleted_at:null
      }).select('id,company_id,original_name,mime_type,size_bytes,amount_cents,status,submitted_at,reviewed_at,review_notes,purge_after,file_deleted_at').single()
      if(insertError)throw insertError
      const {error:auditError}=await admin.from('master_audit_logs').insert({
        actor_user_id:user.id,
        action:'payment_receipt_submitted',
        company_id:companyId,
        details:{receipt_id:receipt.id,amount_cents:amountCents,plan_id:plan?.id||subscription.plan_id||null,mime_type:actualMime,size_bytes:actualSize}
      })
      if(auditError)console.warn('payment-receipt submit audit',auditError.message)
      return J({ok:true,receipt})
    }

    if(action==='master_status'){
      if(!companyId)return J({error:'company_required'},400)
      if(!await masterRole(admin,user.id))return J({error:'master_forbidden'},403)
      const [{subscription,plan,amountCents},receipt]=await Promise.all([billing(admin,companyId),latestReceipt(admin,companyId)])
      return J({ok:true,payment_status:subscription.payment_status,subscription_status:subscription.status,current_period_end:subscription.current_period_end,amount_cents:amountCents,plan_name:plan?.name||null,receipt})
    }

    if(action==='master_signed_url'){
      if(!await masterRole(admin,user.id))return J({error:'master_forbidden'},403)
      const receiptId=text(body.receipt_id,60)
      if(!receiptId)return J({error:'receipt_required'},400)
      const {data:receipt,error}=await admin.from('payment_receipts').select('id,company_id,storage_path,mime_type,original_name,file_deleted_at').eq('id',receiptId).maybeSingle()
      if(error)throw error
      if(!receipt)return J({error:'receipt_not_found'},404)
      if(receipt.file_deleted_at)return J({error:'receipt_file_expired'},410)
      const {data:signed,error:signedError}=await admin.storage.from(BUCKET).createSignedUrl(receipt.storage_path,600)
      if(signedError)throw signedError
      return J({ok:true,url:signed?.signedUrl||null,mime_type:receipt.mime_type,original_name:receipt.original_name})
    }

    if(action==='master_review'){
      if(!await masterRole(admin,user.id))return J({error:'master_forbidden'},403)
      const receiptId=text(body.receipt_id,60)
      const decision=text(body.decision,20)
      if(!receiptId||!['approved','rejected'].includes(decision))return J({error:'invalid_review'},400)
      const notes=text(body.notes,500)||null
      const {data,error}=await admin.rpc('master_review_payment_receipt_v1',{
        p_receipt_id:receiptId,
        p_actor_user_id:user.id,
        p_decision:decision,
        p_notes:notes
      })
      if(error)throw error
      return J(data||{ok:true})
    }

    return J({error:'unknown_action'},400)
  }catch(error){
    console.error('payment-receipt',error)
    const msg=String(error?.message||'internal_error')
    const status=Number(error?.status)||(/authentication_required|invalid_session/i.test(msg)?401:/forbidden/i.test(msg)?403:/not_found/i.test(msg)?404:/receipt_file_expired/i.test(msg)?410:/due_date_required|due_date_expired|already_settled|not_configured/i.test(msg)?409:500)
    return J({error:msg},status)
  }
})
