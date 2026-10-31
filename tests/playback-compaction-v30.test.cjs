const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sqlFile = fs.existsSync(path.join(__dirname,'..','supabase','qa-migrations','v30_playback_compaction_staged.sql'))
  ? path.join(__dirname,'..','supabase','qa-migrations','v30_playback_compaction_staged.sql')
  : path.join(__dirname,'..','vision_playback_compaction_v30.sql');
const sql = fs.readFileSync(sqlFile,'utf8');

test('Starts disabled, with 7-day receipt retention', () => {
  assert.match(sql,/raw_days integer NOT NULL DEFAULT 7 CHECK/);
  assert.match(sql,/enabled boolean NOT NULL DEFAULT false/);
  assert.match(sql,/archive_verified_at IS NOT NULL/);
  assert.match(sql,/reporting_verified_at IS NOT NULL/);
  assert.match(sql,/offline_replay_verified_at IS NOT NULL/);
  assert.match(sql,/dedupe_verified_at IS NOT NULL/);
  assert.match(sql,/COALESCE\(v_ok,false\)/);
});

test('No cron, no change to original report or historical commercial counts', () => {
  assert.doesNotMatch(sql,/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_playback_report\s*\(/i);
  assert.doesNotMatch(sql,/cron\.schedule\s*\(/i);
  assert.doesNotMatch(sql,/(?:DELETE\s+FROM|UPDATE)\s+public\.vision_commercial_daily/i);
  assert.match(sql,/get_playback_report_compacted_v30/);
});

test('Archive write and removal are within the same data-modifying CTE', () => {
  assert.match(sql,/WITH candidate AS MATERIALIZED\s*\(/i);
  assert.match(sql,/FOR UPDATE SKIP LOCKED/i);
  assert.match(sql,/removed AS \(\s*DELETE FROM public\.playback_logs/i);
  assert.match(sql,/applied AS \(\s*INSERT INTO public\.vision_playback_daily_archive_v30/i);
  assert.match(sql,/ON CONFLICT \(play_date,company_id,device_id/i);
  assert.match(sql,/started=dest\.started\+EXCLUDED\.started/);
  assert.match(sql,/count\(\*\) FROM removed/);
});

test('Uses receipt time for cutoff; preserves late arrivals and TV, advertiser, media dimensions', () => {
  assert.match(sql,/l\.created_at < now\(\) - \(v_days \* interval '1 day'\)/);
  assert.match(sql,/AT TIME ZONE COALESCE\(c\.timezone,'America\/Sao_Paulo'\)/);
  for (const x of ['company_id','device_id','campaign_key','playlist_key','media_key','completed','total_seconds','first_play','last_play']) {
    assert.ok(sql.includes(x),x);
  }
});

test('Archive report has RLS, authorization and original JSON keys', () => {
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/private\.is_company_member\(p_company_id\)/);
  for (const x of ["'timezone'","'summary'","'campaigns'","'devices'","'media'","'events'", "'completion_rate'"]) {
    assert.ok(sql.includes(x),x);
  }
});

test('No dangerous dedupe assumption: deletion requires explicit idempotency verification', () => {
  assert.match(sql,/dedupe_verified_at timestamptz/);
  assert.match(sql,/dedupe_verified_at IS NOT NULL/);
  assert.match(sql,/No trigger or ledger is installed/);
  assert.doesNotMatch(sql,/GRANT (?:UPDATE|ALL) ON TABLE private\.vision_playback_compaction_control_v30 TO authenticated/i);
});

test('SQL dollar quote delimiters balanced', () => {
  const count=(sql.match(/\$fn\$/g)||[]).length;
  assert.equal(count,6,'three function pairs with dollar-quotes');
});

test('Synthetic atomic compaction: online + offline late arrival + rerun preserves totals', () => {
  const raw=[{id:'a',seen:0,play:0,device:'t1',media:'m1',completed:1},
             {id:'b',seen:0,play:0,device:'t1',media:'m1',completed:0},
             {id:'c',seen:10,play:0,device:'t1',media:'m1',completed:1}];
  const archive=new Map();
  function compact(cutoff) {
    for (let i=raw.length-1;i>=0;i--) {
      const x=raw[i];if(x.seen>=cutoff)continue;
      const key=[x.play,x.device,x.media].join(':');const v=archive.get(key)||{started:0,completed:0};
      v.started+=1;v.completed+=x.completed;archive.set(key,v);raw.splice(i,1);
    }
  }
  compact(7);compact(7); // rerun cannot recount the same source rows
  assert.equal(archive.get('0:t1:m1').started,2);
  assert.equal(raw.length,1); // late event remains raw because received recently
  assert.equal([...archive.values()].reduce((s,x)=>s+x.started,0)+raw.length,3);
  compact(18);
  assert.equal(archive.get('0:t1:m1').started,3);
  assert.equal(archive.get('0:t1:m1').completed,2);
});