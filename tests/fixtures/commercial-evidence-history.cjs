// OFFLINE LAB ONLY: compare immutable-intended synthetic evidence snapshots.
// Neither chronological consistency nor a hash proves STAGING origin or permissions.
// Never writes files, contacts services, promotes statuses or authorizes deployment.
'use strict';
const {verify}=require('./commercial-staging-evidence.cjs');
const {GATES}=require('./commercial-staging-readiness.cjs');
const UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
function utc(value){
 if(typeof value!=='string'||!UTC.test(value))return null;
 const date=new Date(value);
 if(Number.isNaN(date.getTime()))return null;
 const canonical=date.toISOString();
 return canonical===(value.length===20?value.replace('Z','.000Z'):value)?date.getTime():null;
}
function snapshotShape(x){
 if(x===null||typeof x!=='object'||Array.isArray(x))throw new TypeError('Invalid historical snapshot');
 const keys=Object.keys(x).sort();
 if(keys.join('|')!=='form|recordedAt|sequence')throw new TypeError('Unexpected historical snapshot properties');
 if(!Number.isSafeInteger(x.sequence)||x.sequence<1||x.sequence>100)
  throw new TypeError('Invalid snapshot sequence');
 const at=utc(x.recordedAt);
 if(at===null)throw new TypeError('Invalid snapshot UTC timestamp');
 verify(x.form); // Revalidate each full form; reject raw URLs, duplicate refs and unknown fields.
 return at;
}
function inspectHistory(snapshots){
 if(!Array.isArray(snapshots)||snapshots.length<1||snapshots.length>30)
  throw new TypeError('History requires 1-30 snapshots');
 const seenRefs=new Map(),seenDigests=new Map(),previousRows=new Map();
 const issues=[],snapshotsSummary=[];
 const emit=(code,sequence,gate=null,ref=null)=>{
  issues.push(Object.freeze({code,sequence,gate,ref}));
 };
 let lastRecorded=-Infinity;
 for(let index=0;index<snapshots.length;index++){
  const item=snapshots[index];
  const at=snapshotShape(item);
  if(item.sequence!==index+1)throw new TypeError('Snapshot sequence must start at 1 and be consecutive');
  if(at<=lastRecorded)emit('SNAPSHOT_TIME_NON_MONOTONIC',item.sequence);
  lastRecorded=at;
  let count=0;
  for(const row of item.form.checks){
   const earlier=previousRows.get(row.id);
   if(earlier){
    if(earlier.status==='PASS'&&row.status!=='PASS')
     emit('STATUS_REGRESSION_REVIEW',item.sequence,row.id);
    if(earlier.status==='BLOCKED'&&row.status==='PASS')
     emit('BLOCKED_STATUS_ELEVATION_UNVERIFIED',item.sequence,row.id);
    const existing=new Set(earlier.refs);
    const now=new Set(row.evidence.map(e=>e.ref));
    for(const ref of existing)if(!now.has(ref))
     emit('EVIDENCE_REFERENCE_REMOVED',item.sequence,row.id,ref);
   }
   if(row.status==='PASS'&&(!earlier||earlier.status!=='PASS'))
    emit('NEW_PASS_REQUIRES_INDEPENDENT_REVIEW',item.sequence,row.id);
   for(const e of row.evidence){
    count++;
    const observed=utc(e.observedAt);
    if(observed===null||observed>at)
     emit('EVIDENCE_OBSERVED_AFTER_SNAPSHOT',item.sequence,row.id,e.ref);
    const priorRef=seenRefs.get(e.ref);
    if(priorRef){
     if(priorRef.gate!==row.id||priorRef.type!==e.type)
      emit('REFERENCE_REBOUND',item.sequence,row.id,e.ref);
     if(priorRef.sha256!==e.sha256)
      emit('REFERENCE_DIGEST_CHANGED',item.sequence,row.id,e.ref);
     if(priorRef.source!==e.source)
      emit('EVIDENCE_SOURCE_PROMOTED_OR_CHANGED',item.sequence,row.id,e.ref);
     if(priorRef.observedAt!==e.observedAt)
      emit('EVIDENCE_TIMESTAMP_REWRITTEN',item.sequence,row.id,e.ref);
    }else{
     seenRefs.set(e.ref,{gate:row.id,type:e.type,sha256:e.sha256,
      source:e.source,observedAt:e.observedAt});
    }
    const priorDigest=seenDigests.get(e.sha256);
    if(priorDigest){
     if(priorDigest.ref!==e.ref)
      emit('DIGEST_REUSED_UNDER_DIFFERENT_REF',item.sequence,row.id,e.ref);
     if(priorDigest.source==='LAB'&&e.source==='STAGING')
      emit('LAB_HASH_RELABELED_STAGING',item.sequence,row.id,e.ref);
    }else{
     seenDigests.set(e.sha256,{ref:e.ref,source:e.source});
    }
   }
   previousRows.set(row.id,{status:row.status,refs:row.evidence.map(e=>e.ref)});
  }
  snapshotsSummary.push(Object.freeze({sequence:item.sequence,
   recordedAt:item.recordedAt,evidenceReferences:count,
   passClaims:item.form.checks.filter(r=>r.status==='PASS').length,
   blockedClaims:item.form.checks.filter(r=>r.status==='BLOCKED').length}));
 }
 return Object.freeze({
  snapshotCount:snapshots.length,
  totalCriteria:GATES.length,
  // Absence of history anomalies does not verify the staging provenance.
  structurallyConsistent:issues.length===0,
  issues:Object.freeze(issues),
  summaries:Object.freeze(snapshotsSummary),
  stagingOriginVerified:false,
  canRunRealStaging:false,canConnectStaging:false,canDeployToProduction:false
 });
}
function renderHistory(result){
 if(!result||!Array.isArray(result.issues)||!Array.isArray(result.summaries))
  throw new TypeError('Invalid synthetic history result');
 const lines=[
  '# Vision — auditoria cronológica de evidências sintéticas',
  '',
  '**Ambiente:** laboratório offline; staging e origem documental NÃO autenticados.',
  '**Autorização para staging, mudanças em SQL e produção:** nenhuma.',
  '**Conferência estrutural:** '+(result.structurallyConsistent?'SEM ALERTAS':'REQUER REVISÃO'),
  '',
  '| Rodada | Momento UTC | Referências declaradas | PASS declarado | BLOCKED declarado |',
  '|---:|---|---:|---:|---:|'
 ];
 for(const x of result.summaries)
  lines.push('| '+x.sequence+' | '+x.recordedAt+' | '+x.evidenceReferences+
   ' | '+x.passClaims+' | '+x.blockedClaims+' |');
 lines.push('','| Rodada | Critério | Ref. opaca | Motivo |','|---:|---|---|---|');
 for(const x of result.issues)
  lines.push('| '+x.sequence+' | '+(x.gate||'-')+' | '+(x.ref||'-')+' | '+x.code+' |');
 if(!result.issues.length)lines.push('| - | - | - | Nenhum alerta estrutural |');
 lines.push('','**Atenção:** referência, hash, horário e status declarados não atestam origem ou aprovação.');
 return lines.join('\n')+'\n';
}
module.exports={inspectHistory,renderHistory};
