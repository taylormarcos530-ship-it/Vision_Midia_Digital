// OFFLINE LAB ONLY; never imported by the gateway, APK, or customer player.
// No network, persistence, reporting, database calls, timers, or real impressions.
import {commercialEligibility,interleave} from './supabase/functions/_shared/commercial.mjs';

const usableAds=ads=>{
 if(!Array.isArray(ads)||ads.length>20)return null;
 const ids=new Set(),out=[];
 for(const ad of ads){
  if(!ad||typeof ad.id!=='string'||!ad.id||ids.has(ad.id)||
    !ad.media||typeof ad.media.id!=='string'||!ad.media.id)return null;
  ids.add(ad.id);out.push({...ad,commercial:true});
 }
 return out;
};
const baseItems=p=>Array.isArray(p?.items)?p.items:[];
function plan(state){
 const base=baseItems(state.primary),reason=commercialEligibility(state.primary);
 if(reason||state.blocked||!state.inventory.length)
  return {...state,items:base,selected:[]};
 const n=state.inventory.length,cursor=state.cursor%n;
 // Prefer least completed plays; break ties by a rotating stable cursor.
 // Planning itself never counts as a playback.
 const ranked=state.inventory.map((ad,i)=>({ad,i,plays:state.played[ad.id]||0}))
  .sort((a,b)=>a.plays-b.plays||
   ((a.i-cursor+n)%n)-((b.i-cursor+n)%n));
 const selected=ranked.slice(0,Math.min(Math.ceil(base.length/3),n)).map(x=>x.ad);
 const manifest=interleave(state.primary,selected,3,0);
 return {...state,items:manifest.items,selected:selected.map(x=>x.id)};
}
export function createFairRotationLab(primary,ads=[]){
 const inventory=usableAds(ads);
 return plan({version:1,primary,inventory:inventory||[],pending:null,
  blocked:inventory===null,cycle:0,position:0,generation:0,cursor:0,
  connected:true,running:false,completed:0,completedBase:0,completedAds:0,
  played:{},failures:0,items:[],selected:[]});
}
export function fairRotationView(state){
 const current=state.items[state.position]||null;
 return {current,cycle:state.cycle,position:state.position,items:state.items,
  selected:state.selected,connected:state.connected,running:state.running,
  blocked:state.blocked,completed:state.completed,
  completedBase:state.completedBase,completedAds:state.completedAds,
  played:{...state.played},failures:state.failures,
  token:current?`${state.generation}:${state.cycle}:${state.position}:${current.id}`:null};
}
const deny=(state,reason)=>({state,accepted:false,reason});
const pass=(state,reason)=>({state,accepted:true,reason});
function cycleEnd(state){
 const pool=state.pending===null?state.inventory:state.pending;
 return plan({...state,inventory:pool,pending:null,cycle:state.cycle+1,position:0,
  cursor:pool.length?(state.cursor+state.selected.length)%pool.length:0,
  generation:state.generation+1});
}
function withoutCommercials(state,reason,patch={}){
 // Align the current base position by completed base items; skip cancelled ads,
 // but never skip or replay a point's own media.
 const baseDone=state.items.slice(0,state.position).filter(x=>!x.commercial).length;
 const next={...state,...patch,running:false,generation:state.generation+1,
  items:baseItems(state.primary),selected:[],position:baseDone};
 if(next.items.length && baseDone>=next.items.length)
  return pass(cycleEnd(next),reason);
 return pass(next,reason);
}
export function fairRotationEvent(state,event){
 if(!state||state.version!==1||!event||typeof event.type!=='string')
  throw new Error('invalid_offline_rotation_event');
 const current=state.items[state.position];
 if(event.type==='start'){
  if(!state.connected||!current||state.running)return deny(state,'not_ready');
  return pass({...state,running:true},'started');
 }
 if(event.type==='pause'){
  if(!state.running)return deny(state,'already_paused');
  return pass({...state,running:false,generation:state.generation+1},'paused');
 }
 if(event.type==='disconnect'){
  if(!state.connected)return deny(state,'already_disconnected');
  return pass({...state,connected:false,running:false,generation:state.generation+1},'disconnected');
 }
 if(event.type==='reconnect'){
  if(state.connected)return deny(state,'already_connected');
  return pass({...state,connected:true,running:false,generation:state.generation+1},'reconnected_paused');
 }
 if(event.type==='restart')
  return pass({...state,running:false,generation:state.generation+1},'restarted_paused');
 if(event.type==='complete'){
  if(!state.connected||!state.running||!current||event.token!==fairRotationView(state).token)
   return deny(state,'stale_or_inactive_completion');
  if(!Number.isSafeInteger(state.completed+1)||!Number.isSafeInteger(state.cycle+1))
   return deny(state,'simulation_limit');
  const ad=Boolean(current.commercial);
  const played=ad?{...state.played,[current.id]:(state.played[current.id]||0)+1}:state.played;
  const updated={...state,played,completed:state.completed+1,
   completedAds:state.completedAds+Number(ad),completedBase:state.completedBase+Number(!ad),
   position:state.position+1};
  return pass(updated.position===state.items.length?cycleEnd(updated):updated,'completed_once');
 }
 if(event.type==='media-error'){
  if(!state.running||!current||event.token!==fairRotationView(state).token)
   return deny(state,'stale_or_inactive_error');
  if(!current.commercial)
   return pass({...state,running:false,generation:state.generation+1,failures:state.failures+1},
    'base_failure_paused_no_count');
  return withoutCommercials(state,'commercial_failure_blocked',{
   blocked:true,failures:state.failures+1,pending:[]});
 }
 if(event.type==='inventory-changed'){
  const pool=usableAds(event.ads);
  const result=withoutCommercials(state,pool===null?'invalid_inventory_blocked':'inventory_queued',{
   pending:pool||[],blocked:state.blocked||pool===null});
  return pool===null?{...result,accepted:false}:result;
 }
 if(event.type==='revalidate'){
  if(!state.blocked)return deny(state,'not_blocked');
  // Manual revalidation never inserts an ad in the middle of the cycle.
  return pass({...state,blocked:false,generation:state.generation+1,running:false},
   'commercials_revalidated_for_next_cycle');
 }
 return deny(state,'unknown_event');
}
