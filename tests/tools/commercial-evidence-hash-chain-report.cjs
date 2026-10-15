#!/usr/bin/env node
// OFFLINE LAB ONLY. Read two fixed, synthetic snapshots; no external paths or APIs.
// Neither this script nor its internally built head is a trusted external anchor.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {buildChain,verifyChain,renderChainReport}
 =require('../fixtures/commercial-evidence-hash-chain.cjs');
try{
 const base=path.resolve(__dirname,'../../docs/implementation');
 const load=file=>JSON.parse(fs.readFileSync(path.join(base,file),'utf8'));
 const snapshots=[
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',
   form:load('commercial-staging-evidence-template.json')},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',
   form:load('commercial-staging-evidence-lab-example.json')}
 ];
 const chain=buildChain(snapshots);
 const verdict=verifyChain(chain);
 if(!verdict.chainConsistent||verdict.stagingProvenanceVerified||
   verdict.canConnectStaging||verdict.canDeployToProduction)
  throw new Error('Unsafe synthetic audit');
 process.stdout.write(renderChainReport(verdict));
}catch{
 process.stderr.write('Synthetic chain verification failed; no source data emitted.\n');
 process.exitCode=1;
}
