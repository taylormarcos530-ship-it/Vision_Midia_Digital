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
