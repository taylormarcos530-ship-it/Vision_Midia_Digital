// OFFLINE LAB ONLY: proposed staging receipt ledger contract; never import from a client/player.
// No network, database, timers, secrets, storage or proof of physical media playback.
// All calls model a trusted *server-side* handoff in memory. IDs/leases are NOT credentials.
export const RECEIPT_LAB_VERSION=1;
const id=x=>typeof x==='string'&&x.length>0&&x.length<=160&&/^[\w:.-]+$/.test(x);
const eventId=x=>typeof x==='string'&&x.length>0&&x.length<=120&&/^[\w:.-]+$/.test(x);
const ms=x=>Number.isSafeInteger(x)&&x>=0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const copy=x=>JSON.parse(JSON.stringify(x));
const deny=(state,reason)=>({accepted:false,reason,state});
const allow=(state,reason,extra={})=>({accepted:true,reason,state,...extra});
const unique=values=>new Set(values).size===values.length;
const validAds=ads=>Array.isArray(ads)&&ads.length<=20&&
 ads.every(a=>a&&id(a.campaignId)&&id(a.revisionId)&&id(a.mediaId)&&
  ['active','paused','draft'].includes(a.status)&&typeof a.targeted==='boolean')&&
 unique(ads.map(a=>a.revisionId))&&unique(ads.map(a=>a.campaignId));
const validBase=p=>p.base===null||(Array.isArray(p.base)&&p.base.length<=200&&
 p.base.every(x=>x&&id(x.itemId)&&id(x.mediaId)&&typeof x.revision==='string')&&
 unique(p.base.map(x=>x.itemId)));
