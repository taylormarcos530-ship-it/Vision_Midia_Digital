"""Disposable PostgreSQL17 QA: independently spawned proxy + origin process.
Never use official credentials, endpoints, accounts or production data.
"""
import contextlib,gzip,hashlib,http.client,json,os,queue,resource,socket,struct,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib import request,error
import psycopg

assert os.getenv("QA_STREAM_GUARD_GROUP","1")=="1"
assert os.getenv("GITHUB_REF")=="refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031"
for k in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE"):
    assert not os.getenv(k),("forbidden_env",k)
KW=dict(host="127.0.0.1",port=5432,dbname="vision_v2_quarantine_disposable",
        user="postgres",password="qa-only-local-password",connect_timeout=3)
LOCK_USER=63918941
LOCK_GATE=63918942
CHUNK=int(os.environ["QA_CHUNK"])
assert CHUNK in (65536,262144)
CAP=int(os.environ["QA_PROCESS_POOL"])
assert CAP in (4,6,10)
IDENT=os.environ["QA_WORKER_ID"]
assert IDENT in ("0","1")
# QA-only wall clock offsets in each INDEPENDENT child process.
# Never change the runner/system clock; PG transaction fences remain monotonic.
WALL_OFFSET=int(os.environ.get("QA_WORKER_WALL_SKEW_SEC","0"))
assert WALL_OFFSET in (-86400,86400)
_REAL_WALL=time.time
time.time=lambda: _REAL_WALL()+WALL_OFFSET
REPORT=[{"event":i,"sha":hashlib.sha256(("mproc-original-"+str(i)).encode()).hexdigest(),"original":True} for i in range(10000)]
RAW=json.dumps({"original_full_report":{"export":REPORT},"company":"synthetic",
                "version":1},sort_keys=True,separators=(",",":")).encode()
WIRE=gzip.compress(RAW,compresslevel=3)
SHA=hashlib.sha256(RAW).hexdigest()
assert len(WIRE)>262144

class Pool:
    def __init__(self,name,n):
        self.name=name;self.n=n;self.q=queue.LifoQueue(n);self.mu=threading.Lock()
        self.active=0;self.peak=0;self.borrows=0
        for _ in range(n):self.q.put(psycopg.connect(**KW))
    @contextlib.contextmanager
    def borrow(self):
        conn=self.q.get(timeout=12)
        with self.mu:
            self.active+=1;self.borrows+=1;self.peak=max(self.peak,self.active)
        try:yield conn
        finally:
            with self.mu:self.active-=1
            self.q.put(conn)
    def stats(self):
        with self.mu:
            return {"name":self.name,"capacity":self.n,"active":self.active,
                    "peak":self.peak,"borrows":self.borrows,
                    "pids":sorted(c.info.backend_pid for c in list(self.q.queue))}
    def close(self):
        while not self.q.empty():self.q.get_nowait().close()

class State:
    def __init__(self):
        self.mu=threading.Lock();self.metrics={}
        self.hold_first=threading.Event();self.hold_release=threading.Event()
        self.route_port=None
        self.proxy_pool=Pool(IDENT+"-proxy",max(1,CAP//2))
        self.origin_pool=Pool(IDENT+"-origin",CAP-max(1,CAP//2))
        self.origin=None;self.proxy=None
    def add(self,k,n=1):
        with self.mu:self.metrics[k]=self.metrics.get(k,0)+n
    def snapshot(self):
        with self.mu:data=dict(self.metrics)
        return {"worker":IDENT,"metrics":data,"proxy_pool":self.proxy_pool.stats(),
                "origin_pool":self.origin_pool.stats(),"route_port":self.route_port,
                "rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                "process_wall_skew_seconds":WALL_OFFSET,
                "simulated_wall_epoch":round(time.time(),3)}
STATE=State()
def can(pool,gate=False):
    with pool.borrow() as c:
        with c.transaction():
            c.execute("SET LOCAL ROLE qa_mproc_reader")
            c.execute("SELECT set_config('qa.tenant','synthetic',true)")
            c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK_GATE if gate else LOCK_USER,))
            if gate:
                row=c.execute("SELECT enabled,epoch FROM qa_mproc_gate WHERE id=1").fetchone()
                STATE.add("gate_sql")
                return bool(row and row[0])
            row=c.execute("SELECT allowed FROM qa_mproc_membership WHERE tenant='synthetic'").fetchone()
            STATE.add("membership_sql")
            return bool(row)

class Quiet(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*args):pass
    def answer(self,status,cause,payload=b"",complete=False,partial=0):
        try:
            self.send_response(status)
            self.send_header("Content-Length",str(len(payload)))
            self.send_header("X-QA-Cause",cause)
            self.send_header("X-QA-Upstream-Discarded",str(partial))
            if complete:
                self.send_header("Content-Encoding","gzip")
                self.send_header("X-QA-SHA256",SHA)
            self.end_headers()
            if payload:self.wfile.write(payload);self.wfile.flush()
        except (OSError,ConnectionError):
            STATE.add("disconnected_clients")

class Origin(Quiet):
    def do_GET(self):
        STATE.add("origin_gets")
        if self.headers.get("X-QA-Token")!="valid-test-token":
            self.answer(401,"invalid_token");return
        if not can(STATE.origin_pool):
            self.answer(401,"revoked");return
        if self.path=="/rst":
            STATE.add("reset")
            self.close_connection=True
            self.connection.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack("ii",1,0))
            self.connection.close();return
        if self.path=="/halfopen":
            self.send_response(200);self.send_header("Content-Length",str(len(WIRE)))
            self.send_header("Content-Encoding","gzip");self.send_header("X-QA-SHA256",SHA)
            self.end_headers()
            self.wfile.write(WIRE[:7000]);self.wfile.flush()
            STATE.add("written",7000)
            time.sleep(.55)
            self.close_connection=True
            return
        if self.path=="/fin":
            self.send_response(200);self.send_header("Content-Length",str(len(WIRE)))
            self.send_header("Content-Encoding","gzip");self.send_header("X-QA-SHA256",SHA)
            self.end_headers();self.wfile.write(WIRE[:7000]);self.wfile.flush()
            STATE.add("written",7000);self.close_connection=True;return
        self.send_response(200);self.send_header("Content-Length",str(len(WIRE)))
        self.send_header("Content-Encoding","gzip");self.send_header("X-QA-SHA256",SHA)
        self.end_headers()
        for i in range(0,len(WIRE),CHUNK):
            with STATE.origin_pool.borrow() as c:
                with c.transaction():
                    c.execute("SET LOCAL ROLE qa_mproc_reader")
                    c.execute("SELECT set_config('qa.tenant','synthetic',true)")
                    c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK_USER,))
                    allowed=c.execute("SELECT allowed FROM qa_mproc_membership WHERE tenant='synthetic'").fetchone()
                    STATE.add("membership_sql")
                    if not allowed:
                        STATE.add("stream_revoked")
                        self.close_connection=True
                        return
                    part=WIRE[i:i+CHUNK]
                    try:
                        self.wfile.write(part);self.wfile.flush()
                        STATE.add("written",len(part))
                    except (BrokenPipeError,ConnectionResetError,OSError):
                        STATE.add("send_failed");return
            if i==0 and self.path=="/hold":
                STATE.hold_first.set()
                if not STATE.hold_release.wait(timeout=10):
                    STATE.add("hold_timeout");return

