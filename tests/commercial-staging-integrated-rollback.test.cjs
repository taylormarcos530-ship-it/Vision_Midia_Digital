'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('tests/sql/commercial-staging-integrated-rollback.sql','utf8');
test('integrated SQL can only run in staging and cannot leave fixtures behind',()=>{
 assert.match(sql,/IS DISTINCT FROM 'jmiuitrrhtaeyrpuyohk'/);
 assert.match(sql,/to_regclass\('vision_menu_lab\.vision_menu_drafts'\)/);
 assert.match(sql,/unexpected_existing_operational_fixtures/);
 assert.match(sql,/^BEGIN;/m);
 assert.match(sql,/^ROLLBACK;\s*$/m);
 assert.doesNotMatch(sql,/\bCOMMIT\s*;/i);
 assert.doesNotMatch(sql,/fpadgedrgcxrrqflzhjt/);
 assert.doesNotMatch(sql,/\b(?:CREATE|DROP|ALTER|TRUNCATE)\s+(?:TABLE|FUNCTION|SCHEMA)\b/i);
});
test('SQL integrates the real commercial RPCs and rejects privacy and counting defects',()=>{
 for(const name of ['vision_commercial_save_campaign','vision_commercial_manifest',
  'vision_commercial_refresh_daily','vision_commercial_master_report'])
 assert.ok(sql.includes(name),name);
 for(const condition of ['missing_copy_not_blocked','daily_completed_counts_not_idempotent',
 'report_privacy_or_cross_advertiser_failure','paused_ad_still_in_manifest','archived_ad_still_in_manifest'])
 assert.ok(sql.includes(condition),condition);
 assert.match(sql,/metadata only/i);
 assert.match(sql,/nothing is uploaded or accessed through the Storage API/i);
});
