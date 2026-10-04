const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const start=app.indexOf('  async function handleOnlineMediaSave(');
const save=app.slice(start,app.indexOf('\n  }',start)+4);
function context(playlist='playlist',fail=false){
  const calls=[],messages=[],button={disabled:false};
  const nodes={'#online-media-name':{value:'Cinema'},'#online-media-url':{value:'https://preview.example/news-feed.html?source=cinema_br'},'#online-media-duration':{value:'30'},'#online-media-playlist':{value:playlist},'#online-media-dialog':{close(){}}};
  const c=vm.createContext({URL,location:{origin:'https://preview.example',href:'https://preview.example/index.html'},state:{company:{id:'tenant'},user:{id:'user'},playlists:[{id:'playlist'}],playlistItems:[{playlist_id:'playlist',position:3}]},$:s=>nodes[s],resolveOnlineMediaUrl:x=>x,toast:(...x)=>messages.push(x),setBusy:(b,v)=>b.disabled=v,loadAllData:async()=>{},restRequest:async(table,options)=>{calls.push({table,...options});if(fail&&table==='playlist_items')throw Error('Denied');return [{id:'media'}]}});
  vm.runInContext(save,c);
  return {c,calls,messages,button,event:{preventDefault(){},target:{querySelector:()=>button}}};
}
test('preset is saved with relative URL and appended to selected tenant playlist',async()=>{
  const x=context();await x.c.handleOnlineMediaSave(x.event);
  assert.equal(x.calls.length,2);assert.equal(x.calls[0].body.source_url,'./news-feed.html?source=cinema_br');
  assert.equal(x.calls[1].body.company_id,'tenant');assert.equal(x.calls[1].body.media_id,'media');assert.equal(x.calls[1].body.position,4);
  assert.equal(x.calls[1].body.duration_override_seconds,30);assert.equal(x.button.disabled,false);
});
test('library-only flow does not insert playlist item',async()=>{const x=context('');await x.c.handleOnlineMediaSave(x.event);assert.equal(x.calls.length,1)});
test('unknown playlist is rejected before writing',async()=>{const x=context('other');await x.c.handleOnlineMediaSave(x.event);assert.equal(x.calls.length,0)});
test('partial playlist failure reports saved library item without success claim',async()=>{const x=context('playlist',true);await x.c.handleOnlineMediaSave(x.event);assert.equal(x.messages[0][0],'Conteúdo salvo na biblioteca');assert.equal(x.button.disabled,false)});
test('cinema feed adapter decodes RSS descriptions and rejects unknown sources',async()=>{
  const handler=(await import('../netlify/functions/news-feed.mts')).default;
  const original=global.fetch;try{
    global.fetch=async url=>{assert.equal(url,'https://cinepop.com.br/feed/');return new Response('<rss><channel><language>pt-BR</language><item><title>Cinema &#8212; Brasil</title><description>&lt;p&gt;Estreia&lt;/p&gt;</description></item></channel></rss>')};
    const res=await handler(new Request('https://example.com/api/news-feed?source=cinema_br'));assert.equal(res.status,200);const data=await res.json();assert.equal(data.items[0].description,'Estreia');assert.equal(data.items[0].title,'Cinema — Brasil');
    assert.equal((await handler(new Request('https://example.com/api/news-feed?source=unknown'))).status,400);
  }finally{global.fetch=original}
});
test('feed preserves official photo URLs and strips untrusted image hosts',async()=>{
  const handler=(await import('../netlify/functions/news-feed.mts')).default;
  const original=global.fetch;
  try {
    for(const image of ['https://cinepop.com.br/wp-content/uploads/poster.webp','https://attacker.example/tracker.png']) {
      global.fetch=async()=>new Response(`<rss><channel><language>pt-BR</language><item><title>Estreia</title><description>&lt;img src="${image}" /&gt;&lt;p&gt;Resumo&lt;/p&gt;</description></item></channel></rss>`);
      const data=await (await handler(new Request('https://example.com/api/news-feed?source=cinema_br'))).json();
      assert.equal(data.schema_version,2);assert.equal(data.language,'pt-BR');
      assert.equal(data.items[0].image_url,image.includes('attacker')?'':image);
      assert.equal(data.items[0].description,'Resumo');
    }
  }finally{global.fetch=original}
});
test('branding draft survives refresh and pending signed image cannot replace draft',async()=>{
  function fn(name) {const start=app.indexOf(`  ${name.startsWith('hydrate')?'async ':''}function ${name}(`);return app.slice(start,app.indexOf('\n  }',start)+4)}
  const preview={dataset:{},style:{backgroundImage:'local-image'}};
  const form={dataset:{dirty:'1'}};
  const nodes={'#player-branding-panel':{classList:{remove(){}}},'#player-branding-form':form,'#player-branding-preview':preview,'#branding-title':{value:'New title'}};
  const c=vm.createContext({$:s=>nodes[s],state:{playerBranding:{title:'Saved title',splash_path:'saved.webp'}},location:{origin:'https://fixture.test'},getSignedMediaUrl:async()=>{form.dataset.dirty='1';return 'https://fixture.test/old.jpg'}});
  vm.runInContext(fn('renderPlayerBranding')+fn('hydratePlayerBrandingPreview'),c);
  c.renderPlayerBranding();assert.equal(nodes['#branding-title'].value,'New title');assert.equal(preview.style.backgroundImage,'local-image');
  delete form.dataset.dirty;await c.hydratePlayerBrandingPreview();assert.equal(preview.style.backgroundImage,'local-image');
});
