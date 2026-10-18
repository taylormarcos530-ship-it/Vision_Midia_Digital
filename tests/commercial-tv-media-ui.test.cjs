const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

async function createDOM(){
 const {createMediaTestPlayer,mediaTestView,mediaTestEvent}=await import('../commercial-tv-media-controller.mjs');
 const elements=new Map(),timers=new Map(),docEvents=new Map(),windowEvents=new Map(),urls=new Set();
 let timerId=0,nextURL=0;
 function el(id){
  if(!elements.has(id))elements.set(id,{
   id,hidden:false,disabled:false,textContent:'',dataset:{},files:[],listeners:{},src:'',
   addEventListener(event,fn){this.listeners[event]=fn},
   removeAttribute(prop){delete this[prop]},
   pause(){this.paused=true},
   load(){this.loaded=true},
   play(){this.played=true;return Promise.resolve()}
  });
  return elements.get(id);
 }
 const document={hidden:false,getElementById:el,addEventListener:(name,fn)=>docEvents.set(name,fn)};
 const win={addEventListener:(name,fn)=>windowEvents.set(name,fn)};
 const URL={
  createObjectURL(file){const val='blob:test-fixture-'+(++nextURL);urls.add(val);return val},
  revokeObjectURL(val){urls.delete(val)}
 };
 const source=fs.readFileSync('commercial-tv-media-ui.mjs','utf8').replace(/^import[^\n]+\n/gm,'');
 vm.runInNewContext(source,{
  document,window:win,URL,createMediaTestPlayer,mediaTestView,mediaTestEvent,
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},
  clearTimeout(id){timers.delete(id)}
 });
 return {
  el,timers,urls,document,win,docEvents,windowEvents,
  click:id=>el(id).listeners.click(),
  select(id,file){el(id).files=file?[file]:[];el(id).listeners.change()},
  selectMany(id,files){el(id).files=files;el(id).listeners.change()},
  tick(ms){const entry=[...timers.entries()].find(([_,e])=>e.delay===ms);assert.ok(entry,'expected '+ms+'ms tick');timers.delete(entry[0]);entry[1].fn()}
 };
}

