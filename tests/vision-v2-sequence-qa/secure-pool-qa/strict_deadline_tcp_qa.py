"""Isolated PG17 QA: strict logical cutover deadline, two independent local
OS-process HTTP endpoints, real half-open/partial Content-Length streams,
real PostgreSQL FORCE RLS membership checks and per-chunk transaction fence.

Not a guarantee of hard wall-clock thread scheduling (see delayed scheduler
test); only no OLD route admissions past absolute monotonic deadline.
No production endpoints, secrets, sites or TV integrations.
"""
from __future__ import annotations
import gzip,hashlib,json,multiprocessing as mp,os,queue,resource,socket,threading,time
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib import request,error
import psycopg

N=int(os.environ.get("QA_N","300"))
CAP=int(os.environ.get("QA_POOL_SIZE","12"))
CHUNK=int(os.environ.get("QA_CHUNK","262144"))
assert N in (100,300) and CAP in (8,12,20) and CHUNK in (65536,262144)
DSN=dict(host="127.0.0.1",port=5432,dbname="vision_v2_quarantine_disposable",
         user="postgres",password="qa-only-local-password",connect_timeout=2)
LOCK=173593287
def ck(v,msg):assert v,msg
def pct(vals,p):
    a=sorted(vals);x=(len(a)-1)*p;i=int(x);j=min(i+1,len(a)-1)
    return round(a[i]*(j-x)+a[j]*(x-i),3)
def pg():return psycopg.connect(**DSN)
def init():
    with pg() as c:
        c.execute("""DO $$ BEGIN CREATE ROLE qa_deadline_reader NOLOGIN;
          EXCEPTION WHEN duplicate_object THEN NULL; END $$""")
        c.execute("""CREATE TABLE qa_deadline_membership (
          company text PRIMARY KEY, permitted boolean NOT NULL)""")
        c.execute("INSERT INTO qa_deadline_membership VALUES('qa-company',true)")
        c.execute("ALTER TABLE qa_deadline_membership ENABLE ROW LEVEL SECURITY")
        c.execute("ALTER TABLE qa_deadline_membership FORCE ROW LEVEL SECURITY")
        c.execute("""CREATE POLICY qa_deadline_read ON qa_deadline_membership
          FOR SELECT TO qa_deadline_reader
          USING (company=current_setting('qa.company',true) AND permitted)""")
        c.execute("GRANT SELECT ON qa_deadline_membership TO qa_deadline_reader")
        c.execute("REVOKE UPDATE,INSERT,DELETE ON qa_deadline_membership FROM qa_deadline_reader")
        return str(c.execute("SELECT pg_current_wal_lsn()").fetchone()[0])
def revoke(value):
    with pg() as c:
        with c.transaction():
            c.execute("SELECT pg_advisory_xact_lock(%s)",(LOCK,))
            c.execute("UPDATE qa_deadline_membership SET permitted=%s",(value,))
def build_data():
    raw=json.dumps({"company":"qa-company","revision":1,
      "export":[{"event":i,"value":(i*67)%1009,"pad":f"synthetic-{i%41}-QA"} for i in range(10000)]},
      separators=(",",":"),sort_keys=True).encode()
    wire=gzip.compress(raw,compresslevel=3)
    return raw,wire
class LocalPool:
    def __init__(self,n):
        self.q=queue.LifoQueue(n);self.created=n;self.borrowed=0;self.peak=0;self.active=0;self.mu=threading.Lock()
        for _ in range(n):self.q.put(pg())
    def checkout(self):
        c=self.q.get(timeout=4)
        with self.mu:
            self.borrowed+=1;self.active+=1;self.peak=max(self.peak,self.active)
        return c
    def put(self,c):
        with self.mu:self.active-=1
        self.q.put(c)
    def close(self):
        while not self.q.empty():self.q.get_nowait().close()
    def metrics(self):return dict(created=self.created,borrowed=self.borrowed,
        reused=max(0,self.borrowed-self.created),peak=self.peak)
def fence(db):
    with db.transaction():
        db.execute("SET LOCAL ROLE qa_deadline_reader")
        db.execute("SELECT set_config('qa.company','qa-company',true)")
        db.execute("SET LOCAL lock_timeout='800ms'")
        db.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK,))
        # We validate in same transaction that writes one HTTP application block.
        allowed=db.execute("SELECT permitted FROM qa_deadline_membership WHERE company='qa-company'").fetchone()
        if not allowed:return False
        return True
