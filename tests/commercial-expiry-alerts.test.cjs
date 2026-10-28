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

test('client delivery: only verified owner email with active advertiser, and disabled by default', () => {
  assert.match(sql, /vision_commercial_client_alert_config/);
  assert.match(sql, /insert into private\.vision_commercial_client_alert_config\(id,enabled\)[\s\S]*?values \(1,false\)/);
  assert.match(sql, /a\.status = 'active'/);
  assert.match(sql, /u\.email_confirmed_at is not null/);
  assert.match(sql, /lower\(trim\(a\.email\)\) = lower\(trim\(u\.email\)\)/);
  assert.match(sql, /unique \(campaign_id, advertiser_id, end_date\)/);
  assert.match(sql, /c\.end_date=d\.end_date/);
  assert.match(worker, /claim_vision_commercial_client_alerts/);
  assert.match(worker, /finish_vision_commercial_client_alert/);
  assert.match(worker, /'Idempotency-Key':/);
  assert.match(worker, /recipient_email/);
  assert.doesNotMatch(worker, /password:.*recipient_email/);
});

test('Master card displays period and countdown without opening editor', () => {
  const code = read('master-advertisers.mjs');
  const css = read('master-advertisers-safe.css');
  const page = read('master-advertisers.html');
  assert.match(code, /renderCampaignPeriod\(c\)/);
  assert.match(code, /commercialDeadlineLabel\(c\.end_date\)/);
  assert.match(code, /commercial-campaign-period/);
  assert.match(css, /commercial-campaign-period\{display:grid/);
  assert.match(page, /master-advertisers\.mjs\?v=commercial-expiry-20261028/);
});

test('advertiser portal has a read-only expiry notice, not publishing controls', () => {
  const portal = read('advertiser-portal.mjs');
  const page = read('anunciante.html');
  assert.match(portal, /function renderExpiryNotices/);
  assert.match(portal, /renderExpiryNotices\(data\)/);
  assert.match(page, /id="advertiser-expiry-notices"/);
  assert.doesNotMatch(portal, /publishCommercialCampaign/);
});

test('calendar countdown is correct for today, future and expired dates', async () => {
  const { commercialDeadlineLabel, commercialDaysUntil } = await import('../commercial-campaign-deadline.mjs');
  assert.equal(commercialDaysUntil('2026-10-30','2026-10-28'),2);
  assert.equal(commercialDeadlineLabel('2026-10-30','2026-10-28').label,'Faltam 2 dias');
  assert.equal(commercialDeadlineLabel('2026-10-28','2026-10-28').label,'Vence hoje');
  assert.equal(commercialDeadlineLabel('2026-10-27','2026-10-28').label,'Vencida há 1 dia');
  assert.equal(commercialDeadlineLabel('2026-10-26','2026-10-28').label,'Vencida há 2 dias');
});


test('advertiser push has a separate RLS-protected subscription table, not company device tokens', () => {
  assert.match(sql,/create table if not exists public\.vision_advertiser_push_subscriptions/);
  assert.match(sql,/vision_advertiser_push_subscriptions enable row level security/);
  assert.match(sql,/revoke all on public\.vision_advertiser_push_subscriptions from public,anon,authenticated/);
  assert.match(sql,/vision_commercial_advertiser_push_config/);
  assert.match(sql,/insert into private\.vision_commercial_advertiser_push_config\(id,enabled\)[\s\S]*?values \(1,false\)/);
  assert.match(sql,/unique \(campaign_id,advertiser_id,end_date\)/);
  assert.match(sql,/c\.end_date=d\.end_date/);
  assert.match(sql,/sub\.advertiser_id=a\.id and sub\.user_id=a\.user_id/);
  assert.match(sql,/c\.status in \('active','paused'\) and a\.status='active'/);
});

test('advertiser registration uses the authenticated account, not supplied advertiser or company ids', () => {
  const functionCode = read('supabase/functions/advertiser-push/index.ts');
  assert.match(functionCode,/client\.auth\.getUser\(auth\.slice\(7\)\)/);
  assert.match(functionCode,/\.eq\('user_id',user\.id\)\.maybeSingle\(\)/);
  assert.match(functionCode,/user\.email_confirmed_at/);
  assert.match(functionCode,/advertiser\.status !== 'active'/);
  assert.match(functionCode,/validPushEndpoint/);
  assert.match(functionCode,/action === 'subscribe'/);
  assert.match(functionCode,/action === 'unsubscribe'/);
  assert.match(functionCode,/action === 'test'/);
  assert.match(functionCode,/test_cooldown|push_test_cooldown/);
  assert.doesNotMatch(functionCode,/body\.company_id/);
  assert.doesNotMatch(functionCode,/body\.advertiser_id/);
});

test('push recipient matches advertiser plus user and clicks open portal, never the Master', () => {
  const shared=read('supabase/functions/_shared/web-push.ts');
  assert.match(shared,/export async function sendAdvertiserPush/);
  assert.match(shared,/\.from\('vision_advertiser_push_subscriptions'\)/);
  assert.match(shared,/\.eq\('advertiser_id', advertiserId\)/);
  assert.match(shared,/\.eq\('user_id', recipientUserId\)/);
  assert.match(shared,/https:\/\/vision-midia-digital\.vercel\.app\/anunciante\.html/);
  assert.match(worker,/claim_vision_commercial_advertiser_push_alerts/);
  assert.match(worker,/finish_vision_commercial_advertiser_push_alert/);
  assert.match(worker,/sendAdvertiserPush/);
  assert.match(worker,/advertiser_push:/);
});

test('advertiser push is an opt-in browser gesture, with own device test and no auto-subscribe', () => {
  const controls=read('advertiser-push.mjs');
  const portal=read('advertiser-portal.mjs');
  const html=read('anunciante.html');
  const manifest=JSON.parse(read('advertiser.webmanifest'));
  assert.match(controls,/Notification\.requestPermission\(\)/);
  assert.match(controls,/navigator\.serviceWorker\.register/);
  assert.match(controls,/registration\.pushManager\.subscribe/);
  assert.match(controls,/action:'subscribe'/);
  assert.match(controls,/action:'test'/);
  assert.match(controls,/action:'unsubscribe'/);
  assert.match(controls,/async function onLogout/);
  assert.match(portal,/createAdvertiserPushControls/);
  assert.match(portal,/if\(!demo\)void pushControls\.attach/);
  assert.match(html,/id="advertiser-push-enable"/);
  assert.match(html,/id="advertiser-push-test"/);
  assert.match(html,/id="advertiser-push-disable"/);
  assert.match(html,/rel="manifest" href="\.\/advertiser\.webmanifest"/);
  assert.equal(manifest.start_url,'./anunciante.html');
  assert.equal(manifest.display,'standalone');
});

test('advertiser push workflow never mutates TV campaign state', () => {
  const endpoint=read('supabase/functions/advertiser-push/index.ts');
  const controls=read('advertiser-push.mjs');
  assert.doesNotMatch(endpoint,/\.from\('(?:devices|device_commands|playlists|playlist_items)'\)/);
  assert.doesNotMatch(controls,/sendCompanyPush|company_notifications/);
});
