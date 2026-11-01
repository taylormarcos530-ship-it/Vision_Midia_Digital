"""Disposable PG17 Vision V2 advanced admission and socket-boundary QA.

Two OS endpoint processes on ONE CI host, with a shared-memory admission
epoch and actual TCP sockets. Never treat local multiprocess tests as
independent physical hosts. Commit fence protects application writes only,
not previously buffered TCP bytes.
"""
from __future__ import annotations
import gzip,hashlib,http.client,importlib.util,json,multiprocessing as mp
import os,resource,socket,struct,threading,time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler
from urllib import request,error
from pathlib import Path
s=importlib.util.spec_from_file_location("v2_prior_strict",Path(__file__).parent/"strict_deadline_tcp_qa.py")
v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
N=v.N;CAP=v.CAP;CHUNK=v.CHUNK
def check(x,label):assert x,label
def make_report():
    # Stable incompressible-enough fixture >256 KiB with original 10000 rows,
    # rather than pretending the older 73 KiB gzip crosses 256 KiB boundary.
    doc={"company":"qa-company","revision":1,
         "export":[{"event":i,"digest":hashlib.sha256(("qa-row-"+str(i)).encode()).hexdigest(),
                    "marker":"synthetic" } for i in range(10000)]}
    raw=json.dumps(doc,sort_keys=True,separators=(",",":")).encode()
    wire=gzip.compress(raw,compresslevel=3)
    check(len(wire)>262144,("gzip_not_large_enough_to_test_second_chunk",len(wire)))
    return raw,wire
v.build_data=make_report
class EpochFence:
    """A route decision is linearized under ONE process-shared lock.
    Previously issued tickets are rejected after changing the epoch.
    This does not force in-flight sockets to close physically at 420ms.
    """
    def __init__(self,old,new):
        self.mu=mp.RLock()
        self.epoch=mp.Value("i",0)
        self.route=mp.Value("i",old)
        self.new=new;self.old=old
        self.deadline=mp.Value("d",0)
    def ticket(self):
        with self.mu:return self.epoch.value
    def cutover(self):
        with self.mu:
            start=time.monotonic()
            self.epoch.value+=1
            self.deadline.value=start+.42
            self.route.value=self.new
            return start,self.deadline.value
    def choose(self,ticket=None):
        with self.mu:
            now=time.monotonic()
            if ticket is not None and ticket!=self.epoch.value:
                return {"route":None,"stale":True,"now":now,"epoch":self.epoch.value}
            return {"route":self.route.value,"stale":False,"now":now,
                    "epoch":self.epoch.value}
def probe(fence,ticket,signal,q):
    signal.wait(8)
    q.put(fence.choose(ticket))
def negative_epoch(old,new):
    fence=EpochFence(old,new)
    stale=fence.ticket()
    q=mp.Queue();release=mp.Event()
    p=[mp.Process(target=probe,args=(fence,stale,release,q)) for _ in range(2)]
    for child in p:child.start()
    start,end=fence.cutover()
    # Real OS late wakeup >420ms. No stale route allowed at any time.
    time.sleep(.56)
    release.set()
    decisions=[q.get(timeout=5) for _ in p]
    for child in p:
        child.join(5)
        check(child.exitcode==0,("admission_probe_crashed",child.exitcode))
    overshoot_ms=(min(x["now"] for x in decisions)-end)*1000
    check(overshoot_ms>70,"no_real_scheduler_delay")
    check(all(x["route"] is None and x["stale"] for x in decisions),
          "pre_cutover_admission_ticket_accepted_after_deadline")
    fresh=fence.choose(fence.ticket())
    check(fresh["route"]==new and not fresh["stale"],"new_epoch_not_served")
    return {"old_ticket_denied_processes":2,
            "post_deadline_old_admissions":0,
            "late_wakeup_over_deadline_ms":round(overshoot_ms,3),
            "new_route_selected":True,
            "physical_stream_close_under_420ms_proven":False}
def authorized(db):
    with db.transaction():
        db.execute("SET LOCAL ROLE qa_deadline_reader")
        db.execute("SELECT set_config('qa.company','qa-company',true)")
        db.execute("SET LOCAL lock_timeout='800ms'")
        db.execute("SELECT pg_advisory_xact_lock_shared(%s)",(v.LOCK,))
        return db.execute("SELECT permitted FROM qa_deadline_membership WHERE company='qa-company'").fetchone() is not None
