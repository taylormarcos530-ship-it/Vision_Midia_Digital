const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function appFunction(file, name) {
  const text = read(file);
  const start = text.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf('\n  }', start) + 4);
}
function gatewayContext() {
  const text = read('supabase/functions/device-gateway/index.ts');
  const context = vm.createContext({ console, Date, Intl });
  vm.runInContext(text.slice(text.indexOf('const WEEKDAY_INDEX'), text.indexOf('async function loadPlaylistPayload')), context);
  return context;
}
function database(rows) {
  return { from(table) {
    let data = rows[table] || [];
    let single = false;
    const query = {
      select() { return query; },
      eq(key, value) { data = data.filter(row => row[key] === value); return query; },
      order() { return query; },
      maybeSingle() { single = true; return query; },
      then(resolve, reject) { return Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(resolve, reject); },
    };
    return query;
  } };
}
const base = () => ({
  companies: [{ id: 'company', timezone: 'America/Sao_Paulo', fallback_playlist_id: 'emergency' }],
  campaigns: [{ id: 'campaign', company_id: 'company', playlist_id: 'campaign-playlist', is_active: true, all_devices: true, weekdays: [0,1,2,3,4,5,6] }],
});
test('unassigned TV stays idle even with an active global campaign', async () => {
  const result = await gatewayContext().resolveProgram(database(base()), { id: 'tv', company_id: 'company' });
  assert.equal(result.playlistId, null);
  assert.equal(result.fallbackPlaylistId, null);
  assert.equal(result.program.source, 'none');
});
test('assigned TV preserves its active campaign', async () => {
  const rows = base();
  rows.device_playlist_assignments = [{ device_id: 'tv', playlist_id: 'primary' }];
  const result = await gatewayContext().resolveProgram(database(rows), { id: 'tv', company_id: 'company' });
  assert.equal(result.playlistId, 'campaign-playlist');
  assert.equal(result.fallbackPlaylistId, null);
});
test('direct playlist and emergency candidate remain when campaign is inactive', async () => {
  const rows = base(); rows.campaigns[0].is_active = false;
  rows.device_playlist_assignments = [{ device_id: 'tv', playlist_id: 'primary' }];
  const result = await gatewayContext().resolveProgram(database(rows), { id: 'tv', company_id: 'company' });
  assert.equal(result.playlistId, 'primary');
  assert.equal(result.program.source, 'default');
  assert.equal(result.fallbackPlaylistId, null);
});
test('group assignment preserves campaign scheduling', async () => {
  const rows = base();
  rows.device_group_members = [{ company_id: 'company', device_id: 'tv', group_id: 'group' }];
  rows.device_groups = [{ id: 'group', company_id: 'company', playlist_id: 'group-primary' }];
  const result = await gatewayContext().resolveProgram(database(rows), { id: 'tv', company_id: 'company' });
  assert.equal(result.playlistId, 'campaign-playlist');
});
test('campaign belonging to another company never overrides assigned playlist', async () => {
  const rows = base(); rows.campaigns[0].company_id = 'other-company';
  rows.device_playlist_assignments = [{ device_id: 'tv', playlist_id: 'primary' }];
  const result = await gatewayContext().resolveProgram(database(rows), { id: 'tv', company_id: 'company' });
  assert.equal(result.playlistId, 'primary');
});
for (const file of ['app.js', 'player.js']) {
  for (const host of ['https://preview.example/', 'https://production.example/subpath/']) {
    test(`${file}: built-in URLs follow ${host}, external URL is preserved`, () => {
      const context = vm.createContext({ URL, location: { href: host + 'index.html', origin: new URL(host).origin } });
      vm.runInContext(appFunction(file, 'resolveOnlineMediaUrl'), context);
      assert.equal(context.resolveOnlineMediaUrl('https://visionmidiadigital-old-vision-midia-digital.vercel.app/widget.html?type=clock&city=Anapolis'), host + 'clock.html');
      assert.equal(context.resolveOnlineMediaUrl('./clock.html'), host + 'clock.html');
      assert.equal(context.resolveOnlineMediaUrl('https://visionmidiadigitalgo.netlify.app/news-feed.html?source=sports_br'), host + 'news-feed.html?source=sports_br');
      assert.equal(context.resolveOnlineMediaUrl('https://external.example/clock.html'), 'https://external.example/clock.html');
    });
  }
}
test('new playlist invalidates media signature and appears in select', () => {
  const state = { media: [], playlistItems: [], playlists: [{ id: 'old', name: 'Teste' }] };
  const context = vm.createContext({ state, escapeHtml: value => value });
  vm.runInContext(appFunction('app.js', 'currentMediaRenderSignature') + appFunction('app.js', 'mediaPlaylistOptions'), context);
  const before = context.currentMediaRenderSignature();
  state.playlists.push({ id: 'new', name: 'Testando' });
  assert.notEqual(context.currentMediaRenderSignature(), before);
  assert.match(context.mediaPlaylistOptions('media'), /value="new"/);
});
test('clock uses Brasilia date across UTC midnight', () => {
  const nodes = { time: {}, date: {} };
  class FixedDate extends Date { constructor() { super('2026-10-05T01:30:00Z'); } }
  vm.runInNewContext(read('clock.html').match(/<script>([\s\S]*?)<\/script>/)[1], {
    Date: FixedDate, Intl, document: { getElementById: id => nodes[id] }, setInterval() {},
  });
  assert.equal(nodes.time.textContent, '22:30');
  assert.match(nodes.date.textContent, /04 de outubro/);
});
test('Netlify adapter preserves original feed response and rejects failed upstream', async () => {
  const handler = (await import('../netlify/functions/news-feed.mts')).default;
  const originalFetch = global.fetch;
  try {
    global.fetch = async url => {
      assert.equal(url, 'https://ge.globo.com/rss/ge/futebol/brasileirao-serie-a/');
      return new Response('<rss><channel><language>pt-BR</language><item><title>Futebol &amp; notícias</title><description><![CDATA[<p>Resultado</p>]]></description></item></channel></rss>');
    };
    const response = await handler(new Request('https://preview.example/api/news-feed?source=soccer'));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.items[0].title, 'Futebol & notícias');
    assert.equal(data.items[0].description, 'Resultado');
    assert.match(response.headers.get('cache-control'), /s-maxage=300/);
    global.fetch = async url => {
      assert.equal(url, 'https://g1.globo.com/rss/g1/brasil/');
      return new Response('<rss><channel><language>pt-BR</language><item><title>Brasil</title></item></channel></rss>');
    };
    assert.equal((await handler(new Request('https://preview.example/api/news-feed?source=news_br'))).status, 200);
    global.fetch = async () => new Response('<rss><channel><language>en-US</language><item><title>Foreign</title></item></channel></rss>');
    assert.equal((await handler(new Request('https://preview.example/api/news-feed'))).status, 502);
    global.fetch = async () => new Response('Unavailable', { status: 502 });
    assert.equal((await handler(new Request('https://preview.example/api/news-feed'))).status, 502);
  } finally { global.fetch = originalFetch; }
});
