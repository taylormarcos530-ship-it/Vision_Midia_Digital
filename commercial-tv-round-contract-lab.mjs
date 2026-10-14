// OFFLINE LAB ONLY. A proposed program/revision/round handoff contract.
// Not imported by real gateway, APK, player, Storage, or any production module.
// This identity is DETERMINISTIC, not cryptographic or a security credential.
// Only locally trusted checkpoint fixtures may be supplied to recovery.
import {createFairRotationLab,fairRotationView,fairRotationEvent} from './commercial-tv-fair-rotation-lab.mjs';

export const LAB_CONTRACT_VERSION=1;
const safeInteger=n=>Number.isSafeInteger(n)&&n>=0;
const safeId=id=>typeof id==='string'&&id.length>0&&id.length<=160;
const text=value=>value===undefined||value===null?null:String(value);
const schedule=item=>{
 const s=item?.schedule||{};
 return [s.enabled===true,text(s.start_date),text(s.end_date),text(s.start_time),
  text(s.end_time),Array.isArray(s.weekdays)?s.weekdays.slice():null];
};
const distinct=arr=>new Set(arr).size===arr.length;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function validateBase(base){
 if(base===null)return true;
 if(!base||!base.playlist||!safeId(base.playlist.id)||!Array.isArray(base.items)||
  base.items.length>200)return false;
 const itemIds=[],mediaIds=[];
 for(const item of base.items){
  if(!item||!safeId(item.id)||!item.media||!safeId(item.media.id))return false;
  itemIds.push(item.id);mediaIds.push(item.media.id);
 }
 return distinct(itemIds);
}
function validateAds(ads){
 if(!Array.isArray(ads)||ads.length>20)return false;
 const ids=[];
 for(const ad of ads){
  if(!ad||!safeId(ad.id)||!ad.media||!safeId(ad.media.id))return false;
  ids.push(ad.id);
 }
 return distinct(ids);
}
export function describeRoundProgram(input){
 if(!input||!validateBase(input.primary)||!validateAds(input.ads||[])||
  !safeId(input.assignmentRevision)||!safeId(input.inventoryRevision))
  return {valid:false,reason:'invalid_program',baseKey:null,adKey:null,key:null};
 const capabilities=input.capabilities||{};
 const supported=capabilities.supportsItemSchedules===true&&
  Number.isSafeInteger(capabilities.protocolVersion)&&capabilities.protocolVersion>=1&&
  capabilities.timeZone==='America/Sao_Paulo';
 const base=input.primary;
 const baseKey=JSON.stringify({
  playlist:base?.playlist?[
   base.playlist.id,text(base.playlist.updated_at),base.playlist.shuffle===true,
   text(base.playlist.repeat_mode)]:null,
  assignmentRevision:input.assignmentRevision,
  media:(base?.items||[]).map(item=>[
   item.id,item.media.id,text(item.media.checksum),text(item.media.name),
   text(item.media.type),text(item.duration_seconds),item.essential===true,
   schedule(item)
  ])
 });
 // Every creative revision and schedule is part of the commercial identity.
 // Names, order, targeted inventory revision and media IDs are included.
 const adKey=JSON.stringify({
  inventoryRevision:input.inventoryRevision,
  media:(input.ads||[]).map(ad=>[
   ad.id,ad.media.id,text(ad.media.checksum),text(ad.media.name),
   text(ad.media.type),text(ad.duration_seconds),schedule(ad)
  ])
 });
 const capabilityKey=JSON.stringify([
  capabilities.supportsItemSchedules===true,capabilities.protocolVersion,
  text(capabilities.timeZone)
 ]);
 const reason=!base||!base.items.length?'no_base_playlist':
  !supported?'legacy_or_incompatible_player':
  base.playlist.shuffle===true?'shuffle_preserved':
  base.playlist.repeat_mode==='single'?'single_preserved':
  base.items.some(item=>item.schedule?.enabled===true)?'scheduled_base_preserved':null;
 return {valid:true,baseKey,adKey,key:JSON.stringify([LAB_CONTRACT_VERSION,baseKey,adKey,capabilityKey]),
  allowed:reason===null,reason};
}
function baseOnlyModel(primary){return createFairRotationLab(primary,[]);}
export function createRoundContract(input){
 const identity=describeRoundProgram(input);
 const model=identity.valid&&identity.allowed?
  createFairRotationLab(input.primary,input.ads||[]):baseOnlyModel(input?.primary||null);
 return {version:LAB_CONTRACT_VERSION,identity,model,epoch:0,
  status:identity.reason||null};
}
export function currentRoundLease(contract){
 if(!contract?.identity?.valid)return null;
 const v=fairRotationView(contract.model);
 return v.current?JSON.stringify([contract.identity.key,contract.epoch,v.token]):null;
}
export function applyRoundContract(contract,event){
 if(!contract||contract.version!==LAB_CONTRACT_VERSION||!event||typeof event.type!=='string')
  throw new Error('invalid_lab_round_event');
 if(event.type==='complete'||event.type==='media-error'){
  if(!event.lease||event.lease!==currentRoundLease(contract))
   return {accepted:false,reason:'stale_program_or_lease',contract};
 }
 // Never accept arbitrary inventory-change events from a playback callback.
 if(event.type==='inventory-changed'||event.type==='revalidate'||event.type==='configure')
  return {accepted:false,reason:'requires_new_validated_program',contract};
 const action=event.type==='complete'||event.type==='media-error'?
  {type:event.type,token:fairRotationView(contract.model).token}:{type:event.type};
 const result=fairRotationEvent(contract.model,action);
 if(!result.accepted)return {...result,contract};
 return {accepted:true,reason:result.reason,contract:{...contract,model:result.state,
  epoch:contract.epoch+(event.type==='restart'?1:0)}};
}
export function exportRoundCheckpoint(contract){
 if(!contract?.identity?.valid)return null;
 // Explicit handoff only. No browser storage or claims of trusted telemetry.
 return JSON.parse(JSON.stringify({
  version:LAB_CONTRACT_VERSION,identity:contract.identity,model:contract.model,
  epoch:contract.epoch,status:contract.status
 }));
}
function validModel(model,primary,ads){
 if(!model||model.version!==1||!model.options===false)return false;
 if(!safeInteger(model.cycle)||!safeInteger(model.position)||
  !safeInteger(model.generation)||!safeInteger(model.completed)||
  !safeInteger(model.completedBase)||!safeInteger(model.completedAds)||
  !safeInteger(model.failures)||typeof model.connected!=='boolean'||
  typeof model.running!=='boolean'||!Array.isArray(model.items)||
  !Array.isArray(model.selected)||!Array.isArray(model.inventory)||!model.played||
  typeof model.played!=='object'||model.completed!==model.completedBase+model.completedAds)
  return false;
 if(!same(model.primary,primary)||!same(model.inventory,ads))return false;
 if(model.position>=model.items.length&&model.items.length>0)return false;
 if(model.position!==0&&model.items.length===0)return false;
 const baseItems=model.items.filter(x=>!x.commercial);
 if(!same(baseItems,primary?.items||[]))return false;
 const adIds=new Set(ads.map(x=>x.id));
 if(model.selected.some(id=>!adIds.has(id)))return false;
 if(model.items.filter(x=>x.commercial).some(x=>!adIds.has(x.id)))return false;
 if(Object.values(model.played).some(x=>!safeInteger(x)||x>model.completedAds))return false;
 return true;
}
function safeFallback(input,identity,reason,checkpoint){
 const fallback=baseOnlyModel(input?.primary||null);
 // After a commercially changed revision, keep base position only if the base
 // program itself is unchanged. Never replay a deleted advertising item.
 const candidate=checkpoint?.model;
 const sameBase=checkpoint?.identity?.baseKey===identity.baseKey&&
  Array.isArray(candidate?.items)&&safeInteger(candidate?.position);
 if(sameBase&&validateBase(input.primary)){
  const done=candidate.items.slice(0,candidate.position).filter(item=>!item.commercial).length;
  if(done<(input.primary?.items.length||0))fallback.position=done;
 }
 return {accepted:false,reason,contract:{version:LAB_CONTRACT_VERSION,identity,
  model:fallback,epoch:safeInteger(checkpoint?.epoch)?checkpoint.epoch+1:1,
  status:'base_only_'+reason}};
}
export function restoreRoundCheckpoint(input,checkpoint){
 const identity=describeRoundProgram(input);
 if(!identity.valid)return safeFallback(input,identity,'invalid_current_program',null);
 if(!checkpoint||checkpoint.version!==LAB_CONTRACT_VERSION||
  !safeInteger(checkpoint.epoch)||!checkpoint.identity||
  !validModel(checkpoint.model,checkpoint.model?.primary,checkpoint.model?.inventory))
  return safeFallback(input,identity,'invalid_checkpoint',null);
 if(checkpoint.identity.baseKey!==identity.baseKey)
  return safeFallback(input,identity,'base_program_changed',null);
 if(checkpoint.identity.key!==identity.key||!same(checkpoint.identity,identity))
  return safeFallback(input,identity,'commercial_or_capability_changed',checkpoint);
 if(!identity.allowed)return safeFallback(input,identity,'protected_base_program',checkpoint);
 if(!validModel(checkpoint.model,input.primary,input.ads||[]))
  return safeFallback(input,identity,'checkpoint_program_mismatch',null);
 // Force a new playback generation. Old callback leases cannot complete again.
 const model={...checkpoint.model,primary:input.primary,inventory:input.ads||[],
  running:false,generation:checkpoint.model.generation+1};
 const contract={version:LAB_CONTRACT_VERSION,identity,model,
  epoch:checkpoint.epoch+1,status:'recovered_paused'};
 return {accepted:true,reason:'same_program_recovered_paused',contract};
}
