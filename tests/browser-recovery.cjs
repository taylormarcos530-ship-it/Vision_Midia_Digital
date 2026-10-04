// Browser regression fixtures: intercept only test-page responses, never edit production JS.
// Dependencies: playwright, @sparticuz/chromium; NETLIFY_CLI points to the installed CLI.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const binary = require('@sparticuz/chromium');
const root = path.resolve(__dirname, '..');
const origin = 'http://localhost:8891';
const company = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const media = { id: '33333333-3333-4333-8333-333333333333', company_id: company, name: 'Fixture image', media_type: 'image', storage_path: company + '/fixture.svg', size_bytes: 100, width: 1920, height: 1080 };
const db = {
  media_assets: [media], playlists: [{ id: 'old', company_id: company, name: 'Existing', repeat_mode: 'loop' }],
  playlist_items: [], devices: [], device_playlist_assignments: [], device_groups: [], device_group_members: [], campaigns: [], campaign_devices: [], device_events: [], device_commands: [], device_heartbeats: [], company_members: [], profiles: [], device_screenshots: [],
};
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#14856d"/></svg>';
const checks = [];
function pass(name) { checks.push(name); console.log('PASS', name); }
(async () => {
  const server = spawn(process.env.NETLIFY_CLI, ['dev', '--offline', '--no-open', '--skip-gitignore', '--dir', '.', '--port', '8891'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk; if (String(chunk).includes('ready:')) console.log(String(chunk).trim()); });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  let browser;
  try {
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(origin + '/clock.html', { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
      if (i === 119) throw new Error('Netlify dev not ready: ' + serverLog);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    pass('Netlify dev serves current frontend and clock');
    browser = await chromium.launch({ headless: true, executablePath: await binary.executablePath(), args: binary.args });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/app.js*', route => {
      const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace('bootstrap().catch(error => {', 'window.__test = { state, bindEvents, showScreen, setView, loadAllData, openPlaylistEditor }; Promise.resolve().catch(error => {');
      return route.fulfill({ contentType: 'application/javascript', body: source });
    });
    let signedRequests = 0;
    await context.route('**/storage/v1/object/sign/**', route => {
      signedRequests++;
      return route.fulfill({ json: { signedURL: origin + '/test-image.svg' } });
    });
    await context.route('**/test-image.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: image }));
    await context.route('**/functions/v1/**', route => route.fulfill({ json: { items: [], unread_count: 0 } }));
    await context.route('**/rest/v1/**', route => {
      const request = route.request(), url = new URL(request.url());
      const table = url.pathname.split('/').pop();
      if (request.method() === 'POST' && table === 'playlists') {
        const row = { ...request.postDataJSON(), id: 'new', created_at: new Date().toISOString() };
        assert.equal(row.company_id, company);
        db.playlists.push(row);
        return route.fulfill({ status: 201, json: [row] });
      }
      if (table !== 'profiles') assert.equal(url.searchParams.get('company_id'), 'eq.' + company, table);
      return route.fulfill({ json: db[table] || [] });
    });
    async function initialize() {
      await page.goto(origin);
      await page.evaluate(async ({ company, user }) => {
        const t = window.__test;
        Object.assign(t.state, { company: { id: company, name: 'Fixture company', timezone: 'America/Sao_Paulo' }, user: { id: user }, session: { access_token: 'fixture-only' }, companyRole: 'owner', subscription: { status: 'active' } });
        t.bindEvents(); t.showScreen('app'); await t.loadAllData(); t.setView('media');
      }, { company, user });
    }
    await initialize();
    await page.waitForFunction(() => document.querySelector('[data-media-preview] img')?.naturalWidth > 0);
    assert.ok(signedRequests > 0);
    pass('library requests signed URL and displays decoded image');
    await page.click('[data-view="playlists"]');
    await page.click('#add-playlist-button');
    await page.fill('#playlist-name', 'Created in browser');
    await page.click('#playlist-save');
    await page.waitForFunction(() => !document.querySelector('#playlist-dialog').open);
    await page.click('[data-view="media"]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-media-playlist-select] option')].some(option => option.value === 'new'));
    pass('create playlist via form immediately updates media selector');
    await initialize();
    assert.match(await page.locator('[data-media-playlist-select]').textContent(), /Created in browser/);
    pass('playlist remains selectable after page reload and REST reload');
    await page.evaluate(() => window.__test.openPlaylistEditor('new'));
    await page.waitForFunction(() => document.querySelector('#playlist-media-picker img')?.naturalWidth > 0);
    pass('playlist editor decodes thumbnail');
    assert.deepEqual(errors, []);
    pass('no frontend JavaScript exceptions during tested flows');
    await page.close();
    const player = await context.newPage();
    await context.route('**/player.js*', route => {
      const source = fs.readFileSync(path.join(root, 'player.js'), 'utf8').replace('bootstrap().catch(error => {', 'window.__playerTest = { state, playbackLoop, syncManifest }; Promise.resolve().catch(error => {');
      return route.fulfill({ contentType: 'application/javascript', body: source });
    });
    await player.goto(origin + '/player.html');
    await player.evaluate(() => {
      const t = window.__playerTest;
      t.state.deviceToken = 'fixture';
      t.state.manifest = { version: 'none', playlist: null, items: [], fallback: { playlist: { id: 'fallback' }, items: [{ media: { type: 'url', url: './clock.html' }, duration_seconds: 10 }] } };
      t.state.runtimeFallbackVersion = 'none';
      t.playbackLoop();
    });
    await player.waitForFunction(() => document.querySelector('#idle-message').textContent.includes('Aguardando'));
    assert.equal(await player.locator('#media-stage iframe').count(), 0);
    pass('Player without primary stays idle even with a stale runtime fallback lock');
    await player.evaluate(() => {
      const t = window.__playerTest;
      t.state.runtimeFallbackVersion = null;
      t.state.manifest = { version: 'assigned', playlist: { id: 'primary', repeat_mode: 'loop' }, program: {}, items: [{ media: { id: 'clock', type: 'url', url: 'https://visionmidiadigital-old.vercel.app/widget.html?type=clock' }, duration_seconds: 30 }] };
      t.state.playlistNonce++;
    });
    await player.waitForFunction(() => document.querySelector('#media-stage iframe')?.src.endsWith('/clock.html'));
    await player.frameLocator('#media-stage iframe').locator('#time').waitFor();
    pass('assigned Player renders existing legacy clock media on current domain');
    await player.evaluate(() => {
      const t = window.__playerTest;
      t.state.manifest = { version: 'empty-primary', playlist: { id: 'primary' }, items: [], fallback: { playlist: { id: 'fallback', repeat_mode: 'loop' }, items: [{ media: { id: 'clock2', type: 'url', url: './clock.html' }, duration_seconds: 30 }] } };
      t.state.playlistNonce++;
    });
    await player.waitForFunction(() => window.__playerTest.state.runtimeFallbackVersion === 'empty-primary');
    pass('assigned empty primary still activates allowed emergency playlist');
    const news = await context.newPage();
    await news.route('**/api/news-feed*', route => route.fulfill({ json: { ok: true, items: [{ title: 'Fixture football headline', description: 'Fixture news body' }] } }));
    await news.goto(origin + '/news-feed.html');
    await news.getByText('Fixture football headline', { exact: true }).waitFor();
    pass('news screen renders original API payload');
    console.log('BROWSER CHECKS', checks.length);
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
