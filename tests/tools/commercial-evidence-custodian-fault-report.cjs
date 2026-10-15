#!/usr/bin/env node
// OFFLINE LAB ONLY: fixed synthetic failure trace, no input paths or credentials.
// This is NOT an independent custodian, approval, disaster-recovery system or deploy.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {buildChain}=require('../fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('../fixtures/commercial-evidence-external-anchor.cjs');
const {createLabCustodian}=require('../fixtures/commercial-evidence-custodian-faults.cjs');
try{
 const dir=path.resolve(__dirname,'../../docs/implementation');
 const data=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
 const a=data('commercial-staging-evidence-template.json');
 const b=data('commercial-staging-evidence-lab-example.json');
 const chain=buildChain([
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:a},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:b},
  {sequence:3,recordedAt:'2026-10-15T12:15:00Z',form:structuredClone(b)}
 ]);
 const first=issueLabAnchor(chain,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
 const second=issueLabAnchor(chain,{previous:first,recordCount:3,
  stampedAt:'2026-10-15T12:16:00Z'});
 const lab=createLabCustodian(chain);
 const initial=lab.publish({role:'WRITER',receipt:first,
  expectedHead:ZERO,requestId:'REQ-00000001'}).status;
 const old=lab.snapshot({role:'REVIEWER'}).snapshot;
 const race=lab.publish({role:'WRITER',receipt:second,
  expectedHead:ZERO,requestId:'REQ-00000002'}).status;
 lab.availability({role:'OPERATOR',online:false});
 const unavailable=lab.publish({role:'WRITER',receipt:second,
  expectedHead:first.receiptHash,requestId:'REQ-00000002'}).status;
 lab.availability({role:'OPERATOR',online:true});
 const resumed=lab.publish({role:'WRITER',receipt:second,
  expectedHead:first.receiptHash,requestId:'REQ-00000002'}).status;
 const rollback=lab.inspectBackup({role:'REVIEWER',backup:old,
  independentlyHeldDigest:second.receiptHash}).status;
 const latest=lab.inspectBackup({role:'REVIEWER',
  backup:lab.snapshot({role:'REVIEWER'}).snapshot,
  independentlyHeldDigest:second.receiptHash}).status;
 if(initial!=='COMMITTED'||race!=='CONFLICT_STALE_HEAD'||
  unavailable!=='UNAVAILABLE'||resumed!=='COMMITTED'||
  rollback!=='INDEPENDENT_HEAD_MISMATCH'||latest!=='MANUAL_REVIEW_ONLY'||
  lab.canConnectStaging||lab.canDeployToProduction)
  throw Error('Synthetic contract failed');
 const report=[
  '# Vision — falhas do guardião fictício',
  '',
  '| Ensaio offline | Resultado esperado e observado |',
  '|---|---|',
  '| Primeira gravação | '+initial+' |',
  '| Gravação concorrente com cabeça antiga | '+race+' |',
  '| Gravação com guardião indisponível | '+unavailable+' |',
  '| Nova tentativa após recuperação | '+resumed+' |',
  '| Backup antigo com cabeça preservada | '+rollback+' |',
  '| Backup atual, apenas para revisão | '+latest+' |',
  '',
  '**Staging, Supabase, TV, deploy e restauração automática:** não autorizados.',
  '**Limite:** guardião e cabeça externa são somente objetos na mesma memória do teste.'
 ].join('\n')+'\n';
 process.stdout.write(report);
}catch{
 process.stderr.write('Synthetic custodian trace unavailable; no sensitive data printed.\n');
 process.exitCode=1;
}
