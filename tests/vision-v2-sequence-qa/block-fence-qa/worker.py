"""Isolated, NOT production: PostgreSQL17 per-block TCP fence candidate.
No global streaming advisory lock. A writer obtains exclusive guard between
blocks; the holder uses a bounded socket timeout for each fragment.
A 200 already sent on the wire MAY TRUNCATE; client SHA/length is mandatory.
"""
import contextlib,gzip,hashlib,http.client,json,os,queue,socket,struct,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import psycopg

BRANCH="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.environ.get("GITHUB_REF")==BRANCH and os.environ.get("QA_STREAM_GUARD_GROUP")=="1"
for name in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
    assert not os.getenv(name),("forbidden QA env",name)
CHUNK=int(os.environ["QA_CHUNK"])
assert CHUNK in (65536,262144)
IDENT=os.environ["QA_WORKER_ID"]
assert IDENT in ("0","1")
KW=dict(host="127.0.0.1",port=5432,dbname="vision_v2_quarantine_disposable",
        user="postgres",password="qa-only-local-password",connect_timeout=3)
LOCK=63918942
REPORT=[{"event":i,"sha":hashlib.sha256(("mproc-original-"+str(i)).encode()).hexdigest(),
         "original":True} for i in range(10000)]
RAW=json.dumps({"original_full_report":{"export":REPORT},"company":"synthetic","version":1},
               sort_keys=True,separators=(",",":")).encode()
WIRE=gzip.compress(RAW,compresslevel=3)
SHA=hashlib.sha256(RAW).hexdigest()
assert len(WIRE)>262144

class Pool:
 def __init__(self,n=5):
  self.q=queue.LifoQueue(n)
  for _ in range(n):self.q.put(psycopg.connect(**KW))
 @contextlib.contextmanager
 def borrow(self):
  c=self.q.get(timeout=8)
  try:yield c
  finally:self.q.put(c)
 def close(self):
  while not self.q.empty():self.q.get_nowait().close()
class State:
 def __init__(self):
  self.mu=threading.Lock();self.counts={};self.pause=threading.Event()
  self.kill_hold=threading.Event();self.pool=Pool()
 def add(self,key,num=1):
  with self.mu:self.counts[key]=self.counts.get(key,0)+num
 def snapshot(self):
  with self.mu:return dict(self.counts)
S=State()
def gate_allowed(c):
 c.execute("SET LOCAL ROLE qa_mproc_reader")
 c.execute("SELECT set_config('qa.tenant','synthetic',true)")
 c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK,))
 row=c.execute("SELECT enabled FROM qa_mproc_gate WHERE id=1").fetchone()
 c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(63918941,))
 member=c.execute("SELECT allowed FROM qa_mproc_membership WHERE tenant='synthetic'").fetchone()
 S.add("gate_reads")
 return bool(row and row[0] and member and member[0])
class Handler(BaseHTTPRequestHandler):
 protocol_version="HTTP/1.1"
 def log_message(self,*args):pass
 def respond(self,status,cause):
  self.send_response(status);self.send_header("Content-Length","0")
  self.send_header("X-QA-Cause",cause);self.end_headers()
 def close_now(self):
  self.close_connection=True
  try:self.connection.shutdown(socket.SHUT_RDWR)
  except OSError:pass
  try:self.connection.close()
  except OSError:pass
 def do_GET(self):
  S.add("requests")
  if self.headers.get("X-QA-Token")!="valid-test-token":
   self.respond(401,"invalid_token");return
  if self.path=="/rst":
   S.add("rst_injected")
   try:self.connection.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack("ii",1,0))
   except OSError:pass
   self.close_now();return
  if self.path in ("/fin","/halfopen"):
   self.send_response(200);self.send_header("Content-Length",str(len(WIRE)))
   self.send_header("Content-Encoding","gzip");self.send_header("X-QA-SHA256",SHA)
   self.end_headers()
   try:
    self.wfile.write(WIRE[:7000]);self.wfile.flush()
    S.add("fault_written",7000)
    if self.path=="/halfopen":time.sleep(.55)
   except OSError:pass
   self.close_now();return
  slow=self.path=="/slow"
  if slow:
   self.connection.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,4096)
   self.connection.settimeout(.075)
  if self.path not in ("/normal","/pause","/kill_lock","/slow"):
   self.respond(404,"unknown");return
  # Headers themselves are authorized inside a brief PG transaction.
  # A later close can produce truncated HTTP 200, never a valid SHA-complete report.
  with S.pool.borrow() as c:
   with c.transaction():
    if not gate_allowed(c):
     self.respond(503,"gate_closed");return
    self.send_response(200);self.send_header("Content-Length",str(len(WIRE)))
    self.send_header("Content-Encoding","gzip")
    self.send_header("X-QA-SHA256",SHA);self.end_headers()
  for i in range(0,len(WIRE),CHUNK):
   try:
    with S.pool.borrow() as c:
     with c.transaction():
      # lock_timeout is a hard cap on contention; socket timeout caps
      # sendall in Python, NOT physical network delivery to client.
      c.execute("SELECT set_config('lock_timeout','150ms',true)")
      if not gate_allowed(c):
       S.add("denied_after_header")
       self.close_now();return
      if i==0 and self.path=="/kill_lock":
       S.add("holding_guard")
       S.kill_hold.wait(12)
      if i==0 and slow:
       S.add("slow_guard_enter")
       time.sleep(.22) # deterministic scheduler stall under real TCP test
      part=WIRE[i:i+CHUNK]
      try:
       self.wfile.write(part);self.wfile.flush()
       S.add("application_write_completed_bytes",len(part))
      except (socket.timeout,TimeoutError,BrokenPipeError,ConnectionError,OSError):
       S.add("send_timeout_or_closed")
       self.close_now();return
   except (psycopg.errors.LockNotAvailable,psycopg.OperationalError):
    S.add("block_guard_timeout")
    self.close_now();return
   if i==0 and self.path=="/pause":
    S.add("paused_after_first")
    if not S.pause.wait(timeout=9):self.close_now();return
  S.add("fully_written")
def main():
 srv=ThreadingHTTPServer(("127.0.0.1",0),Handler);srv.daemon_threads=True
 t=threading.Thread(target=srv.serve_forever,daemon=True);t.start()
 print(json.dumps(dict(type="READY",pid=os.getpid(),worker=IDENT,
     port=srv.server_address[1],sha=SHA,gzip_bytes=len(WIRE))),flush=True)
 try:
  for line in sys.stdin:
   msg=json.loads(line);cmd=msg["cmd"]
   if cmd=="stats":res=dict(type="STATS",metrics=S.snapshot())
   elif cmd=="resume":S.pause.set();res=dict(type="ACK")
   elif cmd=="reset_pause":S.pause.clear();res=dict(type="ACK")
   elif cmd=="stop":print(json.dumps(dict(type="ACK")),flush=True);break
   else:res=dict(type="ERROR",cmd=cmd)
   print(json.dumps(res),flush=True)
 finally:
  S.pause.set();S.kill_hold.set()
  srv.shutdown();srv.server_close();t.join(timeout=3);S.pool.close()
if __name__=="__main__":main()
