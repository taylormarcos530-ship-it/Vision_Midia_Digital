'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fnPath = path.join(__dirname, '..', 'supabase', 'functions', 'vision-v2-qa-device', 'index.ts');
const sqlPath = path.join(__dirname, '..', 'docs', 'vision-v2', 'qa-device-api.sql');
const raw = fs.readFileSync(fnPath, 'utf8');
const sql = fs.readFileSync(sqlPath, 'utf8');
const TEST_TOKEN = 'a'.repeat(64);

// Transform ONLY the known, minimal TypeScript syntax for isolated Node mocks.
// All other application statements execute directly in a VM. No npm, Deno,
// HTTP, SQL, GitHub secrets, real Supabase or production services are used.
function jsFromKnownSource(source) {
  assert.match(source, /^import \{ createClient \} from 'npm:@supabase\/supabase-js@2\.57\.0'$/m);
  const transformed = source
    .replace(/^import \{ createClient \} from 'npm:@supabase\/supabase-js@2\.57\.0'\r?\n/m, '')
    .replace('function respond(code: number, data: Record<string, unknown>, extra: Record<string, string> = {}): Response {',
      'function respond(code, data, extra = {}) {')
    .replace('let secrets: Record<string, string> = {}', 'let secrets = {}')
    .replace('Deno.serve(async (req: Request) => {', 'Deno.serve(async (req) => {')
    .replace('let body: Record<string, unknown>', 'let body')
    .replace('const parsed: unknown = JSON.parse(raw)', 'const parsed = JSON.parse(raw)')
    .replace('body = parsed as Record<string, unknown>', 'body = parsed')
    .replace('(revision as number)', '(revision)');
  assert.doesNotMatch(transformed, /\bas Record<string|\breq: Request\b|: Response\b/);
  return transformed;
}

