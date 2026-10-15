// OFFLINE LAB ONLY: the report utility emits no secret-bearing raw payloads.
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cli='tests/tools/commercial-staging-evidence-report.cjs';
test('read-only CLI converts the default 17 gate template to a redacted report',()=>{
 const p=spawnSync(process.execPath,[cli],{cwd:process.cwd(),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
 assert.match(p.stdout,/BLOQUEADO \/ NÃO HOMOLOGADO/);
 assert.match(p.stdout,/SQL-01 \| BLOCKED/);
 assert.match(p.stdout,/SQL-02 \| BLOCKED/);
 assert.match(p.stdout,/Evidências registradas:\*\* 0/);
 assert.doesNotMatch(p.stdout,/Bearer |token=|private-owner/);
 assert.equal(p.stderr,'');
});
test('explicit repository-local JSON input produces the same output',()=>{
 const base=spawnSync(process.execPath,[cli],{encoding:'utf8',cwd:process.cwd()});
 const separate=spawnSync(process.execPath,[cli,'docs/implementation/commercial-staging-evidence-template.json'],
  {encoding:'utf8',cwd:process.cwd()});
 assert.equal(separate.status,0);
 assert.equal(separate.stdout,base.stdout);
});
test('invalid JSON fails closed and never echoes bearer or signed URL',()=>{
 const dir=fs.mkdtempSync(path.join(process.cwd(),'tests','fixtures','invalid-evidence-'));
 try{
  const file=path.join(dir,'private.json');
  fs.writeFileSync(file,'{"jwt":"Bearer synthetic-lab-token","signedURL":"https://invalid/?token=fixture"}');
  const result=spawnSync(process.execPath,[cli,path.relative(process.cwd(),file)],
   {encoding:'utf8',cwd:process.cwd()});
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/Evidence form unavailable or invalid/);
  assert.doesNotMatch(result.stderr,/Bearer |token=|signedURL|synthetic-lab-token/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('traversal or out-of-repository evidence path is rejected without exposing filename',()=>{
 const input='../outside-private-report.json';
 const result=spawnSync(process.execPath,[cli,input],{encoding:'utf8',cwd:process.cwd()});
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.doesNotMatch(result.stderr,/outside-private-report/);
});
test('report tool remains inert and explicitly denies network and filesystem writes',()=>{
 const source=fs.readFileSync(cli,'utf8');
 assert.match(source,/OFFLINE LAB ONLY/);
 assert.doesNotMatch(source,/\b(?:fetch|https\.request|execFileSync|writeFileSync)\s*\(/);
 assert.match(source,/process\.stdout\.write\(render\(data\)\)/);
});
