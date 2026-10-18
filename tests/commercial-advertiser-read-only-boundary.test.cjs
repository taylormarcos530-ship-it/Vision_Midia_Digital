// Offline access-boundary contract: the advertiser can view advertising results,
// but only the authenticated Master can publish campaigns. Customer playlist
// uploads must remain separate from commercial campaign submissions.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');
test('advertiser pages are report-only, including staging',()=>{
 const browser=read('advertiser-portal.mjs');
 assert.match(browser,/rpc\('vision_advertiser_portal'\)/);
 assert.doesNotMatch(browser,/masterCall|commercial_save_campaign|storage\.from|\.upload\(|type=['"]file['"]/);
 for(const page of ['anunciante.html','anunciante-homologacao.html']){
  const html=read(page);
  assert.match(html,/id="advertiser-read-only-note"/);
  assert.match(html,/O painel não permite enviar anúncios/);
  assert.match(html,/Você não pode carregar, substituir ou publicar anúncios por esta conta/);
  assert.doesNotMatch(html,/<input[^>]+type=['"]file['"]|<form[^>]+enctype=['"]multipart\/form-data/);
 }
});
test('the test uploader is local and cannot upload to storage or publish ads',()=>{
 const page=read('commercial-tv-media-player.html');
 const code=read('commercial-tv-media-ui.mjs');
 assert.match(page,/Este seletor é apenas para testes locais/);
 assert.match(page,/connect-src 'none'/);
 assert.match(code,/URL\.createObjectURL/);
 assert.doesNotMatch(code,/\bfetch\(|XMLHttpRequest|\.upload\(|masterCall|storage\.from|WebSocket/);
});
test('database explicitly withholds commercial write grants from advertiser sessions',()=>{
 const sql=read('supabase/sql/advertiser-portal.sql');
 assert.match(sql,/revoke all on public\.vision_advertisers,public\.vision_commercial_campaigns,public\.vision_commercial_revisions,public\.vision_commercial_targets,public\.vision_commercial_daily from public,anon,authenticated;/i);
 assert.match(sql,/grant select on public\.vision_advertisers,public\.vision_commercial_campaigns,public\.vision_commercial_revisions,public\.vision_commercial_targets,public\.vision_commercial_daily to authenticated;/i);
 assert.match(sql,/revoke all on function public\.vision_commercial_save_campaign\(uuid,jsonb\) from public,anon,authenticated;/i);
 assert.match(sql,/grant execute on function public\.vision_commercial_save_campaign\(uuid,jsonb\) to service_role;/i);
 const mediaPolicy=read('supabase/migrations/20260908034737_enforce_storage_plan_quota_rls.sql');
 assert.match(mediaPolicy,/private\.has_company_role_text\(company_text, array\['owner','admin','operator'\]/);
});
test('Master permission check denies advertiser and point-owner roles before any database call',async()=>{
 const {commercialMaster}=await import('../supabase/functions/_shared/commercial-master.mjs');
 let touched=false;
 const admin=new Proxy({}, {get(){touched=true;throw Error('database_never_expected')}});
 for(const role of ['advertiser','owner','operator','viewer',null,undefined]){
  await assert.rejects(()=>commercialMaster(admin,{id:'lab-user'},role,{action:'commercial_save_campaign',campaign:{media_id:'x'}}),
   e=>e?.status===403&&e.message==='master_forbidden');
 }
 assert.equal(touched,false);
});
test('the Master UI claims exactly its own commercial management role',()=>{
 for(const page of ['master-advertisers.html','master-advertisers-homologacao.html']){
  const html=read(page);
  assert.match(html,/Somente o Master Vision administra as campanhas comerciais/);
  assert.match(html,/o estabelecimento continua gerenciando suas próprias mídias e playlists/);
 }
 const gateway=read('supabase/functions/device-gateway/index.ts');
 assert.match(gateway,/commercialPilotDeviceAllowed\(device.id/);
 assert.match(gateway,/VISION_COMMERCIAL_PILOT_DEVICE_IDS/);
});
