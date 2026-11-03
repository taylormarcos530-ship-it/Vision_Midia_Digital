"""Independent local PG17 short-lock block fence adversarial QA.
2 independent OS workers, real sockets, deterministic commit barriers.
A wire HTTP 200 truncated by revocation is NOT valid commercially.
No production connections and no claim of real multi-host behavior.
"""
from __future__ import annotations
import concurrent.futures,hashlib,gzip,http.client,importlib.util,json,os,signal,socket,struct,subprocess,sys,time
from pathlib import Path

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("old_qa_fixture",
    HERE.parent/"toctou-continuous-qa"/"positive.py")
base=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)
assert os.environ.get("GITHUB_REF")==base.BRANCH
N=int(os.environ["QA_TVS"]);CHUNK=int(os.environ["QA_CHUNK"])
assert N in (100,300) and CHUNK in (65536,262144)
def ck(pred,label):
 assert pred,label
class Child:
 def __init__(self,index):
  env=dict(os.environ,QA_WORKER_ID=str(index))
  self.proc=subprocess.Popen([sys.executable,"-u",str(HERE/"worker.py")],
      stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
      text=True,bufsize=1,env=env)
  line=self.proc.stdout.readline()
  ck(bool(line),("worker init failed",index,self.proc.poll()))
  self.meta=json.loads(line)
  ck(self.meta["type"]=="READY","worker not ready")
 def cmd(self,name):
  ck(self.proc.poll() is None,("worker exited before cmd",name))
  self.proc.stdin.write(json.dumps({"cmd":name})+"\n");self.proc.stdin.flush()
  result=json.loads(self.proc.stdout.readline())
  ck(result["type"] in ("STATS","ACK"),("worker command",result))
  return result
 def metrics(self):
  return self.cmd("stats")["metrics"]
 def kill(self):
  self.proc.send_signal(signal.SIGKILL);self.proc.wait(timeout=8)
  ck(self.proc.returncode==-signal.SIGKILL,"SIGKILL not executed")
 def close(self):
  if self.proc.poll() is None:
   try:self.cmd("stop")
   except Exception:pass
   try:self.proc.wait(timeout=5)
   except subprocess.TimeoutExpired:self.kill()
  for f in (self.proc.stdin,self.proc.stdout,self.proc.stderr):
   try:f.close()
   except OSError:pass
def read(port,path="/normal",timeout=3):
 conn=http.client.HTTPConnection("127.0.0.1",port,timeout=timeout)
 status=None;headers={};received=b"";transport=None;started=time.monotonic()
 try:
  conn.request("GET",path,headers={"X-QA-Token":"valid-test-token"})
  response=conn.getresponse()
  status=response.status;headers=dict(response.getheaders())
  try:received=response.read()
  except http.client.IncompleteRead as ex:
   received=ex.partial;transport="INCOMPLETE"
  except (OSError,TimeoutError,socket.timeout,ConnectionError) as ex:
   transport=type(ex).__name__
 except (http.client.RemoteDisconnected,ConnectionError,OSError,TimeoutError,socket.timeout) as ex:
  transport=type(ex).__name__
 finally:
  conn.close()
 valid=False
 if status==200 and len(received)==int(headers.get("Content-Length","-1")):
  try:
   body=gzip.decompress(received)
   valid=hashlib.sha256(body).hexdigest()==headers.get("X-QA-SHA256") and len(json.loads(body)["original_full_report"]["export"])==10000
  except Exception:valid=False
 return dict(status=status,application_valid=valid,transport=transport,
  bytes=len(received),ms=round((time.monotonic()-started)*1000,3))
def await_count(worker,name,greater_than=0,timeout=5):
 limit=time.monotonic()+timeout
 while time.monotonic()<limit:
  v=worker.metrics().get(name,0)
  if v>greater_than:return v
  time.sleep(.006)
 raise AssertionError(("metric never reached",name,greater_than))
def wait_writer(timeout=4):
 limit=time.monotonic()+timeout
 while time.monotonic()<limit:
  if base.blocked_writer():return True
  time.sleep(.006)
 return False