test('local playback starts on user interaction and runs offline text frames in playlist order',async()=>{
 const d=await createDOM();
 assert.equal(d.timers.size,0);
 assert.equal(d.el('media-live').textContent,'PAUSADO');
 d.click('media-start');
 assert.equal(d.el('media-live').textContent,'EXECUTANDO');
 assert.equal(d.timers.size,1);
 assert.match(d.el('media-current').textContent,/Troca de óleo/);
 d.tick(2000);
 assert.match(d.el('media-current').textContent,/Suspensão/);
 assert.match(d.el('media-round').textContent,/item 2 de 8/);
 d.click('media-pause');
 assert.equal(d.timers.size,0);
 assert.equal(d.el('media-live').textContent,'PAUSADO');
});
test('local video advances only through its actual ended callback, not the fixture timer',async()=>{
 const d=await createDOM();
 d.select('media-base-file',{size:10000,type:'video/mp4'});
 assert.equal(d.urls.size,1);
 d.click('media-start');
 assert.equal(d.timers.size,0,'video must not receive fake expiry timer');
 assert.equal(d.el('media-video').played,true);
 assert.match(d.el('media-video').src,/blob:test-fixture-/);
 const firstCallback=d.el('media-video').onended;
 firstCallback();
 assert.match(d.el('media-round').textContent,/item 2 de 8/);
 assert.equal(d.el('media-video').hidden,true,'item 2 uses a fictitious frame, not the same uploaded video');
 firstCallback();
 assert.match(d.el('media-round').textContent,/item 2 de 8/);
 d.tick(2000);
 assert.match(d.el('media-round').textContent,/item 3 de 8/);
 d.win.addEventListener&&d.windowEvents.get('pagehide')();
 assert.equal(d.urls.size,0,'blob URLs must be released when page closes');
});
test('local-image playback waits for actual image load before timing 2.5 seconds',async()=>{
 const d=await createDOM();
 d.select('media-base-file',{size:4096,type:'image/png'});
 d.click('media-start');
 assert.equal(d.timers.size,0,'do not advance before image is loaded');
 const onload=d.el('media-photo').onload;
 assert.equal(typeof onload,'function');
 onload();
 assert.equal([...d.timers.values()][0].delay,2500);
 d.tick(2500);
 assert.match(d.el('media-round').textContent,/item 2 de 8/);
});
test('an error in uploaded commercial media stops the loop and returns to only original point content',async()=>{
 const d=await createDOM();
 d.select('media-commercial-file',{size:10000,type:'video/webm'});
 d.click('media-start');
 d.tick(2000);d.tick(2000);d.tick(2000);
 assert.match(d.el('media-current').textContent,/Publicidade comercial/);
 assert.equal(d.el('media-video').played,true);
 d.el('media-video').onerror();
 assert.match(d.el('media-status').textContent,/anúncios desativados/i);
 assert.equal(d.el('media-live').textContent,'PAUSADO');
 assert.match(d.el('media-count').textContent,/Comerciais nesta rodada: 0/);
 assert.match(d.el('media-count').textContent,/Falhas: 1/);
 assert.equal(d.timers.size,0);
});
test('disconnection, no playlist, and unsupported file cannot leak media outside the page',async()=>{
 const d=await createDOM();
 d.select('media-base-file',{size:1024,type:'image/svg+xml'});
 assert.match(d.el('media-notice').textContent,/Arquivo não aceito/);
 assert.equal(d.urls.size,0);
 d.click('media-no-playlist');
 assert.match(d.el('media-current').textContent,/Aguardando playlist/);
 assert.equal(d.el('media-start').disabled,true);
 d.click('media-restore-playlist');
 d.click('media-start');
 const position=d.el('media-round').textContent;
 d.click('media-disconnect');
 assert.equal(d.timers.size,1,'only the delayed reconnect timer remains');
 assert.equal([...d.timers.values()][0].delay,3000);
 assert.equal(d.el('media-live').textContent,'SEM CONEXÃO');
 d.click('media-reconnect');
 assert.equal(d.el('media-round').textContent,position);
 assert.equal(d.el('media-live').textContent,'EXECUTANDO');
 assert.equal([...d.timers.values()][0].delay,2000,'manual reconnect resumes from same item');
});

test('two separate selected files get visible independent previews and commercial starts on item four',async()=>{
 const d=await createDOM();
 d.select('media-base-file',{size:10000,type:'video/mp4',name:'oficina.mp4'});
 d.select('media-commercial-file',{size:5000,type:'image/png',name:'anuncio.png'});
 assert.equal(d.urls.size,2);
 assert.match(d.el('media-base-loaded').textContent,/VÍDEO carregado.*oficina.mp4/);
 assert.match(d.el('media-commercial-loaded').textContent,/IMAGEM carregada.*anuncio.png/);
 assert.equal(d.el('media-base-thumb-video').hidden,false);
 assert.equal(d.el('media-commercial-thumb-image').hidden,false);
 assert.match(d.el('media-file-count').textContent,/1 mídia do estabelecimento.*1 comercial/);
 assert.match(d.el('media-order-hint').textContent,/item 4 de 8/);
 d.click('media-start');
 assert.equal(d.el('media-video').hidden,false);
 assert.equal(d.timers.size,0);
 d.el('media-video').onended();
 d.tick(2000);d.tick(2000);
 assert.match(d.el('media-round').textContent,/item 4 de 8/);
 assert.match(d.el('media-current').textContent,/Publicidade comercial/);
 assert.equal(d.el('media-photo').hidden,false);
 assert.equal(d.el('media-video').hidden,true);
 assert.equal(d.el('media-photo').src,d.el('media-commercial-thumb-image').src);
 assert.equal(d.timers.size,0);
 d.el('media-photo').onload();
 d.tick(2500);
 assert.match(d.el('media-round').textContent,/item 5 de 8/);
 assert.equal(d.el('media-video').hidden,false);
});