class Handler(v.Handler):
    def do_GET(self):
        srv=self.server
        if self.path not in ("/headers-only","/partial-fin","/partial-rst","/halfopen",
                             "/gated-revocation","/one503","/unauthorized"):
            return super().do_GET()
        with srv.counts_lock:
            srv.counts[self.path]=srv.counts.get(self.path,0)+1
        if self.path=="/unauthorized" or self.headers.get("X-QA-Token")!="qa-valid":
            self.respond(401);return
        if self.path=="/one503":
            with srv.counts_lock:count=srv.counts[self.path]
            if count==1:
                self.respond(503);return
            return super().do_GET()
        c=srv.pool.checkout()
        try:
            with c.transaction():
                c.execute("SET LOCAL ROLE qa_deadline_reader")
                c.execute("SELECT set_config('qa.company','qa-company',true)")
                c.execute("SET LOCAL lock_timeout='800ms'")
                c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(v.LOCK,))
                if c.execute("SELECT permitted FROM qa_deadline_membership WHERE company='qa-company'").fetchone() is None:
                    self.respond(401);return
                if self.path=="/headers-only":
                    self.header_full(srv);self.close_connection=True
                    try:self.connection.shutdown(socket.SHUT_WR)
                    except OSError:pass
                    return
                first=srv.wire[:CHUNK]
                check(len(first)==CHUNK,"partial_chunk_size_invalid")
                self.header_full(srv)
                self.wfile.write(first);self.wfile.flush()
                with srv.write_count.get_lock():
                    srv.write_count.value+=len(first)
                if self.path=="/partial-fin":
                    self.close_connection=True
                    try:self.connection.shutdown(socket.SHUT_WR)
                    except OSError:pass
                    return
                if self.path=="/partial-rst":
                    # Actual abortive close (SO_LINGER on, zero); no continuation.
                    self.close_connection=True
                    try:
                        self.connection.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack("ii",1,0))
                        self.connection.close()
                    except OSError:pass
                    return
                if self.path=="/halfopen":
                    time.sleep(.65)
                    self.close_connection=True
                    return
            if self.path=="/gated-revocation":
                srv.first_chunk.set()
                if not srv.allow_resume.wait(4):self.close_connection=True;return
                with c.transaction():
                    c.execute("SET LOCAL ROLE qa_deadline_reader")
                    c.execute("SELECT set_config('qa.company','qa-company',true)")
                    c.execute("SET LOCAL lock_timeout='800ms'")
                    c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(v.LOCK,))
                    if c.execute("SELECT permitted FROM qa_deadline_membership WHERE company='qa-company'").fetchone() is None:
                        self.close_connection=True
                        return
                    # Would write 2nd chunk only if SQL still authorizes it.
                    self.wfile.write(srv.wire[CHUNK:CHUNK*2]);self.wfile.flush()
                    with srv.write_count.get_lock():
                        srv.write_count.value+=len(srv.wire[CHUNK:CHUNK*2])
                self.close_connection=True
        except (OSError,TimeoutError):
            self.close_connection=True
        finally:
            srv.pool.put(c)
    def header_full(self,srv):
        self.send_response(200)
        self.send_header("Content-Length",str(len(srv.wire)))
        self.send_header("X-QA-SHA256",srv.sha)
        self.end_headers()
def endpoint(pipe,first,allow,count):
    raw,wire=make_report()
    srv=v.Server(("127.0.0.1",0),Handler)
    srv.pool=v.LocalPool(CAP)
    srv.wire=wire;srv.sha=hashlib.sha256(raw).hexdigest()
    srv.retry_once=False;srv.full=0;srv.partial_writes=0;srv.complete_app_writes=0
    srv.first_chunk=first;srv.allow_resume=allow;srv.write_count=count
    srv.counts={};srv.counts_lock=threading.RLock()
    pipe.send(srv.server_address[1])
    try:srv.serve_forever(poll_interval=.03)
    finally:srv.pool.close();srv.server_close()
def req(port,path,timeout=.17,token="qa-valid"):
    x=request.Request(f"http://127.0.0.1:{port}{path}",headers={"X-QA-Token":token})
    return request.urlopen(x,timeout=timeout)
def negative_transport(port):
    out={}
    for mode in ("/headers-only","/partial-fin","/partial-rst","/halfopen"):
        attempts=1
        try:
            with req(port,mode) as response:
                data=response.read()
                raise AssertionError(("truncated_200_accepted",mode,len(data)))
        except (http.client.IncompleteRead,TimeoutError,socket.timeout,
                ConnectionResetError,http.client.RemoteDisconnected,OSError) as e:
            out[mode]={"type":type(e).__name__,"attempts":attempts,"retried":False}
    try:
        with req(port,"/unauthorized") as response:raise AssertionError("unauthorized_success")
    except error.HTTPError as e:
        check(e.code==401 and not e.read(),"401_wrong_code_or_body")
        out["401"]={"attempts":1,"no_retry":True,"body_bytes":0}
    # Exactly one permissible retry on idempotent GET/503.
    attempts=0
    while True:
        attempts+=1
        try:
            with req(port,"/one503",timeout=5) as response:
                raw=gzip.decompress(response.read())
                check(hashlib.sha256(raw).hexdigest()==response.headers["X-QA-SHA256"],
                      "retry_sha_failed")
                break
        except error.HTTPError as e:
            check(e.code==503 and attempts==1,"non503_or_extra_retry")
            e.read()
            continue
    check(attempts==2,"503_retry_not_bounded")
    out["503"]={"attempts":attempts,"complete_SHA_200":True}
    return out
