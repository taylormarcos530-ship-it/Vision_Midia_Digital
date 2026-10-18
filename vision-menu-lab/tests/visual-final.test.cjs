const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const template = () => import(pathToFileURL(path.join(root, 'menu-template.mjs')).href);

test('fixed reference layout keeps logo and heading separate', async () => {
  const {TEMPLATE_01:t} = await template();
  assert.equal(t.width / t.height, 16 / 9);
  assert.ok(t.regions.logo.y + t.regions.logo.height < t.regions.heading.y);
});

test('table, video and footer occupy non-overlapping stable regions', async () => {
  const {TEMPLATE_01:t} = await template();
  const r=t.regions;
  assert.ok(r.products.x + r.products.width < r.video.x);
  assert.ok(r.products.y + r.products.height < r.footer.y);
  assert.ok(r.video.y + r.video.height < r.footer.y);
});

test('video proportions and right-hand composition stay inside 16:9 canvas', async () => {
  const {TEMPLATE_01:t,regionCss} = await template();
  const r=t.regions.video;
  assert.ok(r.x > t.width*.48 && r.width > t.width*.40);
  assert.ok(r.height > t.height*.45);
  assert.ok(parseFloat(regionCss(r).left) + parseFloat(regionCss(r).width) <= 100);
});

test('layout typography scales with preview canvas, never with external screen size', () => {
  const css=fs.readFileSync(path.join(root,'menu.css'),'utf8');
  assert.match(css,/\.tv-canvas\{container-type:inline-size\}/);
  assert.match(css,/\.tv-product-name,\.tv-product-price\{font-size:clamp\([^}]*cqw/);
});

test('visual calibration does not add any live integrations or replace persistent video', () => {
  for(const name of ['menu-template.mjs','menu.css']){
    const text=fs.readFileSync(path.join(root,name),'utf8');
    assert.doesNotMatch(text,/supabase\.co|device-gateway|commercial-tv|player\.js|app\.js/);
  }
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.equal((html.match(/<video\s/g) || []).length,1);
});
