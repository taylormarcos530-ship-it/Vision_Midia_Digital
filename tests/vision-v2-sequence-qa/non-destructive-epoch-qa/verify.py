"""QA ONLY: non-destructive *separate* authority row, 100/300 old real PG17
advisory holders remain alive. No claim old code automatically obeys new fence.
New HTTP path verifies separate row with FOR SHARE for each bounded chunk.
Never reads credentials or contacts production.
"""
from __future__ import annotations
import concurrent.futures,hashlib,importlib.util,json,os,py_compile,resource,sys,tempfile,time
from pathlib import Path
import psycopg
P=Path(__file__).resolve().parent
ROOT=P.parent
def module(name,path):
 s=importlib.util.spec_from_file_location(name,path)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
old=module("original_positive",ROOT/"toctou-continuous-qa"/"positive.py")
locks=module("original_real_lock_controller",ROOT/"pg-lock-storm-qa"/"controller.py")
http=module("original_block_verify",ROOT/"block-fence-qa"/"verify.py")
N=int(os.environ["QA_TVS"]);CHUNK=int(os.environ["QA_CHUNK"])
assert N in (100,300) and CHUNK in (65536,262144)
assert os.environ.get("GITHUB_REF")==old.BRANCH and os.environ.get("QA_STREAM_GUARD_GROUP")=="1"
def ck(x,msg):assert x,msg
def sql(sql,args=()):
 with old.con() as c:return c.execute(sql,args).fetchone() if sql.strip().upper().startswith("SELECT") else None
def snapshot():
 with old.con() as c:
  locks=c.execute("""SELECT count(*),count(DISTINCT pid) FROM pg_locks WHERE
   locktype='advisory' AND mode='ShareLock' AND granted
   AND classid=0 AND objid=%s""",(old.LOCK_GATE,)).fetchone()
  fence=c.execute("SELECT enabled,epoch FROM qa_nd_fence WHERE id=1").fetchone()
  legacy=c.execute("SELECT enabled,epoch FROM qa_mproc_gate WHERE id=1").fetchone()
  lsn=str(c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0])
  return dict(real_locks=locks[0],unique_backends=locks[1],
              fence_enabled=fence[0],epoch=fence[1],legacy_gate_enabled=legacy[0],
              wal_lsn=lsn)
def close_epoch():
 start=time.monotonic()
 try:
  with old.con() as c:
   with c.transaction():
    c.execute("SELECT set_config('lock_timeout','500ms',true)")
    c.execute("UPDATE qa_nd_fence SET enabled=false,epoch=epoch+1 WHERE id=1")
    epoch=c.execute("SELECT epoch FROM qa_nd_fence WHERE id=1").fetchone()[0]
  return dict(committed=True,epoch=epoch,ms=round((time.monotonic()-start)*1000,3))
 except psycopg.errors.LockNotAvailable:
  return dict(committed=False,reason="LOCK_TIMEOUT",ms=round((time.monotonic()-start)*1000,3))
def make_worker(path):
 src=(ROOT/"block-fence-qa"/"worker.py").read_text()
 start=src.index("def gate_allowed(c):")
 end=src.index("class Handler(BaseHTTPRequestHandler):",start)
 replace="""def gate_allowed(c):
 try:
  row=c.execute('SELECT enabled,epoch FROM qa_nd_fence WHERE id=1 FOR SHARE').fetchone()
  S.add('authority_row_reads')
  return bool(row and row[0])
 except psycopg.Error:
  S.add('authority_unreachable')
  return False
"""
 src=src[:start]+replace+src[end:]
 path.write_text(src)
 py_compile.compile(str(path),doraise=True)
def read_wal(start,end):
 with old.con() as c:
  return int(c.execute("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",
                       (end["wal_lsn"],start["wal_lsn"])).fetchone()[0])
