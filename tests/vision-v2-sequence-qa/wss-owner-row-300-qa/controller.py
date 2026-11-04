"""QA-local 100/300 PostgreSQL17 same-device row locks and 750ms safety gate.

Provable negative: unbounded FOR SHARE owners cause UPDATE lock_timeout and
cannot commit in 750ms. An independent disjoint epoch can close promptly,
but older readers ignoring it remain security FAIL. Voluntary holder
release allows owner UPDATE without SIGKILL, NOT guaranteed within 750ms
with real blocked WSS/TLS clients. PG17 tuple lock counts often NOT exposed
directly by pg_locks; use row SELECT, distinct backends, PG relation locks,
and writer blocked as supporting evidence, not physical per-row proof.
"""
from __future__ import annotations
import concurrent.futures,json,os,resource,subprocess,sys,time
from pathlib import Path
import psycopg
from psycopg.errors import LockNotAvailable
ROOT=Path(__file__).resolve().parent
N=int(os.environ['QA_TVS'])
assert N in (100,300) and N%2==0
assert os.environ.get('GITHUB_REF')=='refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102'
assert os.environ.get('QA_STREAM_GUARD_GROUP')=='1'
for key in ('DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PGHOST','PGSERVICE','REDIS_URL'):
 assert not os.getenv(key),(key,'live env forbidden')
CONN=dict(host='127.0.0.1',port=5432,dbname='vision_v2_quarantine_disposable',
  user='postgres',password='qa-only-local-password',connect_timeout=4)
def ck(x,m):assert x,m
def pct(values,percent):
 a=sorted(values);pos=(len(a)-1)*percent;i=int(pos);w=pos-i
 return round(a[i]*(1-w)+a[min(i+1,len(a)-1)]*w,3)
def dbquery(query,args=()):
 with psycopg.connect(**CONN,autocommit=True) as c:
  return c.execute(query,args).fetchone()
def snapshot():
 with psycopg.connect(**CONN,autocommit=True) as c:
  c.execute('SELECT pg_stat_clear_snapshot()')
  rel=c.execute("SELECT 'qa_owner'::regclass::oid").fetchone()[0]
  rows=c.execute("""SELECT count(*),count(DISTINCT a.pid)
    FROM pg_stat_activity a JOIN pg_locks l ON a.pid=l.pid
    WHERE a.application_name LIKE 'vision-v2-row-holder-%'
      AND a.state='idle in transaction'
      AND a.query LIKE '%FOR SHARE%'
      AND l.relation=%s AND l.mode='RowShareLock' AND l.granted""",(rel,)).fetchone()
  blocked=c.execute("""SELECT count(*) FROM pg_stat_activity
    WHERE application_name='vision-v2-row-writer' AND wait_event_type='Lock'""").fetchone()[0]
  epoch=c.execute("SELECT enabled,epoch FROM qa_independent_epoch WHERE id=1").fetchone()
  owner=c.execute("SELECT tenant FROM qa_owner WHERE device='tv-0000'").fetchone()[0]
  lsn=str(c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0])
  return dict(rowshare_granted=rows[0],distinct_PG_backends=rows[1],blocked_writer=blocked,
       epoch_enabled=epoch[0],epoch=epoch[1],owner=owner,lsn=lsn)
def update_owner(timeout=750):
 now=time.monotonic()
 try:
  with psycopg.connect(**CONN,application_name='vision-v2-row-writer') as c:
   with c.transaction():
    c.execute("SELECT set_config('lock_timeout',%s,true)",(str(timeout)+'ms',))
    c.execute("UPDATE qa_owner SET tenant='company-B' WHERE device='tv-0000'")
  return dict(committed=True,elapsed_ms=round((time.monotonic()-now)*1000,3))
 except LockNotAvailable:
  return dict(committed=False,reason='PG_LOCK_TIMEOUT',elapsed_ms=round((time.monotonic()-now)*1000,3))
def close_epoch():
 now=time.monotonic()
 with psycopg.connect(**CONN) as c:
  with c.transaction():
   c.execute("SELECT set_config('lock_timeout','500ms',true)")
   c.execute("UPDATE qa_independent_epoch SET enabled=false,epoch=epoch+1 WHERE id=1")
 return dict(committed=True,elapsed_ms=round((time.monotonic()-now)*1000,3))
