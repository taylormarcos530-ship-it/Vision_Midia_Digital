// OFFLINE LAB: read-only history report does not expose source bytes or credentials.
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const cli='tests/tools/commercial-evidence-history-report.cjs';
test('read-only command reports two synthetic snapshots with no structural alarms',()=>{
 const x=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(x.status,0,x.stderr);
 assert.match(x.stdout,/SEM ALERTAS/);
 assert.match(x.stdout,/\| 2 \| 2026-10-15T12:10:00Z \| 1 \| 0 \| 2 \|/);
 assert.match(x.stdout,/2026-10-15T12:05:00Z/);
 assert.match(x.stdout,/2026-10-15T12:10:00Z/);
 assert.match(x.stdout,/Autorização para staging, mudanças em SQL e produção:\*\* nenhuma/);
 assert.equal(x.stderr,'');
});
test('command does not print SHA, signed tokens or customer details',()=>{
 const x=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(x.status,0,x.stderr);
 assert.doesNotMatch(x.stdout,/3c3f14fb|source_storage_path|\/storage\/v1|token=/);
});
test('report command cannot accept alternate paths and uses synthetic fixtures only',()=>{
 const code=fs.readFileSync(cli,'utf8');
 assert.match(code,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(code,/\b(?:writeFileSync|https\.request|fetch|execFileSync)\s*\(/);
 const x=spawnSync(process.execPath,[cli,'../unexpected-file.json'],{
  cwd:process.cwd(),encoding:'utf8'});
 assert.equal(x.status,0);
 assert.match(x.stdout,/SEM ALERTAS/);
});
