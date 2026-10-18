const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
for(const standalone of [false,true])test('icon editor opens from '+(standalone?'standalone Master':'installed app Master menu'),async()=>{
 const added=[];const nav={append:e=>added.push(e)};let opens=0;const parts=new Map();
 const document={hidden:false,head:{append(){}},body:{append(){}},addEventListener(){},querySelector(selector){if(selector==='.master-sidebar nav')return standalone?nav:null;if(selector==='#saas-admin-nav')return standalone?null:nav;return null;},createElement(tag){return{style:{},setAttribute(){},showModal(){opens++;},close(){},querySelector(selector){if(!parts.has(selector))parts.set(selector,{});return parts.get(selector);}}}};
 vm.runInNewContext(fs.readFileSync('pwa-icon.js','utf8'),{document,window:{addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({revision:null,icons:[]})})});
 assert.equal(added.length,1);assert.equal(added[0].className,standalone?'nav-button':'nav-item');await added[0].onclick();assert.equal(opens,1);
});

test('global logo editor is separate from existing PWA icon editor',()=>{
 const s=fs.readFileSync('pwa-icon.js','utf8');
 assert.match(s,/Logo do painel \(global\)/);
 assert.match(s,/config\.panel_logo\?\.src/);
 assert.match(s,/\.brand-mark, \.master-sidebar \.sidebar-brand > span/);
 assert.match(s,/kind:'panel-logo'/);
 assert.match(s,/expected_logo_revision/);
 assert.match(fs.readFileSync('index.html','utf8'),/pwa-icon\.js\?v=panel-logo-20261018/);
 assert.match(fs.readFileSync('master.html','utf8'),/pwa-icon\.js\?v=panel-logo-20261018/);
});
