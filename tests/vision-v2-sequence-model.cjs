'use strict';
// SIMULADOR DE CONTRATO, NÃO backend implantado.
// Prova invariantes lógicas; DB, concorrência SQL e Android precisam de homologação própria.
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dateInBrazil = value => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
};
function validate(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)
    || !Number.isSafeInteger(e.seq) || e.seq < 1
    || typeof e.mediaId !== 'string' || e.mediaId.length < 1 || e.mediaId.length > 128
    || typeof e.playedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(e.playedAt)
    || !Number.isFinite(Date.parse(e.playedAt))
    || typeof e.completed !== 'boolean'
    || typeof e.durationSeconds !== 'number' || !Number.isFinite(e.durationSeconds)
    || e.durationSeconds < 0 || e.durationSeconds > 3600)
      throw Error('invalid_event');
  return {
    seq:e.seq, mediaId:e.mediaId, playedAt:e.playedAt,
    completed:e.completed, durationSeconds:e.durationSeconds,
  };
}
function serverKey(t,d,e) { return t+'|'+d+'|'+e; }
class SequenceServer {
  constructor({window=128, recent=128}={}) {
    assert.ok(Number.isSafeInteger(window)&&window>=1);
    assert.ok(Number.isSafeInteger(recent)&&recent>=1);
    this.window=window;this.recent=recent;
    this.streams=new Map();this.tokens=new Map();this.aggregates=new Map();
  }
  provision({tenant,device,epoch,token,adminApproved=false}) {
    if(!adminApproved) throw Error('admin_approval_required');
    if(!tenant||!device||!epoch||!token||this.tokens.has(token)) throw Error('invalid_provision');
    const k=serverKey(tenant,device,epoch);
    if(this.streams.has(k)) throw Error('epoch_already_exists');
    this.streams.set(k,{tenant,device,epoch,watermark:0,pending:new Map(),recent:new Map(),active:true});
    this.tokens.set(token,k);
  }
  revoke(token) { const k=this.tokens.get(token);if(k)this.streams.get(k).active=false; }
  submit(token,rawEvents,{failpoint}={}) {
    const key=this.tokens.get(token);
    if(!key || !this.streams.get(key).active) return {ok:false,error:'unauthorized'};
    if(!Array.isArray(rawEvents)||rawEvents.length<1||rawEvents.length>50)
      return {ok:false,error:'invalid_batch'};
    const original=this.streams.get(key);
    const s={...original,pending:new Map(original.pending),recent:new Map(original.recent)};
    const aggregates=new Map([...this.aggregates].map(([k,v])=>[k,{...v}]));
    let newlyPending=0,duplicates=0,committed=0;
    try {
      for(const raw of rawEvents) {
        const e=validate(raw),hash=sha(e);
        if(e.seq<=s.watermark) {
          const known=s.recent.get(e.seq);
          if(!known) throw Error('old_replay_unverifiable');
          if(known!==hash) throw Error('sequence_conflict');
          duplicates++;continue;
        }
        if(e.seq>s.watermark+this.window+1) throw Error('gap_out_of_window');
        const prior=s.pending.get(e.seq);
        if(prior) {
          if(prior.hash!==hash) throw Error('sequence_conflict');
          duplicates++;continue;
        }
        if(s.pending.size>=this.window) throw Error('pending_full');
        s.pending.set(e.seq,{hash,event:e});
        newlyPending++;
        while(s.pending.has(s.watermark+1)) {
          const next=s.watermark+1;
          const item=s.pending.get(next);s.pending.delete(next);
          const ev=item.event;
          const akey=s.tenant+'|'+s.device+'|'+dateInBrazil(ev.playedAt)+'|'+ev.mediaId;
          const a=aggregates.get(akey)||{starts:0,completes:0,totalSeconds:0};
          a.starts++;a.completes+=Number(ev.completed);a.totalSeconds+=ev.durationSeconds;
          aggregates.set(akey,a);
          s.watermark=next;s.recent.set(next,item.hash);
          while(s.recent.size>this.recent) s.recent.delete(s.recent.keys().next().value);
          committed++;
        }
      }
      if(failpoint==='beforeCommit') throw Error('simulated_db_rollback');
    } catch(e) {
      return {ok:false,error:e.message};
    }
    this.streams.set(key,s);this.aggregates=aggregates;
    if(failpoint==='afterCommitBeforeAck') throw Error('simulated_lost_ack');
    return {ok:true,accepted:newlyPending,committed,duplicates,
      committedThrough:s.watermark,pending:s.pending.size};
  }
  snapshot(token){
    const k=this.tokens.get(token);const s=this.streams.get(k);
    return {watermark:s.watermark,pending:s.pending.size,recent:s.recent.size,
      aggregates:[...this.aggregates].filter(([a])=>a.startsWith(s.tenant+'|'+s.device+'|'))};
  }
  totals(token) {
    const snap=this.snapshot(token);
    return snap.aggregates.reduce((a,[,b])=>({
      starts:a.starts+b.starts,completes:a.completes+b.completes,
      seconds:a.seconds+b.totalSeconds}),{starts:0,completes:0,seconds:0});
  }
}
class DurableJournal {
  constructor({epoch,cap=2000,stored}={}) {
    this.epoch=epoch||'test-epoch';this.cap=cap;
    this.lastIssued=0;this.events=[];
    if(stored) {
      const data=JSON.parse(stored);
      if(data.epoch!==this.epoch)throw Error('epoch_drift');
      this.lastIssued=data.lastIssued;this.events=data.events.map(validate);
    }
  }
  append(details) {
    if(this.events.length>=this.cap)throw Error('device_storage_full');
    const e=validate({...details,seq:this.lastIssued+1});
    this.events.push(e);this.lastIssued++;return e;
  }
  ack(response) {
    if(!response||response.ok!==true||!Number.isSafeInteger(response.committedThrough))
      throw Error('ack_invalid');
    // O ACK precisa vir da conexão autenticada/TLS na implementação real.
    this.events=this.events.filter(e=>e.seq>response.committedThrough);
  }
  batch(size=50){return this.events.slice(0,size).map(x=>({...x}));}
  save(){return JSON.stringify({epoch:this.epoch,lastIssued:this.lastIssued,events:this.events});}
}
module.exports={SequenceServer,DurableJournal,validate,dateInBrazil};
