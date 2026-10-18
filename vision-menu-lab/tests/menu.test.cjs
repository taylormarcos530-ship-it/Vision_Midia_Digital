const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const base = path.join(__dirname, '..');
const mod = p => import(pathToFileURL(path.join(base, p)).href);
const sample = () => Array.from({length:18},(_,i)=>({id:`id${i}`,name:`Produto ${i+1}`,priceCents:1000+i,enabled:true}));

test('template regions are proportional, fixed and within 16:9 bounds',async()=>{
  const {TEMPLATE_01,regionCss}=await mod('menu-template.mjs');
  assert.equal(TEMPLATE_01.width/TEMPLATE_01.height,16/9);
  for(const item of Object.values(TEMPLATE_01.regions)){
    const css=regionCss(item);assert.match(css.left,/%$/);assert.match(css.width,/%$/);
  }
  assert.throws(()=>regionCss({x:1900,y:0,width:100,height:100}),/outside/);
});
test('default state has fictitious products and eight visible',async()=>{
  const {createState,currentProducts}=await mod('menu-data.mjs');
  const state=createState();assert.equal(state.products.length,18);assert.equal(currentProducts(state).length,8);
});
test('18 products rotate 8 + 8 + 2, without page labels',async()=>{
  const {createState,currentProducts,nextPage}=await mod('menu-data.mjs');
  let s=createState(sample());assert.equal(currentProducts(s).length,8);
  s=nextPage(s);assert.equal(currentProducts(s)[0].id,'id8');
  s=nextPage(s);assert.equal(currentProducts(s).length,2);
  s=nextPage(s);assert.equal(s.pageIndex,0);
});
test('empty and disabled products remain safe',async()=>{
  const {createState,currentProducts,nextPage,editProduct}=await mod('menu-data.mjs');
  let s=createState([]);assert.deepEqual(currentProducts(s),[]);assert.equal(nextPage(s).pageIndex,0);
  s=createState(sample());s=editProduct(s,'id0',{enabled:false});assert.equal(currentProducts(s)[0].id,'id1');
});
test('name and price validation',async()=>{
  const {normalizeName,parsePrice,formatPrice}=await mod('menu-data.mjs');
  assert.equal(normalizeName('  Contra   filé  '),'Contra filé');
  assert.equal(parsePrice('78,90'),7890);assert.equal(parsePrice('12.5'),1250);assert.equal(parsePrice('0'),0);
  assert.equal(formatPrice(7890),'78,90');
  for(const bad of ['1.2.3','-3','1,999','R$ 100','','Infinity','1e3'])assert.throws(()=>parsePrice(bad));
  assert.throws(()=>normalizeName(' '.repeat(4)));
});
test('insert, edit, move, disable and delete never change other products',async()=>{
  const {createState,addProduct,editProduct,moveProduct,deleteProduct}=await mod('menu-data.mjs');
  let s=createState([]);s=addProduct(s,{id:'a',name:'Picanha',priceCents:7500});
  s=addProduct(s,{id:'b',name:'Alcatra',priceCents:4300});
  s=editProduct(s,'a',{name:'Nova Picanha',priceCents:7800});
  assert.equal(s.products[0].priceCents,7800);assert.equal(s.products[1].name,'Alcatra');
  s=moveProduct(s,'b',-1);assert.equal(s.products[0].id,'b');
  s=editProduct(s,'b',{enabled:false});assert.equal(s.products[0].enabled,false);
  s=deleteProduct(s,'a');assert.equal(s.products.length,1);
  assert.throws(()=>addProduct(s,{id:'b',name:'Duplicado',priceCents:0}),/duplicado/);
});
test('only allowed intervals',async()=>{
  const {createState,setIntervalSeconds}=await mod('menu-data.mjs');
  for(const seconds of [5,10,15])assert.equal(setIntervalSeconds(createState(),seconds).intervalSeconds,seconds);
  assert.throws(()=>setIntervalSeconds(createState(),1));
});
test('saved draft parses safely and rejects malformed or duplicated IDs',async()=>{
  const {createState,parseSavedState}=await mod('menu-data.mjs');
  const state=createState(sample());const raw=JSON.parse(JSON.stringify(state));
  assert.equal(parseSavedState(raw).products.length,18);
  raw.products.push({...raw.products[0]});assert.throws(()=>parseSavedState(raw));
  assert.throws(()=>parseSavedState({products:[{id:'a',name:'X',priceCents:-3}]}));
});
test('TV HTML contains one permanent video and no page labels',()=>{
  const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
  const js=fs.readFileSync(path.join(base,'menu.js'),'utf8');
  assert.equal((html.match(/<video\b/g)||[]).length,1);
  assert.doesNotMatch(html,/Página \d|Grupo \d/);
  assert.match(js,/renderBoardProducts\(\)/);
  assert.match(js,/const video = \$\('menu-video'\)/);
});
test('laboratory has no production calls or import of official scripts',()=>{
  const files=['index.html','menu.js','menu-data.mjs','menu-template.mjs'];
  for(const file of files){const text=fs.readFileSync(path.join(base,file),'utf8');assert.doesNotMatch(text,/https?:\/\/|supabase\.co|service_role|player\.js|app\.js|device-gateway/);}
});
