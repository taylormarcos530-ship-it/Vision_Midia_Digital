const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=path=>fs.readFileSync(require('node:path').join(__dirname,'..',path),'utf8');
test('Rede Vision: new PWA JavaScript parses',()=>{
 for(const path of ['pontos.js','master-pontos.js']){
   assert.doesNotThrow(()=>new vm.Script(source(path),{filename:path}));
 }
});
test('Rede Vision: catalog and Master navigation are isolated',()=>{
 assert.match(source('master.html'),/href="\.\/master-pontos\.html"/);
 assert.match(source('pontos.html'),/pontos\.js/);
 assert.match(source('master-pontos.html'),/master-pontos\.js/);
 assert.match(source('vercel.json'),/"source": "\/pontos"/);
});
test('Rede Vision: published rows and physically paired TVs only',()=>{
 const code=source('supabase/functions/vision-network-points/index.ts');
 assert.match(code,/\.eq\('published',true\)/);
 assert.match(code,/consent_confirmed_at/);
 assert.match(code,/!d\.retired_at&&d\.paired_at&&!privateTv\(d\.name\)/);
 assert.match(code,/publication_requires_consent_and_location/);
 assert.match(code,/tv_not_eligible_for_public_catalog/);
 assert.match(code,/master_only/);
});
test('Rede Vision: new tables are private by default',()=>{
 const sql=source('supabase/migrations/20261021220000_vision_network_points_v1.sql');
 assert.match(sql,/vision_network_points enable row level security/);
 assert.match(sql,/vision_network_point_tvs enable row level security/);
 assert.match(sql,/revoke all on public\.vision_network_points from public,anon,authenticated/);
 assert.match(sql,/revoke all on public\.vision_network_point_tvs from public,anon,authenticated/);
 assert.doesNotMatch(sql,/create policy|grant select on public\.vision_network_points to anon/i);
});
test('Rede Vision: no TV player, playlist or payment mutation',()=>{
 const code=source('supabase/functions/vision-network-points/index.ts');
 const sql=source('supabase/migrations/20261021220000_vision_network_points_v1.sql');
 for(const text of [code,sql]){
   assert.doesNotMatch(text,/(?:update|delete|insert)\s+(?:into|from)?\s*public\.(?:devices|playlist_items|playlists|company_subscriptions)/i);
 }
});
test('Rede Vision: WhatsApp enquiry requires a configured valid number',()=>{
 const code=source('pontos.js');
 assert.match(code,/https:\/\/wa\.me\//);
 assert.match(code,/encodeURIComponent\(text\)/);
 assert.match(code,/\^55\\d\{10,11\}\$/);
});
