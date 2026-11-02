"""QA-only Vision V2 encrypted hourly proof segments + durable SQLite and PG17 summaries.
Physical load: 1 hour x 15 sec x 10/100/300 TVs. 8/12/18/24-hour monthly
values are projections, not executions. No production URLs or credentials.
"""
from __future__ import annotations
import argparse,base64,gzip,hashlib,json,os,resource,signal,sqlite3,subprocess,sys,tempfile,time
from collections import defaultdict
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag
import psycopg
N=240
DB='vision_v2_quarantine_disposable'
KW=dict(host='127.0.0.1',port=5432,dbname=DB,user='postgres',password='qa-only-local-password',connect_timeout=5)
def con():return psycopg.connect(**KW,autocommit=True)
def canonical(o):return json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def q(root):
 c=sqlite3.connect(root/'queue.sqlite',timeout=15)
 c.execute('PRAGMA journal_mode=WAL')
 c.execute('PRAGMA synchronous=FULL')
 return c
def check_environment():
 assert os.environ.get('GITHUB_REF')=='refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031'
 assert os.environ.get('QA_STREAM_GUARD_GROUP')=='1'
 assert not any(os.environ.get(x) for x in ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','PGHOST','PGSERVICE'])
 with con() as c:
  assert c.execute('SELECT current_database()').fetchone()[0]==DB
  assert int(c.execute('SHOW server_version_num').fetchone()[0])//10000==17
def fsyncdir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def atomic(path,data,kill=False):
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_suffix('.incomplete')
 with open(tmp,'wb') as f:
  f.write(data);f.flush();os.fsync(f.fileno())
 if kill:os.kill(os.getpid(),signal.SIGKILL)
 os.replace(tmp,path);fsyncdir(path.parent)
def init(root,tvs):
 root.mkdir(parents=True)
 atomic(root/'qa-key',os.urandom(32))
 with q(root) as c:
  c.execute('CREATE TABLE proofs(device TEXT,seq INT,tenant TEXT,day TEXT,campaign TEXT,media TEXT,completed INT,seconds INT,event_id TEXT,ack INT DEFAULT 0,PRIMARY KEY(device,seq))')
  for i in range(tvs):
   device=f'tv-{i:03d}'
   c.executemany('INSERT INTO proofs(device,seq,tenant,day,campaign,media,completed,seconds,event_id) VALUES(?,?,?,?,?,?,?,?,?)',[
    (device,n,f'company-{i%2}','2026-11-02',f'camp-{n%3}',f'media-{n%5}',int(n%7!=0),15,f'{device}:{n}') for n in range(1,N+1)])
 with con() as c:
  c.execute('CREATE SCHEMA qa_economy_archive')
  c.execute('''CREATE TABLE qa_economy_archive.segments(
   id TEXT PRIMARY KEY,tenant TEXT NOT NULL,device TEXT NOT NULL,
   cipher_sha TEXT NOT NULL,raw_sha TEXT NOT NULL,count INT NOT NULL,
   bytes INT NOT NULL,manifest JSONB NOT NULL)''')
  c.execute('''CREATE TABLE qa_economy_archive.daily(
   tenant TEXT NOT NULL,device TEXT NOT NULL,day TEXT NOT NULL,
   campaign TEXT NOT NULL,media TEXT NOT NULL,
   started BIGINT NOT NULL,completed BIGINT NOT NULL,seconds BIGINT NOT NULL,
   PRIMARY KEY(tenant,device,day,campaign,media))''')
  c.execute('CREATE ROLE qa_archive_reader NOLOGIN')
  c.execute('GRANT USAGE ON SCHEMA qa_economy_archive TO qa_archive_reader')
  c.execute('GRANT SELECT ON ALL TABLES IN SCHEMA qa_economy_archive TO qa_archive_reader')
  for table in ['segments','daily']:
   c.execute(f'ALTER TABLE qa_economy_archive.{table} ENABLE ROW LEVEL SECURITY')
   c.execute(f'ALTER TABLE qa_economy_archive.{table} FORCE ROW LEVEL SECURITY')
   c.execute(f"""CREATE POLICY tenant_select ON qa_economy_archive.{table}
     FOR SELECT TO qa_archive_reader USING(tenant=current_setting('qa.tenant',true))""")
def source(root,device):
 with q(root) as c:
  c.row_factory=sqlite3.Row
  rows=[dict(r) for r in c.execute('SELECT device,seq,tenant,day,campaign,media,completed,seconds,event_id FROM proofs WHERE device=? AND seq BETWEEN 1 AND ? ORDER BY seq',(device,N))]
 assert len(rows)==N and [x['seq'] for x in rows]==list(range(1,N+1))
 return rows
def groups(rows):
 g=defaultdict(lambda:[0,0,0])
 for x in rows:
  v=g[x['tenant'],x['device'],x['day'],x['campaign'],x['media']]
  v[0]+=1;v[1]+=x['completed'];v[2]+=x['seconds']
 return dict(g)
def decode(file,manifest,key,tenant):
 assert manifest['tenant']==tenant,'wrong_tenant'
 payload=file.read_bytes()
 assert sha(payload)==manifest['cipher_sha'],'cipher_sha_mismatch'
 envelope=json.loads(payload)
 assert envelope['id']==manifest['id'],'segment_id_mismatch'
 compressed=AESGCM(key).decrypt(base64.b64decode(envelope['nonce']),
  base64.b64decode(envelope['ciphertext']),canonical([tenant,manifest['device'],manifest['id']]))
 raw=gzip.decompress(compressed)
 assert sha(raw)==manifest['raw_sha'],'raw_sha_mismatch'
 rows=json.loads(raw)
 assert len(rows)==manifest['count'] and rows[0]['seq']==1 and rows[-1]['seq']==N
 assert all(x['tenant']==tenant for x in rows)
 return rows
def archive(root,device,kill=None):
 rows=source(root,device);tenant=rows[0]['tenant']
 sid=sha(canonical([tenant,device,1,N]));raw=canonical(rows)
 key=(root/'qa-key').read_bytes();assert len(key)==32
 file=root/'archive'/(sid+'.v2qa')
 if not file.exists():
  nonce=os.urandom(12)
  sealed=AESGCM(key).encrypt(nonce,gzip.compress(raw,compresslevel=6,mtime=0),canonical([tenant,device,sid]))
  envelope=canonical({'id':sid,'nonce':base64.b64encode(nonce).decode(),
    'ciphertext':base64.b64encode(sealed).decode()})
  atomic(file,envelope,kill=='after_tmp_fsync')
 payload=file.read_bytes()
 manifest={'id':sid,'tenant':tenant,'device':device,'count':N,
   'cipher_sha':sha(payload),'raw_sha':sha(raw),'bytes':len(payload)}
 assert canonical(decode(file,manifest,key,tenant))==raw
 if kill=='after_file_fsync':os.kill(os.getpid(),signal.SIGKILL)
 with con() as c:
  with c.transaction():
   inserted=c.execute('''INSERT INTO qa_economy_archive.segments
    (id,tenant,device,cipher_sha,raw_sha,count,bytes,manifest)
    VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id''',
    (sid,tenant,device,manifest['cipher_sha'],manifest['raw_sha'],N,len(payload),json.dumps(manifest))).fetchone()
   existing=c.execute('SELECT cipher_sha,raw_sha,count FROM qa_economy_archive.segments WHERE id=%s',(sid,)).fetchone()
   assert existing==(manifest['cipher_sha'],manifest['raw_sha'],N),'immutable_manifest_conflict'
   if inserted:
    for (co,d,day,camp,media),(started,completed,seconds) in groups(rows).items():
     c.execute('''INSERT INTO qa_economy_archive.daily(tenant,device,day,campaign,media,started,completed,seconds)
      VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
      ON CONFLICT(tenant,device,day,campaign,media) DO UPDATE SET
      started=qa_economy_archive.daily.started+EXCLUDED.started,
      completed=qa_economy_archive.daily.completed+EXCLUDED.completed,
      seconds=qa_economy_archive.daily.seconds+EXCLUDED.seconds''',
      (co,d,day,camp,media,started,completed,seconds))
 if kill=='after_pg_commit':os.kill(os.getpid(),signal.SIGKILL)
 with q(root) as c:
  c.execute('UPDATE proofs SET ack=1 WHERE device=? AND seq BETWEEN 1 AND ?',(device,N))
 return manifest
def checks(root,tvs,wal0):
 with con() as c:
  total=c.execute('SELECT sum(started) FROM qa_economy_archive.daily').fetchone()[0]
  assert total==tvs*N
  manifests=[r[0] for r in c.execute('SELECT manifest FROM qa_economy_archive.segments ORDER BY device')]
  sqlgroups={tuple(r[:5]):list(r[5:]) for r in c.execute('SELECT tenant,device,day,campaign,media,started,completed,seconds FROM qa_economy_archive.daily')}
  dbsize=c.execute('SELECT pg_database_size(current_database())').fetchone()[0]
  segbytes=c.execute("SELECT pg_total_relation_size('qa_economy_archive.segments')").fetchone()[0]
  dailybytes=c.execute("SELECT pg_total_relation_size('qa_economy_archive.daily')").fetchone()[0]
  wal=int(c.execute('SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),%s)',(wal0,)).fetchone()[0])
  for table in ['daily','segments']:
   assert c.execute('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=%s::regclass',(f'qa_economy_archive.{table}',)).fetchone()==(True,True)
  with c.transaction():
   c.execute('SET LOCAL ROLE qa_archive_reader')
   c.execute("SELECT set_config('qa.tenant','company-0',true)")
   assert c.execute("SELECT count(*) FROM qa_economy_archive.segments WHERE tenant='company-1'").fetchone()[0]==0
   assert c.execute("SELECT count(*) FROM qa_economy_archive.daily WHERE tenant='company-1'").fetchone()[0]==0
  with c.transaction():
   c.execute('SET LOCAL ROLE qa_archive_reader')
   try:c.execute('UPDATE qa_economy_archive.daily SET started=0')
   except psycopg.errors.InsufficientPrivilege:pass
   else:raise AssertionError('reader_can_write')
 restored=[];archivebytes=0;key=(root/'qa-key').read_bytes()
 for m in manifests:
  f=root/'archive'/(m['id']+'.v2qa')
  restored.extend(decode(f,m,key,m['tenant']))
  archivebytes+=f.stat().st_size
  if m==manifests[0]:
   try:decode(f,m,bytes(32),m['tenant'])
   except InvalidTag:pass
   else:raise AssertionError('wrong_key_accepted')
   try:decode(f,m,key,'wrong-company')
   except AssertionError:pass
   else:raise AssertionError('cross_tenant_archive_accepted')
   altered=f.read_bytes()[:-5]+b'xxxxx'
   f2=root/'tampered.v2qa';f2.write_bytes(altered)
   try:decode(f2,m,key,m['tenant'])
   except (AssertionError,ValueError,InvalidTag):pass
   else:raise AssertionError('tampering_accepted')
 assert groups(restored)==sqlgroups
 with q(root) as c:
  assert c.execute('SELECT count(*) FROM proofs WHERE ack=1').fetchone()[0]==tvs*N
  source_groups={}
  c.row_factory=sqlite3.Row
  source_groups=groups([dict(r) for r in c.execute('SELECT device,seq,tenant,day,campaign,media,completed,seconds,event_id FROM proofs WHERE seq<=?',(N,))])
 assert source_groups==sqlgroups,'original SQLite report differs from restored archives/PG summary'
 return {'proofs':total,'segments':len(manifests),'groups':len(sqlgroups),
   'cipher_archive_bytes':archivebytes,'cipher_bytes_per_proof':round(archivebytes/total,3),
   'segment_sql_bytes':segbytes,'daily_sql_bytes':dailybytes,'database_bytes':dbsize,
   'wal_bytes':wal,'exact_qa_report_parity':True,'RLS_FORCE':True,'AES_GCM_SHA256':True}
def offline(root):
 with q(root) as c:
  c.execute('CREATE TABLE retry(device TEXT PRIMARY KEY,until_ms BIGINT,level INT,reason INT)')
  c.execute("""INSERT INTO proofs(device,seq,tenant,day,campaign,media,completed,seconds,event_id)
   VALUES('tv-000',241,'company-0','2026-11-02','camp-x','media-x',1,15,'offline-241')""")
  c.execute('SAVEPOINT quota_injection')
  try:raise sqlite3.OperationalError('database or disk is full')
  except sqlite3.OperationalError:c.execute('ROLLBACK TO quota_injection')
  c.execute('RELEASE SAVEPOINT quota_injection')
 now=1_000_000
 for i,status in enumerate((402,402,429,503,401,403)):
  seconds=([21600,43200][i] if i<2 else 300 if status==429 else 60 if status==503 else 86400*365)
  with q(root) as c:
   assert c.execute("SELECT count(*) FROM proofs WHERE device='tv-000' AND ack=0").fetchone()[0]==1
   until=now+seconds*1000
   c.execute('INSERT INTO retry VALUES(?,?,?,?) ON CONFLICT(device) DO UPDATE SET until_ms=EXCLUDED.until_ms,level=EXCLUDED.level,reason=EXCLUDED.reason',('tv-000',until,i+1,status))
  with q(root) as c:
   assert c.execute("SELECT until_ms,reason FROM retry WHERE device='tv-000'").fetchone()==(until,status)
   assert c.execute("SELECT count(*) FROM proofs WHERE device='tv-000' AND ack=0").fetchone()[0]==1
  now=until
 return {'402_429_503_401_403_durable_backoff':'PASS','one_unacked_offline_proof':1,
  'SQLITE_FULL_exception_injected':True,'actual_disk_full_tested':False,
  'actual_HTTP_gateway_tested':False}
def run(tvs):
 check_environment();root=Path(tempfile.mkdtemp(prefix='qa_v2_encrypted_'))
 start=time.monotonic();init(root,tvs)
 with con() as c:wal0=c.execute('SELECT pg_current_wal_insert_lsn()').fetchone()[0]
 faults=[]
 for i,stage in enumerate(('after_tmp_fsync','after_file_fsync','after_pg_commit')):
  d=f'tv-{i:03d}'
  proc=subprocess.run([sys.executable,__file__,'--worker',str(root),d,stage],
    timeout=35,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  assert proc.returncode==-signal.SIGKILL,(stage,proc.returncode,proc.stderr.decode()[-500:])
  with q(root) as c:assert c.execute('SELECT count(*) FROM proofs WHERE device=? AND ack=1',(d,)).fetchone()[0]==0
  with con() as c:
   observed=c.execute('SELECT count(*) FROM qa_economy_archive.segments WHERE device=%s',(d,)).fetchone()[0]
   assert observed==(1 if stage=='after_pg_commit' else 0)
  archive(root,d)
  faults.append({'stage':stage,'SIGKILL_detected':True,'manifest_before_retry':observed,'ACK_after_retry':N})
 for i in range(3,tvs):archive(root,f'tv-{i:03d}')
 with con() as c:before=c.execute('SELECT sum(started) FROM qa_economy_archive.daily').fetchone()[0]
 for i in range(tvs):archive(root,f'tv-{i:03d}')
 with con() as c:assert c.execute('SELECT sum(started) FROM qa_economy_archive.daily').fetchone()[0]==before
 physical=checks(root,tvs,wal0)
 offline_result=offline(root)
 projections=[]
 for h in (8,12,18,24):
  monthly=tvs*N*h*30
  uploadcalls=tvs*h*30
  cycles=tvs*h*30*30
  storage=round(physical['cipher_archive_bytes']*h*30)
  projections.append({'online_hours':h,'monthly_proofs_15s':monthly,
    'cipher_archive_bytes_linear':storage,'external_storage_1GB_Free_exceeded_if_on_supabase':storage>1e9,
    'hourly_Edge_upload_calls_hypothetical':uploadcalls,
    'two_minute_Edge_cycles_hypothetical':cycles,
    'two_minute_calls_exceed_350k_reserve':cycles>350000})
 result={'outcome':'PASS_ISOLATED_QA_ONLY','tvs':tvs,'physical_hours':1,
   'proof_cadence_s':15,'metrics':physical,'faults':faults,'offline':offline_result,
   'projected_8_12_18_24_hours':projections,
   'full_original_report_rpc_executed_here':False,
   'media_egress_measured':False,'Edge_invocations_measured':False,
   'SQLite_real_FULL_tested':False,'synthetic_key_NOT_KMS':True,
   'RSS_python_KiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
   'elapsed_s':round(time.monotonic()-start,3),
   'TOCTOU_security':'FAIL_NO_GO','production':'NO_GO'}
 print('QA_SEGMENTED_ECONOMY_JSON='+json.dumps(result,sort_keys=True),flush=True)
def main():
 p=argparse.ArgumentParser();p.add_argument('--tvs',type=int,choices=(10,100,300),default=10)
 p.add_argument('--worker',nargs=3);args=p.parse_args()
 if args.worker:
  check_environment();archive(Path(args.worker[0]),args.worker[1],args.worker[2])
 else:run(args.tvs)
if __name__=='__main__':main()
