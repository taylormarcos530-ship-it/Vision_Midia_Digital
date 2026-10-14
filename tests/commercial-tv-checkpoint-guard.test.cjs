const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=()=>import('../commercial-tv-auto-state.mjs');

test('restart accepts a compatible programming revision and preserves the commercial cycle',async()=>{
 const {createAutoBench,advanceAutoBench,autoBenchView,restoreAutoBench}=await load();
 let state=createAutoBench({baseCount:6,adCount:5,programRevision:'v1'});
 for(let i=0;i<11;i++)state=advanceAutoBench(state,{type:'complete',token:autoBenchView(state).token}).state;
 const oldToken=autoBenchView(state).token;
 const clone=JSON.parse(JSON.stringify(state));
 const result=restoreAutoBench(clone,{baseCount:6,adCount:5,programRevision:'v1'});
 assert.equal(result.accepted,true);
 assert.equal(result.state.cycle,1);
 assert.equal(result.state.position,3);
 assert.equal(result.state.completedItems,11);
 assert.equal(autoBenchView(result.state).included,2);
 assert.notEqual(autoBenchView(result.state).token,oldToken);
 assert.equal(advanceAutoBench(result.state,{type:'complete',token:oldToken}).accepted,false);
});
test('changed commercial inventory after restart blocks all ads without altering client base media',async()=>{
 const {createAutoBench,autoBenchView,restoreAutoBench}=await load();
 const before=createAutoBench({baseCount:6,adCount:5,programRevision:'v1'});
 const result=restoreAutoBench(before,{baseCount:6,adCount:2,programRevision:'v2'});
 assert.equal(result.accepted,false);
 assert.equal(result.state.options.enabled,false);
 assert.deepEqual(autoBenchView(result.state).items.map(item=>item.id),
  ['base-1','base-2','base-3','base-4','base-5','base-6']);
 assert.equal(autoBenchView(result.state).included,0);
 assert.match(result.reason,/Programação alterada/);
});
test('changed playlist content or revision cannot silently restore earlier campaign positions',async()=>{
 const {createAutoBench,autoBenchView,restoreAutoBench}=await load();
 const c=createAutoBench({baseCount:6,adCount:5,programRevision:'playlist-rev-1'});
 for(const program of [
  {baseCount:3,adCount:5,programRevision:'playlist-rev-2'},
  {baseCount:6,adCount:5,programRevision:'playlist-rev-2'},
  {baseCount:0,adCount:5,programRevision:'playlist-rev-2'},
  {baseCount:6,adCount:5,shuffle:true,programRevision:'playlist-rev-1'},
  {baseCount:6,adCount:5,scheduled:true,programRevision:'playlist-rev-1'}
 ]){
  const restored=restoreAutoBench(c,program);
  assert.equal(restored.accepted,false);
  assert.equal(autoBenchView(restored.state).included,0);
  assert.equal(restored.state.options.enabled,false);
 }
});
test('tampered checkpoint signature or manipulated options are rejected with commercials disabled',async()=>{
 const {createAutoBench,restoreAutoBench,autoBenchView}=await load();
 const source=createAutoBench({baseCount:6,adCount:5});
 const variants=[
  {...source,programSignature:'wrong'},
  {...source,options:{...source.options,adCount:2}},
  {...source,options:{...source.options,baseCount:3}},
  {...source,programRevision:'other-v1'},
  {...source,programSignature:null},
  {...source,programRevision:null},
  {...source,programSignature:undefined}
 ];
 for(const altered of variants){
  const result=restoreAutoBench(altered);
  assert.equal(result.accepted,false);
  assert.equal(autoBenchView(result.state).included,0);
 }
});
test('configure updates checkpoint identity; no-playlist compatible checkpoint stays empty',async()=>{
 const {createAutoBench,advanceAutoBench,autoBenchView,restoreAutoBench}=await load();
 let state=createAutoBench({baseCount:6,adCount:5});
 const previousSignature=state.programSignature;
 const oldCheckpoint=JSON.parse(JSON.stringify(state));
 state=advanceAutoBench(state,{type:'configure',options:{baseCount:3,adCount:1}}).state;
 assert.notEqual(state.programSignature,previousSignature);
 assert.equal(restoreAutoBench(state,{baseCount:3,adCount:1}).accepted,true);
 assert.equal(restoreAutoBench(oldCheckpoint,{baseCount:3,adCount:1}).accepted,false);
 const empty=createAutoBench({baseCount:0,adCount:5});
 const restored=restoreAutoBench(empty,{baseCount:0,adCount:5});
 assert.equal(restored.accepted,true);
 assert.equal(autoBenchView(restored.state).status,'Aguardando playlist');
 assert.equal(autoBenchView(restored.state).included,0);
});
test('checkpoint identity is deterministic and does not persist or query customer resources',async()=>{
 const {autoBenchProgramSignature}=await load();
 assert.equal(autoBenchProgramSignature({baseCount:6,adCount:5}),
  autoBenchProgramSignature({baseCount:6,adCount:5}));
 assert.notEqual(autoBenchProgramSignature({baseCount:6,adCount:5},'v1'),
  autoBenchProgramSignature({baseCount:6,adCount:5},'v2'));
 const js=fs.readFileSync('commercial-tv-auto-state.mjs','utf8');
 assert.match(js,/programSignature!==autoBenchProgramSignature/);
 assert.match(js,/Programação alterada no reinício/);
 assert.doesNotMatch(js,/fetch\(|createClient\(|localStorage|sessionStorage|supabase\.co|\/rest\/v1/);
});
