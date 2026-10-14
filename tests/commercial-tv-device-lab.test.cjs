const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const load=()=>import('../commercial-tv-device-metrics.mjs');

test('viewport measurement describes browser viewport only and handles invalid sizes',async()=>{
 const {viewportReport}=await load();
 assert.deepEqual(viewportReport(1920,1080,2),{valid:true,width:1920,height:1080,pixelRatio:2,orientation:'horizontal'});
 assert.equal(viewportReport(1080,1920).orientation,'vertical');
 assert.equal(viewportReport(720,720).orientation,'quadrado');
 assert.equal(viewportReport(0,1080).valid,false);
 assert.equal(viewportReport(Infinity,1080).valid,false);
 assert.equal(viewportReport(300,500,Infinity).pixelRatio,1);
});
test('codec flags are declarations, not real decoder success',async()=>{
 const {decodeSupport}=await load();
 const s=decodeSupport(mime=>mime.includes('avc1')?'probably':mime.includes('vp8')?'maybe':'');
 assert.deepEqual(s.map(x=>x.level),['provável','possível','não declarado']);
 assert.equal(decodeSupport(()=>{throw Error('unsupported')})[0].level,'não declarado');
});
test('local video file gate rejects oversize and unsupported formats',async()=>{
 const {canUseLabFile}=await load();
 assert.equal(canUseLabFile({size:1024,type:'video/mp4'}),true);
 assert.equal(canUseLabFile({size:100*1024*1024,type:'video/webm'}),true);
 for(const f of [null,{size:0,type:'video/mp4'},{size:101*1024*1024,type:'video/mp4'},
  {size:2048,type:'image/svg+xml'},{size:10,type:'text/html'}, {size:10,type:''}])
  assert.equal(canUseLabFile(f),false);
});

async function createLab(){
 const {viewportReport,decodeSupport,canUseLabFile}=await load();
 const elements=new Map(),events=new Map(),winEvents=new Map(),timers=new Map(),objects=new Set();
 let timerId=0,fileId=0;
 function element(id){
  if(!elements.has(id))elements.set(id,{
   id,hidden:false,textContent:'',disabled:false,src:'',files:[],
   listeners:{},currentTime:0,duration:10,paused:true,ended:false,
   classNames:new Set(),
   addEventListener(type,handler){this.listeners[type]=handler},
   classList:{
    add(name){element(id).classNames.add(name)},
    remove(name){element(id).classNames.delete(name)},
    toggle(name,on){
     if(on===true)element(id).classNames.add(name);
     else if(on===false)element(id).classNames.delete(name);
    }
   },
   pause(){this.paused=true;if(this.listeners.pause)this.listeners.pause()},
   play(){this.paused=false;this.ended=false;
    if(this.listeners.play)this.listeners.play();
    if(this.listeners.playing)this.listeners.playing();
    return Promise.resolve();
   },
   load(){this.loaded=true},
   removeAttribute(attr){if(attr==='src')this.src=''},
   canPlayType(type){return type.includes('avc1')?'probably':type.includes('vp8')?'maybe':''}
  });
  return elements.get(id);
 }
 const stage=element('diag-stage');
 const document={
  hidden:false,fullscreenElement:null,
  getElementById:element,
  addEventListener(type,handler){events.set(type,handler)},
  exitFullscreen(){this.fullscreenElement=null;events.get('fullscreenchange')();return Promise.resolve()}
 };
 stage.requestFullscreen=function(){document.fullscreenElement=stage;events.get('fullscreenchange')();return Promise.resolve()};
 const window={
  innerWidth:1920,innerHeight:1080,devicePixelRatio:1,
  screen:{orientation:{type:'landscape-primary'}},
  addEventListener(type,handler){winEvents.set(type,handler)}
 };
 const URL={createObjectURL(file){const ref='blob:lab'+(++fileId);objects.add(ref);return ref},
  revokeObjectURL(ref){objects.delete(ref)}};
 const src=fs.readFileSync('commercial-tv-device-lab.mjs','utf8').replace(/^import[^\n]+\n/gm,'');
 vm.runInNewContext(src,{document,window,URL,viewportReport,decodeSupport,canUseLabFile,
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},
  clearTimeout(id){timers.delete(id)}
 });
 return {
  element,document,window,stage,events,winEvents,timers,objects,
  click(id){element(id).listeners.click()},
  pick(file){element('diag-file').files=file?[file]:[];element('diag-file').listeners.change()},
  event(id,type){element(id).listeners[type]()},
  tick(ms){const x=[...timers.entries()].find(([_,entry])=>entry.ms===ms);
   assert.ok(x,'expected timer '+ms);timers.delete(x[0]);x[1].fn()}
 };
}