class Proxy(Quiet):
    def do_GET(self):
        STATE.add("proxy_gets")
        if not can(STATE.proxy_pool,gate=True):
            self.answer(503,"gate_closed");return
        with STATE.mu:port=STATE.route_port
        if not port:
            self.answer(503,"route_missing");return
        req=request.Request("http://127.0.0.1:"+str(port)+self.path,
                            headers={"X-QA-Token":self.headers.get("X-QA-Token","")})
        count=0;parts=[]
        try:
            with request.urlopen(req,timeout=.13 if self.path=="/halfopen" else 12) as resp:
                size=int(resp.headers.get("Content-Length","0"))
                while count<size:
                    block=resp.read1(min(65536,size-count))
                    if not block:raise http.client.IncompleteRead(b"",size-count)
                    count+=len(block);parts.append(block)
                contents=b"".join(parts)
                if hashlib.sha256(gzip.decompress(contents)).hexdigest()!=SHA:
                    raise ValueError("upstream_sha_mismatch")
                STATE.add("proxy_completed_bytes",len(contents))
                self.answer(200,"ok",contents,complete=True)
        except error.HTTPError as ex:
            if ex.code==401:self.answer(401,"revoked_or_invalid")
            else:self.answer(503,"upstream_http_error")
        except (TimeoutError,socket.timeout):
            STATE.add("upstream_discarded",count)
            self.answer(503,"timeout",partial=count)
        except http.client.IncompleteRead as ex:
            STATE.add("upstream_discarded",count+len(ex.partial))
            self.answer(503,"incomplete",partial=count+len(ex.partial))
        except (ConnectionResetError,http.client.RemoteDisconnected,OSError) as ex:
            STATE.add("upstream_discarded",count)
            self.answer(503,"reset",partial=count)

def serve(cls):
    s=ThreadingHTTPServer(("127.0.0.1",0),cls);s.daemon_threads=True
    thread=threading.Thread(target=s.serve_forever,daemon=True)
    thread.start()
    return s,thread

def main():
    STATE.origin,origin_thread=serve(Origin)
    STATE.proxy,proxy_thread=serve(Proxy)
    STATE.route_port=STATE.origin.server_address[1]
    print(json.dumps({"type":"READY","pid":os.getpid(),"worker":IDENT,
      "proxy":STATE.proxy.server_address[1],"origin":STATE.origin.server_address[1],
      "report_gzip_bytes":len(WIRE),"report_sha":SHA,
      "wall_skew_seconds":WALL_OFFSET}),flush=True)
    try:
        for line in sys.stdin:
            cmd=json.loads(line);kind=cmd["cmd"]
            if kind=="switch":
                with STATE.mu:STATE.route_port=int(cmd["port"])
                result={"type":"ACK","cmd":kind,"worker":IDENT,"port":STATE.route_port}
            elif kind=="release":
                STATE.hold_release.set();result={"type":"ACK","cmd":kind,"worker":IDENT}
            elif kind=="stats":
                result={"type":"STATS",**STATE.snapshot()}
            elif kind=="deadline":
                started=time.monotonic()
                deadline=started+.025
                time.sleep(.055)
                now=time.monotonic()
                result={"type":"ACK","cmd":kind,"worker":IDENT,
                        "expired":now>deadline,
                        "overdue_ms":round((now-deadline)*1000,3),
                        "wall_skew_seconds":WALL_OFFSET}
            elif kind=="stop":
                result={"type":"ACK","cmd":kind}
                print(json.dumps(result),flush=True);break
            else:raise ValueError(("unknown_command",kind))
            print(json.dumps(result),flush=True)
    finally:
        STATE.hold_release.set()
        for server,t in ((STATE.origin,origin_thread),(STATE.proxy,proxy_thread)):
            server.shutdown();server.server_close();t.join(timeout=3)
        STATE.proxy_pool.close();STATE.origin_pool.close()
if __name__=="__main__":main()