function fixture({ rpcResult, envOverride } = {}) {
  let handler;
  const calls = [];
  const env = {
    SUPABASE_URL: 'https://v2-test.invalid',
    SUPABASE_SECRET_KEYS: '{"default":"fake-test-only-secret-not-valid"}',
    ...envOverride,
  };
  const createClient = (url, secret, options) => {
    assert.equal(url, env.SUPABASE_URL);
    assert.equal(secret, 'fake-test-only-secret-not-valid');
    assert.equal(options.auth.persistSession, false);
    return {
      rpc: async (name, payload) => {
        calls.push({ name, payload });
        if (typeof rpcResult === 'function') return rpcResult(name, payload);
        return rpcResult ?? { data: { ok: true, action: 'sync', changed: false, revision: 7 }, error: null };
      },
    };
  };
  vm.runInNewContext(jsFromKnownSource(raw), {
    Deno: {
      env: { get: (key) => env[key] },
      serve: (cb) => { handler = cb; },
    },
    createClient,
    Request,
    Response,
  }, { timeout: 2000, filename: 'vision-v2-qa-device.mock.js' });
  assert.equal(typeof handler, 'function');

  async function send(body, { method = 'POST', token = TEST_TOKEN, headers = {} } = {}) {
    const h = { 'x-device-token': token, ...headers };
    const request = new Request('https://v2-test.invalid/functions/v1/vision-v2-qa-device', {
      method,
      headers: h,
      ...(method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const res = await handler(request);
    const payload = res.status === 204 ? null : await res.json();
    return { res, payload };
  }
  return { calls, send };
}

test('static: endpoint remains QA-only and pinned; SQL RPC not callable by user or anon', () => {
  assert.match(raw, /npm:@supabase\/supabase-js@2\.57\.0/);
  assert.match(raw, /vision_v2_qa_device_api/);
  assert.match(raw, /x-device-token/);
  assert.match(sql, /revoke all on function public\.vision_v2_qa_device_api[\s\S]+?from public,anon,authenticated;/i);
  assert.match(sql, /grant execute on function public\.vision_v2_qa_device_api[\s\S]+?to service_role;/i);
  assert.match(sql, /on conflict do nothing/i);
  assert.doesNotMatch(raw, /fpadgedrgcxrrqflzhjt|vision-midia-digital\.vercel\.app/);
  assert.doesNotMatch(raw, /https?:\/\/[^\s'"]*prod/i);
});

test('CORS preflight is restricted and does not call database', async () => {
  const f = fixture();
  const { res } = await f.send(null, { method: 'OPTIONS', token: '' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
  assert.equal(f.calls.length, 0);
});

test('reject unsupported methods before database access', async () => {
  const f = fixture();
  const { res, payload } = await f.send(null, { method: 'GET' });
  assert.equal(res.status, 405);
  assert.equal(payload.error, 'method_not_allowed');
  assert.equal(f.calls.length, 0);
});

test('missing/malformed device token rejected', async () => {
  const f = fixture();
  for (const token of ['', 'bad', 'z'.repeat(64)]) {
    const { res, payload } = await f.send({ action: 'sync' }, { token });
    assert.equal(res.status, 401);
    assert.equal(payload.error, 'unauthorized');
  }
  assert.equal(f.calls.length, 0);
});

test('invalid JSON, JSON array, and empty object are denied', async () => {
  const f = fixture();
  for (const input of ['{broken', '[]', 'null']) {
    const { res } = await f.send(input);
    assert.equal(res.status, 400);
  }
  const { res, payload } = await f.send({});
  assert.equal(res.status, 400);
  assert.equal(payload.error, 'unknown_action');
  assert.equal(f.calls.length, 0);
});

test('unknown action and invalid revision rejected', async () => {
  const f = fixture();
  const bad = [
    { action: 'delete' },
    { action: 'sync', known_revision: -1 },
    { action: 'sync', known_revision: 1.2 },
    { action: 'sync', known_revision: '7' },
  ];
  for (const body of bad) {
    const { res } = await f.send(body);
    assert.equal(res.status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test('playback batches must have 1 to 50 elements', async () => {
  const f = fixture();
  for (const events of [[], Array(51).fill({}), 'not-array', null]) {
    const { res, payload } = await f.send({ action: 'playback_batch', events });
    assert.equal(res.status, 400);
    assert.equal(payload.error, 'invalid_batch');
  }
  assert.equal(f.calls.length, 0);
});

test('large payload blocked before RPC', async () => {
  const f = fixture();
  const { res, payload } = await f.send({ action: 'sync', filler: 'x'.repeat(80001) });
  assert.equal(res.status, 413);
  assert.equal(payload.error, 'payload_too_large');
  assert.equal(f.calls.length, 0);
});

test('sync unmodified returns no manifest and passes known revision', async () => {
  const f = fixture();
  const { res, payload } = await f.send({ action: 'sync', known_revision: 7 });
  assert.equal(res.status, 200);
  assert.equal(payload.changed, false);
  assert.equal(Object.hasOwn(payload, 'manifest'), false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'vision_v2_qa_device_api');
  assert.equal(f.calls[0].payload.p_token, TEST_TOKEN);
  assert.equal(f.calls[0].payload.p_known_revision, 7);
  assert.equal(f.calls[0].payload.p_events, null);
});

test('sync changed returns revision and manifest from authorized RPC', async () => {
  const manifest = { items: [{ media_id: 'synthetic' }] };
  const f = fixture({ rpcResult: { data: { ok: true, action: 'sync', changed: true, revision: 8, manifest }, error: null } });
  const { res, payload } = await f.send({ action: 'sync', known_revision: 7 });
  assert.equal(res.status, 200);
  assert.equal(payload.revision, 8);
  assert.equal(payload.manifest.items[0].media_id, 'synthetic');
});

test('playback ACK forwards 2 accepted and 0 duplicate counts', async () => {
  const f = fixture({ rpcResult: { data: { ok: true, action: 'playback_batch', accepted: 2, duplicates: 0, received: 2 }, error: null } });
  const { res, payload } = await f.send({ action: 'playback_batch', events: [{ event_id: 'a' }, { event_id: 'b' }] });
  assert.equal(res.status, 200);
  assert.equal(payload.accepted, 2);
  assert.equal(payload.duplicates, 0);
  assert.equal(f.calls[0].payload.p_events.length, 2);
});

test('replay ACK forwards 0 accepted and 2 duplicates', async () => {
  const f = fixture({ rpcResult: { data: { ok: true, action: 'playback_batch', accepted: 0, duplicates: 2, received: 2 }, error: null } });
  const { res, payload } = await f.send({ action: 'playback_batch', events: [{}, {}] });
  assert.equal(res.status, 200);
  assert.equal(payload.accepted, 0);
  assert.equal(payload.duplicates, 2);
});

test('unknown and revoked token response mapped to HTTP 401', async () => {
  const f = fixture({ rpcResult: { data: { ok: false, error: 'unauthorized' }, error: null } });
  const { res } = await f.send({ action: 'sync' });
  assert.equal(res.status, 401);
});

test('invalid event database error mapped to HTTP 400 without SQL details', async () => {
  const f = fixture({ rpcResult: { data: null, error: { code: '22023', message: 'internal-test-only-secret' } } });
  const { res, payload } = await f.send({ action: 'playback_batch', events: [{}] });
  assert.equal(res.status, 400);
  assert.equal(payload.error, 'invalid_playback_event');
  assert.doesNotMatch(JSON.stringify(payload), /internal-test-only-secret/);
});

test('backend error mapped to bounded 503 with Retry-After', async () => {
  const f = fixture({ rpcResult: { data: null, error: { code: 'PGRST100', message: 'internal-test-only-secret' } } });
  const { res, payload } = await f.send({ action: 'sync' });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal(payload.error, 'gateway_unavailable');
  assert.doesNotMatch(JSON.stringify(payload), /internal-test-only-secret/);
});

test('missing secret means unavailable rather than unguarded access', async () => {
  const f = fixture({ envOverride: { SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: '' } });
  const { res, payload } = await f.send({ action: 'sync' });
  assert.equal(res.status, 503);
  assert.equal(payload.error, 'gateway_unavailable');
  assert.equal(f.calls.length, 0);
});
