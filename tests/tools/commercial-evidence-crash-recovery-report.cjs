#!/usr/bin/env node
// OFFLINE LAB ONLY. Demonstrate abrupt child exit while writing synthetic ledger.
// Only disposable OS temporary files; no Supabase, client media or production.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {buildChain}=require('../fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('../fixtures/commercial-evidence-external-anchor.cjs');
const {createDurableLabCustodian}=require('../fixtures/commercial-evidence-durable-lab.cjs');
const {releaseReviewedOrphan}=require('../fixtures/commercial-evidence-lock-review-lab.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-custody-durable-'));
try{
 const docs=path.resolve(__dirname,'../../docs/implementation');
 const load=n=>JSON.parse(fs.readFileSync(path.join(docs,n),'utf8'));
 const first=load('commercial-staging-evidence-template.json');
 const next=load('commercial-staging-evidence-lab-example.json');
 const chain=buildChain([
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:first},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:next}
 ]);
 const receipt=issueLabAnchor(chain,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
 const child=spawnSync(process.execPath,[
  'tests/tools/commercial-evidence-crash-worker.cjs',dir,'AFTER_RENAME','1'
 ],{cwd:process.cwd(),encoding:'utf8',timeout:20000});
 if(child.status!==77||child.stdout||child.stderr)throw Error('Wrong synthetic worker status');
 const recovered=createDurableLabCustodian(chain,{directory:dir}).read();
 const noReview=releaseReviewedOrphan({directory:dir,chain,
  expectedPinnedHead:receipt.receiptHash,review:null}).status;
 const review=releaseReviewedOrphan({directory:dir,chain,
  expectedPinnedHead:receipt.receiptHash,
  review:{reviewerConfirmed:true,secondReviewerConfirmed:true,
   manualTicket:'LAB-TICKET-000001'}}).status;
 const duplicate=createDurableLabCustodian(chain,{directory:dir}).publish({
  receipt,expectedHead:ZERO,requestId:'REQ-00000001'}).status;
 if(recovered.count!==1||noReview!=='DUAL_REVIEW_REQUIRED'||
  review!=='SIMULATED_MANUAL_LOCK_RELEASE'||duplicate!=='ALREADY_COMMITTED')
  throw Error('Synthetic crash replay failed');
 process.stdout.write([
  '# Vision — recuperação de processo interrompido durante commit',
  '',
  '| Ensaio offline | Resultado |',
  '|---|---|',
  '| Encerramento após rename | EXIT_77 |',
  '| Recibos persistidos | '+recovered.count+' |',
  '| Sem revisão dupla | '+noReview+' |',
  '| Liberação revisada simulada | '+review+' |',
  '| Tentativa repetida | '+duplicate+' |',
  '',
  '**Conclusão:** registro não duplicado na simulação local.',
  '**Limite:** processo finalizado propositalmente; não simula perda real de energia.',
  '**Produção, staging, player e Supabase:** não autorizados.'
 ].join('\n')+'\n');
}catch{
 process.stderr.write('Synthetic crash recovery report unavailable; no raw evidence emitted.\n');
 process.exitCode=1;
}finally{fs.rmSync(dir,{recursive:true,force:true})}
