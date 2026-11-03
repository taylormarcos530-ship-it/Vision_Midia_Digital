"""Real TCP 100/300 simultaneous slow readers, two subprocess proxies, PG17.
Only tests a NEW disposable copy of the per-block prototype; parent untouched.
PASS means bounded revocation on this one local runner, never a production SLA.
"""
from __future__ import annotations
import concurrent.futures,importlib.util,json,os,resource,socket,struct,sys,tempfile,time
from pathlib import Path
import psycopg
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
spec=importlib.util.spec_from_file_location("block_qa",ROOT/"block-fence-qa"/"verify.py")
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
assert os.environ.get("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
N=int(os.environ["QA_TVS"]);CHUNK=int(os.environ["QA_CHUNK"])
assert N in (100,300) and CHUNK in (65536,262144)
def check(test,msg):assert test,msg
def pgstate():
 with qa.base.con() as c:
  c.execute("SELECT pg_stat_clear_snapshot()")
  stats=c.execute("""SELECT xact_commit,xact_rollback,blks_read,blks_hit,
                         tup_returned,tup_fetched
                     FROM pg_stat_database WHERE datname=current_database()""").fetchone()
  lsn=c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0]
  locks=c.execute("""SELECT count(*) FROM pg_locks
                 WHERE locktype='advisory' AND NOT granted""").fetchone()[0]
  return {"db_stats":list(map(int,stats)),"lsn":str(lsn),"pending_advisory":int(locks)}
def wal_delta(start,end):
 with qa.base.con() as c:
  return int(c.execute("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",(end["lsn"],start["lsn"])).fetchone()[0])
def rss_kib(pid):
 try:
  for line in Path(f"/proc/{pid}/status").read_text().splitlines():
   if line.startswith("VmRSS:"):return int(line.split()[1])
 except FileNotFoundError:return 0
 return 0
def patch_source(dest):
 source=(ROOT/"block-fence-qa"/"worker.py").read_text()
 patches=[
  ('class Handler(BaseHTTPRequestHandler):',
   'class BurstServer(ThreadingHTTPServer):\n request_queue_size=512\n\nclass Handler(BaseHTTPRequestHandler):'),
  ('srv=ThreadingHTTPServer(("127.0.0.1",0),Handler)',
   'srv=BurstServer(("127.0.0.1",0),Handler)'),
  ('self.kill_hold=threading.Event();self.pool=Pool()',
   'self.kill_hold=threading.Event();self.storm_release=threading.Event();self.pool=Pool()'),
  ('slow=self.path=="/slow"','slow=self.path in ("/slow","/storm")'),
  ('"/kill_lock","/slow")','"/kill_lock","/slow","/storm")'),
  ('  for i in range(0,len(WIRE),CHUNK):',
   '  if self.path=="/storm":\n   S.add("storm_headers")\n   if not S.storm_release.wait(timeout=40):self.close_now();return\n  for i in range(0,len(WIRE),CHUNK):'),
  ('if i==0 and slow:', 'if i==0 and self.path=="/slow":'),
  ('   elif cmd=="reset_pause":S.pause.clear();res=dict(type="ACK")',
   '   elif cmd=="release_storm":S.storm_release.set();res=dict(type="ACK")\n   elif cmd=="reset_storm":S.storm_release.clear();res=dict(type="ACK")\n   elif cmd=="reset_pause":S.pause.clear();res=dict(type="ACK")')
 ]
 for original,replacement in patches:
  check(source.count(original)==1,("upstream changed, refuse patch",original,source.count(original)))
  source=source.replace(original,replacement)
 dest.write_text(source)
 import py_compile;py_compile.compile(str(dest),doraise=True)
def slow_open(port):
 s=socket.socket()
 s.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,1024)
 s.settimeout(22)
 try:
  s.connect(("127.0.0.1",port))
  s.sendall(b"GET /storm HTTP/1.1\r\nHost: localhost\r\nX-QA-Token: valid-test-token\r\nConnection: close\r\n\r\n")
  head=b""
  while b"\r\n\r\n" not in head:
   z=s.recv(4096)
   if not z:raise AssertionError("closed before HTTP response headers")
   head+=z
   check(len(head)<10000,"header too large")
  before,_,body=head.partition(b"\r\n\r\n")
  check(b"HTTP/1.1 200" in before,("expected status 200",before[:100]))
  check(b"X-QA-SHA256:" in before, "missing SHA advertised")
  return s,body
 except Exception:
  s.close()
  raise
def receive_rest(pair):
 s,initial=pair;data=bytearray(initial);event=None
 try:
  s.settimeout(3)
  while True:
   try:chunk=s.recv(65536)
   except (socket.timeout,TimeoutError):event="timed_out";break
   except (OSError,ConnectionError):event="connection_aborted";break
   if not chunk:event="eof";break
   data.extend(chunk)
   if len(data)>1024*1024:raise AssertionError("unexpected excess bytes")
 finally:s.close()
 return dict(bytes=len(data),transport=event)
def cleanup(pair):
 try:
  s=pair[0]
  s.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack("ii",1,0))
  s.close()
 except Exception:pass
