const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function fn(name){const start=src.indexOf(`  async function ${name}(`);return src.slice(start,src.indexOf('\n  }',start)+4);}
test('arrows persist the sequence and request TV synchronization',async()=>{
 const calls=[],sync=[],state={editingPlaylistId:'p',company:{id:'c'},playlistItems:[{id:'a',playlist_id:'p',position:0},{id:'b',playlist_id:'p',position:1},{id:'z',playlist_id:'other',position:0}]};
 const c=vm.createContext({state,restRequest:async(_,o)=>calls.push(o),renderPlaylistEditor(){},renderMedia(){},toast(){},loadAllData:async()=>{},syncPlaylistDevices:async id=>sync.push(id)});
 vm.runInContext(fn('persistPlaylistOrder')+'\n'+fn('movePlaylistItem'),c);
 await c.movePlaylistItem('b','up');assert.equal(state.playlistItems[1].position,0);assert.equal(state.playlistItems[0].position,1);assert.equal(state.playlistItems[2].position,0);assert.deepEqual(sync,['p']);assert.ok(calls.every(x=>x.query.includes('company_id=eq.c')));
 await c.movePlaylistItem('b','up');assert.equal(sync.length,1);
});
test('touch drag saves full playlist order; cancelled gesture does not save',()=>{
 const handlers={},saved=[],classes=()=>({add(){},remove(){}}),parent={};
 const a={dataset:{playlistDragItem:'a'},parentElement:parent,classList:classes()},b={dataset:{playlistDragItem:'b'},parentElement:parent,classList:classes(),closest:()=>null};
 const handle={closest:()=>a,setPointerCapture(){}};
 const state={editingPlaylistId:'p',playlistItems:[{id:'a',playlist_id:'p',position:0},{id:'b',playlist_id:'p',position:1},{id:'c',playlist_id:'p',position:2}]};
 const document={addEventListener:(n,f)=>handlers[n]=f,elementFromPoint:()=>({closest:()=>b})};
 const c=vm.createContext({state,document,$$:()=>[a,b],persistPlaylistOrder:ids=>saved.push(Array.from(ids))});
 const start=src.indexOf('    let playlistPointerDrag = null;'),end=src.indexOf("    document.addEventListener('dragstart'",start);
 vm.runInContext(src.slice(start,end),c);
 const down={target:{closest:()=>handle},button:0,pointerId:1,preventDefault(){}};
 handlers.pointerdown(down);handlers.pointermove({pointerId:1,clientX:10,clientY:10});handlers.pointerup({pointerId:1,type:'pointerup'});
 assert.deepEqual(saved,[['b','a','c']]);
 handlers.pointerdown(down);handlers.pointermove({pointerId:1,clientX:10,clientY:10});handlers.pointercancel({pointerId:1,type:'pointercancel'});assert.equal(saved.length,1);
});

test('library arrows target chosen playlist without an open editor',async()=>{
 const sync=[],state={editingPlaylistId:null,company:{id:'c'},playlistItems:[{id:'a',playlist_id:'p',position:0},{id:'b',playlist_id:'p',position:1},{id:'z',playlist_id:'q',position:0}]};
 const c=vm.createContext({state,restRequest:async()=>{},renderPlaylistEditor(){throw Error('editor is closed')},renderMedia(){},toast(){},loadAllData:async()=>{},syncPlaylistDevices:async id=>sync.push(id)});
 vm.runInContext(fn('persistPlaylistOrder')+'\n'+fn('movePlaylistItem'),c);
 await c.movePlaylistItem('b','up','p');assert.equal(state.playlistItems[1].position,0);assert.equal(state.playlistItems[2].position,0);assert.deepEqual(sync,['p']);
});
