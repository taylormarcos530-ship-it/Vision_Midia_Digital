"""Synthetic PG17 only: reconstruct the ORIGINAL commercial report filter/group shapes
from immutable AES-GCM/gzip proof archives. Original QA suite remains unchanged.
NEVER uses production connection strings. No deletion of actual user data.
"""
from __future__ import annotations
import base64,gzip,hashlib,importlib.util,json,os,resource,secrets,tempfile,time
from collections import defaultdict
from datetime import date,timedelta
from decimal import Decimal
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import psycopg

ROOT=Path(__file__).resolve().parents[1]
ORIGINAL=ROOT/'commercial-parity-qa'/'qa.py'
spec=importlib.util.spec_from_file_location('original_qa_unchanged',ORIGINAL)
original=importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
DB='vision_v2_quarantine_disposable'
COLUMNS=('company_id','device_id','seq','client_event_id','campaign_id','playlist_id',
 'media_id','device_name','campaign_name','playlist_name','media_name','started_at',
 'play_day','seconds','completed','hash_sha256')
GROUPS=('campaign_id,campaign_name','device_id,device_name','media_id,media_name',
 'play_day','campaign_id,campaign_name,device_id,device_name,media_id,media_name,playlist_id,playlist_name,play_day')
def canonical(o):return json.dumps(o,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def fsyncdir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def atomic(path,b):
 part=path.with_suffix('.partial')
 with open(part,'wb') as f:
  f.write(b);f.flush();os.fsync(f.fileno())
 os.replace(part,path);fsyncdir(path.parent)
def protect():
 assert os.environ.get('GITHUB_REF')=='refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031'
 assert os.environ.get('QA_STREAM_GUARD_GROUP')=='1'
 assert all(not os.getenv(k) for k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','PGHOST','PGSERVICE'))
 with original.connect() as c:
  assert c.execute('select current_database()').fetchone()[0]==DB
  assert int(c.execute('show server_version_num').fetchone()[0])//10000==17
def source_extra(c,n=10_000,tvs=300):
 # Original 90 records remain intact. Fictitious events use same commercial
 # table columns and preserve the historical naming semantics.
 c.execute("""INSERT INTO qa_commercial.playback(
 company_id,device_id,seq,client_event_id,campaign_id,playlist_id,media_id,
 device_name,campaign_name,playlist_name,media_name,started_at,play_day,seconds,completed,hash_sha256)
 SELECT CASE WHEN g%2=0 THEN 'company-A' ELSE 'company-B' END,
 'new-tv-' || lpad((g% """+str(tvs)+""")::text,4,'0'),
 100000+g, 'arch-event-'||g,
 'camp-'||(g%3), 'playlist-'||(g%4), 'media-'||(g%5),
 CASE WHEN g%7=0 THEN 'TV nome antigo' ELSE 'TV nome atual' END,
 CASE WHEN g%11=0 THEN 'Campanha anterior' ELSE 'Campanha atual' END,
 'Playlist retrospectiva','Mídia histórica',
 '2026-10-31T10:00:00Z'::timestamptz + (g%3)*interval '1 day' + (g%3600)*interval '1 second',
 DATE '2026-10-31'+(g%3), 15+(g%4), g%7<>0,
 md5('synthetic-archive-'||g)
 FROM generate_series(1,%s) AS g""",(n,))
def rebuild_daily(c):
 c.execute('TRUNCATE qa_commercial.daily')
 c.execute("""INSERT INTO qa_commercial.daily(
 company_id,device_id,campaign_id,playlist_id,media_id,
 device_name,campaign_name,playlist_name,media_name,play_day,
 started,completed,total_seconds,first_play,last_play)
 SELECT company_id,device_id,campaign_id,playlist_id,media_id,
 device_name,campaign_name,playlist_name,media_name,play_day,
 count(*),count(*) FILTER(WHERE completed),sum(seconds),min(started_at),max(started_at)
 FROM qa_commercial.playback
 GROUP BY company_id,device_id,campaign_id,playlist_id,media_id,
 device_name,campaign_name,playlist_name,media_name,play_day""")
def scalar_json(x):
 if isinstance(x,Decimal):return format(x,'f')
 if isinstance(x,(date,)):return x.isoformat()
 return x
def report(c,table,tenant,first,last,mode):
 # SQL shape/filters are taken directly from the UNMODIFIED original module.
 camp='camp-1' if mode=='campaign' else None
 device='hist-'+tenant[-1]+'-0' if mode=='device' else None
 media='media-1' if mode=='media' else None
 condition,args=original.where_filter(tenant,first,last,camp,device,media)
 metric="""count(*),count(*) FILTER(WHERE completed),sum(seconds),
 count(distinct device_id),count(distinct campaign_id),count(distinct media_id),
 min(started_at),max(started_at)"""
 summary=c.execute(f'SELECT {metric} FROM {table} WHERE {condition}',args).fetchone()
 output={'summary':[scalar_json(x) for x in summary],'groups':{}}
 for group in GROUPS:
  value="count(*),count(*) FILTER(WHERE completed),sum(seconds),min(started_at),max(started_at)"
  rows=c.execute(f'SELECT {group},{value} FROM {table} WHERE {condition} GROUP BY {group}',args).fetchall()
  normalized=[[scalar_json(x) for x in row] for row in rows]
  normalized.sort(key=canonical)
  output['groups'][group]=normalized
 return output
def reports(c,table):
 result={}
 for tenant in ('company-A','company-B'):
  for a,b in ((0,0),(1,1),(2,2),(0,1),(0,2)):
   for mode in ('all','campaign','device','media'):
    first=original.DAY+timedelta(days=a);last=original.DAY+timedelta(days=b)
    result[f'{tenant}/{a}-{b}/{mode}']=report(c,table,tenant,first,last,mode)
 return result
def manifest_db(c):
 c.execute('CREATE SCHEMA qa_arch_report')
 c.execute("""CREATE TABLE qa_arch_report.manifests(
  id text PRIMARY KEY,tenant text NOT NULL,day date NOT NULL,
  cipher_sha text NOT NULL,raw_sha text NOT NULL,events integer NOT NULL,
  generation integer NOT NULL,metadata jsonb NOT NULL)""")
 c.execute('CREATE ROLE qa_arch_report_reader NOLOGIN')
 c.execute('GRANT USAGE ON SCHEMA qa_arch_report TO qa_arch_report_reader')
 c.execute('GRANT SELECT ON qa_arch_report.manifests TO qa_arch_report_reader')
 c.execute('ALTER TABLE qa_arch_report.manifests ENABLE ROW LEVEL SECURITY')
 c.execute('ALTER TABLE qa_arch_report.manifests FORCE ROW LEVEL SECURITY')
 c.execute("""CREATE POLICY tenant_read ON qa_arch_report.manifests FOR SELECT TO qa_arch_report_reader
  USING(tenant=current_setting('qa.claim.tenant',true))""")
def test_rls(c):
 with c.transaction():
  c.execute('SET LOCAL ROLE qa_arch_report_reader')
  c.execute("SELECT set_config('qa.claim.tenant','company-A',true)")
  assert c.execute("SELECT count(*) FROM qa_arch_report.manifests WHERE tenant='company-B'").fetchone()[0]==0
  assert c.execute("SELECT count(*) FROM qa_arch_report.manifests WHERE tenant='company-A'").fetchone()[0]==3
 with c.transaction():
  c.execute('SET LOCAL ROLE qa_arch_report_reader')
  try:c.execute("DELETE FROM qa_arch_report.manifests")
  except psycopg.errors.InsufficientPrivilege:pass
  else:raise AssertionError('untrusted_archive_reader_can_delete')
def run():
 protect()
 root=Path(tempfile.mkdtemp(prefix='vision_archive_report_')); key=secrets.token_bytes(32)
 started=time.monotonic()
 original.init();original.fixture();original.build_cqrs()
 original.parity();original.rls_check() # exact historical suite reused unchanged
 with original.connect() as c:
  source_extra(c,n=10_000)
  rebuild_daily(c)
  assert c.execute("SELECT count(*) FROM qa_commercial.playback").fetchone()[0]==10090
  assert c.execute('SELECT sum(started) FROM qa_commercial.daily').fetchone()[0]==10090
  baseline=reports(c,'qa_commercial.playback')
  for tenant in ('company-A','company-B'):
   for a,b in ((0,0),(1,1),(2,2),(0,1),(0,2)):
    for mode in ('all','campaign','device','media'):
     camp='camp-1' if mode=='campaign' else None
     device='hist-'+tenant[-1]+'-0' if mode=='device' else None
     media='media-1' if mode=='media' else None
     original.raw_vs_cqrs(c,tenant,original.DAY+timedelta(days=a),
       original.DAY+timedelta(days=b),camp,device,media)
  original_raw_hash=sha(canonical(baseline))
  manifest_db(c)
  raw_rows=c.execute("""SELECT row_to_json(p)::text FROM qa_commercial.playback AS p
      ORDER BY company_id,play_day,device_id,seq""").fetchall()
  events=[json.loads(row[0]) for row in raw_rows]
  assert len(events)==10090
  grouped=defaultdict(list)
  for event in events:grouped[(event['company_id'],event['play_day'])].append(event)
  proof_bytes=0;manifests=[]
  for (tenant,day),data in sorted(grouped.items()):
   mid=sha(canonical([tenant,day,'first-generation']))
   plain=canonical(data);nonce=os.urandom(12)
   ciphertext=AESGCM(key).encrypt(nonce,gzip.compress(plain,compresslevel=6,mtime=0),canonical([tenant,day,mid]))
   container=canonical({'nonce':base64.b64encode(nonce).decode(),'data':base64.b64encode(ciphertext).decode()})
   path=root/(mid+'.qa')
   atomic(path,container)
   digest={'id':mid,'tenant':tenant,'day':day,'cipher_sha':sha(container),
    'raw_sha':sha(plain),'events':len(data),'generation':1}
   with c.transaction():
    c.execute("""INSERT INTO qa_arch_report.manifests(id,tenant,day,cipher_sha,raw_sha,events,generation,metadata)
       VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
      (mid,tenant,day,digest['cipher_sha'],digest['raw_sha'],len(data),1,json.dumps(digest)))
   proof_bytes+=len(container);manifests.append((digest,path))
  assert len(manifests)==6
  test_rls(c)
  original_event_hash=sha(canonical(events))
  c.execute('CREATE TABLE qa_arch_report.restored (LIKE qa_commercial.playback INCLUDING ALL)')
  # Source is synthetic; drop its rows NOW to demonstrate that reporting truly
  # depends on recovered encrypted archive, not a lingering original table.
  c.execute('TRUNCATE qa_commercial.playback')
  assert c.execute('SELECT count(*) FROM qa_commercial.playback').fetchone()[0]==0
  reconstructed=[]
  negative_checks=0
  for digest,path in manifests:
   raw=path.read_bytes();assert sha(raw)==digest['cipher_sha']
   env=json.loads(raw)
   plain=AESGCM(key).decrypt(base64.b64decode(env['nonce']),base64.b64decode(env['data']),
      canonical([digest['tenant'],digest['day'],digest['id']]))
   decoded=gzip.decompress(plain)
   assert sha(decoded)==digest['raw_sha']
   data=json.loads(decoded)
   assert len(data)==digest['events']
   assert all(x['company_id']==digest['tenant'] and x['play_day']==digest['day'] for x in data)
   reconstructed.extend(data)
   try:AESGCM(secrets.token_bytes(32)).decrypt(base64.b64decode(env['nonce']),
       base64.b64decode(env['data']),canonical([digest['tenant'],digest['day'],digest['id']]))
   except Exception:negative_checks+=1
   else:raise AssertionError('wrong_key_accepted')
   try:AESGCM(key).decrypt(base64.b64decode(env['nonce']),
       base64.b64decode(env['data']),canonical(['wrong-tenant',digest['day'],digest['id']]))
   except Exception:negative_checks+=1
   else:raise AssertionError('tenant_AAD_mismatch_accepted')
  reconstructed.sort(key=lambda x:(x['company_id'],x['play_day'],x['device_id'],x['seq']))
  assert sha(canonical(reconstructed))==original_event_hash,'source_archive_bitwise_mismatch'
  args=[tuple(event[k] for k in COLUMNS) for event in reconstructed]
  with c.transaction():
   with c.cursor() as cur:
    cur.executemany('INSERT INTO qa_arch_report.restored('+','.join(COLUMNS)+') VALUES('+','.join(['%s']*len(COLUMNS))+')',args)
  assert c.execute('SELECT count(*) FROM qa_arch_report.restored').fetchone()[0]==10090
  restored_reports=reports(c,'qa_arch_report.restored')
  assert canonical(restored_reports)==canonical(baseline),'ORIGINAL_REPORT_JSON_MISMATCH'
  assert sha(canonical(restored_reports))==original_raw_hash
  assert c.execute('SELECT sum(started) FROM qa_commercial.daily').fetchone()[0]==10090
  # archive cannot silently double count; identical generation is immutable.
  m,_=manifests[0]; before=c.execute('SELECT count(*) FROM qa_arch_report.manifests').fetchone()[0]
  c.execute('''INSERT INTO qa_arch_report.manifests(id,tenant,day,cipher_sha,raw_sha,events,generation,metadata)
   VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
   (m['id'],m['tenant'],m['day'],m['cipher_sha'],m['raw_sha'],m['events'],1,json.dumps(m)))
  assert c.execute('SELECT count(*) FROM qa_arch_report.manifests').fetchone()[0]==before
  pgbytes=c.execute("SELECT pg_total_relation_size('qa_arch_report.manifests')").fetchone()[0]
  pgbytes+=c.execute("SELECT pg_total_relation_size('qa_commercial.daily')").fetchone()[0]
 elapsed=round(time.monotonic()-started,3)
 print('QA_ARCHIVE_REPORT_JSON='+json.dumps({'result':'PASS','original_qa_module_unchanged':True,
    'source_original_90_plus_synthetic_10k':10090,'filters':40,'group_comparisons':200,
    'full_JSON_SHA256':original_raw_hash,'source_archive_all_columns_same':True,
    'original_events_removed_in_DISPOSABLE_DB':True,'reconstructed_count':len(reconstructed),
    'tenants':2,'segments':len(manifests),'archive_cipher_bytes':proof_bytes,
    'sql_daily_plus_manifest_bytes':pgbytes,'wrong_key_or_tenant_rejections':negative_checks,
    'sql_rls_test':'PASS','replayed_manifest_dedup':'PASS','rss_python_KiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    'elapsed_s':elapsed,'not_tested':['real_production_RPC_implementation','remote_object_store_failover',
    'cross_host_KMS_rotation','multi_month_infinite_retention','TOCTOU_gate_fix'],
    'production':'NO_GO'},sort_keys=True),flush=True)
if __name__=='__main__':run()
