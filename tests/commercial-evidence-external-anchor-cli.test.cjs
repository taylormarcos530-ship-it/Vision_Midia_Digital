// OFFLINE LAB: demonstrate receipt comparison while disclaiming independent custody.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const cli='tests/tools/commercial-evidence-external-anchor-report.cjs';
test('the local command reports matching synthetic anchor without implying a real custodian',()=>{
 const p=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 assert.match(p.stdout,/CONSISTENTE NO LABORATÓRIO/);
 assert.match(p.stdout,/digest confere, procedência NÃO certificada/);
 assert.match(p.stdout,/NÃO sob custódia independente/);
 assert.match(p.stdout,/Staging e produção:\*\* não autorizados/);
 assert.equal(p.stderr,'');
});
test('the local report contains no full SHA256, bearer, signed URL or original media',()=>{
 const p=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 assert.doesNotMatch(p.stdout,/[a-f0-9]{64}|Bearer |token=|source_storage_path|\/storage\/v1/);
});
test('the reporting CLI is fixed-input and never invokes a remote or write capability',()=>{
 const source=fs.readFileSync(cli,'utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(source,/\b(?:fetch|writeFileSync|execFileSync|spawn|https\.request)\s*\(/);
 const withArgument=spawnSync(process.execPath,[cli,'../private-customer-file.json'],
  {cwd:process.cwd(),encoding:'utf8'});
 assert.equal(withArgument.status,0,withArgument.stderr);
 assert.doesNotMatch(withArgument.stdout,/private-customer-file/);
});