export function describeStagingProgram(input){
 if(!input||!id(input.companyId)||!id(input.deviceId)||
  !id(input.assignmentRevision)||!id(input.inventoryRevision)||
  !validBase(input)||!validAds(input.ads)||
  (input.base!==null&&(!id(input.playlistId)||!id(input.playlistRevision))))
  return {valid:false,enabled:false,reason:'invalid_program',key:null};
 const cap=input.capabilities||{};
 const supported=cap.protocolVersion===2&&cap.supportsItemSchedules===true&&
  cap.timeZone==='America/Sao_Paulo';
 const enabled=Boolean(input.base?.length)&&supported&&
  input.shuffle!==true&&input.repeatMode!=='single'&&input.hasItemSchedule!==true;
 const reason=!input.base?.length?'no_base_playlist':
  !supported?'legacy_player':
  input.shuffle===true?'shuffle_preserved':
  input.repeatMode==='single'?'single_preserved':
  input.hasItemSchedule===true?'scheduled_base_preserved':null;
 const key=JSON.stringify([RECEIPT_LAB_VERSION,input.companyId,input.deviceId,
  input.assignmentRevision,input.playlistId||null,input.playlistRevision||null,
  input.base,input.inventoryRevision,input.ads,
  [cap.protocolVersion,cap.supportsItemSchedules,cap.timeZone],
  input.shuffle===true,input.repeatMode||null,input.hasItemSchedule===true]);
 return {valid:true,enabled,reason,key};
}
export function createStagingReceiptLab(input){
 const description=describeStagingProgram(input);
 return {version:RECEIPT_LAB_VERSION,program:description.valid?copy(input):null,
  description,programEpoch:1,nextOccurrence:1,issued:[],accepted:[]};
}
export function issueStagingOccurrence(state,request){
 if(!state||state.version!==RECEIPT_LAB_VERSION)throw Error('invalid_receipt_lab_state');
 if(!state.description.enabled)return deny(state,state.description.reason||'commercial_blocked');
 if(!request||!ms(request.nowMs)||!id(request.authenticatedDeviceId)||
  !id(request.revisionId)||!Number.isInteger(request.ttlMs)||
  request.ttlMs<1000||request.ttlMs>300000)return deny(state,'invalid_issuance');
 // The real server MUST bind authenticatedDeviceId to a verified device token.
 if(request.authenticatedDeviceId!==state.program.deviceId)return deny(state,'wrong_authenticated_device');
 const ad=state.program.ads.find(x=>x.revisionId===request.revisionId&&
  x.status==='active'&&x.targeted===true);
 if(!ad)return deny(state,'no_active_target');
 if(!Number.isSafeInteger(state.nextOccurrence+1))return deny(state,'sequence_exhausted');
 const occurrence={occurrenceId:'fixture:'+state.program.deviceId+':'+state.nextOccurrence,
  deviceId:state.program.deviceId,companyId:state.program.companyId,
  campaignId:ad.campaignId,revisionId:ad.revisionId,mediaId:ad.mediaId,
  programKey:state.description.key,programEpoch:state.programEpoch,
  issuedAt:request.nowMs,expiresAt:request.nowMs+request.ttlMs};
 if(!ms(occurrence.expiresAt))return deny(state,'invalid_expiry');
 return allow({...state,nextOccurrence:state.nextOccurrence+1,
  issued:[...state.issued,occurrence]},'issued',{occurrence:copy(occurrence)});
}
const normalizedReceipt=receipt=>({
 client_event_id:receipt.client_event_id,occurrence_id:receipt.occurrence_id,
 media_revision_id:receipt.media_revision_id,completed:receipt.completed,
 ended_at:receipt.ended_at||null
});
export function receiveStagingReceipt(state,context,receipt){
 if(!state||state.version!==RECEIPT_LAB_VERSION)throw Error('invalid_receipt_lab_state');
 if(!context||!ms(context.serverNowMs)||!id(context.authenticatedDeviceId)||
  !receipt||!eventId(receipt.client_event_id)||!id(receipt.occurrence_id)||
  !id(receipt.media_revision_id)||typeof receipt.completed!=='boolean')
  return deny(state,'invalid_receipt');
 if(context.authenticatedDeviceId!==state.program?.deviceId)
  return deny(state,'wrong_authenticated_device');
 const existing=state.accepted.find(x=>x.deviceId===context.authenticatedDeviceId&&
  x.clientEventId===receipt.client_event_id);
 if(existing){
  return same(existing.payload,normalizedReceipt(receipt))?
   {accepted:true,reason:'duplicate_event',duplicate:true,state}:
   deny(state,'client_event_id_collision');
 }
 const occurrence=state.issued.find(x=>x.occurrenceId===receipt.occurrence_id);
 if(!occurrence||occurrence.deviceId!==context.authenticatedDeviceId||
  occurrence.revisionId!==receipt.media_revision_id)
  return deny(state,'unissued_or_wrong_revision');
 if(state.accepted.some(x=>x.occurrenceId===receipt.occurrence_id))
  return deny(state,'occurrence_already_finalized');
 // A late first receipt is refused; a previously accepted identical retry was
 // handled above. Client clocks alone cannot certify physical playback.
 if(context.serverNowMs<occurrence.issuedAt||context.serverNowMs>occurrence.expiresAt)
  return deny(state,'expired_or_not_yet_issued');
 if(state.programEpoch!==occurrence.programEpoch||
  state.description.key!==occurrence.programKey||!state.description.enabled)
  return deny(state,'program_superseded');
 const active=state.program.ads.find(x=>x.revisionId===occurrence.revisionId&&
  x.campaignId===occurrence.campaignId&&x.mediaId===occurrence.mediaId&&
  x.status==='active'&&x.targeted===true);
 if(!active)return deny(state,'commercial_no_longer_targeted');
 if(receipt.completed&&(typeof receipt.ended_at!=='string'||!receipt.ended_at))
  return deny(state,'completion_requires_end_time');
 if(receipt.ended_at!==undefined&&receipt.ended_at!==null){
  if(typeof receipt.ended_at!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(receipt.ended_at))
   return deny(state,'invalid_end_time_format');
  const value=Date.parse(receipt.ended_at);
  if(!Number.isFinite(value)||value<occurrence.issuedAt||
   value>context.serverNowMs||value>occurrence.expiresAt)
   return deny(state,'untrusted_or_invalid_client_time');
 }
 const payload=normalizedReceipt(receipt);
 // 'completed' is still an unverified client claim in this simulator.
 const row={deviceId:occurrence.deviceId,companyId:occurrence.companyId,
  campaignId:occurrence.campaignId,revisionId:occurrence.revisionId,
  occurrenceId:occurrence.occurrenceId,clientEventId:receipt.client_event_id,
  completed:receipt.completed,receivedAt:new Date(context.serverNowMs).toISOString(),payload};
 return allow({...state,accepted:[...state.accepted,row]},
  receipt.completed?'completion_claim_recorded':'incomplete_attempt_recorded',{row:copy(row)});
}
export function republishStagingProgram(state,newInput){
 if(!state||state.version!==RECEIPT_LAB_VERSION)throw Error('invalid_receipt_lab_state');
 const descriptor=describeStagingProgram(newInput);
 if(!descriptor.valid)return deny(state,'invalid_new_program');
 // Retain accepted ledger for idempotent retries; all unused old leases expire
 // logically by epoch even if their wall-clock expiry has not passed.
 return allow({...state,program:copy(newInput),description:descriptor,
  programEpoch:state.programEpoch+1},'new_program_revokes_outstanding_occurrences');
}
export function receiveStagingBatch(state,context,events){
 if(!Array.isArray(events)||events.length<1||events.length>100)
  return {accepted:false,reason:'invalid_batch',state,results:[]};
 let current=state;const results=[];
 for(const event of events){
  const result=receiveStagingReceipt(current,context,event);
  current=result.state;
  results.push({accepted:result.accepted,reason:result.reason,
   duplicate:result.duplicate===true});
 }
 return {accepted:true,reason:'processed_serially_in_memory',state:current,results};
}
function saoPauloDay(iso){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
 const get=t=>parts.find(x=>x.type===t).value;
 return get('year')+'-'+get('month')+'-'+get('day');
}
export function recalculateStagingDaily(state){
 if(!state||state.version!==RECEIPT_LAB_VERSION)throw Error('invalid_receipt_lab_state');
 const totals=new Map();
 for(const row of state.accepted){
  const day=saoPauloDay(row.receivedAt);
  const key=JSON.stringify([row.deviceId,row.revisionId,day]);
  let item=totals.get(key);
  if(!item){item={deviceId:row.deviceId,campaignId:row.campaignId,
    revisionId:row.revisionId,day,attempt_count:0,completed_count:0};totals.set(key,item);}
  item.attempt_count++;
  if(row.completed)item.completed_count++;
 }
 return [...totals.values()].sort((a,b)=>a.day.localeCompare(b.day)||
  a.deviceId.localeCompare(b.deviceId)||a.revisionId.localeCompare(b.revisionId));
}
