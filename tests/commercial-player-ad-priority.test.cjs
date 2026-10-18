'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const playerSource=fs.readFileSync('player.js','utf8');
const commercialSource=fs.readFileSync('supabase/functions/_shared/commercial.mjs','utf8');
// Execute the very helper used by the official Player, not an independently
// reimplemented approximation. No document, network, device or Supabase access.
const match=playerSource.match(/  function findNewPointMediaPriority\(previousItems, nextItems, timeZone\) \{[\s\S]*?\n  \}/);
assert.ok(match,'official Player priority helper is required');
const context={itemScheduleActive:(item,zone)=>zone==='America/Sao_Paulo'&&item.schedule?.enabled!==false};
vm.runInNewContext(match[0]+';this.priority=findNewPointMediaPriority',context);
const priority=context.priority;
const item=(id,commercial=false)=>({id,commercial,media:{id},schedule:{enabled:true}});
test('commercial ads from the real gateway are explicitly identifiable',()=>{
 assert.match(commercialSource,/id:r\.id,commercial:true,essential:false/);
 assert.match(playerSource,/findNewPointMediaPriority\(state\.manifest\.items, manifest\.items/);
});
test('new ads at items 4 and 8 never leap ahead of six customer items',()=>{
 const old=Array.from({length:6},(_,i)=>item('point-'+(i+1)));
 const next=[...old.slice(0,3),item('rev-1',true),...old.slice(3),item('rev-2',true)];
 assert.equal(next[3].commercial,true);
 assert.equal(next[7].commercial,true);
 assert.equal(priority(old,next,'America/Sao_Paulo'),null);
});
test('new customer media still receives expected priority over new ad',()=>{
 const old=Array.from({length:6},(_,i)=>item('point-'+(i+1)));
 const next=[...old.slice(0,3),item('rev-1',true),...old.slice(3),item('point-7'),item('rev-2',true)];
 assert.equal(priority(old,next,'America/Sao_Paulo'),'point-7');
 assert.equal(priority(old,[...old.slice(0,3),item('rev-1',true),...old.slice(3)],'America/Manaus'),null);
});
test('reconnection with unchanged point content and changing ad revision does not change priority',()=>{
 const first=[...Array.from({length:3},(_,i)=>item('point-'+(i+1))),item('rev-old',true),...Array.from({length:3},(_,i)=>item('point-'+(i+4))),item('rev-old-2',true)];
 const next=first.map(i=>i.commercial?item(i.id==='rev-old'?'rev-new':'rev-new-2',true):i);
 assert.equal(priority(first,next,'America/Sao_Paulo'),null);
 assert.equal(first[0].id,next[0].id);
 assert.equal(next[3].id,'rev-new');
 assert.equal(next[7].id,'rev-new-2');
});
