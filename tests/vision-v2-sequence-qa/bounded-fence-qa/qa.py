"""Vision V2 PG17 disposable proof: bounded per-chunk DB transaction shared
advisory lock protects auth/check and application socket.write against a
cooperating exclusive-lock membership revocation writer. Revocation has bounded
*tested* delay; no claim that TCP delivery after kernel buffering is atomic.
The QA intentionally rejects a stalled stream instead of indefinitely blocking
a revocation commit. Two separate OS-process HTTP replicas; 100/300 full gzip.
"""
from __future__ import annotations
import gzip,hashlib,importlib.util,json,multiprocessing as mp,os,resource,socket,threading,time
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib import request,error
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("qa_old_rollback",ROOT/"rolling-cutover-outbox-qa"/"qa.py")
rollback=importlib.util.module_from_spec(spec);spec.loader.exec_module(rollback)
v,deep,a,q,p=rollback.v,rollback.deep,rollback.a,rollback.q,rollback.p
FENCE_BASE=621780111
CHUNK=65536
MAX_PAUSE_SECONDS=.30
def lock_id(i):return FENCE_BASE+i
def ck(x,m):assert x,m
def geturl(info,tenant,token,paused=False):
    return request.Request("http://127.0.0.1:"+str(info["port"])+"/"+str(tenant)+
       ("?pause=1" if paused else ""),headers={"X-QA-JWT":token,"Accept-Encoding":"gzip"})
class Service(ThreadingHTTPServer):
    daemon_threads=True;request_queue_size=512
    def __init__(self,keys):
        super().__init__(("127.0.0.1",0),Handler)
        self.keys=keys;self.mu=threading.RLock();self.admit=threading.BoundedSemaphore(20)
        self.cache={};self.ready=False
        self.entered=threading.Event();self.release=threading.Event()
        self.after_first=threading.Event();self.proceed=threading.Event()
        self.pause_mode="normal";self.max_active=0;self.active=0
        self.checks=0;self.lock_calls=0;self.sent=0;self.bytes_written=0
        self.denied=0;self.failed=0;self.prewarm_sec=0;self.builds=0
        self.last_write_time=0;self.first_write_time=0
    def prewarm(self):
        start=time.perf_counter()
        for company in v.COMPANIES:
            blob=deep.report_full(company)["payload"]
            doc=json.loads(blob)
            ck(len(doc["export"])==10000,"incomplete_original_sql_export")
            self.cache[str(company)]={"raw":blob,"gzip":gzip.compress(blob,compresslevel=3,mtime=0),
                   "hash":hashlib.sha256(blob).hexdigest()}
            self.builds+=1
        self.ready=True;self.prewarm_sec=time.perf_counter()-start
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        s=self.server
        if not s.ready:
            self.send_error(503,"cache_not_ready");return
        if not s.admit.acquire(timeout=30):
            self.send_error(503,"queue_timeout");return
        with s.mu:s.active+=1;s.max_active=max(s.active,s.max_active)
        headers=False
        try:
            tenant=int(self.path.split("?")[0].strip("/"))
            company=v.COMPANIES[tenant]
            token=self.headers.get("X-QA-JWT","")
            claims=s.keys.verify(token)
            if claims["company_id"]!=str(company):raise PermissionError("tenant")
            # First authorization must succeed before sending HTTP status 200.
            with v.con() as c:
                with c.transaction():
                    c.execute("SET LOCAL lock_timeout='1500ms'")
                    c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(lock_id(tenant),))
                    v.auth(c,claims)
                    if not c.execute("SELECT private.is_company_member(%s)",(company,)).fetchone()[0]:
                        raise PermissionError("revoked")
                    with s.mu:s.checks+=1;s.lock_calls+=1
            entry=s.cache[str(company)]
            body=entry["gzip"]
            self.send_response(200);headers=True
            self.send_header("Content-Encoding","gzip")
            self.send_header("Content-Length",str(len(body)))
            self.send_header("X-QA-Original-SHA256",entry["hash"])
            self.send_header("X-QA-Events","10000")
            self.end_headers()
            # The socket timeout covers actual socket writes; the QA event wait
            # has its own shorter cap. A real production shutdown/cancel policy
            # is still needed and this is not a hard worst-case proof.
            self.connection.settimeout(.6)
            for offset in range(0,len(body),CHUNK):
                with v.con() as c:
                    with c.transaction():
                        c.execute("SET LOCAL lock_timeout='1500ms'")
                        c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(lock_id(tenant),))
                        v.auth(c,claims)
                        if not c.execute("SELECT private.is_company_member(%s)",(company,)).fetchone()[0]:
                            raise PermissionError("revoked_during_stream")
                        with s.mu:s.checks+=1;s.lock_calls+=1
                        if offset==0 and "pause=1" in self.path:
                            s.entered.set()
                            if not s.release.wait(MAX_PAUSE_SECONDS):
                                raise PermissionError("bounded_stall_abort")
                        piece=body[offset:offset+CHUNK]
                        self.wfile.write(piece);self.wfile.flush()
                        with s.mu:
                            s.bytes_written+=len(piece)
                            s.last_write_time=time.monotonic()
                            if offset==0:s.first_write_time=s.last_write_time
                if offset==0 and "pause=1" in self.path:
                    s.after_first.set()
                    # Outside any lock. Revocation writer can obtain exclusive
                    # lock and commit before next block's auth check.
                    ck(s.proceed.wait(8),"post_first_gate_timeout")
            with s.mu:s.sent+=1
        except (PermissionError,ValueError,IndexError):
            with s.mu:s.denied+=1
            if not headers:
                self.send_response(401);self.send_header("Content-Length","0");self.end_headers()
            else:
                with s.mu:s.failed+=1
                self.close_connection=True
                try:self.connection.shutdown(socket.SHUT_WR)
                except OSError:pass
        except (BrokenPipeError,ConnectionResetError,TimeoutError):
            with s.mu:s.failed+=1
        except Exception:
            with s.mu:s.failed+=1
            if headers:
                self.close_connection=True
                try:self.connection.shutdown(socket.SHUT_WR)
                except OSError:pass
            else:self.send_error(503)
        finally:
            with s.mu:s.active-=1
            s.admit.release()
