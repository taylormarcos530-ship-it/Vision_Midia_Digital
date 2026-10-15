// OFFLINE LAB ONLY: simulate independent checkpoints for synthetic SHA256 evidence history.
// Trust model: independentlyHeldDigest must come from a *separate trusted channel*.
// An anchor stored beside the chain is NOT independent, signed, immutable or proof of STAGING.
// No networking, secret keys, file writes, migrations, player changes, or deployments.
'use strict';
const {createHash,timingSafeEqual}=require('node:crypto');
const {verifyChain}=require('./commercial-evidence-hash-chain.cjs');
const HEX=/^[a-f0-9]{64}$/;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const DOMAIN='VISION-COMMERCIAL-INDEPENDENT-ANCHOR-LAB-V1\u0000';
const ZERO='0'.repeat(64);
function canonicalUtc(x){
 if(typeof x!=='string'||!TIME.test(x))return null;
 const d=new Date(x);
 if(Number.isNaN(d.getTime()))return null;
 const round=d.toISOString();
 return round===(x.length===20?x.replace('Z','.000Z'):x)?d.getTime():null;
}
function validDigest(x){return typeof x==='string'&&HEX.test(x)}
function eqDigest(a,b){
 if(!validDigest(a)||!validDigest(b))return false;
 const x=Buffer.from(a,'hex'),y=Buffer.from(b,'hex');
 return timingSafeEqual(x,y);
}
function receiptHash(entry){
 // Closed, ordered tuple prevents ambiguity and unapproved JSON properties.
 return createHash('sha256').update(DOMAIN,'utf8')
  .update(JSON.stringify([entry.version,entry.anchorNumber,entry.recordCount,
    entry.headHash,entry.previousAnchorHash,entry.stampedAt]),'utf8')
  .digest('hex');
}
function shape(x){
 if(x===null||typeof x!=='object'||Array.isArray(x)||
   Object.keys(x).sort().join('|')!==
   'anchorNumber|headHash|previousAnchorHash|receiptHash|recordCount|stampedAt|version')
  throw new TypeError('Invalid anchor receipt fields');
 if(x.version!==1||!Number.isInteger(x.anchorNumber)||x.anchorNumber<1||
  x.anchorNumber>30||!Number.isInteger(x.recordCount)||
  x.recordCount<1||x.recordCount>30||!validDigest(x.headHash)||
  !validDigest(x.previousAnchorHash)||!validDigest(x.receiptHash)||
  canonicalUtc(x.stampedAt)===null)
  throw new TypeError('Invalid anchor receipt values');
}
function issueLabAnchor(chain,{previous=null,recordCount=chain.length,stampedAt}={}){
 const c=verifyChain(chain);
 if(!c.chainConsistent||c.historyNeedsReview)
  throw new TypeError('Do not issue an anchor for an inconsistent synthetic history');
 if(!Number.isInteger(recordCount)||recordCount<1||recordCount>chain.length)
  throw new TypeError('Invalid anchor checkpoint length');
 const instant=canonicalUtc(stampedAt);
 if(instant===null||instant<canonicalUtc(chain[recordCount-1].recordedAt))
  throw new TypeError('Anchor timestamp predates checkpoint or is malformed');
 if(previous!==null){
  shape(previous);
  if(!eqDigest(previous.receiptHash,receiptHash(previous)))
   throw new TypeError('Invalid previous anchor checksum');
  if(previous.recordCount>=recordCount||
   !eqDigest(previous.headHash,chain[previous.recordCount-1].hash)||
   instant<=canonicalUtc(previous.stampedAt))
   throw new TypeError('Anchor rotation must strictly advance a matching checkpoint');
 }
 const fields={version:1,anchorNumber:previous===null?1:previous.anchorNumber+1,
  recordCount,headHash:chain[recordCount-1].hash,
  previousAnchorHash:previous===null?ZERO:previous.receiptHash,
  stampedAt};
 return Object.freeze({...fields,receiptHash:receiptHash(fields)});
}
function verifyLabAnchors(chain,receipts,{independentlyHeldDigest=null}={}){
 const c=verifyChain(chain);
 if(!Array.isArray(receipts)||receipts.length<1||receipts.length>30)
  throw new TypeError('Expected 1-30 synthetic anchor receipts');
 if(independentlyHeldDigest!==null&&!validDigest(independentlyHeldDigest))
  throw new TypeError('Invalid independently supplied digest');
 const alerts=[],add=(n,code)=>alerts.push(Object.freeze({anchorNumber:n,code}));
 let prev=null;
 for(let i=0;i<receipts.length;i++){
  const a=receipts[i];shape(a);
  if(a.anchorNumber!==i+1)throw new TypeError('Anchor sequence must be consecutive');
  if(a.recordCount>chain.length)
   add(a.anchorNumber,'ANCHORED_RECORD_MISSING');
  else{
   if(!eqDigest(a.headHash,chain[a.recordCount-1].hash))
    add(a.anchorNumber,'HISTORY_HEAD_MISMATCH');
   if(canonicalUtc(a.stampedAt)<canonicalUtc(chain[a.recordCount-1].recordedAt))
    add(a.anchorNumber,'ANCHOR_TIMESTAMP_BEFORE_HISTORY');
  }
  if(!eqDigest(a.receiptHash,receiptHash(a)))
   add(a.anchorNumber,'ANCHOR_RECEIPT_TAMPERED');
  if(!eqDigest(a.previousAnchorHash,prev===null?ZERO:prev.receiptHash))
   add(a.anchorNumber,'ANCHOR_LINK_MISMATCH');
  if(prev&&(a.recordCount<=prev.recordCount||
      canonicalUtc(a.stampedAt)<=canonicalUtc(prev.stampedAt)))
   add(a.anchorNumber,'ANCHOR_ROTATION_NOT_MONOTONIC');
  prev=a;
 }
 if(receipts.at(-1).recordCount<chain.length)
  add(receipts.at(-1).anchorNumber,'UNANCHORED_HISTORY_TAIL');
 const pinnedChecked=independentlyHeldDigest!==null;
 const pinnedMatches=pinnedChecked?
  eqDigest(receipts.at(-1).receiptHash,independentlyHeldDigest):null;
 if(pinnedMatches===false)add(receipts.at(-1).anchorNumber,'INDEPENDENT_HEAD_MISMATCH');
 if(!c.chainConsistent)add(0,'HISTORY_CHAIN_INCONSISTENT');
 if(c.historyNeedsReview)add(0,'HISTORY_SEMANTIC_REVIEW_REQUIRED');
 return Object.freeze({
  anchors:receipts.length,records:chain.length,
  locallyConsistent:alerts.length===0,
  alerts:Object.freeze(alerts),
  independentHeadCompared:pinnedChecked,independentHeadMatches:pinnedMatches,
  // A claimed independent digest is data, not an authenticated trusted witness.
  independentAnchorAuthenticityVerified:false,
  stagingOriginVerified:false,canConnectStaging:false,
  canRunRealStaging:false,canDeployToProduction:false
 });
}
function renderLabAnchorReport(result){
 if(!result||!Array.isArray(result.alerts)||!Number.isInteger(result.anchors))
  throw new TypeError('Invalid simulated anchor report');
 const lines=[
  '# Vision — âncora independente simulada para histórico sintético',
  '',
  '**Escopo:** laboratório offline, sem testemunha externa autenticada.',
  '**Estado:** '+(result.locallyConsistent?'CONSISTENTE NO LABORATÓRIO':'REVISÃO NECESSÁRIA'),
  '**Referência preservada separadamente:** '+(result.independentHeadCompared?
   result.independentHeadMatches?'digest confere, procedência NÃO certificada':
   'DIVERGENTE':'não fornecida'),
  '**Staging e produção:** não autorizados.',
  '',
  '| Âncora | Alerta |','|---:|---|'
 ];
 for(const x of result.alerts)lines.push('| '+x.anchorNumber+' | '+x.code+' |');
 if(!result.alerts.length)lines.push('| - | Sem alertas na simulação |');
 lines.push('','**Limite:** guardar as âncoras e a referência final no mesmo lugar '+
  'permite reescrever ambas. Exige custódia independente antes de qualquer uso real.');
 return lines.join('\n')+'\n';
}
module.exports={ZERO,issueLabAnchor,verifyLabAnchors,renderLabAnchorReport};
