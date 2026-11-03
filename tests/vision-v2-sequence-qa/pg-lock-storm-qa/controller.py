"""Independent PG17 100/300 ACTUAL shared advisory xact locks.
FAIL security if stalled holders force 750ms lock_timeout; separate emergency
SIGKILL mode measures whether an operator killing both OS processes can
release the writer within budget. This is NOT a deployable revocation fix.
"""
from __future__ import annotations
import concurrent.futures,importlib.util,json,os,resource,signal,subprocess,sys,threading,time
from pathlib import Path
import psycopg
from psycopg.errors import LockNotAvailable
P=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("previous_positive",P.parent/"toctou-continuous-qa"/"positive.py")
positive=importlib.util.module_from_spec(spec);spec.loader.exec_module(positive)
assert os.environ.get("GITHUB_REF")==positive.BRANCH
N=int(os.environ["QA_TVS"]);CHUNK=int(os.environ["QA_CHUNK"])
assert N in (100,300) and CHUNK in (65536,262144)
LOCK=63918942
def ck(t,msg):assert t,msg
def pgconn():return psycopg.connect(**positive.KW,autocommit=True)
def snapshot():
 with pgconn() as c:
  c.execute("SELECT pg_stat_clear_snapshot()")
  version=int(c.execute("SHOW server_version_num").fetchone()[0])
  maxconn=int(c.execute("SHOW max_connections").fetchone()[0])
  ck(170000<=version<180000 and maxconn>=400,("require isolated PG17 400+ connections",version,maxconn))
  count,distinct=c.execute("""SELECT count(*),count(DISTINCT pid) FROM pg_locks
    WHERE locktype='advisory' AND mode='ShareLock' AND granted
      AND classid=0 AND objid=%s""",(LOCK,)).fetchone()
  pending=c.execute("""SELECT mode,count(*) FROM pg_locks
    WHERE locktype='advisory' AND NOT granted AND classid=0 AND objid=%s
    GROUP BY mode ORDER BY mode""",(LOCK,)).fetchall()
  lsn=c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0]
  act=c.execute("""SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
    AND state='idle in transaction'""").fetchone()[0]
  return dict(granted=int(count),distinct=int(distinct),pending={mode:int(n) for mode,n in pending},
              idle_xact=int(act),max_connections=maxconn,lsn=str(lsn))
def wal_delta(a,b):
 with pgconn() as c:
  return int(c.execute("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",(b["lsn"],a["lsn"])).fetchone()[0])
def timed_close(timeout_ms):
 now=time.monotonic()
 try:
  with pgconn() as c:
   with c.transaction():
    c.execute("SELECT set_config('lock_timeout',%s,true)",(str(timeout_ms)+"ms",))
    c.execute("SELECT pg_advisory_xact_lock(%s)",(LOCK,))
    c.execute("UPDATE qa_mproc_gate SET enabled=false,epoch=epoch+1 WHERE id=1")
  return dict(committed=True,ms=round((time.monotonic()-now)*1000,3))
 except LockNotAvailable:
  return dict(committed=False,reason="PG_LOCK_TIMEOUT",ms=round((time.monotonic()-now)*1000,3))
def pidrss(pid):
 try:
  for x in Path(f"/proc/{pid}/status").read_text().splitlines():
   if x.startswith("VmRSS:"):return int(x.split()[1])
 except FileNotFoundError:return 0
 return 0
class Worker:
 def __init__(self,i,count):
  env=dict(os.environ,QA_HOLDER_ID=str(i),QA_HOLDER_COUNT=str(count))
  self.proc=subprocess.Popen([sys.executable,"-u",str(P/"holder.py")],
   stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
   text=True,bufsize=1,env=env)
  line=self.proc.stdout.readline()
  ck(line,("holder failed",i,self.proc.poll()))
  self.meta=json.loads(line)
  ck(self.meta["type"]=="LOCKS_HELD" and self.meta["n"]==count,
   ("holder not ready",i,self.meta))
 def kill(self):
  if self.proc.poll() is None:self.proc.send_signal(signal.SIGKILL)
  self.proc.wait(timeout=7)
  ck(self.proc.returncode==-signal.SIGKILL,"holder SIGKILL was not real")
 def close(self):
  if self.proc.poll() is None:self.kill()
  for f in (self.proc.stdin,self.proc.stdout,self.proc.stderr):
   try:f.close()
   except OSError:pass
def wait_pending(mode,needed=1,seconds=1):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  if snapshot()["pending"].get(mode,0)>=needed:return True
  time.sleep(.004)
 return False
def late_reader(i):
 start=time.monotonic()
 with pgconn() as c:
  with c.transaction():
   c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK,))
   allowed=c.execute("SELECT enabled FROM qa_mproc_gate WHERE id=1").fetchone()[0]
 return dict(allowed=bool(allowed),wait_ms=round((time.monotonic()-start)*1000,3))