test('automatic reconnection after three seconds resumes the exact media and rejects old callbacks',async()=>{
 const d=await createDOM();
 d.click('media-start');d.tick(2000);
 const originalPosition=d.el('media-round').textContent;
 d.click('media-disconnect');
 assert.equal(d.el('media-live').textContent,'SEM CONEXÃO');
 assert.equal(d.el('media-reconnect').disabled,false);
 assert.equal(d.el('media-reconnect').textContent,'Reconectar agora');
 assert.equal([...d.timers.values()][0].delay,3000);
 d.tick(3000);
 assert.equal(d.el('media-round').textContent,originalPosition);
 assert.equal(d.el('media-live').textContent,'EXECUTANDO');
 assert.match(d.el('media-status').textContent,/reprodução retomada/);
 assert.equal(d.el('media-reconnect').textContent,'Verificar conexão ✓');
 assert.equal([...d.timers.values()][0].delay,2000);
 d.tick(2000);
 assert.match(d.el('media-round').textContent,/item 3 de 8/);
});

test('simulated reboot displays two-second feedback and automatically resumes if it was playing',async()=>{
 const d=await createDOM();
 d.click('media-start');d.tick(2000);d.tick(2000);
 const before=d.el('media-round').textContent;
 d.click('media-restart');
 assert.equal(d.el('media-live').textContent,'REINICIANDO');
 assert.equal(d.el('media-round').textContent,before);
 assert.equal(d.el('media-restart').disabled,true);
 assert.match(d.el('media-notice').textContent,/REINICIANDO/);
 assert.equal([...d.timers.values()][0].delay,2000);
 d.tick(2000);
 assert.equal(d.el('media-round').textContent,before);
 assert.match(d.el('media-status').textContent,/reprodução retomada/);
 assert.equal(d.el('media-live').textContent,'EXECUTANDO');
 assert.equal([...d.timers.values()][0].delay,2000);
 d.tick(2000);
 assert.match(d.el('media-round').textContent,/item 4 de 8/);
});

test('reboot while paused keeps paused and continues only with explicit start',async()=>{
 const d=await createDOM();
 d.click('media-restart');
 assert.equal(d.el('media-live').textContent,'REINICIANDO');
 d.tick(2000);
 assert.equal(d.el('media-live').textContent,'PAUSADO');
 assert.equal(d.timers.size,0);
 d.click('media-start');
 assert.equal(d.el('media-live').textContent,'EXECUTANDO');
});

test('manual reconnect before timeout cancels the automatic reconnect and no stale transition happens',async()=>{
 const d=await createDOM();
 d.click('media-start');d.click('media-disconnect');
 assert.equal([...d.timers.values()][0].delay,3000);
 d.click('media-reconnect');
 assert.equal(d.timers.size,1);
 assert.equal([...d.timers.values()][0].delay,2000);
 d.click('media-reconnect');
 assert.match(d.el('media-notice').textContent,/já ativa/);
 assert.equal(d.timers.size,1);
 d.tick(2000);
 assert.match(d.el('media-round').textContent,/item 2 de 8/);
});

test('background browser tab cancels fake reconnect/reboot and never advances hidden playback',async()=>{
 const d=await createDOM();
 d.click('media-start');d.click('media-disconnect');
 assert.equal(d.timers.size,1);
 d.document.hidden=true;d.docEvents.get('visibilitychange')();
 assert.equal(d.timers.size,0);
 assert.equal(d.el('media-live').textContent,'SEM CONEXÃO');
 d.document.hidden=false;d.click('media-reconnect');
 assert.equal(d.timers.size,0,'does not autoplay after the page was hidden');
 d.click('media-start');
 d.click('media-restart');
 assert.equal(d.timers.size,1);
 d.document.hidden=true;d.docEvents.get('visibilitychange')();
 assert.equal(d.timers.size,0);
 assert.equal(d.el('media-live').textContent,'PAUSADO');
});

