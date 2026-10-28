import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMediaSignedUrlResolver } from '../supabase/functions/device-gateway/media-url-cache.mjs';

function mockClient(sign) {
  const calls = [];
  return {
    calls,
    client: {
      storage: {
        from(bucket) {
          assert.equal(bucket, 'vision-media');
          return {
            createSignedUrl: async (path, expiresIn) => {
              calls.push({ path, expiresIn });
              return sign(path, expiresIn, calls.length);
            },
          };
        },
      },
    },
  };
}
const media = { id: 'media-1', storage_path: 'tenant/file.mp4', updated_at: '2026-10-28T10:00:00Z' };

test('reuse within 30 minutes; refresh after cache expiry, well before six-hour signed token expiry', async () => {
  let now = 1000;
  const resolve = createMediaSignedUrlResolver({ clock: () => now });
  const m = mockClient(async (_, __, n) => ({ data: { signedUrl: 'signed-'+n }, error: null }));
  const first = await resolve(m.client, 'tenant-1', media);
  now += 29 * 60_000;
  const second = await resolve(m.client, 'tenant-1', media);
  assert.equal(second.data.signedUrl, first.data.signedUrl);
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].expiresIn, 21600);
  now += 60_001;
  const third = await resolve(m.client, 'tenant-1', media);
  assert.equal(third.data.signedUrl, 'signed-2');
  assert.equal(m.calls.length, 2);
});

test('tenant, asset id, path and asset revision are separate cache keys', async () => {
  const resolve = createMediaSignedUrlResolver();
  const m = mockClient(async (_, __, n) => ({ data: { signedUrl: 'url-'+n }, error: null }));
  await resolve(m.client, 'company-one', media);
  await resolve(m.client, 'company-two', media);
  await resolve(m.client, 'company-one', { ...media, id: 'media-2' });
  await resolve(m.client, 'company-one', { ...media, storage_path: 'tenant/new.mp4' });
  await resolve(m.client, 'company-one', { ...media, updated_at: '2026-10-28T10:01:00Z' });
  assert.equal(m.calls.length, 5);
});

test('parallel manifest requests coalesce signing for the same authorized asset', async () => {
  let unlock;
  const gate = new Promise(resolve => { unlock = resolve; });
  const m = mockClient(async () => { await gate; return { data: { signedUrl: 'concurrent' }, error: null }; });
  const resolve = createMediaSignedUrlResolver();
  const requests = Array.from({ length: 12 }, () => resolve(m.client, 'company-one', media));
  unlock();
  const results = await Promise.all(requests);
  assert.equal(m.calls.length, 1);
  for (const r of results) assert.equal(r.data.signedUrl, 'concurrent');
});

test('failed signing is not cached, preserving current error and next retry', async () => {
  const resolve = createMediaSignedUrlResolver();
  const m = mockClient(async (_, __, n) => n===1
    ? { data: null, error: { message: 'storage unavailable' } }
    : { data: { signedUrl: 'recovered' }, error: null });
  assert.equal((await resolve(m.client, 'company-one', media)).error.message, 'storage unavailable');
  assert.equal((await resolve(m.client, 'company-one', media)).data.signedUrl, 'recovered');
  assert.equal(m.calls.length, 2);
});

test('thrown signing errors clear inflight state and allow recovery', async () => {
  const resolve = createMediaSignedUrlResolver();
  const m = mockClient(async (_, __, n) => {
    if(n===1) throw new Error('network');
    return { data: { signedUrl: 'recovered' }, error: null };
  });
  await assert.rejects(resolve(m.client,'company-one',media),/network/);
  assert.equal((await resolve(m.client,'company-one',media)).data.signedUrl,'recovered');
  assert.equal(m.calls.length, 2);
});

test('bounded LRU evicts older entries and does not grow with all media forever', async () => {
  const resolve = createMediaSignedUrlResolver({ maxEntries: 2 });
  const m = mockClient(async (_, __, n) => ({ data: { signedUrl: 'url-'+n }, error: null }));
  await resolve(m.client,'company-one',{...media,id:'one'});
  await resolve(m.client,'company-one',{...media,id:'two'});
  await resolve(m.client,'company-one',{...media,id:'one'}); // refresh LRU
  await resolve(m.client,'company-one',{...media,id:'three'}); // evicts 'two'
  await resolve(m.client,'company-one',{...media,id:'two'}); // re-sign
  assert.equal(m.calls.length, 4);
});

test('configuration and incomplete tenant identity are rejected', async () => {
  assert.throws(() => createMediaSignedUrlResolver({ reuseMs: 21600_000 }), /expire before/);
  assert.throws(() => createMediaSignedUrlResolver({ maxEntries: 0 }), /Invalid cache capacity/);
  const resolve = createMediaSignedUrlResolver();
  const m = mockClient(async () => ({ data:{signedUrl:'never'},error:null }));
  await assert.rejects(resolve(m.client,'',media), /without a tenant/);
  await assert.rejects(resolve(m.client,'company-one',{ id: 'x' }), /without a tenant/);
  assert.equal(m.calls.length, 0);
});

test('gateway still authenticates device and checks subscription before fetching a manifest', () => {
  const source = readFileSync(new URL('../supabase/functions/device-gateway/index.ts', import.meta.url), 'utf8');
  assert.match(source, /const device = await authenticateDevice\(admin, req\)/);
  assert.match(source, /accountSubscriptionBlock\(company, subscription\)/);
  assert.match(source, /const resolved = await resolveProgram\(admin, device\)/);
  assert.match(source, /await signedUrlForAsset\(admin, companyId, asset\)/);
  assert.match(source, /membershipPermissionDeniedUntilMs = Date\.now\(\) \+ 15 \* 60_000/);
  assert.match(source, /membershipError && !membershipUnavailable/);
  assert.doesNotMatch(source, /const \{ data: signed, error: signedError \} = await admin\.storage/);
});
