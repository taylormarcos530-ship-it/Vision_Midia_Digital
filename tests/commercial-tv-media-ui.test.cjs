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
 firstCallback();
 assert.match(d.el('media-round').textContent,/item 2 de 8/);
 d.el('media-video').onended();
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
 assert.equal(d.timers.size,0);
 assert.equal(d.el('media-live').textContent,'PAUSADO');
 d.click('media-reconnect');
 assert.equal(d.el('media-round').textContent,position);
 assert.equal(d.timers.size,0,'reconnection must never auto-complete media');
});
