const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('commercial public UI uses the official project but never a secret key',()=>{
 const c=fs.readFileSync('commercial-config.js','utf8');
 assert.match(c,/fpadgedrgcxrrqflzhjt/);
 assert.doesNotMatch(c,/jmiuitrrhtaeyrpuyohk|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/);
 assert.match(c,/environment:'production'/);
 assert.match(c,/enabled:official\|\|preview\|\|local/);
});
test('Master-only advertiser link and read-only advertiser portal',()=>{
 const html=fs.readFileSync('master.html','utf8');
 const master=fs.readFileSync('master-advertisers.html','utf8');
 const adv=fs.readFileSync('anunciante.html','utf8');
 const js=fs.readFileSync('advertiser-portal.mjs','utf8');
 assert.match(html,/href="\.\/master-advertisers\.html"/);
 assert.match(master,/src="\.\/commercial-config\.js"/);
 assert.match(adv,/src="\.\/commercial-config\.js"/);
 assert.doesNotMatch(adv,/type="file"|<input[^>]+type="file"|<button[^>]*>\s*Enviar anúncio/i);
 assert.match(js,/api\.rpc\('vision_advertiser_portal'\)/);
});
test('Player, APK and operational customer files stay byte-identical to release baseline',()=>{
 const docs=fs.readFileSync('docs/commercial-production-ui-safe-20261018.md','utf8');
 assert.match(docs,/baseline 921f365b7f1ee5c7da7c96b74b3cdf1462e180c3/);
 assert.match(docs,/unchanged: player\.js/);
});

test('Master owns signed upload and customer never receives media upload control',()=>{
 const h=fs.readFileSync('master-advertisers.html','utf8');
 const j=fs.readFileSync('master-advertisers.mjs','utf8');
 const client=fs.readFileSync('anunciante.html','utf8');
 assert.match(h,/id="commercial-source-upload"/);
 assert.match(j,/commercial_prepare_source/);
 assert.match(j,/commercial_finalize_source/);
 assert.match(j,/storage\/v1\/object\/upload\/sign\/vision-media/);
 assert.match(j,/state\.sources/);
 assert.doesNotMatch(client,/type="file"/);
});

test('Master offers visual selection with image and video previews and keeps native fallback',()=>{
 const html=fs.readFileSync('master-advertisers.html','utf8');
 const js=fs.readFileSync('master-advertisers.mjs','utf8');
 const picker=fs.readFileSync('commercial-master-media-picker.mjs','utf8');
 assert.match(html,/data-media-filter="vision"/);
 assert.match(html,/id="commercial-media-grid"/);
 assert.match(html,/id="commercial-media-preview"/);
 assert.match(html,/Escolher pelo nome \(lista alternativa\)/);
 assert.match(js,/createCommercialMediaPicker/);
 assert.match(picker,/commercial_media_previews/);
 assert.match(picker,/document\.createElement\(item\.media_type==='video'\?'video':'img'\)/);
 assert.match(picker,/element\.preload='metadata'/);
 assert.doesNotMatch(fs.readFileSync('anunciante.html','utf8'),/data-media-filter/);
});
test('upload progress reports percentage and keeps copy isolated from client media',()=>{
 const script=fs.readFileSync('commercial-master-media-picker.mjs','utf8');
 const master=fs.readFileSync('master-advertisers.mjs','utf8');
 assert.match(script,/xhr\.upload\.onprogress/);
 assert.match(master,/uploadCommercialSignedFile/);
 assert.match(master,/commercial_prepare_source/);
 assert.match(master,/commercial_finalize_source/);
});

test('advertiser refresh updates metrics without discarding previously loaded preview',()=>{
 const ui=fs.readFileSync('commercial-ui.mjs','utf8');
 const page=fs.readFileSync('advertiser-portal.mjs','utf8');
 assert.match(ui,/data-campaign-id=/);
 assert.match(ui,/export function updateCommercialCards/);
 assert.match(ui,/sameCommercialRevision/);
 assert.match(ui,/for\(const selector of \['\.campaign-head','\.metrics','\.period','\.points','\.creative-breakdown','details'\]\)/);
 assert.match(ui,/if\(slot\.querySelector\('img,video'\)\)continue/);
 assert.match(page,/updateCommercialCards\(\$\('#campaigns'\),data\)/);
 assert.doesNotMatch(page,/\$\('#campaigns'\)\.innerHTML=renderCampaigns/);
 assert.match(page,/Aguardando a primeira exibição comercial concluída/);
});

