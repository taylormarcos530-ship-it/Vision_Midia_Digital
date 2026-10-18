'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const guard=path.resolve('scripts/verify-vercel-homologation.cjs');
const branch='fix/advertiser-portal-safety-20261013';
const addition='  "git": {\n    "deploymentEnabled": {\n      "'+branch+'": false\n    }\n  },\n';
const source=fs.readFileSync('vercel.json','utf8');
const baseline=source.replace(addition,'');
const approved=baseline.replace('{\n','{\n'+addition);
function run(content,kind='file'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vision-vercel-guard-'));
 try{
  if(kind==='file')fs.writeFileSync(path.join(dir,'vercel.json'),content);
  if(kind==='directory')fs.mkdirSync(path.join(dir,'vercel.json'));
  if(kind==='symlink'){
   fs.writeFileSync(path.join(dir,'target.json'),content);
   fs.symlinkSync('target.json',path.join(dir,'vercel.json'));
  }
  const result=spawnSync(process.execPath,[guard],{cwd:dir,encoding:'utf8'});
  if(result.status!==0)assert.match(result.stderr,/BLOCKED: vercel configuration/,result.stderr);
  return result;
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('repository disables only the homologation branch',()=>{
 assert.deepEqual(JSON.parse(source).git,{deploymentEnabled:{[branch]:false}});
});
test('guard accepts the exact reviewed configuration',()=>{
 const r=run(approved);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PASS/);
});
test('guard rejects removal of deployment block',()=>assert.notEqual(run(baseline).status,0));
test('guard rejects enabling deployments',()=>assert.notEqual(run(approved.replace('": false\n','": true\n')).status,0));
test('guard rejects blocking main instead of the review branch',()=>assert.notEqual(run(approved.replace(branch,'main')).status,0));
test('guard rejects a wildcard affecting unrelated branches',()=>assert.notEqual(run(approved.replace(branch,'*')).status,0));
test('guard rejects a change to existing routing configuration',()=>assert.notEqual(run(approved.replace('"cleanUrls": false','"cleanUrls": true')).status,0));
test('guard rejects malformed JSON',()=>assert.notEqual(run('{bad json').status,0));
test('guard rejects a missing configuration file',()=>assert.notEqual(run('', 'missing').status,0));
test('guard rejects a symlink even when its content matches',()=>assert.notEqual(run(approved,'symlink').status,0));
test('guard rejects a directory in place of the configuration',()=>assert.notEqual(run('','directory').status,0));
test('all seven existing protection workflows invoke the strict guard',()=>{
 const names=['advertiser-portal-safety','commercial-fair-visual-chromium',
  'commercial-storage-signed-cache-browser','commercial-postgres-multisession-lab',
  'commercial-portal-sanitized-chromium','vision-diagnostic-android-tv-emulator','vision-diagnostic-apk'];
 for(const name of names){
  const text=fs.readFileSync('.github/workflows/'+name+'.yml','utf8');
  assert.match(text,/node scripts\/verify-vercel-homologation\.cjs/,name);
  for(const protectedPath of ['player.js','android-player/','config.js','sw.js','netlify.toml'])assert.ok(text.includes(protectedPath),name+': '+protectedPath);
 }
});
