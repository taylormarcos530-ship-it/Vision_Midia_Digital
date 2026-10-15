#!/usr/bin/env node
// OFFLINE LAB ONLY: writes a synthetic ledger exclusively to controlled OS temp.
// All published evidence is fictitious. No external data, network, staging or deploy.
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {buildChain}=require('../fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,ZERO}=require('../fixtures/commercial-evidence-external-anchor.cjs');
const {createDurableLabCustodian}=require('../fixtures/commercial-evidence-durable-lab.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-custody-durable-'));
try{
 const parent=path.resolve(__dirname,'../../docs/implementation');
 const load=name=>JSON.parse(fs.readFileSync(path.join(parent,name),'utf8'));
 const a=load('commercial-staging-evidence-template.json');
 const b=load('commercial-staging-evidence-lab-example.json');
 const chain=buildChain([
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:a},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:b},
  {sequence:3,recordedAt:'2026-10-15T12:15:00Z',form:structuredClone(b)}
 ]);
 const receipt=issueLabAnchor(chain,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
 const input={receipt,expectedHead:ZERO,requestId:'REQ-00000001'};
 const before=createDurableLabCustodian(chain,{directory:dir})
  .publish({...input,fault:'AFTER_RENAME_BEFORE_ACK'}).status;
 const restarted=createDurableLabCustodian(chain,{directory:dir});
 const duplicate=restarted.publish(input).status;
 const after=restarted.read();
 if(before!=='ACK_LOST_AFTER_COMMIT'||duplicate!=='ALREADY_COMMITTED'||
   after.count!==1||after.head!==receipt.receiptHash)
  throw new Error('Durability simulation was not consistent');
 process.stdout.write([
  '# Vision — persistência de evidências sintéticas',
  '',
  '| Ensaio local | Resultado |',
  '|---|---|',
  '| Confirmação perdida após gravação | '+before+' |',
  '| Reinicialização e repetição | '+duplicate+' |',
  '| Recibos recuperados | '+after.count+' |',
  '',
  '**Disco:** apenas pasta temporária fictícia, descartada ao fim do comando.',
  '**Custódia externa, staging, restauração real e produção:** não autorizados.',
  '**Limite:** fsync e rename locais não simulam todas as falhas físicas, sistemas de arquivos ou redes.'
 ].join('\n')+'\n');
}catch{
 process.stderr.write('Synthetic durable report failed; no raw ledger emitted.\n');
 process.exitCode=1;
}finally{fs.rmSync(dir,{recursive:true,force:true})}
