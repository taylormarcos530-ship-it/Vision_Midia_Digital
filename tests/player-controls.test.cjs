const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function fn(src,name){const start=src.indexOf('  async function '+name+'(');assert.ok(start>=0,name);return src.slice(start,src.indexOf('\n  }',start)+4)}
test('audio setting reaches native output as well as the current playlist video',async()=>{
 const video={muted:false},native=[];const c=vm.createContext({state:{},window:{VisionAndroid:{setAudioEnabled:x=>native.push(x),setAutostart(){},setKioskReturn(){}}},applyPlayerOrientation:async()=>{},$:()=>video,localStorage:{getItem:()=>0},CACHE_REV_KEY:'cache',console});vm.runInContext(fn(read('player.js'),'applyDeviceSettings'),c);
 await c.applyDeviceSettings({audio_enabled:false});assert.equal(video.muted,true);assert.deepEqual(native,[false]);await c.applyDeviceSettings({audio_enabled:true});assert.equal(video.muted,false);assert.deepEqual(native,[false,true]);
});
test('TV kiosk change is persisted remotely before updating native state',async()=>{
 const calls=[],native=[],state={deviceToken:'paired',manifest:{device:{settings:{audio_enabled:false}},items:[]}};
 const c=vm.createContext({state,gateway:async b=>{calls.push(b);return {ok:true,settings:{audio_enabled:false,kiosk_return_enabled:true}}},window:{VisionAndroid:{showSettingsResult:(...x)=>native.push(x)}},applyDeviceSettings:async s=>{native.push(s.kiosk_return_enabled)},writeJson(){},MANIFEST_KEY:'m',console});vm.runInContext(fn(read('player.js'),'changeKioskReturn'),c);
 await c.changeKioskReturn(true);assert.equal(calls[0].action,'player_settings');assert.equal(calls[0].kiosk_return_enabled,true);assert.equal(state.manifest.device.settings.audio_enabled,false);assert.equal(native[0],true);
});
test('failed TV kiosk save does not silently change the native setting',async()=>{
 let applied=false,result;const c=vm.createContext({state:{deviceToken:'paired'},gateway:async()=>{throw Error('offline')},window:{VisionAndroid:{showSettingsResult:(...x)=>result=x}},applyDeviceSettings:async()=>applied=true,console});vm.runInContext(fn(read('player.js'),'changeKioskReturn'),c);await c.changeKioskReturn(false);assert.equal(applied,false);assert.equal(result[1],false);
});
function gatewayFixture(device,rows) {
 const source=read('supabase/functions/device-gateway/index.ts');let handler;const queries=[];
 const admin={from:table=>{let filters={},body;const q={update:b=>(body=b,q),eq:(k,v)=>(filters[k]=v,q),select:()=>q,maybeSingle:async()=>{queries.push({table,filters,body});const row=rows.find(x=>Object.entries(filters).every(([k,v])=>x[k]===v));if(row)Object.assign(row,body);return {data:row||null,error:null}}};return q}};
 const c=vm.createContext({Deno:{serve:f=>handler=f},Response,console,Date,adminClient:()=>admin,authenticateDevice:async()=>device,json:(body,status=200)=>new Response(JSON.stringify(body),{status})});vm.runInContext(source.slice(source.indexOf('Deno.serve(')),c);
 return {queries,run:b=>handler({method:'POST',json:async()=>b})};
}
test('native kiosk endpoint changes only authenticated TV, preserves audio and rejects stale settings',async()=>{
 const device={id:'tv',company_id:'tenant',updated_at:'v1',settings:{audio_enabled:false,autostart_enabled:true}};const other={id:'foreign',company_id:'other',updated_at:'v1',settings:{}};const row={...device};const f=gatewayFixture(device,[row,other]);
 const r=await f.run({action:'player_settings',kiosk_return_enabled:true,device_id:'foreign',company_id:'other',audio_enabled:true});assert.equal(r.status,200);assert.equal(row.settings.kiosk_return_enabled,true);assert.equal(row.settings.audio_enabled,false);assert.equal(other.settings.kiosk_return_enabled,undefined);assert.equal(f.queries[0].filters.updated_at,'v1');
 row.updated_at='v2';const conflict=await f.run({action:'player_settings',kiosk_return_enabled:false});assert.equal(conflict.status,409);assert.equal(row.settings.kiosk_return_enabled,true);
});
test('native kiosk endpoint rejects unauthenticated, blocked and non boolean requests',async()=>{
 for(const [device,body,want] of [[null,{kiosk_return_enabled:true},401],[{access_block:'blocked'},{kiosk_return_enabled:true},403],[{id:'tv',company_id:'tenant',settings:{}},{kiosk_return_enabled:'false'},400]]){const f=gatewayFixture(device,[]);assert.equal((await f.run({action:'player_settings',...body})).status,want);assert.equal(f.queries.length,0)}
});
