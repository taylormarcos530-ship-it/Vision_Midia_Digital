import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../player.js',import.meta.url),'utf8');
const player=source.slice(source.indexOf('async function startPlayer()'),source.indexOf('function startLegacyPollingTimers()'));
const resume=source.slice(source.indexOf('const resumeSync = () => {'),source.indexOf("window.addEventListener('online', resumeSync)"));
function harness({valid=true,complete=true,online=true,push=false,linked=true}={}){
 const calls=[],timers=new Map();let tick=0,token=linked?'token-A':null,device='device-A',signal=push;
 const state={deviceToken:token,manifest:{device:{id:device},items:[{media:{id:'ad',type:'image',checksum:'x'}}]},serverAccessDenied:false,pushPending:false,clockAnchor:{},startupClockStartedAt:0};
 const navigator={onLine:online};
 const context={
  state,navigator,window:{VisionAndroid:{consumePushSignal:()=>{const x=signal;signal=false;return x;}}},
  performance:{now:()=>0},Math:{...Math,random:()=>.5},Array,Promise,
  MEDIA_CACHE:'test',caches:{open:async()=>({match:async()=>complete?{headers:{get:()=> '512'}}:undefined})},
  cacheKey:()=>({url:'test'}),localAccessState:()=>valid?'valid':'clock-grace',
  useQaBundle:()=>true,enforceLocalAccess:()=>false,showPlayback:()=>{},setStatus:()=>{},
  ensurePlaybackLoop:()=>calls.push('playback'),applyStartupPresentation:async()=>{},
  consumeNativeWatchdogRecovery:()=>'',queueDeviceEvent:()=>{},nativeAppVersion:()=> '1.5.24-stable',
  APP_VERSION:'1.5.24-stable',detectPlatform:()=> 'android',
  runBackgroundPoll:async fn=>{if(!navigator.onLine)return false;calls.push('bundle');return true;},
  runQaBundle:()=>{},startPairing:()=>calls.push('pair'),startLegacyPollingTimers:()=>{},
  staggeredPollInterval:x=>x,QA_BUNDLE_INTERVAL_MS:58000,
  setInterval:(fn,ms)=>{const id=++tick;timers.set(id,{fn,ms,interval:true});return id;},
  setTimeout:(fn,ms)=>{const id=++tick;timers.set(id,{fn,ms,interval:false});return id;},
  clearInterval:id=>timers.delete(id),clearTimeout:id=>timers.delete(id),
  syncManifest:()=>{},runBackgroundPoll2:()=>{},backgroundPollState:{},Date,
  flushPlaybackQueue:()=>{},flushDeviceEventQueue:()=>{},heartbeat:()=>{},
  '$':()=>({}),console
 };
 vm.createContext(context);
 vm.runInContext(player+'\n'+resume+'\nglobalThis.__start=startPlayer;globalThis.__resume=resumeSync;',context);
 return {state,calls,timers,context,async start(){await context.__start();await new Promise(resolve=>setImmediate(resolve));},fire(ms){for(const [id,t] of [...timers])if(t.ms===ms){if(!t.interval)timers.delete(id);t.fn();}},push(){signal=true;},online(v){navigator.onLine=v;},changePair(){state.deviceToken='token-B';state.manifest.device.id='device-B';},resume(){context.__resume();}};
}
test('cached and valid: playback immediate, bundle delayed',async()=>{
 const h=harness();await h.start();assert.ok(h.calls.includes('playback'));assert.equal(h.calls.includes('bundle'),false);h.fire(7500);assert.equal(h.calls.filter(x=>x==='bundle').length,1);
});
test('incomplete cache: bundle immediate',async()=>{const h=harness({complete:false});await h.start();assert.ok(h.calls.includes('bundle'));});
test('invalid clock: bundle immediate',async()=>{const h=harness({valid:false});await h.start();assert.ok(h.calls.includes('bundle'));});
test('offline: cache playback starts and reconnect uses one bundle',async()=>{const h=harness({online:false});await h.start();assert.ok(h.calls.includes('playback'));h.online(true);h.resume();assert.equal(h.calls.filter(x=>x==='bundle').length,1);h.fire(7500);assert.equal(h.calls.filter(x=>x==='bundle').length,1);});
test('push interrupts delayed first call',async()=>{const h=harness();await h.start();h.push();h.fire(1000);assert.equal(h.calls.filter(x=>x==='bundle').length,1);h.fire(7500);assert.equal(h.calls.filter(x=>x==='bundle').length,1);});
test('pairing change cancels stale timer',async()=>{const h=harness();await h.start();h.changePair();h.fire(7500);assert.equal(h.calls.filter(x=>x==='bundle').length,0);});
test('uncached unpaired starts pairing',async()=>{const h=harness({linked:false});await h.start();assert.ok(h.calls.includes('pair'));assert.equal(h.calls.includes('bundle'),false);});
test('focus and reconnect consolidated route, never legacy',async()=>{const h=harness();await h.start();h.resume();assert.equal(h.calls.filter(x=>x==='bundle').length,1);assert.ok(!h.calls.includes('heartbeat'));});