class Holder:
 def __init__(self,i):
  env=dict(os.environ,QA_ROW_WORKER=str(i),QA_ROW_HOLDERS=str(N//2))
  self.p=subprocess.Popen([sys.executable,'-u',str(ROOT/'holder.py')],
      stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
      text=True,bufsize=1,env=env)
  line=self.p.stdout.readline()
  ck(bool(line),('holder process failed',i,self.p.poll()))
  self.info=json.loads(line)
  ck(self.info['type']=='ROW_HOLDERS_READY' and self.info['count']==N//2,
     ('holder not ready',self.info))
 def release(self):
  ck(self.p.poll() is None,'holder exited before voluntary release')
  self.p.stdin.write('{"cmd":"release"}\n');self.p.stdin.flush()
  line=self.p.stdout.readline()
  ck(line and json.loads(line).get('released'),'release ack missing')
 def wait(self):
  self.p.wait(timeout=12)
  ck(self.p.returncode==0,('unexpected holder failure',self.p.returncode,self.p.stderr.read()[:800]))
 def close(self):
  if self.p.poll() is None:
   try:self.release()
   except Exception:pass
   try:self.p.wait(timeout=8)
   except subprocess.TimeoutExpired:self.p.kill();self.p.wait(timeout=5)
  for pipe in (self.p.stdin,self.p.stdout,self.p.stderr):
   try:pipe.close()
   except Exception:pass
def wait_writer():
 end=time.monotonic()+.4
 while time.monotonic()<end:
  if snapshot()['blocked_writer']:return True
  time.sleep(.004)
 return False
def main():
 begin=time.monotonic()
 with psycopg.connect(**CONN) as c:
  ck(int(c.execute('SHOW server_version_num').fetchone()[0])//10000==17,'PG17 only')
  ck(int(c.execute('SHOW max_connections').fetchone()[0])>=400,'requires disposable 450 connections')
  c.execute('CREATE TABLE qa_owner(device text PRIMARY KEY, tenant text NOT NULL)')
  c.execute("INSERT INTO qa_owner VALUES('tv-0000','company-A')")
  c.execute('CREATE TABLE qa_independent_epoch(id int PRIMARY KEY,enabled boolean NOT NULL,epoch bigint NOT NULL)')
  c.execute("INSERT INTO qa_independent_epoch VALUES(1,true,1)")
 holders=[]
 try:
  holders=[Holder(0),Holder(1)]
  original=snapshot()
  ck(original['distinct_PG_backends']==N and original['rowshare_granted']==N,
     ('actual same-row PG backend/SQL FOR SHARE evidence missing',original))
  ck(original['owner']=='company-A','owner altered during setup')
  blocked=update_owner(750)
  ck(not blocked['committed'] and blocked['reason']=='PG_LOCK_TIMEOUT',
     ('unbounded row lock unexpectedly met 750ms',blocked))
  ck(snapshot()['owner']=='company-A','writer committed despite timeout')
  independent=close_epoch()
  ck(independent['committed'] and independent['elapsed_ms']<750,
      ('independent epoch unexpectedly blocked',independent))
  mid=snapshot()
  ck(mid['distinct_PG_backends']==N and mid['epoch_enabled']==False and
     mid['owner']=='company-A',('independent epoch changed legacy physical locks',mid))
  # Must acquire 100/300 row locks despite tenant update racing. New
  # independently fenced users should NOT receive heartbeat_ack when closed.
  can_ack=bool(dbquery('SELECT enabled FROM qa_independent_epoch WHERE id=1')[0])
  ck(not can_ack,'new epoch failed to block old-session ACK')
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   future=pool.submit(update_owner,750)
   ck(wait_writer(),'owner updater not waiting on genuine row-share holders')
   released_at=time.monotonic()
   for h in holders:h.release()
   result=future.result(timeout=5)
   for h in holders:h.wait()
  ck(result['committed'] and result['elapsed_ms']<750,
     ('voluntary release did not complete bounded local owner update',result))
  ended=snapshot()
  ck(ended['owner']=='company-B' and ended['distinct_PG_backends']==0,
     ('old holder connections survived voluntary release',ended))
  # Rejected even if old cached tenant. This is a synthetic new-epoch-only
  # check, not proof that actual WSS clients are migrated.
  ck(dbquery('SELECT enabled FROM qa_independent_epoch WHERE id=1')[0] is False,'epoch resurrected')
  wal=dbquery('SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)',(ended['lsn'],original['lsn']))[0]
  report=dict(
    QA='PASS_LOCAL_ROW_LOCK_NEGATIVE_AND_VOLUNTARY_RELEASE',
    production_GO=False,
    N_actual_PG17_rowshare_backends=N,
    PG_backend_PIDs_distinct=original['distinct_PG_backends'],
    rows_locking_same_device_verified_by_issued_SELECT_FOR_SHARE=True,
    tuple_level_pg_locks_count_not_verified=True,
    original_owner_update_750ms=blocked,
    independent_epoch_close=independent,
    old_clients_retained_until_voluntary_release=True,
    old_owner_still_authoritative_in_legacy_routes_during_closed_epoch=True,
    additional_heartbeat_ack_if_new_epoch_checked=can_ack,
    owner_update_after_voluntary_release=result,
    SIGKILL_used=False,
    epoch_revocation_end_to_end_proven=False,
    RSS_kib_per_holder_process=[h.info['rss_kib'] for h in holders],
    SQL_lower_bound_for_share_reads=N,
    WAL_delta_bytes_narrow_fixture=int(wal),
    security_verdict='NO_GO_OLD_OWNER_LOCKS_CAN_STALL_750MS_AND_LEGACY_BYPASS',
    elapsed_seconds=round((time.monotonic()-begin),3)
  )
  Path('qa-v2-owner-row-stress.json').write_text(json.dumps(report,indent=2,sort_keys=True))
  print('QA_OWNER_ROW_STRESS_JSON='+json.dumps(report,sort_keys=True),flush=True)
 finally:
  for h in holders:h.close()
if __name__=='__main__':main()
