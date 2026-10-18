const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const code=fs.readFileSync('supabase/functions/commercial-staging-master/index.ts','utf8');
const html=fs.readFileSync('master-advertisers-homologacao.html','utf8');
const ui=fs.readFileSync('master-advertisers-staging.mjs','utf8');
const load=()=>import('../supabase/functions/_shared/commercial-staging-storage-probe.mjs');

function mock({copyError=false,corrupt=false,removeError=false}={}){
 const calls=[];
 const content=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO97GrEAAAAASUVORK5CYII='),x=>x.charCodeAt(0));
 const bucket={
  async upload(path,raw,opts){calls.push('upload');assert.match(path,/^qa-commercial-probe\/[a-f0-9-]+\.png$/);assert.equal(opts.upsert,false);assert.equal(raw.length,content.length);return {error:null}},
  async copy(src,dst){calls.push('copy');assert.match(dst,/^commercial-ads\/[a-f0-9-]+\.png$/);return {error:copyError?new Error('copy'):null}},
  async createSignedUrl(){calls.push('sign');return {data:{signedUrl:'https://staging-only.example.test/signed'},error:null}},
  async remove(paths){calls.push('remove');assert.equal(paths.length,2);return {error:removeError?new Error('remove'):null}}
 };
 const admin={storage:{from(name){assert.equal(name,'vision-media');return bucket}}};
 const fetcher=async(url)=>{calls.push('fetch');assert.match(url,/staging-only/);return {ok:true,async arrayBuffer(){return corrupt?Uint8Array.of(1).buffer:content.buffer}}};
 return {admin,fetcher,calls};
}
test('Master-only staging endpoint cannot be triggered before role check and has environment guard',()=>{
 assert.match(code,/if\(url!==STAGING_URL\)/);
 assert.match(code,/if\(!master\|\|master\.status!=='active'/);
 const role=code.indexOf("if(!master||master.status!=='active'"),call=code.indexOf("if(action==='commercial_storage_probe')");
 assert(role>=0&&call>role);
 assert.match(code,/await stagingStorageProbe\(admin\)/);
 assert.doesNotMatch(code,/fpadgedrgcxrrqflzhjt/);
 assert.match(html,/id="staging-storage-probe"/);
 assert.match(ui,/commercial_storage_probe/);
});
test('real byte protocol: upload + copy + signed GET + cleanup in that order',async()=>{
 const p=mock();
 const r=await (await load()).stagingStorageProbe(p.admin,p.fetcher);
 assert.equal(r.ok,true);assert.equal(r.cleanup_verified,true);
 assert.deepEqual(p.calls,['upload','copy','sign','fetch','remove']);
});
test('copy error and corrupted bytes cannot falsely pass, and both clean up',async()=>{
 for(const options of [{copyError:true},{corrupt:true}]){
  const p=mock(options);
  await assert.rejects(()=>load().then(m=>m.stagingStorageProbe(p.admin,p.fetcher)),/staging_storage_probe/);
  assert.equal(p.calls.at(-1),'remove');
 }
});
test('cleanup failure cannot be reported as success',async()=>{
 const p=mock({removeError:true});
 await assert.rejects(()=>load().then(m=>m.stagingStorageProbe(p.admin,p.fetcher)),/cleanup_failed/);
 assert.equal(p.calls.at(-1),'remove');
});
