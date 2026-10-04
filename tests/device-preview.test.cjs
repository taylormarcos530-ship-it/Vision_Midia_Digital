const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function fn(name){const match=new RegExp('  (?:async )?function '+name+'\\(').exec(source);assert.ok(match,name);return source.slice(match.index,source.indexOf('\n  }',match.index)+4)}
function context(media){
  const targets=media.map(m=>({dataset:{deviceProgramPreview:m.id},isConnected:true,innerHTML:'Carregando programação',replaceChildren(el){this.element=el;this.innerHTML=''}}));
  const c=vm.createContext({URL,location:{href:'https://preview.example/index.html',origin:'https://preview.example'},state:{media},$$:()=>targets,document:{createElement:()=>({setAttribute(){},classList:{add(){}}})},setTimeout,clearTimeout,signedMediaUrlCached:()=>{throw Error('URL media must not request storage')},loadStablePreviewElement:()=>{throw Error('URL media must not request storage')}});
  vm.runInContext(['resolveOnlineMediaUrl','onlineDeviceProgramPreview','devicePreviewWithDeadline','hydrateDeviceProgramPreviews'].map(fn).join('\n'),c);
  return {c,targets};
}
test('online playlist preview mounts iframe immediately instead of leaving spinner',async()=>{
  const {c,targets}=context([{id:'feed',media_type:'url',source_url:'./news-feed.html?source=soccer'}]);
  await c.hydrateDeviceProgramPreviews();assert.equal(targets[0].element.src,'https://preview.example/news-feed.html?source=soccer');assert.equal(targets[0].innerHTML,'');
});
test('unsupported media ends loading state',async()=>{
  const {c,targets}=context([{id:'missing',media_type:'url'}]);await c.hydrateDeviceProgramPreviews();assert.match(targets[0].innerHTML,/Conteúdo sem prévia/);
});
test('slow storage does not block other TVs and stops waiting at the deadline',async()=>{
  const {c,targets}=context([{id:'slow',media_type:'image',storage_path:'slow.jpg'},{id:'feed',media_type:'url',source_url:'./clock.html'}]);
  let timeout;c.setTimeout=callback=>{timeout=callback;return 1};c.clearTimeout=()=>{};c.signedMediaUrlCached=()=>new Promise(()=>{});
  const loading=c.hydrateDeviceProgramPreviews();assert.equal(targets[1].element.src,'https://preview.example/clock.html');timeout();await loading;
  assert.match(targets[0].innerHTML,/Prévia indisponível/);assert.equal(targets[0].dataset.loadingPath,undefined);
});
test('Ver TV opens online programming when previous capture has wrong orientation',async()=>{
  const media={id:'feed',media_type:'url',source_url:'./news-feed.html?source=cinema_br'};
  const {c}=context([media]);const nodes={};
  c.$=selector=>nodes[selector]||= {textContent:'',replaceChildren(el){this.element=el},innerHTML:''};
  c.state.devices=[{id:'tv',name:'Test TV'}];c.effectiveDeviceStatus=()=> 'online';c.statusLabel=x=>x;c.formatLastSeen=()=> 'Agora';
  c.latestScreenshotForDevice=()=>({storage_path:'old.jpg'});c.screenshotMatchesConfiguredOrientation=()=>false;c.deviceProgramPreviewMedia=()=>media;
  c.configureTvViewerFrame=()=>{};c.setTvViewerProgramPreviewMode=()=>{};c.syncTvViewerProgramMediaLayout=()=>{};
  vm.runInContext(fn('renderTvViewer'),c);await c.renderTvViewer('tv');
  assert.equal(nodes['#view-tv-preview'].element.src,'https://preview.example/news-feed.html?source=cinema_br');
});