def main():
 begin=time.monotonic();positive.setup()
 holders=[]
 summary=dict(production_GO=False,security_verdict="FAIL_NO_GO_BOUNDED_REVOCATION",
  real_PG17_multi_backend_shared_locks=True,
  one_disposable_runner=True,real_processes=2,holders_requested=N,
  chunk_bytes=CHUNK,NO_GO=True)
 try:
  holders=[Worker(0,N//2),Worker(1,N//2)]
  before=snapshot()
  pids=holders[0].meta["pids"]+holders[1].meta["pids"]
  ck(len(pids)==N and len(set(pids))==N,("not independent DB backends",len(pids)))
  ck(before["granted"]==N and before["distinct"]==N,("not N actual granted locks",before))
  ck(before["idle_xact"]>=N,("not all transactions idle while holding locks",before))
  baseline=timed_close(750)
  ck(not baseline["committed"] and baseline.get("reason")=="PG_LOCK_TIMEOUT",
    ("unbounded holders unexpectedly permitted revocation",baseline))
  ck(positive.gate()[0] is True,"gate closed after failed 750ms revocation")
  after_timeout=snapshot()
  ck(after_timeout["granted"]==N and after_timeout["distinct"]==N,
    ("test holders did not persist after writer timeout",after_timeout))
  summary["unbounded_300_lock_holders"]=dict(
    status="SECURITY_FAIL_REPRODUCED",writer=baseline,gate_still_open=True,
    verified_distinct_PG_backends=before["distinct"],granted_advisory_locks=before["granted"])
  # Real termination of BOTH holder OS processes. One writer queues behind
  # 100/300 actual locks. Further shared requests enqueue BEHIND the writer.
  # No guarantee exists that this emergency mass-kill is suitable for production.
  with concurrent.futures.ThreadPoolExecutor(max_workers=22) as ex:
   writer=ex.submit(timed_close,750)
   ck(wait_pending("ExclusiveLock",seconds=.35),"exclusive writer not queued")
   later=[ex.submit(late_reader,i) for i in range(20)]
   # Give the 20 additional shared-lock readers a bounded opportunity to queue.
   queue_start=time.monotonic()
   while time.monotonic()-queue_start<.11:
    if snapshot()["pending"].get("ShareLock",0)>=5:break
    time.sleep(.004)
   pending_before_kill=snapshot()
   ck(not writer.done(),"writer completed while locks held")
   killed_at=time.monotonic()
   for h in holders:h.proc.send_signal(signal.SIGKILL)
   for h in holders:
    h.proc.wait(timeout=7)
    ck(h.proc.returncode==-signal.SIGKILL,"real SIGKILL missing")
   closed=writer.result(timeout=5)
   later_results=[x.result(timeout=7) for x in later]
  after_close=snapshot()
  ck(closed["committed"],("SIGKILL failed to release all real locks",closed,after_close))
  ck(closed["ms"]<750,("emergency SIGKILL exceeded revocation deadline",closed))
  ck(positive.gate()[0] is False,"gate not closed after writer committed")
  ck(all(not x["allowed"] for x in later_results),"later reader bypassed exclusive writer")
  ck(after_close["granted"]==0,("remaining granted shared locks after clients gone",after_close))
  waits=[x["wait_ms"] for x in later_results]
  summary["emergency_SIGKILL_both_holder_processes"]=dict(
    status="PASS_LOCAL_OPERATOR_FORCED_ABORT_ONLY",
    writer=closed,writer_queued_before_kill=True,
    queued_late_shared_locks=pending_before_kill["pending"].get("ShareLock",0),
    later_shared_readers_rejected=20,late_reader_p95_ms=positive.pct(waits,.95),
    late_reader_p99_ms=positive.pct(waits,.99),
    SIGKILL_to_writer_complete_ms=round((time.monotonic()-killed_at)*1000,3),
    physical_TCP_already_sent_not_recalled=True)
  summary["PG_metrics"]=dict(
    before=before,after_writer_timeout=after_timeout,after_close=after_close,
    WAL_delta_bytes=wal_delta(before,after_close),
    child_max_rss_KiB=[pidrss(h.proc.pid) or h.meta["rss_kib"] for h in holders],
    controller_rss_KiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    SQL_explicit_holder_min=N*2,
    SQL_controller_instrumentation_incomplete=True)
  summary["P95_P99_are_late_reader_wait_not_full_HTTP"]=True
  summary["actual_HTTP_200_truncation_test_run_this_job"]=False
  summary["independent_operator_cancellation_needed"]=True
  summary["duration_seconds"]=round(time.monotonic()-begin,3)
  Path("qa-v2-real-pg-locks.json").write_text(json.dumps(summary,indent=2,sort_keys=True))
  print("QA_REAL_PG_LOCKS_JSON="+json.dumps(summary,sort_keys=True),flush=True)
 finally:
  for h in holders:h.close()
if __name__=="__main__":main()