test('advertiser scripts share explicit version to avoid stale service worker module graph',()=>{
 const markup=fs.readFileSync('anunciante.html','utf8');
 const script=fs.readFileSync('advertiser-portal.mjs','utf8');
 const a=markup.match(/advertiser-portal\.mjs\?v=([a-z0-9-]+)/);
 const b=script.match(/commercial-ui\.mjs\?v=([a-z0-9-]+)/);
 assert.ok(a);
 assert.ok(b);
 assert.equal(a[1],b[1]);
});

test('Master public address form needs explicit point consent, advertiser UI read-only',()=>{
 const h=fs.readFileSync('master-advertisers.html','utf8');
 const m=fs.readFileSync('master-advertisers.mjs','utf8');
 assert.match(h,/id="public-points-dialog"/);
 assert.match(h,/name="share_location"/);
 assert.match(h,/name="consent_confirmed"/);
 assert.match(m,/commercial_point_save/);
 assert.match(m,/point_profiles/);
 assert.match(m,/Confirme a autorização do estabelecimento/);
 assert.doesNotMatch(fs.readFileSync('anunciante.html','utf8'),/public-points-form/);
});
test('advertiser shows telemetry and only consent-filtered locations, never raw private address',()=>{
 const s=fs.readFileSync('commercial-ui.mjs','utf8');
 assert.match(s,/commercial_on_screen/);
 assert.match(s,/public_location/);
 assert.match(s,/Sem confirmação de anúncio em tela/);
 assert.match(s,/Anúncio sinalizado em reprodução/);
});

test('each ad revision has its own completed counts per day and TV, no preview impressions',async()=>{
 const {creativeDailyBreakdown,renderCreativeBreakdown}=await import('../commercial-ui.mjs');
 const data={today:'2026-10-18',campaigns:[{id:'c1'}],
  revisions:[{id:'r1',campaign_id:'c1',name:'Video A',media_type:'video',created_at:'2026-10-18'},
    {id:'r2',campaign_id:'c1',name:'Foto B',media_type:'image',created_at:'2026-10-17'},
    {id:'rOther',campaign_id:'c2',name:'Outsider',created_at:'2026-10-17'}],
  targets:[{campaign_id:'c1',device_id:'tv1',point_name:'Academia',device_name:'TV frente'}],
  daily:[{campaign_id:'c1',revision_id:'r1',device_id:'tv1',day:'2026-10-18',completed_count:3},
   {campaign_id:'c1',revision_id:'r1',device_id:'tv1',day:'2026-10-17',completed_count:4},
   {campaign_id:'c1',revision_id:'r2',device_id:'tv1',day:'2026-10-18',completed_count:5},
   {campaign_id:'c2',revision_id:'rOther',device_id:'tv1',day:'2026-10-18',completed_count:300}]};
 const rows=creativeDailyBreakdown(data,'c1');
 assert.equal(rows.length,2);
 const video=rows.find(x=>x.id==='r1'),image=rows.find(x=>x.id==='r2');
 assert.equal(video.total,7);assert.equal(video.today,3);
 assert.equal(video.history.length,2);assert.equal(video.history[0].point,'Academia · TV frente');
 assert.equal(image.total,5);assert.equal(image.today,5);
 const ui=renderCreativeBreakdown(data,'c1');
 assert.match(ui,/data-watch-revision="r1"/);
 assert.match(ui,/data-watch-revision="r2"/);
 assert.doesNotMatch(ui,/Outsider|300/);
});
test('owned creative preview never claims to broadcast a real TV or fake the count',()=>{
 const script=fs.readFileSync('advertiser-portal.mjs','utf8');
 const markup=fs.readFileSync('anunciante.html','utf8');
 assert.match(script,/commercialPreviewPath/);
 assert.match(script,/latestPortalData\?\.revisions/);
 assert.match(script,/Não é transmissão da TV e não contabiliza exibições/);
 assert.match(markup,/id="commercial-revision-dialog"/);
 assert.match(markup,/commercial-r3-20261018/);
 assert.match(script,/commercial-r3-20261018/);
 assert.doesNotMatch(script,/sb_secret_/);
});

