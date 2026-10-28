const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');

const sql = read('supabase/migrations/20261028190500_vision_commercial_expiry_alerts.sql');
const worker = read('supabase/functions/commercial-expiry-alerts/index.ts');
const push = read('supabase/functions/_shared/web-push.ts');

test('commercial expiry: opt-in destination, no automatic disclosure to partners', () => {
  assert.match(sql, /enabled boolean not null default false/);
  assert.match(sql, /co\.owner_user_id = r\.user_id/);
  assert.match(sql, /r\.enabled = true/);
  assert.match(worker, /false, job\.user_id\)/);
  assert.match(push, /if \(recipientUserId\) subscriptionQuery = subscriptionQuery\.eq\('user_id', recipientUserId\)/);
});

test('commercial expiry: is one alert per campaign and end date', () => {
  assert.match(sql, /unique \(campaign_id, recipient_company_id, end_date\)/);
  assert.match(sql, /on conflict do nothing returning id into inserted_id/);
  assert.match(sql, /if inserted_id is not null then/);
  assert.match(sql, /insert into public\.company_notifications/);
});

test('commercial expiry: uses São Paulo calendar, excludes drafts and archives', () => {
  assert.match(sql, /America\/Sao_Paulo/);
  assert.match(sql, /c\.status in \('active','paused'\)/);
  assert.match(sql, /c\.archived_at is null/);
  assert.match(sql, /c\.end_date between today_sp - 7 and today_sp/);
});

test('commercial expiry: does not alter the video player and requires server token', () => {
  assert.match(worker, /verify_subscription_alert_token/);
  assert.match(worker, /claim_vision_commercial_alerts/);
  assert.match(worker, /finish_vision_commercial_alert/);
  assert.doesNotMatch(worker, /(?:device_commands|player_cache|playlist_items)/);
});

test('commercial expiry: inbox remains paginated to show more than three alerts', () => {
  const inbox = read('supabase/functions/notification-inbox/index.ts');
  const app = read('app.js');
  assert.match(inbox, /\.limit\(100\)/);
  assert.match(inbox, /\.filter\(\(item: any\) => !item\.deleted_at\)\.slice\(0, 30\)/);
  assert.match(app, /result\.items\.slice\(0, 30\)/);
});

test('commercial expiry: Academia Life master is the only preselected account, disabled until QA', () => {
  assert.match(sql, /c\.slug = 'visiontek-group-9c77be'/);
  assert.match(sql, /c\.name = 'Academia Life'/);
  assert.match(sql, /pa\.status = 'active'/);
  assert.match(sql, /pa\.role in \('admin','super_admin'\)/);
  assert.match(sql, /select c\.id, c\.owner_user_id, false/);
  assert.match(sql, /on conflict \(company_id\) do nothing/);
});
