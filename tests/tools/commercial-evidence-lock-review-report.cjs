#!/usr/bin/env node
// OFFLINE LAB ONLY: disposable synthetic lock + child process termination.
// Never uses real services, customers, production paths or authentication.
// Written files live only under a controlled OS temporary directory, then vanish.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {buildChain}=require('../fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('../fixtures/commercial-evidence-external-anchor.cjs');
const {createDurableLabCustodian}=require('../fixtures/commercial-evidence-durable-lab.cjs');
const {reviewOrphan,releaseReviewedOrphan}
 =require('../fixtures/commercial-evidence-lock-review-lab.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-custody-durable-'));
try{
 const docs=path.resolve(__dirname,'../../docs/implementation');
 const load=n=>JSON.parse(fs.readFileSync(path.join(docs,n),'utf8'));
 const first=load('commercial-staging-evidence-template.json'),
  second=load('commercial-staging-evidence-lab-example.json');
 const chain=buildChain([
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:first},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:second}
 ]);
 const receipt=issueLabAnchor(chain,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
 const script=[
  "const fs=require('node:fs'),path=require('node:path');",
  "const {stampSyntheticLock}=require('./tests/fixtures/commercial-evidence-lock-review-lab.cjs');",
  "fs.mkdirSync(path.join(process.argv[1],'writer.lock'));",
  "stampSyntheticLock({directory:process.argv[1]});",
  "process.exit(87);"
 ].join('\n');
 const crash=spawnSync(process.execPath,['-e',script,dir],{
  cwd:process.cwd(),encoding:'utf8'});
 if(crash.status!==87)throw Error('Child did not complete the synthetic exit');
 const options={directory:dir,chain,expectedPinnedHead:ZERO};
 const orphan=reviewOrphan(options).status;
 const noApproval=releaseReviewedOrphan({...options,review:null}).status;
 const approved=releaseReviewedOrphan({...options,review:{
  reviewerConfirmed:true,secondReviewerConfirmed:true,
  manualTicket:'LAB-TICKET-000001'}}).status;
 const resumed=createDurableLabCustodian(chain,{directory:dir})
  .publish({receipt,expectedHead:ZERO,requestId:'REQ-00000001'}).status;
 if(orphan!=='ORPHAN_REVIEW_REQUIRED'||noApproval!=='DUAL_REVIEW_REQUIRED'||
  approved!=='SIMULATED_MANUAL_LOCK_RELEASE'||resumed!=='COMMITTED')
  throw Error('Synthetic recovery failed');
 process.stdout.write([
  '# Vision — bloqueio abandonado após encerramento de processo fictício',
  '',
  '| Ensaio local | Resultado |',
  '|---|---|',
  '| Bloqueio órfão detectado | '+orphan+' |',
  '| Liberação sem revisão dupla | '+noApproval+' |',
  '| Liberação após revisão dupla simulada | '+approved+' |',
  '| Próxima gravação fictícia | '+resumed+' |',
  '',
  '**Processos, arquivos e dados:** exclusivamente temporários, removidos após ensaio.',
  '**Revisores, PID e referência de confiança:** simulação; não autenticados.',
  '**Supabase, staging, produção e deploy:** não autorizados.'
 ].join('\n')+'\n');
}catch{
 process.stderr.write('Synthetic lock review failed; no evidence contents emitted.\n');
 process.exitCode=1;
}finally{fs.rmSync(dir,{recursive:true,force:true})}
