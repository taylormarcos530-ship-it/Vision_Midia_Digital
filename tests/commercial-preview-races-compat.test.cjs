// OFFLINE LAB ONLY: deterministic lifecycle races and old DOM API fallbacks.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const modulePromise=import('../commercial-ui.mjs');
const imagePath='commercial-ads/00000000-0000-4000-8000-000000000301.webp';
const videoPath='commercial-ads/00000000-0000-4000-8000-000000000302.mp4';
const signed=(target=imagePath,token='new')=>({
 signedURL:'/object/sign/vision-media/'+target+'?token='+token
});
const revision=(path=imagePath,id='rev-1',media_type='image')=>({
 revisions:[{id,name:'Foto fictícia',media_type,storage_path:path}]
});
const apiWith=request=>({
 config:{supabaseUrl:'https://fixture.invalid'},request
});
function deferred(){
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}
async function withDom(fn,{oldDom=false,videoSupport='maybe'}={}){
 const previousDocument=globalThis.document,previousCss=globalThis.CSS;
 const created=[];
 const slot={
  children:[],notice:0,isConnected:true,
  get firstChild(){return this.children[0]||null;},
  appendChild(el){this.children.push(el);return el;},
  removeChild(el){
   const index=this.children.indexOf(el);
   if(index>=0)this.children.splice(index,1);
   return el;
  },
  contains(el){return this.children.includes(el);},
  insertAdjacentHTML(_where,html){
   assert.match(html,/Prévia indisponível no momento/);
   this.notice++;
  }
 };
 if(!oldDom)slot.replaceChildren=(...items)=>{slot.children=items;};
 const root={querySelector:selector=>
  selector==='[data-revision="rev-1"]'?slot:null};
 globalThis.document={createElement:kind=>{
  const el={kind,src:null,controls:false,preload:null,playsInline:false,alt:'',onerror:null};
  if(kind==='video')el.canPlayType=()=>videoSupport;
  created.push(el);
  return el;
 }};
 // WebViews lacking CSS.escape must still be supported by the preview code.
 delete globalThis.CSS;
 try{return await fn({slot,root,created});}
 finally{
  if(previousDocument===undefined)delete globalThis.document;
  else globalThis.document=previousDocument;
  if(previousCss===undefined)delete globalThis.CSS;else globalThis.CSS=previousCss;
 }
}
test('preview accepts UUID-backed revision with CSS.escape missing and without replaceChildren',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot,created})=>{
  const api=apiWith(async()=>signed());
  await loadThumbnails(root,revision(),api);
  assert.equal(created.length,1);
  assert.equal(slot.children[0],created[0]);
  assert.match(created[0].src,/token=new/);
 },{oldDom:true});
});
test('older DOM fallback clears broken media and displays notice without replaceChildren',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot})=>{
  await loadThumbnails(root,revision(videoPath,'rev-1','video'),
   apiWith(async()=>signed(videoPath)));
  assert.equal(slot.children.length,1);
  slot.children[0].onerror();
  assert.equal(slot.children.length,0);
  assert.equal(slot.notice,1);
 },{oldDom:true});
});
test('late original signature never overwrites newer commercial media',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot})=>{
  const first=deferred();
  const slow=loadThumbnails(root,revision(),apiWith(()=>first.promise));
  await loadThumbnails(root,revision(),apiWith(async()=>signed(imagePath,'fresh')));
  assert.match(slot.children[0].src,/token=fresh/);
  first.resolve(signed(imagePath,'stale'));
  await slow;
  assert.match(slot.children[0].src,/token=fresh/);
  assert.equal(slot.notice,0);
 });
});
test('late rejected signature cannot replace newer preview with an error',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot})=>{
  const pending=deferred();
  const first=loadThumbnails(root,revision(),apiWith(()=>pending.promise));
  await loadThumbnails(root,revision(),apiWith(async()=>signed(imagePath,'latest')));
  pending.reject(Error('Stale 403'));
  await first;
  assert.match(slot.children[0].src,/token=latest/);
  assert.equal(slot.notice,0);
 });
});
test('late corrupted-media callback cannot clear new preview in old DOM',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot})=>{
  await loadThumbnails(root,revision(),apiWith(async()=>signed(imagePath,'old')));
  const old=slot.children[0];
  await loadThumbnails(root,revision(),apiWith(async()=>signed(imagePath,'latest')));
  old.onerror();
  assert.match(slot.children[0].src,/token=latest/);
  assert.equal(slot.notice,0);
 },{oldDom:true});
});
test('newer invalid path cancels earlier outstanding signature without exposing source',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot})=>{
  const p=deferred();
  const first=loadThumbnails(root,revision(),apiWith(()=>p.promise));
  await loadThumbnails(root,revision('private-owner/point-media.png'),
   apiWith(()=>{throw Error('Must not sign private source')}));
  assert.equal(slot.children.length,0);
  assert.equal(slot.notice,1);
  p.resolve(signed(imagePath,'stale'));
  await first;
  assert.equal(slot.children.length,0);
  assert.equal(slot.notice,1);
 });
});
test('removed DOM slot ignores signed responses arriving after a full card refresh',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot,created})=>{
  const p=deferred();
  const first=loadThumbnails(root,revision(),apiWith(()=>p.promise));
  slot.isConnected=false;
  p.resolve(signed(imagePath));
  await first;
  assert.equal(slot.children.length,0);
  assert.equal(created.length,0);
  assert.equal(slot.notice,0);
 });
});
test('unsupported simulated MP4 format displays notice and does not start downloading video',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot,created})=>{
  await loadThumbnails(root,revision(videoPath,'rev-1','video'),apiWith(async()=>signed(videoPath)));
  assert.equal(created.length,1);
  assert.equal(created[0].src,null);
  assert.equal(slot.children.length,0);
  assert.equal(slot.notice,1);
 },{oldDom:true,videoSupport:''});
});
test('malformed IDs are ignored and never interpolated into CSS selectors',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot,created})=>{
  let requested=false;
  await loadThumbnails(root,revision(imagePath,'rev-1"] img, body'),apiWith(()=>{
   requested=true;return signed();
  }));
  assert.equal(requested,false);
  assert.equal(created.length,0);
  assert.equal(slot.children.length,0);
 });
});
test('two concurrently resolved media requests retain only newest accepted version',async()=>{
 const {loadThumbnails}=await modulePromise;
 await withDom(async({root,slot})=>{
  const first=deferred(),second=deferred();
  const oldest=loadThumbnails(root,revision(),apiWith(()=>first.promise));
  const newest=loadThumbnails(root,revision(),apiWith(()=>second.promise));
  second.resolve(signed(imagePath,'second'));
  await newest;
  first.resolve(signed(imagePath,'first'));
  await oldest;
  assert.match(slot.children[0].src,/token=second/);
  assert.equal(slot.children.length,1);
 });
});