def main():
 began=time.monotonic()
 old.setup()
 with old.con() as c:
  c.execute("""CREATE TABLE qa_nd_fence
    (id integer PRIMARY KEY,enabled boolean NOT NULL,epoch bigint NOT NULL)""")
  c.execute("INSERT INTO qa_nd_fence VALUES (1,true,1)")
 workers=[];proxies=[]
 folder=Path(tempfile.mkdtemp(prefix="vision_v2_nd_qa_"))
 make_worker(folder/"worker.py")
 prior=http.HERE
 http.HERE=folder
 try:
  workers=[locks.Worker(0,N//2),locks.Worker(1,N//2)]
  initial=snapshot()
  ck(initial["real_locks"]==initial["unique_backends"]==N,
     ("not truly 100/300 PG sessions",initial))
  proxies=[http.Child(0),http.Child(1)]
  a,b=proxies
  ck(a.meta["sha"]==b.meta["sha"],"original source changed")
  with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
   reader=ex.submit(http.read,a.meta["port"],"/pause",8)
   http.await_count(a,"paused_after_first")
   # With every OLD transaction lock still held, this independent writer
   # updates a disjoint SQL row. Never SIGKILL the holders.
   closed=close_epoch()
   ck(closed["committed"] and closed["ms"]<750,
      ("new authority failed 750ms local deadline",closed))
   after=snapshot()
   ck(after["real_locks"]==after["unique_backends"]==N,
      ("non-destructive close released old holders unexpectedly",after))
   ck(not after["fence_enabled"] and after["legacy_gate_enabled"],
      "test no longer proves coexistence risk")
   before_write=a.metrics().get("application_write_completed_bytes",0)
   a.cmd("resume")
   partial=reader.result(timeout=10)
   ck(partial["status"]==200 and not partial["application_valid"],
      ("old HTTP200 incorrectly accepted as full",partial))
   ck(a.metrics().get("application_write_completed_bytes",0)==before_write,
      "application wrote new chunk after authority closure")
  # New candidate denies every GET while old transactions remain locked;
  # 100/300 requests across two independent subprocesses and real TCP.
  with concurrent.futures.ThreadPoolExecutor(max_workers=35) as ex:
   refused=list(ex.map(lambda i:http.read([a.meta["port"],b.meta["port"]][i%2],
                "/normal",timeout=6),range(N)))
  ck(all(x["status"]==503 and not x["application_valid"] for x in refused),
     ("non-closed report admitted",sum(x["status"]!=503 for x in refused)))
  denied_ms=[x["ms"] for x in refused]
  # Actual RST/FIN/half-open faults are checked against full-report integrity.
  faults={}
  for path in ("/rst","/fin","/halfopen"):
   results=[http.read(w.meta["port"],path,timeout=2) for w in proxies]
   ck(all(not v["application_valid"] for v in results),("accepted partial transport",path))
   faults[path]=[dict(status=v["status"],transport=v["transport"],bytes=v["bytes"])
                 for v in results]
  with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
   both=[ex.submit(close_epoch),ex.submit(close_epoch)]
   results=[f.result(timeout=4) for f in both]
  ck(all(x["committed"] and x["ms"]<750 for x in results),("two writer race",results))
  last=snapshot()
  ck(last["epoch"]==closed["epoch"]+2 and last["real_locks"]==N,
     ("epoch or locks wrong after two writers",last))
  # Do not silently claim legacy routes were migrated:
  # original gate is still enabled and its long-held lock transactions persist.
  report=dict(
   QA="PASS_LOCAL_SEPARATE_EPOCH_DISJOINT_FROM_OLD_LOCKS",
   security_verdict="NO_GO_LEGACY_GATE_BYPASS_AND_DISTRIBUTED_AUTHORITY_UNPROVEN",
   production_GO=False,clients=N,chunk_bytes=CHUNK,
   existing_old_shared_lock_holders=N,old_backend_PIDs_verified=True,
   old_holders_processes_killed=0,
   separate_authority_COMMIT=closed,old_gate_still_open=after["legacy_gate_enabled"],
   old_sessions_still_held_locks_after_COMMIT=after["real_locks"]==N,
   full_200_response_after_commit=False,partial_http_200=partial,
   closed_new_path_denied_count=N,
   denied_get_p95_ms=old.pct(denied_ms,.95),
   denied_get_p99_ms=old.pct(denied_ms,.99),
   two_concurrent_writer_COMMITs=results,monotonic_epoch_after_two_writers=last["epoch"],
   transport_faults=faults,
   WAL_delta_bytes_across_narrow_study=read_wal(initial,last),
   explicit_authority_SQL_read_count=sum(w.metrics().get("authority_row_reads",0) for w in proxies),
   max_proxy_rss_kib=[locks.pidrss(w.proc.pid) for w in proxies],
   known_security_failure="LEGACY_READERS_IGNORE_NEW_FENCE",
   actual_network_client_SHA_validation_not_proven=True,
   SQL_billing_not_estimated=True,
   elapsed_s=round(time.monotonic()-began,3))
  Path("qa-v2-nd-epoch.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_ND_FENCE_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  for w in proxies:w.close()
  for w in workers:w.close()
  http.HERE=prior
if __name__=="__main__":main()
