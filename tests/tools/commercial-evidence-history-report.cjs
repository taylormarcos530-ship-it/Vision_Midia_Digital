#!/usr/bin/env node
// OFFLINE LAB ONLY. No input paths, uploads, connections, writes or deployments.
// This example is NOT an authenticated or append-only historical ledger.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {inspectHistory,renderHistory}=require('../fixtures/commercial-evidence-history.cjs');
try{
 const folder=path.resolve(__dirname,'../../docs/implementation');
 const load=name=>JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));
 const snapshots=[
  {sequence:1,recordedAt:'2026-10-15T12:05:00Z',
   form:load('commercial-staging-evidence-template.json')},
  {sequence:2,recordedAt:'2026-10-15T12:10:00Z',
   form:load('commercial-staging-evidence-lab-example.json')}
 ];
 const x=inspectHistory(snapshots);
 if(!x.structurallyConsistent||x.stagingOriginVerified||x.canDeployToProduction)
  throw Error('Synthetic audit contract is not safe');
 process.stdout.write(renderHistory(x));
}catch{
 process.stderr.write('Synthetic history report unavailable; no raw data emitted.\n');
 process.exitCode=1;
}
