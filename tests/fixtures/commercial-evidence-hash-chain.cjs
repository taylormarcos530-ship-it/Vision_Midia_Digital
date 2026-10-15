// OFFLINE LAB ONLY. Tamper-evident SHA-256 links for *synthetic* evidence forms.
// A self-computed hash chain is NOT signed, append-only, or proof of STAGING origin.
// Never connects services, writes files, authorizes SQL changes or deploys.
'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const {inspectHistory}=require('./commercial-evidence-history.cjs');

const GENESIS='0'.repeat(64);
const DIGEST=/^[0-9a-f]{64}$/;
const DOMAIN='VISION-COMMERCIAL-EVIDENCE-CHAIN-V1\u0000';
const owns=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
function canonical(x){
 if(x===null)return 'null';
 if(typeof x==='string'||typeof x==='boolean')return JSON.stringify(x);
 if(typeof x==='number'&&Number.isFinite(x))return JSON.stringify(x);
 if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
 if(x&&typeof x==='object'&&
   (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)){
  return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
 }
 throw new TypeError('Unsupported chain value');
}
function sha(payload){
 return createHash('sha256').update(DOMAIN,'utf8')
  .update(canonical(payload),'utf8').digest('hex');
}
function equalDigest(a,b){
 const left=Buffer.from(a,'hex'),right=Buffer.from(b,'hex');
 return left.length===32&&right.length===32&&timingSafeEqual(left,right);
}
function checkEntryShape(x){
 if(!x||typeof x!=='object'||Array.isArray(x)||
  Object.keys(x).sort().join('|')!=='form|hash|previousHash|recordedAt|sequence')
  throw new TypeError('Invalid chained record fields');
 if(!Number.isSafeInteger(x.sequence)||x.sequence<1||x.sequence>30||
  !DIGEST.test(x.hash)||!DIGEST.test(x.previousHash))
  throw new TypeError('Invalid chain index or digest');
}
function buildChain(snapshots){
 inspectHistory(snapshots); // Same contract as earlier: schema, UTC, refs, sequencing.
 let previous=GENESIS;
 return snapshots.map(row=>{
  // Prevent mutation of caller-owned original forms after chain construction.
  const clean=structuredClone(row);
  const fields={sequence:clean.sequence,recordedAt:clean.recordedAt,
   form:clean.form,previousHash:previous};
  const entry={...fields,hash:sha(fields)};
  previous=entry.hash;
  return entry;
 });
}
function verifyChain(chain,{expectedHead=null}={}){
 if(!Array.isArray(chain)||chain.length<1||chain.length>30)
  throw new TypeError('Chain requires 1-30 records');
 if(expectedHead!==null&&(typeof expectedHead!=='string'||!DIGEST.test(expectedHead)))
  throw new TypeError('Invalid externally provided head digest');
 chain.forEach(checkEntryShape);
 // The previous validator also rejects duplicate IDs, secret-bearing fields,
 // malformed timestamps and out-of-sequence snapshots.
 const audit=inspectHistory(chain.map(x=>({
  sequence:x.sequence,recordedAt:x.recordedAt,form:x.form
 })));
 let previous=GENESIS;
 const alerts=[];
 for(const [index,x] of chain.entries()){
  if(!equalDigest(x.previousHash,previous))
   alerts.push(Object.freeze({sequence:index+1,code:'PREVIOUS_LINK_MISMATCH'}));
  const computed=sha({sequence:x.sequence,recordedAt:x.recordedAt,
   form:x.form,previousHash:x.previousHash});
  if(!equalDigest(x.hash,computed))
   alerts.push(Object.freeze({sequence:index+1,code:'RECORD_DIGEST_MISMATCH'}));
  previous=x.hash;
 }
 const headMatches=expectedHead===null?null:equalDigest(previous,expectedHead);
 if(headMatches===false)
  alerts.push(Object.freeze({sequence:chain.length,code:'EXPECTED_HEAD_MISMATCH'}));
 const chainConsistent=alerts.length===0;
 return Object.freeze({
  records:chain.length,
  chainConsistent,
  historyNeedsReview:!audit.structurallyConsistent,
  alerts:Object.freeze(alerts),
  // No trust conclusion can be derived solely from a digest supplied in
  // the same file/communication channel as the chain itself.
  checkedAgainstSuppliedHead:expectedHead!==null,
  suppliedHeadMatches:headMatches,
  externalAnchorAuthenticityVerified:false,
  stagingProvenanceVerified:false,
  canConnectStaging:false,canRunRealStaging:false,canDeployToProduction:false
 });
}
function renderChainReport(result){
 if(!result||!Array.isArray(result.alerts)||!Number.isInteger(result.records))
  throw new TypeError('Invalid chain report');
 const lines=[
  '# Vision — encadeamento SHA-256 de evidências sintéticas',
  '',
  '**Ambiente:** laboratório local; nenhum staging real autenticado.',
  '**Cadeia:** '+(result.chainConsistent?'ÍNTEGRA NO LABORATÓRIO':'ALTERAÇÃO/INCONSISTÊNCIA'),
  '**Referência externa:** '+(result.checkedAgainstSuppliedHead?
   (result.suppliedHeadMatches?'comparação coincidente, autenticidade não verificada':
    'digest final divergente'):'não fornecida'),
  '**Deploy e conexões reais:** não autorizados.',
  '',
  '| Rodada | Alerta |','|---:|---|'
 ];
 for(const x of result.alerts)lines.push('| '+x.sequence+' | '+x.code+' |');
 if(!result.alerts.length)lines.push('| - | Nenhuma divergência criptográfica identificada |');
 lines.push('','**Aviso:** cadeia interna íntegra não impede reescrita completa; '+
  'guardar o digest final em fonte independente é requisito para detectar essa troca.');
 return lines.join('\n')+'\n';
}
module.exports={GENESIS,buildChain,verifyChain,renderChainReport};