test('TV diagnostic browser reports viewport/codec declarations and simulated portrait without hardware rotation',async()=>{
 const d=await createLab();
 assert.match(d.element('diag-viewport').textContent,/1920 × 1080.*horizontal/);
 assert.match(d.element('diag-codecs').textContent,/MP4\/H.264: provável/);
 d.click('diag-portrait');
 assert.equal(d.stage.classNames.has('portrait'),true);
 assert.match(d.element('diag-screen').textContent,/vertical 9:16/);
 assert.equal(d.window.screen.orientation.type,'landscape-primary','no device rotation');
 d.click('diag-landscape');
 assert.equal(d.stage.classNames.has('portrait'),false);
 d.click('diag-fit');
 assert.equal(d.element('diag-video').classNames.has('cover'),true);
 assert.match(d.element('diag-fit-state').textContent,/pode cortar/);
 d.click('diag-fit');
 assert.equal(d.element('diag-video').classNames.has('cover'),false);
});
test('fullscreen requires user-click and mirrors browser state, remote keys are only observed',async()=>{
 const d=await createLab();
 assert.equal(d.document.fullscreenElement,null);
 d.click('diag-fullscreen');
 assert.equal(d.document.fullscreenElement,d.stage);
 assert.match(d.element('diag-fullscreen-state').textContent,/ativa/);
 d.click('diag-fullscreen');
 assert.equal(d.document.fullscreenElement,null);
 d.winEvents.get('keydown')({key:'ArrowDown'});
 assert.match(d.element('diag-key').textContent,/ArrowDown/);
});
test('local MP4 is not uploaded; real ended event only counts once',async()=>{
 const d=await createLab();
 d.pick({name:'laboratorio.mp4',size:2000,type:'video/mp4'});
 assert.equal(d.objects.size,1);
 assert.match(d.element('diag-file-status').textContent,/laboratorio.mp4/);
 assert.equal(d.element('diag-video').hidden,false);
 assert.equal(d.element('diag-video').paused,true,'file selection does not autoplay');
 d.click('diag-play');
 assert.equal(d.element('diag-video').paused,false);
 d.element('diag-video').currentTime=10;
 d.event('diag-video','ended');
 assert.match(d.element('diag-video-state').textContent,/Vídeo concluído/);
 assert.match(d.element('diag-events').textContent,/concluídos neste teste: 1/);
 d.event('diag-video','ended');
 assert.match(d.element('diag-events').textContent,/concluídos neste teste: 1/);
 d.window.innerWidth=1080;d.window.innerHeight=1920;
 d.winEvents.get('resize')();
 assert.match(d.element('diag-viewport').textContent,/vertical/);
});
test('interrupt preserves video position and resumes only while visible',async()=>{
 const d=await createLab();
 d.pick({name:'teste.webm',size:5000,type:'video/webm'});
 d.click('diag-play');
 d.element('diag-video').currentTime=3.5;
 d.click('diag-interrupt');
 assert.equal(d.element('diag-video').paused,true);
 assert.equal(d.element('diag-video').currentTime,3.5);
 assert.equal(d.timers.size,1);
 assert.equal([...d.timers.values()][0].ms,2000);
 d.tick(2000);
 assert.equal(d.element('diag-video').paused,false);
 assert.equal(d.element('diag-video').currentTime,3.5);
 assert.match(d.element('diag-events').textContent,/Interrupções: 1/);
 d.click('diag-interrupt');
 d.document.hidden=true;d.events.get('visibilitychange')();
 assert.equal(d.timers.size,0,'hidden tab cancels auto-restart');
 assert.equal(d.element('diag-video').paused,true);
 assert.match(d.element('diag-video-state').textContent,/segundo plano/);
});
test('invalid media and leaving page revoke blob URLs and cancel pending recovery',async()=>{
 const d=await createLab();
 d.pick({name:'unsafe.svg',size:999,type:'image/svg+xml'});
 assert.equal(d.objects.size,0);
 assert.match(d.element('diag-file-status').textContent,/recusado/);
 d.pick({name:'test.mp4',size:300,type:'video/mp4'});
 d.click('diag-play');d.click('diag-interrupt');
 assert.equal(d.timers.size,1);
 d.winEvents.get('pagehide')();
 assert.equal(d.timers.size,0);
 assert.equal(d.objects.size,0);
 assert.equal(d.element('diag-video').hidden,true);
});
test('new device diagnostic is offline, requires local user action and touches no live player',()=>{
 const html=fs.readFileSync('commercial-tv-device-lab.html','utf8');
 const js=fs.readFileSync('commercial-tv-device-lab.mjs','utf8');
 const helpers=fs.readFileSync('commercial-tv-device-metrics.mjs','utf8');
 assert.match(html,/LABORATÓRIO, NÃO PRODUÇÃO/);
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/media-src blob:/);
 assert.match(html,/script type="module" src="\.\/commercial-tv-device-lab.mjs"/);
 assert.match(html,/Simular interrupção \(2 s\)/);
 assert.match(js,/video\.addEventListener\('ended'/);
 assert.match(js,/document\.addEventListener\('visibilitychange'/);
 assert.match(js,/URL\.revokeObjectURL/);
 assert.match(js,/stage\.requestFullscreen/);
 for(const file of [html,js,helpers]){
  assert.doesNotMatch(file,/sb_secret_|service_role|\.supabase\.co|device-gateway|android-player\//);
  assert.doesNotMatch(file,/\bfetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|sendBeacon/);
 }
});
