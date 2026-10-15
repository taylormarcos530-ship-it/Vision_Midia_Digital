// OFFLINE LAB ONLY: fixed demonstration never reads external files or discloses bytes.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const cli='tests/tools/commercial-evidence-custodian-fault-report.cjs';
test('fixed command demonstrates outage, stale concurrent writer, backup rollback and recovery',()=>{
 const result=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/CONFLICT_STALE_HEAD/);
 assert.match(result.stdout,/UNAVAILABLE/);
 assert.match(result.stdout,/INDEPENDENT_HEAD_MISMATCH/);
 assert.match(result.stdout,/MANUAL_REVIEW_ONLY/);
 assert.match(result.stdout,/não autorizados/);
});
test('safe output does not expose hashes, opaque request IDs or media paths',()=>{
 const result=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.doesNotMatch(result.stdout,/[a-f0-9]{64}|REQ-0000000|Bearer |token=|source_storage_path/);
});
test('command remains read only; arbitrary path argument is inert',()=>{
 const source=fs.readFileSync(cli,'utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(source,/\b(?:fetch|writeFileSync|execFileSync|spawn|https\.request)\s*\(/);
 const result=spawnSync(process.execPath,[cli,'../../private-data.json'],{
  cwd:process.cwd(),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.doesNotMatch(result.stdout,/private-data/);
});
