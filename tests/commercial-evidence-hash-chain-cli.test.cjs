// OFFLINE LAB ONLY: a fixed local report must not expose raw forms or hashes.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const cli='tests/tools/commercial-evidence-hash-chain-report.cjs';
test('read-only CLI prints a safe synthetic chain status without an external anchor',()=>{
 const p=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 assert.match(p.stdout,/ÍNTEGRA NO LABORATÓRIO/);
 assert.match(p.stdout,/Referência externa:\*\* não fornecida/);
 assert.match(p.stdout,/Deploy e conexões reais:\*\* não autorizados/);
 assert.equal(p.stderr,'');
});
test('report omits raw SHA256, commercial media paths and credentials',()=>{
 const p=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 assert.doesNotMatch(p.stdout,/[a-f0-9]{64}|token=|Bearer |source_storage_path|\/storage\/v1/);
 assert.match(p.stdout,/cadeia interna íntegra não impede reescrita completa/);
});
test('fixed fixture command has no filesystem write, subprocess or remote call',()=>{
 const text=fs.readFileSync(cli,'utf8');
 assert.match(text,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(text,/\b(?:fetch|writeFileSync|execFileSync|spawn|https\.request)\s*\(/);
 const p=spawnSync(process.execPath,[cli,'../outside-secrets.json'],
  {cwd:process.cwd(),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 assert.doesNotMatch(p.stdout,/outside-secrets/);
});