def service_process(keys,pipe):
    s=Service(keys)
    t=threading.Thread(target=s.serve_forever,daemon=True);t.start()
    pipe.send({"port":s.server_address[1],"pid":os.getpid()})
    try:
        while True:
            op=pipe.recv()
            if op=="prewarm":
                s.prewarm();pipe.send({"time":round(s.prewarm_sec,3),"builds":s.builds})
            elif op=="pause":
                s.pause_mode="pause";s.entered.clear();s.release.clear()
                s.after_first.clear();s.proceed.clear();pipe.send(True)
            elif op=="release":s.release.set();pipe.send(True)
            elif op=="next":s.proceed.set();pipe.send(True)
            elif op=="entered":pipe.send(s.entered.is_set())
            elif op=="first_written":pipe.send(s.after_first.is_set())
            elif op=="stats":
                with s.mu:
                    pipe.send({"pid":os.getpid(),"prewarm_s":round(s.prewarm_sec,3),
                        "builds":s.builds,"checks":s.checks,"lock_calls":s.lock_calls,
                        "sent":s.sent,"denied":s.denied,"failed":s.failed,
                        "bytes_written":s.bytes_written,
                        "last_write_time":s.last_write_time,
                        "first_write_time":s.first_write_time,
                        "active_max":s.max_active,
                        "cache_bytes":sum(len(o["raw"])+len(o["gzip"]) for o in s.cache.values()),
                        "rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
            elif op=="stop":pipe.send(True);break
            else:raise RuntimeError("unsupported:"+str(op))
    finally:
        s.shutdown();s.server_close();t.join(3)
def spawn(keys):
    x,y=mp.Pipe();p=mp.Process(target=service_process,args=(keys,y));p.start()
    return (p,x,x.recv())
def cmd(peer,action):
    ck(peer[0].is_alive(),"dead_worker")
    peer[1].send(action);return peer[1].recv()
def stop(peer):
    if peer[0].is_alive():cmd(peer,"stop")
    peer[0].join(6)
    if peer[0].is_alive():peer[0].terminate();peer[0].join(3)
    ck(peer[0].exitcode==0,"abnormal_exit")
def until(f,secs=7):
    end=time.monotonic()+secs
    while time.monotonic()<end:
        if f():return
        time.sleep(.012)
    raise AssertionError("timeout")
def change_member(company,member,allowed,attempted,finished):
    with v.con() as c:
        with c.transaction():
            c.execute("SET LOCAL lock_timeout='1800ms'")
            attempted.set()
            c.execute("SELECT pg_advisory_xact_lock(%s)",(lock_id(0),))
            if allowed:
                c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(company,member))
            else:
                c.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",(company,member))
    finished["committed_at"]=time.monotonic()
def race_safe(peer,keys):
    co,user=v.COMPANIES[0],v.USER_IDS[0]
    token=keys.issue(co,user,"a")
    cmd(peer,"pause")
    resp=request.urlopen(geturl(peer[2],0,token,True),timeout=30)
    attempted=threading.Event();finished={}
    writer=threading.Thread(target=change_member,args=(co,user,False,attempted,finished))
    try:
        until(lambda:cmd(peer,"entered"),8)
        writer.start();ck(attempted.wait(3),"writer_never_started")
        # Commit must be blocked by the reader holding a shared PG lock.
        time.sleep(.08)
        ck("committed_at" not in finished,"writer_bypassed_shared_lock")
        cmd(peer,"release")
        first=resp.read(65536)
        ck(len(first)==65536,"first_chunk_not_transmitted")
        until(lambda:cmd(peer,"first_written"),5)
        writer.join(4);ck(not writer.is_alive(),"revocation_stalled")
        write_time=cmd(peer,"stats")["first_write_time"]
        ck(finished["committed_at"]>=write_time,
           "revocation_committed_before_server_called_write")
        cmd(peer,"next")
        try:
            rest=resp.read()
            raise AssertionError(("post_commit_server_written_more",len(rest)))
        except IncompleteRead as e:
            ck(len(e.partial)==0,("post_revocation_app_bytes",len(e.partial)))
    finally:
        resp.close()
        if writer.is_alive():cmd(peer,"release");cmd(peer,"next");writer.join(4)
    # Writer can restore membership under same exclusive advisory lock.
    done={}
    change_member(co,user,True,threading.Event(),done)
    with request.urlopen(geturl(peer[2],0,token),timeout=25) as healthy:
        ck(len(gzip.decompress(healthy.read()))>2_000_000,"restore_failed")
    return {"result":"PASS",
            "PG_writer_exclusive_lock_prevents_commit_during_protected_write":True,
            "writer_commit_after_first_server_write":True,
            "writer_finished_in_bounded_test":True,
            "server_bytes_written_after_writer_commit":0,
            "already_kernel_buffered_bytes_not_retractable":True,
            "absolute_network_delivery_zero_window_not_proven":True}
def bounded_stall(peer,keys):
    co,user=v.COMPANIES[0],v.USER_IDS[0]
    token=keys.issue(co,user,"a")
    cmd(peer,"pause")
    resp=request.urlopen(geturl(peer[2],0,token,True),timeout=25)
    attempted=threading.Event();done={}
    writer=threading.Thread(target=change_member,args=(co,user,False,attempted,done))
    try:
        until(lambda:cmd(peer,"entered"),6)
        writer.start();ck(attempted.wait(4),"writer_no_attempt")
        start=time.monotonic()
        # Deliberately never release the stream pause; reader aborts at 300ms.
        writer.join(2)
        delay=time.monotonic()-start
        ck(not writer.is_alive(),"unbounded_writer_delay")
        ck(delay<1.5,("revocation_delay_over_test_budget",delay))
        try:
            extra=resp.read()
            raise AssertionError(("aborted_stall_stream_delivered",len(extra)))
        except IncompleteRead as ex:ck(len(ex.partial)==0,"bytes_after_stall_timeout")
    finally:resp.close()
    change_member(co,user,True,threading.Event(),{})
    return {"result":"PASS","revocation_commit_delay_s":round(delay,4),
            "injected_stream_stall_auto_aborted_after_s":MAX_PAUSE_SECONDS,
            "indefinite_revocation_blocking_seen":False,
            "limit_only_tested_for_injected_event_wait_and_local_socket":True}
def main():
    start=time.perf_counter()
    q.init_db();p.expanded_history();a.setup_outbox()
    deep.rls_audit()
    with v.con() as c:wal0=c.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
    keys=a.Keys()
    p1=spawn(keys);p2=spawn(keys);procs=[p1,p2]
    router=None;thread=None
    try:
        prepared=[cmd(x,"prewarm") for x in procs]
        ck(all(x["builds"]==2 for x in prepared),"extra_report_SQL")
        router=rollback.old.Router(p1[2]["port"])
        thread=threading.Thread(target=router.serve_forever,daemon=True);thread.start()
        h100=rollback.old.wave(router,keys,100)
        ck(h100["full_json_200"]==100,"100_clients_failed")
        c300=rollback.exact_crossing(router,keys,p1,p2)
        race=race_safe(p2,keys)
        stall=bounded_stall(p2,keys)
        stats=[cmd(x,"stats") for x in procs]
        ck(all(s["active_max"]<=20 for s in stats),"unbounded_http_admission")
        with v.con() as c:
            result={"result":"PASS","100_clients":h100,"300_cutover_rollback":c300,
                "race":race,"stall":stall,"workers":stats,"prewarm":prepared,
                "auth_sql_per_block":True,"sql_statements_approx_check_plus_lock":sum(x["checks"]+x["lock_calls"] for x in stats),
                "pg_database_bytes":int(c.execute("SELECT pg_database_size(current_database())").fetchone()[0]),
                "index_bytes":int(c.execute("SELECT pg_indexes_size('public.playback_logs')").fetchone()[0]),
                "wal_after_fixture_bytes":int(c.execute("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(wal0,)).fetchone()[0]),
                "object_manifest_gets_in_this_job":0,
                "parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                "elapsed_s":round(time.perf_counter()-start,3),
                "synthetic_only":True,"two_physical_hosts":False,
                "production_GO":False}
        print("QA_BOUNDED_FENCE_SUMMARY_JSON="+json.dumps(result,sort_keys=True),flush=True)
        print("QA_BOUNDED_FENCE_PASS=true",flush=True)
    finally:
        if router:
            router.shutdown();router.server_close()
            if thread:thread.join(3)
        for peer in procs:
            if peer[0].is_alive():stop(peer)
if __name__=="__main__":main()
