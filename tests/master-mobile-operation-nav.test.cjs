const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = read('master.html');
const css = read('master.css');
const script = read('master.js');
const app = read('app.js');

test('Master keeps authenticated shell and sidebar, with accessible mobile toggle', () => {
  assert.match(html, /id="master-shell" class="master-shell hidden"/);
  assert.match(html, /<aside id="master-sidebar" class="master-sidebar">/);
  assert.match(html, /id="master-menu-toggle"[^>]+aria-controls="master-sidebar"[^>]+aria-expanded="false"/);
  assert.match(html, /id="master-menu-backdrop"[^>]+aria-label="Fechar menu lateral"/);
});

test('Master links only to the authenticated operational panel, not player pairing or external destinations', () => {
  for (const view of ['devices', 'media', 'playlists', 'monitoring']) {
    assert.match(html, new RegExp('href="\\./index\\.html" data-operational-view="' + view + '"'));
    assert.match(app, new RegExp("'" + view + "'"));
  }
  assert.match(script, /localStorage\.setItem\('vision_midia_active_view_v1', view\)/);
  assert.match(script, /localStorage\.setItem\('vision_midia_active_area_v1', 'operational'\)/);
  assert.match(script, /\['devices', 'media', 'playlists', 'monitoring'\]\.includes\(view\)/);
  assert.match(app, /state\.companies = await restRequest\('companies'/);
  assert.match(app, /if \(!state\.companies\.length\)/);
});

test('Master phone navigation uses a lateral drawer rather than a top-only strip', () => {
  const override = css.slice(css.indexOf('/* Isolated Master navigation repair:'));
  assert.match(override, /@media \(max-width:720px\)/);
  assert.match(override, /position:fixed;left:0;top:0;bottom:0;z-index:60/);
  assert.match(override, /transform:translateX\(-105%\)/);
  assert.match(override, /\.master-sidebar\.is-open\{transform:translateX\(0\);visibility:visible\}/);
  assert.match(override, /\.master-sidebar nav\{display:grid/);
  assert.match(override, /\.master-mobile-menu-toggle\{display:grid/);
});

test('Drawer closes on backdrop, Escape, mobile-to-desktop and Master view navigation', () => {
  assert.match(script, /'#master-menu-toggle'\)\?\.addEventListener\('click'/);
  assert.match(script, /'#master-menu-backdrop'\)\?\.addEventListener\('click'/);
  assert.match(script, /ev\.key === 'Escape'/);
  assert.match(script, /window\.innerWidth > 720/);
  assert.match(script, /function setView\(view\)\{ state\.view=view; setMasterMobileMenu\(false\)/);
});

test('Operational panel is separate from Master and keeps its tenant access gate', () => {
  assert.match(app, /const COMPANY_KEY = 'vision_midia_company_v1'/);
  assert.match(app, /if \(!state\.companies\.length\)/);
  assert.match(app, /accessReason\(state\.subscription\)/);
  assert.doesNotMatch(script.slice(script.indexOf('function openOperationalArea('), script.indexOf('function setView(')), /restRequest|edgeRequest|fetch\(/);
});

test('Master keeps advertiser entry visible but disconnected from real commercial system', () => {
  assert.match(html, /class="nav-button master-commercial-pending"[^>]+disabled aria-disabled="true"[^>]*>◈ Anunciantes · Em homologação<\/button>/);
  assert.match(css, /\.master-sidebar \.master-commercial-pending:disabled\{cursor:not-allowed/);
  assert.doesNotMatch(html, /href="\.\/master-advertisers\.html"/);
  assert.doesNotMatch(html, /VISION_COMMERCIAL_CONFIG/);
});
