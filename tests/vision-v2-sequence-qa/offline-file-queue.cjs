'use strict';
// EXPERIMENTO QA: fila em arquivo fsync+rename. NAO e codigo Android nem deploy.
// No Android: usar SQLite transacional e monotonicMs = SystemClock.elapsedRealtime().
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_QUEUE=2000, MAX_SPAN=30*86400000;
const MIN_TIME=Date.parse('2020-01-01T00:00:00Z'),MAX_TIME=Date.parse('2100-01-01T00:00:00Z');
function fail(c){throw Error(c);}
function sampleOK(bootId,monoMs){
 if(typeof bootId!=='string'||!/^[\w-]{8,100}$/.test(bootId)||!Number.isSafeInteger(monoMs)||monoMs<0) fail('invalid_boot_sample');
}
function daySP(ms){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
 const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return [v.year,v.month,v.day].join('-');
}
function derived(anchor,bootId,monoMs){
 if(!anchor||anchor.bootId!==bootId)return null;
 const delta=monoMs-anchor.monoMs;
 if(!Number.isSafeInteger(delta)||Math.abs(delta)>MAX_SPAN)return null;
 const ms=anchor.serverMs+delta;
 if(ms<MIN_TIME||ms>MAX_TIME)return null;
 return {playedAt:new Date(ms).toISOString(),playedDay:daySP(ms)};
}
function validate(s,id){
 if(!s||s.version!==1||s.deviceId!==id.deviceId||s.streamId!==id.streamId||
    !Array.isArray(s.pending)||s.pending.length>MAX_QUEUE||
    !Number.isSafeInteger(s.confirmed)||s.confirmed<0||
    !Number.isSafeInteger(s.sentThrough)||s.sentThrough<s.confirmed||
    !Number.isSafeInteger(s.nextSequence)||s.nextSequence<=s.sentThrough||
    s.nextSequence!==s.confirmed+s.pending.length+1)fail('queue_state_invalid_repair_required');
 for(let i=0;i<s.pending.length;i++){
  const e=s.pending[i];
  if(!e||e.sequence!==s.confirmed+i+1||typeof e.eventId!=='string'||e.eventId.length<8||
    typeof e.media!=='string'||!e.media||typeof e.bootId!=='string'||
    !Number.isSafeInteger(e.monoMs)||e.monoMs<0||typeof e.completed!=='boolean'||
    !Number.isFinite(e.seconds)||e.seconds<0||e.seconds>3600)fail('queue_event_invalid_repair_required');
  if((e.playedAt===null&&e.playedDay!==null)||
     (e.playedAt!==null&&(typeof e.playedAt!=='string'||!Number.isFinite(Date.parse(e.playedAt))||
     e.playedDay!==daySP(Date.parse(e.playedAt)))))fail('queue_clock_invalid_repair_required');
 }
}
class FilePlaybackQueue{
 constructor(file,identity){this.file=file;this.identity=identity;this.state=this._load();}
 static initialize(file,identity){
  if(!identity||!/^[\w-]{3,120}$/.test(identity.deviceId||'')||!/^[\w-]{3,120}$/.test(identity.streamId||''))fail('invalid_identity');
  if(fs.existsSync(file))fail('queue_already_initialized');
  const q=Object.create(FilePlaybackQueue.prototype);
  q.file=file;q.identity=identity;
  q._save({version:1,deviceId:identity.deviceId,streamId:identity.streamId,confirmed:0,sentThrough:0,nextSequence:1,anchor:null,pending:[]});
  return new FilePlaybackQueue(file,identity);
 }
 _load(){
  let raw;
  try{raw=fs.readFileSync(this.file,'utf8');}
  catch(e){if(e.code==='ENOENT')fail('queue_missing_repair_required');throw e;}
  let envelope,state;
  try{envelope=JSON.parse(raw);}
  catch{fail('queue_corrupt_repair_required');}
  if(!envelope||envelope.format!==1||typeof envelope.payload!=='string'||
     crypto.createHash('sha256').update(envelope.payload).digest('hex')!==envelope.sha256)fail('queue_corrupt_repair_required');
  try{state=JSON.parse(envelope.payload);}
  catch{fail('queue_corrupt_repair_required');}
  validate(state,this.identity);return state;
 }
 _save(next,options={}){
  validate(next,this.identity);
  const dir=path.dirname(this.file);fs.mkdirSync(dir,{recursive:true});
  const payload=JSON.stringify(next),checksum=crypto.createHash('sha256').update(payload).digest('hex');
  const temp=this.file+'.tmp-'+process.pid+'-'+crypto.randomBytes(6).toString('hex');
  let fd;
  try{
   fd=fs.openSync(temp,'wx',0o600);
   fs.writeFileSync(fd,JSON.stringify({format:1,payload,sha256:checksum}));
   fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   if(options.failBeforeRename)fail('simulated_power_loss_before_rename');
   fs.renameSync(temp,this.file);
   const dfd=fs.openSync(dir,'r');try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}
   if(options.failAfterRename)fail('simulated_crash_after_commit');
  }finally{
   if(fd!==undefined)fs.closeSync(fd);
   if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
  this.state=next;
 }
 inspect(){const s=this.state;return {confirmed:s.confirmed,sentThrough:s.sentThrough,nextSequence:s.nextSequence,pending:s.pending.length,unresolved:s.pending.filter(e=>e.playedAt===null).length};}
 append(event,sample,options={}){
  sampleOK(sample.bootId,sample.monoMs);
  if(!event||!/^[\w-]{8,128}$/.test(event.eventId||'')||!/^[\w-]{1,128}$/.test(event.media||'')||
     typeof event.completed!=='boolean'||!Number.isFinite(event.seconds)||
     event.seconds<0||event.seconds>3600)fail('invalid_playback_event');
  const old=this.state.pending.find(e=>e.eventId===event.eventId);
  if(old){if(old.media!==event.media||old.seconds!==event.seconds||old.completed!==event.completed)fail('duplicate_event_id_conflict');return old.sequence;}
  if(this.state.pending.length>=MAX_QUEUE)fail('queue_full_repair_required');
  const next=structuredClone(this.state),clock=derived(next.anchor,sample.bootId,sample.monoMs),sequence=next.nextSequence++;
  next.pending.push({sequence,eventId:event.eventId,media:event.media,completed:event.completed,seconds:event.seconds,bootId:sample.bootId,monoMs:sample.monoMs,playedAt:clock?.playedAt??null,playedDay:clock?.playedDay??null});
  this._save(next,options);return sequence;
 }
 recordTrustedTime(sample,serverIso,{authenticated=false,...options}={}){
  sampleOK(sample.bootId,sample.monoMs);
  if(!authenticated)fail('unauthenticated_clock_anchor');
  if(typeof serverIso!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(serverIso))fail('invalid_server_time');
  const ms=Date.parse(serverIso);
  if(!Number.isFinite(ms)||ms<MIN_TIME||ms>MAX_TIME)fail('invalid_server_time');
  const next=structuredClone(this.state);
  next.anchor={bootId:sample.bootId,monoMs:sample.monoMs,serverMs:ms};
  let resolved=0;
  for(const e of next.pending){
   if(e.playedAt!==null)continue;
   const clock=derived(next.anchor,e.bootId,e.monoMs);
   if(clock){Object.assign(e,clock);resolved++;}
  }
  this._save(next,options);return resolved;
 }
 batch({online=false,limit=50}={}){
  if(!online)return {events:[],reason:'offline'};
  if(!Number.isInteger(limit)||limit<1||limit>50)fail('invalid_batch_limit');
  const ready=[];
  for(const e of this.state.pending){if(!e.playedAt||ready.length===limit)break;ready.push(e);}
  if(!ready.length)return {events:[],reason:this.state.pending.length?'clock_unverified':'queue_empty'};
  const next=structuredClone(this.state);
  next.sentThrough=Math.max(next.sentThrough,ready.at(-1).sequence);
  this._save(next);
  return {events:ready.map(e=>({sequence:e.sequence,media:e.media,played_at:e.playedAt,completed:e.completed,seconds:e.seconds})),reason:null};
 }
 ack(number,options={}){
  if(!Number.isSafeInteger(number)||number<this.state.confirmed||number>this.state.sentThrough)fail('invalid_ack');
  const next=structuredClone(this.state);next.confirmed=number;next.pending=next.pending.filter(e=>e.sequence>number);
  this._save(next,options);
 }
}
module.exports={FilePlaybackQueue,daySP};