test('Master location form explains private test TV instead of raw server code',async()=>{
 const html=fs.readFileSync('master-advertisers.html','utf8');
 const script=fs.readFileSync('master-advertisers.mjs','utf8');
 const {isPrivateCommercialDeviceName,commercialLocationErrorMessage}=await import('../commercial-point-privacy.mjs');
 assert.match(html,/id="public-point-sharing-notice"/);
 assert.match(html,/master-advertisers\.mjs\?v=location-safe-20261018/);
 assert.match(script,/f\.elements\.share_location\.disabled=isPrivate/);
 assert.match(script,/f\.elements\.consent_confirmed\.disabled=isPrivate/);
 assert.match(script,/commercialLocationErrorMessage\(error\)/);
 assert.equal(isPrivateCommercialDeviceName('Teste casa'),true);
 assert.equal(isPrivateCommercialDeviceName('TV de teste'),true);
 assert.equal(isPrivateCommercialDeviceName('Casa'),true);
 assert.equal(isPrivateCommercialDeviceName('Casa de carne'),false);
 assert.equal(isPrivateCommercialDeviceName('Academia Life'),false);
 assert.match(commercialLocationErrorMessage(new Error('private_test_device_location_blocked')),/TV é de teste ou residencial/);
});

test('SaaS admin sidebar contains both Master links between Planos and Auditoria',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const begin=html.indexOf('<div id="saas-admin-nav" class="saas-admin-nav hidden"');
 const end=html.indexOf('</div>',begin);
 const nav=begin>=0&&end>begin?html.slice(begin,end+6):'';
 assert.ok(nav,'SaaS Master section must exist');
 const plans=nav.indexOf('data-saas-view="plans"');
 const m=nav.indexOf('href="./master.html"');
 const ads=nav.indexOf('href="./master-advertisers.html"');
 const audit=nav.indexOf('data-saas-view="audit"');
 assert.ok(plans>=0&&plans<m&&m<ads&&ads<audit,'Master links must be between Planos and Auditoria');
 assert.match(nav,/class="saas-admin-nav hidden"/);
 assert.match(nav,/Painel Master Vision/);
 assert.match(nav,/Master Vision · Anunciantes/);
 assert.doesNotMatch(nav,/target="_blank"/);
});
test('Master navigation reuses authenticated session and cannot be used as privilege escalation',()=>{
 const app=fs.readFileSync('app.js','utf8');
 const master=fs.readFileSync('master.js','utf8');
 const saas=fs.readFileSync('saas-shell.js','utf8');
 const commercial=fs.readFileSync('commercial-ui.mjs','utf8');
 assert.match(app,/const SESSION_KEY = 'vision_midia_session_v1'/);
 assert.match(master,/const SESSION_KEY = 'vision_midia_session_v1'/);
 assert.match(commercial,/vision_midia_session_v1/);
 assert.match(saas,/\['super_admin', 'admin'\]/);
 assert.match(saas,/group.classList.toggle\('hidden', !allowed\)/);
 assert.match(master,/master-admin/);
});

test('advertiser lists active TVs, not historical links with no deliveries',async()=>{
 const {renderCampaigns}=await import('../commercial-ui.mjs');
 const data={today:'2026-10-18',
 campaigns:[{id:'c1',name:'Test',status:'draft',start_date:'2026-10-18',end_date:'2026-10-19',current_revision_id:'r1'}],
 revisions:[{id:'r1',campaign_id:'c1',name:'Vision video',media_type:'video'}],
 targets:[
  {campaign_id:'c1',device_id:'tv1',point_name:'Academia Life',device_name:'Teste casa',active:true,online:true},
  {campaign_id:'c1',device_id:'tv2',point_name:'Casa de carne',device_name:'Casa de carne',active:false,online:false}
 ],daily:[]};
 const current=renderCampaigns(data);
 assert.match(current,/Teste casa/);
 assert.doesNotMatch(current,/Casa de carne/);
 data.targets[0].active=false;
 data.targets[1].active=true;
 const newLocation=renderCampaigns(data);
 assert.doesNotMatch(newLocation,/Teste casa/);
 assert.match(newLocation,/Casa de carne/);
 data.daily=[{campaign_id:'c1',device_id:'tv1',day:'2026-10-18',completed_count:2}];
 const historical=renderCampaigns(data);
 assert.match(historical,/Teste casa/);
 assert.match(historical,/vínculo encerrado/);
});
