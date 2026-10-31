const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'..','supabase','qa-migrations','v30_playback_dedupe_guard.sql'),'utf8');
test('128-bit SHA-256 identity is device-scoped and persistent',()=>{
 assert.match(sql,/pg_catalog\.sha256\(/);
 assert.match(sql,/p_device::text\s*\|\|\s*':'\s*\|\|\s*p_event/);
 assert.match(sql,/for 32\)::uuid/);
 assert.match(sql,/fingerprint uuid PRIMARY KEY/);
});
test('Ingestion checks archived ledger before after-insert commercial count',()=>{
 assert.match(sql,/BEFORE INSERT ON public\.playback_logs/i);
 assert.match(sql,/RETURN NULL/i);
 assert.match(sql,/private\.vision_playback_seen_v30/);
});
test('Inserter and compactor share TV-level transactional advisory lock',()=>{
 const locks=sql.match(/pg_catalog\.pg_advisory_xact_lock\(93030,pg_catalog\.hashtext\(/g)||[];
 assert.equal(locks.length,2);
 assert.ok(sql.indexOf("pg_advisory_xact_lock(93030,pg_catalog.hashtext(v_device::text))")<sql.indexOf("WITH candidate AS MATERIALIZED"));
});
test('Ledger and summary built from DELETE RETURNING in same transaction',()=>{
 assert.match(sql,/DELETE FROM public\.playback_logs l/);
 assert.match(sql,/remembered AS\s*\(/);
 assert.match(sql,/FROM removed r/);
 assert.match(sql,/IF raw_removed <> v_seen THEN/);
});
test('Install does not schedule, enable or run compaction',()=>{
 assert.doesNotMatch(sql,/cron\.schedule|PERFORM private\.vision_playback_compact_batch_v30\(/);
 assert.doesNotMatch(sql,/UPDATE private\.vision_playback_compaction_control_v30 SET/i);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.get_playback_report\(/i);
});
test('No ledger purge or fixed dedupe TTL',()=>{
 assert.doesNotMatch(sql,/DELETE FROM private\.vision_playback_seen_v30/i);
 assert.doesNotMatch(sql,/expires_at timestamptz/i);
});