def revocation_midstream(port,first,allow,count):
    output={}
    def reader():
        try:
            with req(port,"/gated-revocation",timeout=5) as response:
                response.read()
                output["invalid_full_200"]=True
        except (http.client.IncompleteRead,TimeoutError,socket.timeout,
                ConnectionResetError,OSError) as e:
            output["error"]=type(e).__name__
    t=threading.Thread(target=reader)
    try:
        t.start();check(first.wait(6),"first_block_never_written")
        with count.get_lock():before=count.value
        started=time.monotonic()
        v.revoke(False)  # commits while response still has unsent blocks
        commit_ms=round((time.monotonic()-started)*1000,3)
        allow.set();t.join(7)
        check(not t.is_alive() and "error" in output and "invalid_full_200" not in output,
              ("revoked_stream_not_truncated",output))
        with count.get_lock():after=count.value
        check(after==before,("post_commit_application_write",before,after))
        # Revoke must return 401, never retry.
        try:req(port,"/ok",timeout=4)
        except error.HTTPError as e:
            check(e.code==401 and not e.read(),"revoke_not_http401")
        else:raise AssertionError("revoke_allowed_200")
        return {"commit_ms":commit_ms,"first_block_written_precommit":before,
                "new_application_written_bytes_after_commit":after-before,
                "postcommit_response":output["error"],
                "new_request_401_attempts":1}
    finally:
        allow.set();t.join(3);v.revoke(True)
def main():
    start=time.perf_counter()
    wal=v.init()
    left,send=mp.Pipe();right,send2=mp.Pipe()
    first=mp.Event();allow=mp.Event();count=mp.Value("q",0)
    ps=[mp.Process(target=endpoint,args=(send,first,allow,count)),
        mp.Process(target=endpoint,args=(send2,mp.Event(),mp.Event(),mp.Value("q",0)))]
    for p in ps:p.start()
    ports=[left.recv(),right.recv()]
    try:
        clock=negative_epoch(*ports)
        bad=negative_transport(ports[0])
        protected=revocation_midstream(ports[0],first,allow,count)
        route=EpochFence(*ports)
        times=[];total=0
        def full(i):
            started=time.perf_counter()
            ticket=route.ticket()
            choice=route.choose(ticket)
            if choice["stale"]:choice=route.choose(route.ticket())
            with req(choice["route"],"/ok",timeout=9) as response:
                blob=response.read()
                raw=gzip.decompress(blob)
                check(hashlib.sha256(raw).hexdigest()==response.headers["X-QA-SHA256"],"full_sha")
                check(len(json.loads(raw)["export"])==10000,"full_10k")
            return (len(blob),(time.perf_counter()-started)*1000)
        with ThreadPoolExecutor(max_workers=65) as pool:
            futures=[pool.submit(full,i) for i in range(N)]
            time.sleep(.015)
            route.cutover()
            got=[f.result(timeout=25) for f in futures]
        check(len(got)==N,"not_all_healthy_gets")
        with v.pg() as db:
            size=db.execute("SELECT pg_database_size(current_database())").fetchone()[0]
            idx=db.execute("SELECT pg_indexes_size('qa_deadline_membership')").fetchone()[0]
            delta=int(db.execute("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(wal,)).fetchone()[0])
        output={"status":"PASS","clients":N,"pool":CAP,"chunk_bytes":CHUNK,
            "complete_HTTP_200":N,"failures_without_retry":bad,
            "real_revocation_midstream":protected,"multiprocess_epoch":clock,
            "P95_ms":v.pct([x[1] for x in got],.95),
            "P99_ms":v.pct([x[1] for x in got],.99),
            "max_ms":round(max(x[1] for x in got),3),
            "gzip_egress_bytes":sum(x[0] for x in got),
            "HTTP_GET_attempts":N+7,"SQL_guard_calls_lower_bound":N+8,
            "WAL_after_fixture_bytes":delta,"database_bytes":size,
            "membership_index_bytes":idx,
            "parent_RSS_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "no_production":True,"PRODUCTION_GO":False,
            "elapsed_sec":round(time.perf_counter()-start,3)}
        print("QA_MULTIPROCESS_SOCKET_SUMMARY_JSON="+json.dumps(output,sort_keys=True),flush=True)
        print("QA_MULTIPROCESS_SOCKET_PASS=true",flush=True)
    finally:
        allow.set()
        for p in ps:
            if p.is_alive():p.terminate()
            p.join(3)
if __name__=="__main__":main()
