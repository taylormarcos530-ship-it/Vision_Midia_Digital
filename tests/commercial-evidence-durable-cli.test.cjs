// OFFLINE LAB: disposable persistence report never prints private customer content.
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const cli='tests/tools/commercial-evidence-durable-report.cjs';
test('CLI demonstrates a persisted commit after the simulated ACK is lost',()=>{
 const result=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/ACK_LOST_AFTER_COMMIT/);
 assert.match(result.stdout,/ALREADY_COMMITTED/);
 assert.match(result.stdout,/Recibos recuperados \| 1/);
 assert.match(result.stdout,/não autorizados/);
});
test('report omits ledger contents, SHA256, tokens, request IDs and absolute paths',()=>{
 const result=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.doesNotMatch(result.stdout,/[a-f0-9]{64}|token=|Bearer |REQ-00000001|source_storage_path|\/tmp\//);
});
test('CLI only creates short-lived test artifacts, with no external input or deployment',()=>{
 const code=fs.readFileSync(cli,'utf8');
 assert.match(code,/OFFLINE LAB ONLY/);
 assert.match(code,/fs\.rmSync\(dir,\{recursive:true,force:true\}\)/);
 assert.doesNotMatch(code,/\b(?:fetch|https\.request|execFileSync|supabaseClient)\s*\(/);
 const result=spawnSync(process.execPath,[cli,'../../customer-backup.json'],{
  cwd:process.cwd(),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.doesNotMatch(result.stdout,/customer-backup/);
});
