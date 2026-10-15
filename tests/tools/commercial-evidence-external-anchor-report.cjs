#!/usr/bin/env node
// OFFLINE LAB ONLY. Two synthetic anchors, including a simulated in-memory pin.
// Not independent custody: all records and the pin are in the same test process.
// No file arguments, remote connection, key material, file writes or deployment.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {buildChain}=require('../fixtures/commercial-evidence-hash-chain.cjs');
const {issueLabAnchor,verifyLabAnchors,renderLabAnchorReport}
 =require('../fixtures/commercial-evidence-external-anchor.cjs');
try{
 const home=path.resolve(__dirname,'../../docs/implementation');
 const read=name=>JSON.parse(fs.readFileSync(path.join(home,name),'utf8'));
 const base=read('commercial-staging-evidence-template.json');
 const withLabReference=read('commercial-staging-evidence-lab-example.json');
 const history=[
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',form:base},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',form:withLabReference},
  {sequence:3,recordedAt:'2026-10-15T12:15:00Z',form:structuredClone(withLabReference)}
 ];
 const chain=buildChain(history);
 const first=issueLabAnchor(chain,{recordCount:2,stampedAt:'2026-10-15T12:11:00Z'});
 const last=issueLabAnchor(chain,{previous:first,recordCount:3,stampedAt:'2026-10-15T12:16:00Z'});
 const result=verifyLabAnchors(chain,[first,last],{
  independentlyHeldDigest:last.receiptHash // LAB SIMULATION, not actually independent!
 });
 if(!result.locallyConsistent||result.independentAnchorAuthenticityVerified||
   result.canConnectStaging||result.canDeployToProduction)
  throw new Error('Unsafe synthetic receipt comparison');
 process.stdout.write(renderLabAnchorReport(result));
 process.stdout.write('\n**Nota:** a referência deste comando está somente na memória da simulação, NÃO sob custódia independente.\n');
}catch{
 process.stderr.write('Synthetic anchor comparison failed; no raw evidence emitted.\n');
 process.exitCode=1;
}
