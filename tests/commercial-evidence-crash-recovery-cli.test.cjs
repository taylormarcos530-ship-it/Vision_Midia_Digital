// OFFLINE LAB: command only renders synthetic interrupted-process recovery statuses.
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const cli='tests/tools/commercial-evidence-crash-recovery-report.cjs';
test('CLI reproduces real process exit after rename, then idempotent retry',()=>{
 const x=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(x.status,0,x.stderr);
 assert.match(x.stdout,/EXIT_77/);
 assert.match(x.stdout,/Recibos persistidos \| 1/);
 assert.match(x.stdout,/DUAL_REVIEW_REQUIRED/);
 assert.match(x.stdout,/SIMULATED_MANUAL_LOCK_RELEASE/);
 assert.match(x.stdout,/ALREADY_COMMITTED/);
 assert.equal(x.stderr,'');
});
test('CLI response contains no hashes, token, original media or absolute temp path',()=>{
 const x=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(x.status,0,x.stderr);
 assert.doesNotMatch(x.stdout,/[a-f0-9]{64}|Bearer |token=|source_storage_path|\/tmp\/|LAB-TICKET-|REQ-/);
});
test('CLI ignores outside file path arguments and leaves operational services untouched',()=>{
 const source=fs.readFileSync(cli,'utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.match(source,/fs\.rmSync\(dir,\{recursive:true,force:true\}\)/);
 assert.doesNotMatch(source,/\b(?:fetch|axios|https\.request|supabaseClient|execFileSync)\s*\(/);
 const x=spawnSync(process.execPath,[cli,'../../private-customer.json'],{
  cwd:process.cwd(),encoding:'utf8'});
 assert.equal(x.status,0,x.stderr);
 assert.doesNotMatch(x.stdout,/private-customer/);
});
