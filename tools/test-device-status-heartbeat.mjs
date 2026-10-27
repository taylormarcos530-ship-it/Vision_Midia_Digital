import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const master = readFileSync(new URL('../supabase/functions/master-admin/index.ts', import.meta.url), 'utf8');
const monitoring = readFileSync(new URL('../supabase/functions/device-monitoring/index.ts', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../advertiser-portal.mjs', import.meta.url), 'utf8');
const portalHtml = readFileSync(new URL('../anunciante.html', import.meta.url), 'utf8');
const portalSqlReview = readFileSync(new URL('../docs/sql/vision-advertiser-presence-3min.REVIEW.sql', import.meta.url), 'utf8');

const marker = 'function effectiveDeviceStatus(device) {';
const begin = source.indexOf(marker);
const end = source.indexOf('\n  const LOCAL_WEEKDAY_INDEX_APP', begin);
assert.ok(begin >= 0 && end > begin, 'Status classifier source must be present');

const NOW = Date.parse('2026-10-27T12:00:00.000Z');
class TestDate extends Date {
  static now() { return NOW; }
}
const classify = new Function('Date', source.slice(begin, end) + '\nreturn effectiveDeviceStatus;')(TestDate);
const seen = msAgo => new Date(NOW - msAgo).toISOString();

test('keeps TV online between optimized 2-minute heartbeats', () => {
  assert.equal(classify({status:'online', paired_at:seen(10_000), last_seen_at:seen(120_000)}), 'online');
  assert.equal(classify({status:'online', paired_at:seen(10_000), last_seen_at:seen(179_999)}), 'online');
});

test('marks an active TV offline only after 3 minutes without heartbeat', () => {
  assert.equal(classify({status:'online', paired_at:seen(10_000), last_seen_at:seen(180_000)}), 'online');
  assert.equal(classify({status:'online', paired_at:seen(10_000), last_seen_at:seen(180_001)}), 'offline');
});

test('retains pending, blocked and never-paired semantics', () => {
  assert.equal(classify({status:'disabled', last_seen_at:seen(0)}), 'disabled');
  assert.equal(classify({status:'online', access_status:'pending', last_seen_at:seen(0)}), 'pending');
  assert.equal(classify({status:'pending'}), 'pending');
  assert.equal(classify({status:'online', paired_at:seen(400_000)}), 'offline');
});

test('fails closed for malformed heartbeat timestamp', () => {
  assert.equal(classify({status:'online', paired_at:seen(400_000), last_seen_at:'not-a-date'}), 'offline');
});

test('Master summary and server stale sweep match the 3-minute alert threshold', () => {
  const masterChecks = master.match(/Date\.now\(\)-new Date\(x\.last_seen_at\)\.getTime\(\)<180000/g) || [];
  assert.equal(masterChecks.length, 2);
  assert.match(master, /sweep_stale_devices',\{p_stale_seconds:180\}/);
  assert.match(monitoring, /const staleBefore = new Date\(Date\.now\(\) - 3 \* 60_000\)\.toISOString\(\)/);
  assert.doesNotMatch(source, /Date\.now\(\) - new Date\(device\.last_seen_at\)\.getTime\(\) > 90_000/);
});

test('keeps playback counts and report rendering in the admin UI', () => {
  assert.match(source, /function renderPlaybackReport\(\)/);
  assert.match(source, /#report-started/);
  assert.match(source, /#report-completed/);
  assert.match(source, /#report-media-body/);
});

test('does not mark a normally synchronizing TV stale before three minutes', () => {
  assert.match(source, /function deviceSyncIsStale\\(device\\)/);
  assert.match(source, /new Date\\(device\\.last_sync_at\\)\\.getTime\\(\\) > 3 \\* 60_000/);
  assert.doesNotMatch(source, /new Date\\(device\\.last_sync_at\\)\\.getTime\\(\\) > 120_000/);
});

test('advertiser portal reduces polling without losing manual refresh or completed-playback counts', () => {
  assert.match(portal, /const PORTAL_AUTO_REFRESH_MS = 120_000;/);
  assert.match(portal, /setInterval\\(\\(\\)=>\\{if\\(!demo&&!document\\.hidden&&!\\$\\('#dashboard'\\)\\.hidden\\)show\\(\\)\\},PORTAL_AUTO_REFRESH_MS\\);/);
  assert.doesNotMatch(portal, /setInterval[^;]*,15000\\);/);
  assert.match(portal, /api\\.rpc\\('vision_advertiser_portal'\\)/);
  assert.match(portal, /\\$\\('#refresh'\\)\\.onclick/);
  assert.match(portal, /completed_count/);
  assert.match(portalHtml, /automaticamente a cada 2 minutos/);
});

test('review-only advertiser SQL aligns both online predicates without broadening access', () => {
  assert.match(portalSqlReview, /REVIEW ONLY; DO NOT EXECUTE AUTOMATICALLY/);
  assert.match(portalSqlReview, /CREATE OR REPLACE FUNCTION private\\.vision_portal_data/);
  assert.equal((portalSqlReview.match(/'3 minutes'/g) || []).length, 2);
  assert.doesNotMatch(portalSqlReview, /'90 seconds'/);
  assert.match(portalSqlReview, /SECURITY DEFINER/);
  assert.match(portalSqlReview, /c\\.advertiser_id=p_advertiser/);
  assert.match(portalSqlReview, /'daily'/);
});
