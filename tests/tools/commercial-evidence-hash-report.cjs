#!/usr/bin/env node
// OFFLINE LAB ONLY. Read-only check of committed synthetic evidence and its SHA256.
// Never accepts arbitrary paths, production files, account tokens or network URLs.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {verifyLocalFixtureHashes,renderIntegrity}
 =require('../fixtures/commercial-evidence-integrity.cjs');
try{
 const file=path.resolve(__dirname,'../../docs/implementation/commercial-staging-evidence-lab-example.json');
 const form=JSON.parse(fs.readFileSync(file,'utf8'));
 const result=verifyLocalFixtureHashes(form);
 if(result.total!==1||result.totals.MATCH!==1||
   result.totals.MISMATCH||result.totals.MISSING||result.totals.REJECTED)
  throw Error('Fixture does not match its declared digest');
 process.stdout.write(renderIntegrity(result));
}catch{
 // Never echo arbitrary source file content or secret-bearing errors to stdout.
 process.stderr.write('Synthetic evidence verification failed; no sensitive content printed.\n');
 process.exitCode=1;
}