def run_burst(workers,n,mode):
 a,b=workers;ports=[a.meta["port"],b.meta["port"]]
 for w in workers:w.cmd("reset_storm")
 before=[w.metrics() for w in workers]
 startpg=pgstate();t0=time.monotonic()
 pairs=[]
 try:
  # Every socket receives a true HTTP 200 header, then client stops recv().
  # The per-request server thread holds NO PG advisory lock in this barrier.
  with concurrent.futures.ThreadPoolExecutor(max_workers=72) as pool:
   pairs=list(pool.map(lambda i:slow_open(ports[i%2]),range(n)))
  setup_ms=(time.monotonic()-t0)*1000
  check(len(pairs)==n,"not all client sockets opened")
  counts=[w.metrics().get("storm_headers",0)-before[i].get("storm_headers",0) for i,w in enumerate(workers)]
  check(sum(counts)==n,("not all HTTP headers reached server",counts,n))
  check(qa.base.gate()[0] is True,"gate not open")
  max_rss=max(rss_kib(w.proc.pid) for w in workers)
  completed_before=sum(w.metrics().get("application_write_completed_bytes",0) for w in workers)
  if mode=="release_after_commit":
   start=time.monotonic()
   closed=qa.close_gate_timed()
   check(closed["ms"]<750,("bounded gate writer failed",mode,closed))
   pg_after_commit=pgstate()
   for w in workers:w.cmd("release_storm")
  else:
   for w in workers:w.cmd("release_storm")
   # This race runs the writer just after 2 requests have entered a short
   # shared-lock block. This is NOT proof all n clients were lock holders.
   limit=time.monotonic()+6;entered=0
   while time.monotonic()<limit:
    now=sum(w.metrics().get("gate_reads",0)-before[i].get("gate_reads",0) for i,w in enumerate(workers))
    if now>n+2:entered=now-n;break
    time.sleep(.003)
   check(entered>0,("never saw shared block guard",n,mode))
   closed=qa.close_gate_timed()
   pg_after_commit=pgstate()
   check(closed["ms"]<750,("bounded gate writer failed under burst",closed))
  # All sockets remain client-side open until after gate COMMIT. Now drain:
  # a pre-COMMIT 200 may be truncated and must never validate as 10000 rows.
  with concurrent.futures.ThreadPoolExecutor(max_workers=72) as pool:
   tails=list(pool.map(receive_rest,pairs))
  pairs=[]
  after=[w.metrics() for w in workers]
  sent_after=sum(x.get("application_write_completed_bytes",0) for x in after)
  # The explicit completed-write metric is sampled AFTER COMMIT and drain,
  # but output may have been written before COMMIT and only measured later.
  # Hence only the before-commit barrier mode can assert ZERO new bytes.
  if mode=="release_after_commit":
   check(sent_after==completed_before,
        ("post-revocation instrumented bytes in held-before-commit barrier",sent_after,completed_before))
   check(all(x["bytes"]<a.meta["gzip_bytes"] for x in tails),
         "a full report was sent after gate COMMIT")
  for port in ports:check(qa.read(port)["status"]==503,"gateway admitted closed gate")
  metrics=dict(
   mode=mode,simultaneous_open_clients=n,
   started_while_gate_open=True,all_HTTP_200_headers=True,
   max_worker_RSS_KiB=max_rss,
   header_setup_ms=round(setup_ms,3),
   close_commit_ms=closed["ms"],within_750ms=closed["ms"]<750,
   response_tail_bytes_total=sum(x["bytes"] for x in tails),
   complete_report_count_after_commit=sum(x["bytes"]>=a.meta["gzip_bytes"] for x in tails),
   response_transport_counts={k:sum(x["transport"]==k for x in tails) for k in ("eof","timed_out","connection_aborted")},
   per_process_headers=counts,
   worker_counts_delta={key:sum(after[i].get(key,0)-before[i].get(key,0) for i in range(2))
         for key in ("requests","gate_reads","application_write_completed_bytes",
                     "send_timeout_or_closed","block_guard_timeout","denied_after_header")},
   pg_baseline=startpg,pg_at_commit=pg_after_commit,
   pg_WAL_delta_bytes_until_COMMIT=wal_delta(startpg,pg_after_commit),
   PG_database_stats_delta=[pg_after_commit["db_stats"][i]-startpg["db_stats"][i] for i in range(6)],
   previous_200_bytes_may_arrive_post_commit=True)
  check(metrics["pg_WAL_delta_bytes_until_COMMIT"]>=0,"invalid PG WAL delta")
  return metrics
 finally:
  for p in pairs:cleanup(p)
def main():
 started=time.monotonic()
 qa.base.base.setup()
 tmp=Path(tempfile.mkdtemp(prefix="vision_v2_storm_qa_"))
 patch_source(tmp/"worker.py")
 previous=qa.HERE;qa.HERE=tmp
 workers=[]
 try:
  workers=[qa.Child(0),qa.Child(1)]
  check(workers[0].proc.pid!=workers[1].proc.pid,"one process only")
  base=run_burst(workers,N,"release_after_commit")
  qa.base.base.write_gate(True)
  racing=run_burst(workers,N,"writer_races_block_guards")
  report=dict(qa="LOCAL_ADVERSARIAL_STORM",clients=N,chunk_bytes=CHUNK,
   production_GO=False,security_verdict="NO_GO_NOT_FULLY_PROVEN",
   same_runner_not_multi_host=True,distinct_OS_processes=2,
   original_report_SHA256=workers[0].meta["sha"],
   cases=[base,racing],gate_close_budget_ms=750,
   all_clients_simultaneously_connected_before_tested_writer=True,
   no_claim_all_connections_held_PG_lock_simultaneously=True,
   no_proof_of_physical_packet_delivery_cutoff=True,
   exact_SQL_statements_not_derived_from_PG_stat_database=True,
   measured_SQL_gate_read_count=sum(c["worker_counts_delta"]["gate_reads"] for c in (base,racing)),
   elapsed_s=round(time.monotonic()-started,3))
  Path("qa-v2-300-storm.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_STORM_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  for w in workers:w.close()
  qa.HERE=previous
if __name__=="__main__":main()
