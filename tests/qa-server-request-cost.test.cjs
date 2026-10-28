'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const gatewaySource = fs.readFileSync(path.join(root, 'supabase/functions/device-gateway/index.ts'), 'utf8');
const monitoringSource = fs.readFileSync(path.join(root, 'supabase/functions/device-monitoring/index.ts'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('async function ' + name + '(');
  assert.ok(start >= 0, 'Missing function: ' + name);
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start, 'Missing function end: ' + name);
  return source.slice(start, end + 2);
}

const request = { headers: { get: () => 'test-device-token'.repeat(3) } };
const sha256Hex = async () => 'mock-token-hash';
const accountSubscriptionBlock = () => null;
const offlineAccessDeadline = () => new Date(Date.now() + 60_000).toISOString();

function loadAuth(source) {
  const fn = new Function(
    'sha256Hex', 'accountSubscriptionBlock', 'offlineAccessDeadline',
    extractFunction(source, 'authenticateDevice') + '\nreturn authenticateDevice',
  );
  return fn(sha256Hex, accountSubscriptionBlock, offlineAccessDeadline);
}

function mockAuthDb(lastUsedAt, revoked = false) {
  const readsAndWrites = [];
  const data = {
    device_credentials: { device_id: 'tv', revoked_at: revoked ? '2026-10-28' : null, last_used_at: lastUsedAt },
    devices: {
      id: 'tv', company_id: 'company', status: 'online', access_status: 'active',
      access_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
    companies: { status: 'active' },
    company_subscriptions: {
      status: 'active', payment_status: 'paid',
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    },
  };
  const client = {
    from(table) {
      readsAndWrites.push({ table, verb: 'from' });
      return {
        select() { return this; },
        eq() { return this; },
        update(record) {
          readsAndWrites.push({ table, verb: 'update', record });
          return this;
        },
        or() { return Promise.resolve({ error: null }); },
        not() { return Promise.resolve({ error: null }); },
        maybeSingle() { return Promise.resolve({ data: data[table] ?? null, error: null }); },
      };
    },
  };
  return { client, readsAndWrites };
}

for (const [label, source] of [['gateway', gatewaySource], ['monitoring', monitoringSource]]) {
  test(label + ': recent credential activity is not written again', async () => {
    const { client, readsAndWrites } = mockAuthDb(new Date(Date.now() - 10_000).toISOString());
    const result = await loadAuth(source)(client, request);
    assert.ok(result);
    assert.equal(readsAndWrites.filter(x => x.table === 'device_credentials' && x.verb === 'update').length, 0);
  });

  test(label + ': stale credential is written once with concurrency guard', async () => {
    const { client, readsAndWrites } = mockAuthDb(new Date(Date.now() - 120_000).toISOString());
    const result = await loadAuth(source)(client, request);
    assert.ok(result);
    assert.equal(readsAndWrites.filter(x => x.table === 'device_credentials' && x.verb === 'update').length, 1);
    assert.ok(readsAndWrites.some(x => x.table === 'device_credentials' && x.verb === 'update'));
  });

  test(label + ': missing timestamp is refreshed', async () => {
    const { client, readsAndWrites } = mockAuthDb(null);
    assert.ok(await loadAuth(source)(client, request));
    assert.equal(readsAndWrites.filter(x => x.table === 'device_credentials' && x.verb === 'update').length, 1);
  });

  test(label + ': revoked token is denied without writes', async () => {
    const { client, readsAndWrites } = mockAuthDb(null, true);
    assert.equal(await loadAuth(source)(client, request), null);
    assert.equal(readsAndWrites.filter(x => x.verb === 'update').length, 0);
  });
}

test('gateway: optional denied group lookup is not repeated on every manifest', async () => {
  assert.match(gatewaySource, /let groupMembershipPermissionRetryAtMs = 0/);
  let deniedQueries = 0;
  const client = {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        maybeSingle() {
          if (table === 'device_group_members') {
            deniedQueries++;
            return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } });
          }
          const rows = {
            companies: { timezone: 'America/Sao_Paulo' },
            device_playlist_assignments: { playlist_id: 'assigned', updated_at: '2026-10-27' },
          };
          return Promise.resolve({ data: rows[table] ?? null, error: null });
        },
      };
    },
  };
  const factory = new Function(
    'localDateParts', 'campaignIsActive', 'console', 'Promise', 'Date',
    'let groupMembershipPermissionRetryAtMs = 0;\n' +
      extractFunction(gatewaySource, 'resolveProgram') +
      '\nreturn resolveProgram',
  );
  const resolveProgram = factory(
    () => ({ timeZone: 'America/Sao_Paulo', dateKey: '2026-10-28', weekday: 3, seconds: 36_000 }),
    () => true, { warn() {} }, Promise, Date,
  );
  for (let i = 0; i < 2; i++) {
    const manifest = await resolveProgram(client, { company_id: 'company', id: 'tv' });
    assert.equal(manifest.playlistId, 'assigned');
  }
  assert.equal(deniedQueries, 1);
});