def close_gate_timed():
 start=time.monotonic()
 epoch=base.write_gate(False)
 return dict(epoch=epoch,ms=round((time.monotonic()-start)*1000,3))
def slow_client(port):
 s=socket.socket()
 s.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,1024)
 s.settimeout(3)
 s.connect(("127.0.0.1",port))
 s.sendall(b"GET /slow HTTP/1.1\r\nHost: localhost\r\nX-QA-Token: valid-test-token\r\nConnection: close\r\n\r\n")
 header=s.recv(256)
 ck(b"HTTP/1.1 200" in header,("slow client's HTTP status",header[:80]))
 return s,len(header)
def rst_socket(s):
 try:s.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack("ii",1,0))
 except OSError:pass
 s.close()
def main():
 start=time.monotonic()
 base.setup()
 workers=[]
 try:
  workers=[Child(0),Child(1)]
  a,b=workers;ports=[x.meta["port"] for x in workers]
  ck(a.proc.pid!=b.proc.pid,"workers not independent OS processes")
  ck(a.meta["sha"]==b.meta["sha"],"original report changed")
  with concurrent.futures.ThreadPoolExecutor(max_workers=30) as exe:
   normals=list(exe.map(lambda i:read(ports[i%2]),range(N)))
  ck(all(x["application_valid"] and x["status"]==200 for x in normals),
     ("baseline GET failed",sum(not x["application_valid"] for x in normals)))
  # Completed baseline must be exact and not affected by the new test fixture.
  baseline_bytes=sum(x["bytes"] for x in normals)
  ck(baseline_bytes==N*a.meta["gzip_bytes"],"baseline payload changed")
  faults={}
  for path in ("/rst","/fin","/halfopen"):
   results=[read(port,path,timeout=1) for port in ports]
   ck(all(not x["application_valid"] for x in results),("fault accepted",path,results))
   faults[path]=[dict(status=x["status"],bytes=x["bytes"],transport=x["transport"]) for x in results]
  # After the first authorized chunk is finished, force a COMMIT and ensure
  # the next chunk cannot be accepted, while client sees truncated HTTP 200.
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as exe:
   req=exe.submit(read,ports[0],"/pause",5)
   await_count(a,"paused_after_first")
   closed=close_gate_timed()
   ck(closed["ms"]<750,("paused scenario exceeded revocation SLA",closed))
   counts_before=a.metrics().get("application_write_completed_bytes",0)
   a.cmd("resume")
   interrupted=req.result(timeout=8)
   ck(interrupted["status"]==200 and not interrupted["application_valid"],
      ("revoked response incorrectly accepted",interrupted))
   time.sleep(.06)
   ck(a.metrics().get("application_write_completed_bytes",0)==counts_before,
      "application data written after closing COMMIT")
   ck(read(ports[1])["status"]==503,"peer accepted closed gate")
  base.write_gate(True)
  # Deterministic real slow consumer: set receive window 1024, read first
  # response bytes, then stop receiving; worker deliberately stalls .22s
  # during its first bounded transaction under a real socket timeout.
  before=a.metrics().get("slow_guard_enter",0)
  s,nfirst=slow_client(ports[0])
  try:
   await_count(a,"slow_guard_enter",before)
   with concurrent.futures.ThreadPoolExecutor(max_workers=1) as exe:
    pending=exe.submit(close_gate_timed)
    ck(wait_writer(),"slow reader did not block an exclusive writer")
    slow_closed=pending.result(timeout=3)
   ck(slow_closed["ms"]<750,("slow consumer stalls revocation >750ms",slow_closed))
   written_at_commit=a.metrics().get("application_write_completed_bytes",0)
   time.sleep(.05)
   ck(a.metrics().get("application_write_completed_bytes",0)==written_at_commit,
      "new application writes after slow-client revocation COMMIT")
  finally:rst_socket(s)
  ck(read(ports[1])["status"]==503,"slow reader's peer admitted after close")
  base.write_gate(True)
  a.cmd("reset_pause")
  # Both writers commit concurrently during already-admitted but paused
  # response. Request MUST NOT pass final SHA after either commit.
  with concurrent.futures.ThreadPoolExecutor(max_workers=3) as exe:
   before=a.metrics().get("paused_after_first",0)
   req=exe.submit(read,ports[0],"/pause",6)
   await_count(a,"paused_after_first",before)
   gate_future=exe.submit(close_gate_timed)
   member_future=exe.submit(base.write_member,False)
   concurrent_gate=gate_future.result(timeout=3)
   member_future.result(timeout=3)
   ck(concurrent_gate["ms"]<750,"concurrent gate COMMIT blocked")
   before_bytes=a.metrics().get("application_write_completed_bytes",0)
   a.cmd("resume")
   cut=req.result(timeout=7)
   ck(not cut["application_valid"],"concurrent revocation leaked valid full payload")
   time.sleep(.05)
   ck(a.metrics().get("application_write_completed_bytes",0)==before_bytes,
      "post-commit application write after dual revocation")
  base.write_gate(True)
  ck(read(ports[1])["status"]==503,"revoked membership accepted")
  base.write_member(True)
  ck(read(ports[1])["application_valid"],"regrant did not restore report")
  # Real SIGKILL while shared lock is held. Writer must finish fast after
  # process death; client sees incomplete/aborted HTTP, not valid payload.
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as exe:
   pending=exe.submit(read,ports[1],"/kill_lock",5)
   await_count(b,"holding_guard")
   writer=exe.submit(close_gate_timed)
   ck(wait_writer(),"writer never waited before SIGKILL")
   ck(not writer.done(),"writer committed with live lock")
   b.kill()
   died=writer.result(timeout=3)
   ck(died["ms"]<750,("SIGKILL failed bounded revocation",died))
   killed_response=pending.result(timeout=7)
   ck(not killed_response["application_valid"],"killed worker delivered valid body")
  ck(read(ports[0])["status"]==503,"remaining instance served after close")
  report=dict(
    QA="PASS_LOCAL_CANDIDATE_WITH_KNOWN_HTTP200_TRUNCATION",
    production_GO=False,security_verdict="NO_GO_NOT_CERTIFIED",
    original_wss_and_toctou_tests_untouched=True,
    clients=N,chunk_bytes=CHUNK,real_OS_processes=2,one_runner=True,
    original_SHA256=a.meta["sha"],normal_complete_GETs=N,
    normal_application_payload_bytes=baseline_bytes,
    normal_p95_ms=base.pct([x["ms"] for x in normals],.95),
    normal_p99_ms=base.pct([x["ms"] for x in normals],.99),
    transport_faults=faults,
    cutoff_after_first_chunk=dict(revoke_ms=closed["ms"],
       wire_status=interrupted["status"],application_valid=False,
       bytes_received=interrupted["bytes"],old_bytes_can_arrive_after_COMMIT=True),
    slow_TCP_reader=dict(revoke_ms=slow_closed["ms"],
       actual_small_receive_window=True,first_bytes_read=nfirst,
       timeout_budget_ms=750),
    concurrent_gate_member=dict(gate_commit_ms=concurrent_gate["ms"],
       client_application_valid=False),
    SIGKILL_while_guard_held=dict(revocation_ms=died["ms"],
       crashed_client_application_valid=False,worker_pid=b.proc.pid),
    no_new_instrumented_application_writes_after_closure=True,
    bounded_send_timeout_ms=75,guard_timeout_ms=150,
    limitations=["TCP bytes sent before COMMIT may arrive later",
     "wire HTTP 200 may truncate, client must strictly validate length and hash",
     "sendall with timeout may transfer uncounted partial bytes",
     "does not guarantee revocation across untested 300 concurrent slow sockets",
     "one runner only, SQL usage may be high, no real player or CDN"],
    elapsed_seconds=round(time.monotonic()-start,3))
  Path("qa-v2-block-fence-ledger.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_V2_BLOCK_FENCE_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  for c in workers:c.close()
if __name__=="__main__":main()