test('six separate point assets play in assigned slots, never reuse the same video, and keep ad at item 4',async()=>{
 const d=await createDOM();
 const videoA={size:5000,type:'video/mp4',name:'primeiro.mp4'};
 const imageB={size:1000,type:'image/png',name:'segundo.png'};
 const videoC={size:6000,type:'video/webm',name:'terceiro.webm'};
 d.select('media-base-file',videoA);
 d.selectMany('media-base-file',[imageB,videoC]);
 d.select('media-commercial-file',{size:900,type:'image/png',name:'anuncio.png'});
 assert.equal(d.urls.size,4);
 assert.match(d.el('media-base-loaded').textContent,/3 mídias carregadas/);
 assert.match(d.el('media-base-order').textContent,/1\. primeiro\.mp4\n2\. segundo\.png\n3\. terceiro\.webm/);
 d.click('media-start');
 const srcA=d.el('media-video').src;
 assert.equal(srcA,'blob:test-fixture-1');
 d.el('media-video').onended();
 assert.equal(d.el('media-photo').src,'blob:test-fixture-2');
 d.el('media-photo').onload();d.tick(2500);
 assert.equal(d.el('media-video').src,'blob:test-fixture-3');
 assert.notEqual(d.el('media-video').src,srcA);
 d.el('media-video').onended();
 assert.match(d.el('media-round').textContent,/item 4 de 8/);
 assert.equal(d.el('media-photo').src,'blob:test-fixture-4');
 d.el('media-photo').onload();d.tick(2500);
 assert.match(d.el('media-round').textContent,/item 5 de 8/);
 assert.equal(d.el('media-video').hidden,true,'missing base slot uses text placeholder');
 assert.equal([...d.timers.values()][0].delay,2000);
 d.windowEvents.get('pagehide')();
 assert.equal(d.urls.size,0,'all four URLs released on pagehide');
});
test('base files can be added one by one, six max; duplicates and unsupported media cannot interrupt the session',async()=>{
 const d=await createDOM();
 for(let i=0;i<6;i++){
  d.select('media-base-file',{name:'base-'+i+'.png',size:100+i,type:'image/png'});
 }
 assert.match(d.el('media-file-count').textContent,/6 mídias do estabelecimento/);
 assert.equal(d.urls.size,6);
 d.click('media-start');
 assert.equal(d.el('media-live').textContent,'EXECUTANDO');
 d.select('media-base-file',{name:'extra.png',size:99,type:'image/png'});
 assert.match(d.el('media-notice').textContent,/Limite de seis/);
 assert.equal(d.el('media-live').textContent,'EXECUTANDO');
 d.select('media-base-file',{name:'base-0.png',size:100,type:'image/png'});
 assert.match(d.el('media-notice').textContent,/Limite de seis/);
 assert.equal(d.urls.size,6);
 d.click('media-clear-base');
 assert.equal(d.urls.size,0);
 assert.match(d.el('media-base-order').textContent,/quadros fictícios/);
 assert.match(d.el('media-file-count').textContent,/0 mídias do estabelecimento/);
 d.select('media-base-file',{name:'valid.mp4',size:200,type:'video/mp4'});
 d.select('media-base-file',{name:'valid.mp4',size:200,type:'video/mp4'});
 assert.equal(d.urls.size,1);
 assert.match(d.el('media-notice').textContent,/Arquivo já escolhido/);
 d.select('media-base-file',{name:'invalid.svg',size:100,type:'image/svg+xml'});
 assert.match(d.el('media-notice').textContent,/Arquivo não aceito/);
 assert.equal(d.urls.size,1);
 d.click('media-clear-base');
 assert.equal(d.urls.size,0);
});
test('multiple picker rejects more than six files atomically and canceled picker keeps selections',async()=>{
 const d=await createDOM();
 d.selectMany('media-base-file',Array.from({length:7},(_,i)=>({name:'file'+i+'.png',size:400+i,type:'image/png'})));
 assert.equal(d.urls.size,0);
 assert.match(d.el('media-notice').textContent,/Limite de seis/);
 d.selectMany('media-base-file',Array.from({length:6},(_,i)=>({name:'file'+i+'.png',size:400+i,type:'image/png'})));
 assert.equal(d.urls.size,6);
 d.selectMany('media-base-file',[]);
 assert.equal(d.urls.size,6);
 d.windowEvents.get('pagehide')();
 assert.equal(d.urls.size,0);
});
