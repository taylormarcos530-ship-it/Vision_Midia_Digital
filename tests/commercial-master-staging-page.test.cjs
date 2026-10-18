const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const html=fs.readFileSync('master-advertisers-homologacao.html','utf8');
const js=fs.readFileSync('master-advertisers-staging.mjs','utf8');
const vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'));
test('staging Master page uses isolated config and explicitly says fictional-only',()=>{
  assert.match(html,/src="\.\/commercial-staging-config\.js"/);
  assert.doesNotMatch(html,/src="\.\/commercial-config\.js"/);
  assert.match(html,/SOMENTE CONTAS FICTÍCIAS/);
  assert.match(html,/src="\.\/master-advertisers-staging\.mjs"/);
});
test('created access points at advertiser STAGING, never official login',()=>{
  assert.match(js,/new URL\('\.\/anunciante-homologacao\.html'/);
  assert.doesNotMatch(js,/new URL\('\.\/anunciante\.html'/);
  assert.match(html,/href="\.\/anunciante-homologacao\.html"/);
});
test('Master QA cannot submit campaigns or enable commercial programming',()=>{
  assert.match(js,/data-campaign\],button\[data-edit-campaign/);
  assert.match(js,/demo=false/);
  assert.deepEqual(vercel.git.deploymentEnabled,{'fix/advertiser-portal-safety-20261013':false});
});
