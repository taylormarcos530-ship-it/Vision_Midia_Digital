// OFFLINE LAB: sanitized process-exit and manual review demonstration only.
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const cli='tests/tools/commercial-evidence-lock-review-report.cjs';
test('local demonstration detects dead lock, rejects missing approval and safely resumes',()=>{
 const x=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(x.status,0,x.stderr);
 assert.match(x.stdout,/ORPHAN_REVIEW_REQUIRED/);
 assert.match(x.stdout,/DUAL_REVIEW_REQUIRED/);
 assert.match(x.stdout,/SIMULATED_MANUAL_LOCK_RELEASE/);
 assert.match(x.stdout,/COMMITTED/);
 assert.match(x.stdout,/não autorizados/);
 assert.equal(x.stderr,'');
});
test('safe output never prints owner PID, SHA256, ticket, credential or storage object',()=>{
 const x=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(x.status,0,x.stderr);
 assert.doesNotMatch(x.stdout,/[0-9a-f]{64}|Bearer |token=|LAB-TICKET-|REQ-|source_storage_path|\/tmp\//);
});
test('only disposable local child process and temporary directory are used',()=>{
 const source=fs.readFileSync(cli,'utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.match(source,/fs\.rmSync\(dir,\{recursive:true,force:true\}\)/);
 assert.doesNotMatch(source,/\b(?:fetch|axios|https\.request|supabaseClient|execFileSync)\s*\(/);
 const x=spawnSync(process.execPath,[cli,'../../private-customer.json'],{
  cwd:process.cwd(),encoding:'utf8'});
 assert.equal(x.status,0,x.stderr);
 assert.doesNotMatch(x.stdout,/private-customer/);
});
