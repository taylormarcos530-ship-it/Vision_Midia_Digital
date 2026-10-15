#!/usr/bin/env node
// OFFLINE LAB ONLY: render validated opaque evidence references, never raw artifacts.
// No network, staging access, file mutation, migration, player or deployment actions.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {render}=require('../fixtures/commercial-staging-evidence.cjs');
function run(){
 try{
  const root=process.cwd();
  const arg=process.argv[2]||'docs/implementation/commercial-staging-evidence-template.json';
  const file=path.resolve(root,arg);
  if(file!==path.join(root,'docs/implementation/commercial-staging-evidence-template.json')&&
    (!file.startsWith(root+path.sep)||path.extname(file)!=='.json'))
   throw Error('Invalid local file reference');
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>128*1024)throw Error('File too large');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  process.stdout.write(render(data)); // Renderer emits only opaque EV references.
 }catch{
  // Never echo a malformed payload, file content, request URL or credential to logs.
  process.stderr.write('Evidence form unavailable or invalid. No report generated.\n');
  process.exitCode=1;
 }
}
run();
