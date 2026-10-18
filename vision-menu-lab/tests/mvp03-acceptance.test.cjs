const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const open = file => import(pathToFileURL(path.join(root, file)).href);
const samples = n => Array.from({length:n}, (_, i) => ({
  id:`p${i + 1}`, name:`Corte ${i + 1}`, priceCents:(i + 1) * 100, enabled:true,
}));

test('24 products show exactly three complete eight-product cycles', async () => {
  const {createState, currentProducts, nextPage} = await open('menu-data.mjs');
  let s = createState(samples(24));
  for (const start of [1,9,17]) {
    const visible = currentProducts(s);
    assert.equal(visible.length, 8);
    assert.equal(visible[0].name, `Corte ${start}`);
    s = nextPage(s);
  }
  assert.equal(s.pageIndex, 0);
});

test('one product and no products never create empty numbered pages', async () => {
  const {createState, currentProducts, nextPage} = await open('menu-data.mjs');
  for (const size of [0,1]) {
    let s = createState(samples(size));
    for (let i = 0; i < 5; i++) {
      assert.equal(currentProducts(s).length, size);
      s = nextPage(s);
      assert.equal(s.pageIndex, 0);
    }
  }
});

test('price update remains isolated to one product and preserves order', async () => {
  const {createState,editProduct} = await open('menu-data.mjs');
  const before = createState(samples(12));
  const after = editProduct(before, 'p2', {priceCents: 8890});
  assert.equal(after.products[1].priceCents, 8890);
  assert.equal(before.products[1].priceCents, 200);
  assert.deepEqual(after.products.map(p => p.id),before.products.map(p=>p.id));
  assert.deepEqual(after.products.filter(p=>p.id!=='p2'),before.products.filter(p=>p.id!=='p2'));
});

test('saved state cannot smuggle out-of-range price or invalid interval', async () => {
  const {parseSavedState} = await open('menu-data.mjs');
  assert.throws(() => parseSavedState({products:[{id:'p1',name:'Carne',priceCents:Infinity}]}));
  assert.throws(() => parseSavedState({products:[{id:'p1',name:'Carne',priceCents:100000000}]}));
  assert.equal(parseSavedState({products:samples(1), intervalSeconds:999}).intervalSeconds,10);
});

test('video is a separate persistent element, table update edits only row spans', () => {
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const source = fs.readFileSync(path.join(root,'menu.js'),'utf8');
  assert.equal((html.match(/<video\s/g)||[]).length,1);
  assert.match(html, /id="tv-products"/);
  assert.match(source, /function renderBoardProducts\(\)\s*\{[\s\S]*?slots\.forEach/);
  const section = source.split('function renderBoardProducts() {')[1].split('\nfunction ')[0];
  assert.doesNotMatch(section,/video\.|replaceChildren|\.src\s*=/);
  const advance = source.split('function advanceProducts() {')[1].split('\nfunction ')[0];
  assert.doesNotMatch(advance,/video\.|replaceChildren|\.src\s*=/);
});

test('layout remains proportional and source-free of production integrations', async () => {
  const {TEMPLATE_01,regionCss} = await open('menu-template.mjs');
  assert.equal(TEMPLATE_01.width / TEMPLATE_01.height,16/9);
  for (const region of Object.values(TEMPLATE_01.regions)) {
    const css = regionCss(region);
    assert.ok(parseFloat(css.left)+parseFloat(css.width)<=100.00001);
    assert.ok(parseFloat(css.top)+parseFloat(css.height)<=100.00001);
  }
  for (const file of ['index.html','menu.js','menu-data.mjs','menu-template.mjs']) {
    const content = fs.readFileSync(path.join(root,file),'utf8');
    assert.doesNotMatch(content,/supabase\.co|device-gateway|commercial-tv|\bplayer\.js\b|\bapp\.js\b/);
  }
});