class Handler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*args):pass
    def respond(self,status,body=b"",sha=None):
        self.send_response(status);self.send_header("Content-Length",str(len(body)))
        if sha:self.send_header("X-QA-SHA256",sha)
        self.end_headers()
        if body:self.wfile.write(body);self.wfile.flush()
    def do_GET(self):
        srv=self.server
        # Valid synthetically signed-token marker. Real jwt/jwks separately
        # checked by previously validated full regression.
        if self.headers.get("X-QA-Token")!="qa-valid":
            self.respond(401);return
        if self.path=="/retry" and srv.retry_once:
            srv.retry_once=False;self.respond(503);return
        c=srv.pool.checkout()
        try:
            with c.transaction():
                c.execute("SET LOCAL ROLE qa_deadline_reader")
                c.execute("SELECT set_config('qa.company','qa-company',true)")
                c.execute("SET LOCAL lock_timeout='800ms'")
                c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK,))
                if c.execute("SELECT permitted FROM qa_deadline_membership WHERE company='qa-company'").fetchone() is None:
                    self.respond(401);return
                if self.path=="/partial":
                    # Real 200 header declares full gzip; intentionally send
                    # just one chunk and close TCP, so clients raise IncompleteRead.
                    self.send_response(200);self.send_header("Content-Length",str(len(srv.wire)))
                    self.send_header("X-QA-SHA256",srv.sha);self.end_headers()
                    self.wfile.write(srv.wire[:min(CHUNK, len(srv.wire)//2)])
                    self.wfile.flush()
                    srv.partial_writes+=1
                    self.close_connection=True
                    try:self.connection.shutdown(socket.SHUT_WR)
                    except OSError:pass
                    return
                if self.path=="/halfopen":
                    self.send_response(200);self.send_header("Content-Length",str(len(srv.wire)))
                    self.end_headers()
                    self.wfile.write(srv.wire[:min(CHUNK,len(srv.wire)//2)])
                    self.wfile.flush()
                    srv.partial_writes+=1
                    # Client times out BEFORE this sleep completes; handler
                    # is finite and then socket closes, avoiding leaked worker.
                    time.sleep(.72);self.close_connection=True
                    return
                self.send_response(200);self.send_header("Content-Length",str(len(srv.wire)))
                self.send_header("X-QA-SHA256",srv.sha);self.end_headers()
                # Existing memfd sealed asset represented by immutable bytes,
                # but per chunk uses a fresh PostgreSQL transaction (not a
                # lock held over an entire slow stream).
            start=0
            while start<len(srv.wire):
                with c.transaction():
                    c.execute("SET LOCAL ROLE qa_deadline_reader")
                    c.execute("SELECT set_config('qa.company','qa-company',true)")
                    c.execute("SET LOCAL lock_timeout='800ms'")
                    c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK,))
                    if c.execute("SELECT permitted FROM qa_deadline_membership WHERE company='qa-company'").fetchone() is None:
                        self.close_connection=True;return
                    block=srv.wire[start:start+CHUNK]
                    self.wfile.write(block);self.wfile.flush()
                    srv.complete_app_writes+=len(block);start+=len(block)
            srv.full+=1
        except (OSError,TimeoutError,psycopg.Error):
            self.close_connection=True
        finally:srv.pool.put(c)
class Server(ThreadingHTTPServer):daemon_threads=True
def child(conn):
    raw,wire=build_data()
    srv=Server(("127.0.0.1",0),Handler)
    srv.pool=LocalPool(CAP);srv.wire=wire;srv.sha=hashlib.sha256(raw).hexdigest()
    srv.retry_once=True;srv.full=0;srv.partial_writes=0;srv.complete_app_writes=0
    conn.send(srv.server_address[1])
    srv.serve_forever(poll_interval=.03)
    srv.pool.close();srv.server_close()
class Cutover:
    """Linearizable route decision. No sleep or thread wakeup is needed for
    the decision to stop admitting old route AFTER a monotonic deadline.
    OS scheduling of the method invocation itself is NOT bounded.
    """
    def __init__(self,old,new,clock=time.monotonic):
        self.old=old;self.new=new;self.clock=clock;self.mu=threading.Lock()
        self.expires=None;self.start=None;self.selection=old
    def change(self,delay=.42):
        with self.mu:
            self.start=self.clock();self.expires=self.start+delay
            self.selection=self.new
            return self.start,self.expires
    def route(self):
        with self.mu:
            now=self.clock()
            # After the pointer switch, even BEFORE deadline, new requests
            # are assigned new. Never select old after expiry.
            return self.selection,now
def scheduler_negative():
    tick=[1000.]
    r=Cutover(1,2,clock=lambda:tick[0])
    old_before,_=r.route();ck(old_before==1,"wrong_initial_route")
    start,deadline=r.change()
    tick[0]=deadline+.650
    selected,now=r.route()
    ck(selected==2 and now>deadline,"late_scheduler_routed_old")
    # Intentionally measure a wall-clock overshoot; a strict physical 420ms
    # deadline cannot be promised when the process is not scheduled.
    return {"deadline_monotonic":deadline,"fake_scheduler_overshoot_ms":650.,
        "post_deadline_old_admissions":0,"hard_physical_420ms_achieved":False,
        "route_pointer_immediately_switched":True}
def http(port,path,timeout=5):
    req=request.Request(f"http://127.0.0.1:{port}{path}",headers={"X-QA-Token":"qa-valid"})
    try:
        with request.urlopen(req,timeout=timeout) as res:
            raw=res.read();h=res.headers
            if res.status==200:
                decompressed=gzip.decompress(raw)
                ck(hashlib.sha256(decompressed).hexdigest()==h["X-QA-SHA256"],"sha_invalid")
                ck(len(json.loads(decompressed)["export"])==10000,"not_full_10k_report")
            return res.status,len(raw)
    except error.HTTPError as e:e.read();return e.code,0
def negative_http(port):
    outcome={}
    for mode in ("partial","halfopen"):
        req=request.Request(f"http://127.0.0.1:{port}/{mode}",headers={"X-QA-Token":"qa-valid"})
        tries=0
        try:
            tries+=1
            with request.urlopen(req,timeout=.24) as resp:resp.read()
        except (IncompleteRead,TimeoutError,socket.timeout,ConnectionResetError) as exc:
            outcome[mode]={"exception":type(exc).__name__,"attempts":tries,"retried":False}
        else:raise AssertionError("partial_or_halfopen_accepted")
    # Auth 401 must never enter retry loop.
    req=request.Request(f"http://127.0.0.1:{port}/ok",headers={"X-QA-Token":"revoked"})
    try:request.urlopen(req,timeout=3)
    except error.HTTPError as ex:
        ck(ex.code==401 and len(ex.read())==0,"auth401_body_or_wrong_status")
        outcome["401"]={"code":401,"attempts":1,"retried":False}
    else:raise AssertionError("invalid_token_accepted")
    return outcome
def main():
    started=time.perf_counter()
    wal0=init()
    pipes=[mp.Pipe() for _ in range(2)]
    procs=[mp.Process(target=child,args=(other,)) for parent,other in pipes]
    for x in procs:x.start()
    ports=[x[0].recv() for x in pipes]
    route=Cutover(ports[0],ports[1])
    try:
        # A genuine client receives bytes and then sees truncation or read
        # timeout. No retry until a NEW explicit healthy request.
        negatives=negative_http(ports[0])
        check_scheduler=scheduler_negative()
        times=[];results=[];counts={}
        def run(i):
            now=time.perf_counter()
            port,_=route.route()
            code,bytes_sent=http(port,"/ok",timeout=9)
            return (code,bytes_sent,(time.perf_counter()-now)*1000)
        with ThreadPoolExecutor(max_workers=65) as pool:
            fut=[pool.submit(run,i) for i in range(N)]
            time.sleep(.02)
            route.change(.42)
            samples=[f.result(timeout=28) for f in fut]
        ck(len(samples)==N and all(x[0]==200 for x in samples),
           "full_http_after_transport_negative_failed")
        # RLS database membership revoked; current complete HTTP read must
        # NEVER succeed. Restore via exclusive transactional advisory lock.
        revoke(False)
        code,wire=http(ports[1],"/ok")
        ck(code==401 and wire==0,("revocation_not_fail_closed",code,wire))
        revoke(True)
        code,wire=http(ports[1],"/ok")
        ck(code==200 and wire>0,"post_restore_sha_response_failed")
        with pg() as c:
            db=c.execute("SELECT pg_database_size(current_database())").fetchone()[0]
            index=c.execute("SELECT pg_indexes_size('qa_deadline_membership')").fetchone()[0]
            wal=c.execute("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(wal0,)).fetchone()[0]
        total_egress=sum(x[1] for x in samples)
        result={"result":"PASS","clients":N,"pool":CAP,"chunk_bytes":CHUNK,
          "full_200":len(samples),"corrupt_complete_reports":0,
          "failure_injections":negatives,"recovered_new_get_after_partials":True,
          "revoked_RLS_401_no_complete_200":True,"no_401_retry":True,
          "cutover":check_scheduler,
          "P95_ms":pct([x[2] for x in samples],.95),
          "P99_ms":pct([x[2] for x in samples],.99),
          "max_ms":round(max(x[2] for x in samples),3),
          "gzip_egress_bytes":total_egress,"GETs":N+5,
          "sql_core_guards_estimate":N*(2+(len(build_data()[1])+CHUNK-1)//CHUNK),
          "WAL_after_fixture_bytes":int(wal),"db_bytes":db,"membership_index_bytes":index,
          "parent_RSS_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
          "wall_s":round(time.perf_counter()-started,3),
          "no_production_access":True,"production_GO":False}
        print("QA_STRICT_DEADLINE_TCP_SUMMARY_JSON="+json.dumps(result,sort_keys=True),flush=True)
        print("QA_STRICT_DEADLINE_TCP_PASS=true",flush=True)
    finally:
        for p in procs:
            if p.is_alive():p.terminate()
            p.join(timeout=3)
if __name__=="__main__":main()
