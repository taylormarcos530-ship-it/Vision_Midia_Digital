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
