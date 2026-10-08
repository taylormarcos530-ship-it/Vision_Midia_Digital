const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const player=fs.readFileSync(require('node:path').join(__dirname,'../player.js'),'utf8');
function fn(src,name){const start=src.indexOf(`  async function ${name}(`)>=0?src.indexOf(`  async function ${name}(`):src.indexOf(`  function ${name}(`);assert.ok(start>=0,`${name} missing`);return src.slice(start,src.indexOf('\n  }',start)+4)}
test('online transition keeps previous image visible until iframe load',async()=>{
 const previous={tag:'image'},children=[previous],listeners={},frame={style:{},setAttribute(){},addEventListener(t,f){listeners[t]=f},removeEventListener(){},remove(){const i=children.indexOf(this);if(i>=0)children.splice(i,1)}};
 const stage={appendChild(el){children.push(el)},children};let swap=false;
 const c=vm.createContext({state:{playlistNonce:1,currentMediaId:null,deviceToken:null},navigator:{onLine:true},URL,location:{href:'https://example.com/player.html'},document:{createElement:()=>frame},window:{addEventListener(){},removeEventListener(){}},Date,setTimeout,clearTimeout,hideIdle(){},$:()=>stage,resolveOnlineMediaUrl:x=>x,waitForChangeOrTimeout:()=>new Promise(()=>{}),swapStageElement(s,el){swap=true;children.splice(0,children.length,el)},queueDeviceEvent(){},console,sleep:async()=>{}});
 vm.runInContext((player.includes('  async function prepareOnlineFrame(')?fn(player,'prepareOnlineFrame'):'')+'\n'+fn(player,'playItem'),c);
 const pending=c.playItem({media:{id:'u',type:'url',url:'https://other.example/',name:'URL'},duration_seconds:5},{id:'p'},{},1);
 await new Promise(r=>setImmediate(r));assert.equal(swap,false);assert.equal(children[0],previous);assert.equal(frame.style.visibility,'hidden');
 listeners.load();await new Promise(r=>setImmediate(r));assert.equal(swap,true);assert.equal(children[0],frame);assert.notEqual(frame.style.visibility,'hidden');
 c.state.playlistNonce=2;
});
test('manifest updates do not wait for background cache',async()=>{
 let cacheResolve;const cacheWait=new Promise(r=>cacheResolve=r);const manifest={version:'new',items:[{media:{id:'new',type:'image'}}]};
 const state={deviceToken:'token',manifest:{version:'old',items:[{media:{id:'old'}}]},playlistNonce:0};
 const c=vm.createContext({state,enforceLocalAccess:()=>false,gateway:async()=>manifest,applyDeviceSettings:async()=>{},cacheManifestAssets:()=>cacheWait,itemScheduleActive:()=>true,Date,MANIFEST_KEY:'manifest',writeJson(){},showPlayback(){},queueDeviceEvent(){},navigator:{onLine:true},setStatus(){},ensurePlaybackLoop(){},console,isAccessError:()=>false});
 vm.runInContext(fn(player,'syncManifest'),c);let done=false;const p=c.syncManifest().then(()=>done=true);await new Promise(r=>setImmediate(r));assert.equal(done,true);assert.equal(state.manifest,manifest);assert.equal(state.priorityMediaId,'new');cacheResolve();await p;
});
test('linking media immediately requests sync for affected TVs',async()=>{
 const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8'),calls=[];
 const state={company:{id:'tenant'},media:[{id:'m',name:'Image',media_type:'image'}],playlists:[{id:'p',name:'Main'}],playlistItems:[]};
 const c=vm.createContext({state,restRequest:async()=>{},toast(){},loadAllData:async()=>{},syncPlaylistDevices:async p=>calls.push(p)});vm.runInContext(fn(app,'linkMediaToPlaylist'),c);await c.linkMediaToPlaylist('m','p');assert.deepEqual(calls,['p']);
});
test('failed online preparation preserves current content',async()=>{
 const previous={},children=[previous],frame={style:{},addEventListener(){},removeEventListener(){},remove(){children.splice(children.indexOf(this),1)}};
 const c=vm.createContext({state:{playlistNonce:1},navigator:{onLine:true},waitForChangeOrTimeout:async()=> 'timeout',swapStageElement(){throw Error('must preserve previous content')}});
 vm.runInContext(fn(player,'prepareOnlineFrame'),c);assert.equal(await c.prepareOnlineFrame({appendChild:x=>children.push(x)},frame,'https://example.com',1),false);assert.deepEqual(children,[previous]);
});
test('immediate sync only targets active TVs of the current tenant and playlist',async()=>{
 const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8'),calls=[];
 const devices=[{id:'yes',company_id:'a',playlist:'p'},{id:'other',company_id:'b',playlist:'p'},{id:'retired',company_id:'a',playlist:'p',retired_at:'today'},{id:'disabled',company_id:'a',playlist:'p',status:'disabled'},{id:'different',company_id:'a',playlist:'q'}];
 const c=vm.createContext({state:{company:{id:'a'},companyRole:'owner',devices},devicePlaybackHealth:d=>({playlistId:d.playlist}),functionRequest:async(n,o)=>{calls.push(o.body.device_id);throw Error('offline')},console:{warn(){}}});vm.runInContext(fn(app,'syncPlaylistDevices'),c);await c.syncPlaylistDevices('p');assert.deepEqual(calls,['yes']);
});
