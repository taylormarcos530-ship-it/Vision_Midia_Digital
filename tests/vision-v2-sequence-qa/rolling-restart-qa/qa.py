"""Disposable Vision V2 PG17: true rolling restart (old serves as new warms),
gzip full original 10K-event per-tenant JSON, SQL auth tradeoff, revocation stream.
Production NO-GO: event propagation window and external host topology unproven.
"""
from __future__ import annotations
import gzip,hashlib,importlib.util,json,multiprocessing as mp,os,resource,socket
import threading,time,uuid,math
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib import request,error
from http.client import IncompleteRead
from pathlib import Path

BASE=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("vision_v2_prewarm_qa",BASE/"prewarm-stream-qa"/"qa.py")
pre=importlib.util.module_from_spec(spec);spec.loader.exec_module(pre)
v,deep,a,p,q,m=pre.v,pre.deep,pre.a,pre.p,pre.q,pre.m
CHANNEL="qa_v2_rolling_membership"
RECONCILE_S=2.0  # accelerated disposable QA ONLY; not a production cadence
LEASE_S=6.0
def chk(ok,msg):assert ok,msg
def js(x):return m.dump(x).decode()
def percentile(data,f):
    data=sorted(data);v=(len(data)-1)*f;i=int(v);j=min(i+1,len(data)-1)
    return round(data[i]*(j-v)+data[j]*(v-i),3)

class RollingHandler(pre.Handler):
    def check_auth(self,company,token):
        # One real synthetic PG membership/RLS query per request, NOT per chunk.
        # A LISTEN-backed in-process revocation watermark is checked before
        # every chunk. PG periodic reconciliation + bounded lease fails closed
        # after missed notifications. A nonzero propagation window remains.
        claims=self.server.keys.verify(token)
        chk(claims["company_id"]==str(company),"tenant_claim_mismatch")
        if not getattr(self,"_initial_membership_verified",False):
            super().check_auth(company,token)
            self._initial_membership_verified=True
        with self.server.revocation_lock:
            allowed=self.server.active.get(str(company),False)
            fresh=self.server.revocation_ready and (
                time.monotonic()-self.server.revocation_last_ok<=LEASE_S)
        if not allowed or not fresh:
            raise PermissionError("revoked_or_stale_revocation_channel")

class RollingServer(pre.Server):
    def __init__(self,keys):
        super().__init__(keys)
        self.RequestHandlerClass=RollingHandler
        self.revocation_lock=threading.RLock()
        self.active={}
        self.revocation_ready=False
        self.revocation_last_ok=0
        self.revocation_sql=0
        self.revocation_notifies=0
        self.revocation_errors=0
        self.watch_stop=threading.Event()
        self.watch_ready=threading.Event()
        self.watch_thread=threading.Thread(target=self.watch,daemon=True)
        self.watch_thread.start()
    def snapshot(self,c):
        allowed={}
        for co,user in zip(v.COMPANIES,v.USER_IDS):
            permitted=c.execute("""SELECT EXISTS(
                SELECT 1 FROM private.memberships WHERE company_id=%s AND user_id=%s)""",(co,user)).fetchone()[0]
            allowed[str(co)]=bool(permitted)
        with self.revocation_lock:
            self.active=allowed
            self.revocation_last_ok=time.monotonic()
            self.revocation_ready=True
            self.revocation_sql+=2
        self.watch_ready.set()
    def watch(self):
        # A single persistent LISTEN connection; periodic reconcile only per
        # replica, not per HTTP or per streaming chunk.
        while not self.watch_stop.is_set():
            try:
                with v.con() as c:
                    c.execute("LISTEN "+CHANNEL)
                    self.snapshot(c)
                    last=time.monotonic()
                    while not self.watch_stop.is_set():
                        for note in c.notifies(timeout=.16,stop_after=1):
                            self.snapshot(c)
                            with self.revocation_lock:self.revocation_notifies+=1
                        if time.monotonic()-last>=RECONCILE_S:
                            self.snapshot(c);last=time.monotonic()
            except Exception:
                with self.revocation_lock:
                    self.revocation_ready=False
                    self.revocation_errors+=1
                self.watch_ready.set()
                self.watch_stop.wait(.1)
    def close_watch(self):
        self.watch_stop.set();self.watch_thread.join(3)

def rolling_process(keys,control):
    srv=RollingServer(keys)
    worker=threading.Thread(target=srv.serve_forever,daemon=True);worker.start()
    chk(srv.watch_ready.wait(10),"membership_watcher_not_started")
    control.send({"pid":os.getpid(),"port":srv.server_address[1]})
    warming=None
    try:
        while True:
            op=control.recv()
            if op=="prewarm_async":
                chk(warming is None,"duplicate_prewarm")
                warming=threading.Thread(target=srv.prewarm,daemon=True)
                warming.start();control.send({"started":True})
            elif op=="ready":
                with srv.mx:
                    done=srv.ready
                control.send({"ready":done})
            elif op=="stats":
                with srv.mx:
                    info={"pid":os.getpid(),"ready":srv.ready,
                        "prewarm_sql":srv.prewarm_sql,
                        "prewarm_seconds":round(srv.prewarm_duration,3),
                        "auth_sql":srv.auth_sql,
                        "peak_http_active":srv.peak_active,
                        "peak_cache_bytes":srv.peak_cache_bytes,
                        "http_responses":srv.responses,
                        "http_bytes":srv.bytes_out,
                        "denied":srv.denied,
                        "failed_streams":srv.failed_streams,
                        "rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
                with srv.revocation_lock:info.update({
                    "revocation_sql":srv.revocation_sql,
                    "revocation_notifies":srv.revocation_notifies,
                    "revocation_errors":srv.revocation_errors,
                    "active_membership":dict(srv.active),
                    "revocation_age":round(time.monotonic()-srv.revocation_last_ok,3)})
                control.send(info)
            elif op=="pause_state":control.send(srv.paused.is_set())
            elif op=="resume":srv.pause.set();control.send(True)
            elif op=="rotate_b_only":srv.keys.accept={"b"};control.send(True)
            elif op=="stop":control.send(True);break
            else:raise RuntimeError("unsupported_command")
    finally:
        srv.shutdown();srv.server_close();worker.join(4);srv.close_watch()
        if warming:warming.join(5)

def spawn(keys):
    parent,child=mp.Pipe()
    proc=mp.Process(target=rolling_process,args=(keys,child));proc.start()
    info=parent.recv()
    return (proc,parent,info)
def ctl(item,op):
    proc,pipe,_=item
    chk(proc.is_alive(),"rolling_replica_died")
    pipe.send(op)
    return pipe.recv()
def close(item):
    proc,pipe,_=item
    if proc.is_alive():ctl(item,"stop")
    proc.join(6)
    if proc.is_alive():proc.terminate();proc.join(4)
    chk(proc.exitcode==0,("rolling_replica_bad_exit",proc.exitcode))
def until(fn,timeout=35):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            if fn():return
        except Exception:pass
        time.sleep(.07)
    raise AssertionError("condition_timeout")

class Router(ThreadingHTTPServer):
    daemon_threads=True;request_queue_size=1024
    def __init__(self,port):
        super().__init__(("127.0.0.1",0),RouterHandler)
        self.lock=threading.RLock()
        self.upstream=port
        self.hits_by_port={}
        self.errors=0;self.active=0;self.peak_active=0
        self.io_bound=threading.BoundedSemaphore(50)
    def switch(self,port):
        with self.lock:self.upstream=port
class RouterHandler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        ok=self.server.io_bound.acquire(timeout=40)
        if not ok:
            self.send_error(503,"queue limit");return
        with self.server.lock:
            port=self.server.upstream
            self.server.active+=1
            self.server.peak_active=max(self.server.peak_active,self.server.active)
            self.server.hits_by_port[port]=self.server.hits_by_port.get(port,0)+1
        try:
            forwarded=request.Request("http://127.0.0.1:"+str(port)+self.path,
                headers={"X-QA-JWT":self.headers.get("X-QA-JWT",""),
                    "Accept-Encoding":self.headers.get("Accept-Encoding","gzip")})
            try:
                with request.urlopen(forwarded,timeout=80) as resp:
                    status=resp.status
                    body=resp.read()
                    hdr=resp.headers
            except error.HTTPError as err:
                status=err.code;body=err.read();hdr=err.headers
            self.send_response(status)
            self.send_header("Content-Length",str(len(body)))
            for header in ("Content-Encoding","X-QA-Original-SHA256","X-QA-Events"):
                if hdr.get(header):self.send_header(header,hdr[header])
            self.end_headers();self.wfile.write(body)
        except Exception:
            with self.server.lock:self.server.errors+=1
            try:self.send_error(503)
            except OSError:pass
        finally:
            with self.server.lock:self.server.active-=1
            self.server.io_bound.release()

def fetch(url,keys,i,kid="a",expect=200):
    co=v.COMPANIES[(i//2)%2]
    jwt=keys.issue(co,v.USER_IDS[(i//2)%2],kid)
    t=time.perf_counter()
    r=request.Request(url+"/"+str((i//2)%2),
        headers={"X-QA-JWT":jwt,"Accept-Encoding":"gzip"})
    try:
        with request.urlopen(r,timeout=100) as resp:
            raw_wire=resp.read()
            checksha=resp.headers["X-QA-Original-SHA256"]
            body=gzip.decompress(raw_wire)
            chk(hashlib.sha256(body).hexdigest()==checksha,"bad_export_sha")
            if i<4 or i%99==0:
                parsed=json.loads(body)
                chk(len(parsed["export"])==10000,"missing_original_full_export")
            chk(resp.status==expect,("unexpected_success",resp.status,expect))
            return {"ms":(time.perf_counter()-t)*1000,"wire":len(raw_wire),
                    "plain":len(body),"status":resp.status}
    except error.HTTPError as err:
        chk(err.code==expect,("unexpected_denial",err.code,expect))
        return {"ms":(time.perf_counter()-t)*1000,"wire":len(err.read()),"plain":0,
                "status":err.code}
def wave(router,keys,n):
    url="http://127.0.0.1:"+str(router.server_address[1])
    t=time.perf_counter()
    with ThreadPoolExecutor(max_workers=n) as pool:
        data=list(pool.map(lambda i:fetch(url,keys,i),range(n)))
    return {"clients":n,"full_json_200":sum(x["status"]==200 for x in data),
        "p95_ms":percentile([x["ms"] for x in data],.95),
        "p99_ms":percentile([x["ms"] for x in data],.99),
        "wall_seconds":round(time.perf_counter()-t,3),
        "gzip_wire_bytes":sum(x["wire"] for x in data),
        "full_uncompressed_bytes":sum(x["plain"] for x in data)}

def publish_membership(company,user,allowed):
    with v.con() as c:
        with c.transaction():
            if allowed:c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(company,user))
            else:c.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",(company,user))
            c.execute("SELECT pg_notify(%s,%s)",(CHANNEL,str(company)))
def security_midstream(replica,keys):
    # 16 KiB first chunk is delivered. Then revoke active synthetic RLS
    # membership; wait for *observed* revocation before releasing the pause.
    token=keys.issue(v.COMPANIES[0],v.USER_IDS[0],"a")
    url="http://127.0.0.1:"+str(replica[2]["port"])+"/0?pause=1"
    r=request.urlopen(request.Request(url,headers={
        "X-QA-JWT":token,"Accept-Encoding":"gzip"}),timeout=45)
    try:
        first=r.read(16384)
        chk(len(first)==16384,"missing_first_chunk")
        chk(ctl(replica,"pause_state"),"stream_not_paused")
        publish_membership(v.COMPANIES[0],v.USER_IDS[0],False)
        with v.con() as c:
            actual=c.execute("SELECT count(*) FROM private.memberships WHERE company_id=%s AND user_id=%s",
                 (v.COMPANIES[0],v.USER_IDS[0])).fetchone()[0]
        chk(actual==0,("revocation_not_persisted",actual))
        print("QA_ROLLING_REVOKE_DB_JSON="+js({"membership_remaining":actual,
            "worker_before":ctl(replica,"stats")}),flush=True)
        try:
            until(lambda:ctl(replica,"stats")["active_membership"].get(str(v.COMPANIES[0])) is False,9)
        except AssertionError:
            print("QA_ROLLING_REVOKE_FAIL_JSON="+js({"worker":ctl(replica,"stats"),
                "db_membership_remaining":actual}),flush=True)
            raise
        ctl(replica,"resume")
        try:
            remain=r.read()
            raise AssertionError(("revoked_stream_did_not_truncate",len(remain)))
        except IncompleteRead as err:
            chk(len(err.partial)==0,("unauthorized_post_revoke_bytes",len(err.partial)))
    finally:r.close()
    # Already cached results must not bypass revocation on NEW requests.
    for i in (0,):
        denied=fetch("http://127.0.0.1:"+str(replica[2]["port"]),keys,i,expect=401)
        chk(denied["status"]==401,"revoked_user_allowed")
    keys.accept={"a","b"}
    # Rotate worker to key B before membership restore, then A must fail.
    ctl(replica,"rotate_b_only")
    keys.accept={"b"}
    new=keys.issue(v.COMPANIES[0],v.USER_IDS[0],"b")
    denied=request.Request("http://127.0.0.1:"+str(replica[2]["port"])+"/0",
                    headers={"X-QA-JWT":new,"Accept-Encoding":"gzip"})
    try:request.urlopen(denied,timeout=15)
    except error.HTTPError as e:chk(e.code==401,"B_revoke_must_deny")
    else:raise AssertionError("B_accepted_revoked_member")
    publish_membership(v.COMPANIES[0],v.USER_IDS[0],True)
    until(lambda:ctl(replica,"stats")["active_membership"].get(str(v.COMPANIES[0])) is True,6)
    old=keys.issue(v.COMPANIES[0],v.USER_IDS[0],"a")
    old_req=request.Request("http://127.0.0.1:"+str(replica[2]["port"])+"/0",
                    headers={"X-QA-JWT":old,"Accept-Encoding":"gzip"})
    try:request.urlopen(old_req,timeout=15)
    except error.HTTPError as e:chk(e.code==401,"old_key_accept")
    else:raise AssertionError("old_key_accepted")
    good=request.Request("http://127.0.0.1:"+str(replica[2]["port"])+"/0",
                    headers={"X-QA-JWT":new,"Accept-Encoding":"gzip"})
    with request.urlopen(good,timeout=15) as resp:
        chk(resp.status==200 and len(resp.read())>100000,"B_restore_failed")
    return {"result":"PASS","first_chunk_bytes":16384,
        "bytes_after_observed_revocation":0,
        "truncated_http_200_content_length":True,
        "revoked_cached_member_denied":True,
        "old_key_denied_new_key_valid_after_restore":True,
        "blind_event_delivery_window_not_proven_zero":True}

def main():
    started=time.perf_counter()
    q.init_db();p.expanded_history();a.setup_outbox()
    audit=deep.rls_audit()
    with v.con() as c:
        lsn=v.scalar(c,"SELECT pg_current_wal_lsn()")
        initial_size=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
    keys=a.Keys()
    old=spawn(keys)
    router=None;router_worker=None
    records=[];all_processes=[old]
    initial_ready_time=None
    try:
        # One-time initial cold start: include full readiness cost, do not
        # classify rolling as an improvement if no old replica exists.
        t=time.perf_counter();ctl(old,"prewarm_async")
        until(lambda:ctl(old,"ready")["ready"],60)
        initial_ready_time=time.perf_counter()-t
        router=Router(old[2]["port"])
        router_worker=threading.Thread(target=router.serve_forever,daemon=True)
        router_worker.start()
        for concurrent in (100,300):
            new=spawn(keys);all_processes.append(new)
            chk(new[2]["pid"]!=old[2]["pid"],"same_worker")
            check_before=ctl(new,"ready")["ready"]
            chk(check_before is False,"new_replica_not_cold")
            t=time.perf_counter();ctl(new,"prewarm_async")
            # The existing instance takes traffic while replacement warms.
            # Dynamic cutover after READY. Requests already assigned to old
            # finish there; the old process drains instead of being killed.
            switch=threading.Event()
            def promote():
                until(lambda:ctl(new,"ready")["ready"],65)
                router.switch(new[2]["port"]);switch.set()
            thread=threading.Thread(target=promote,daemon=True);thread.start()
            outcome=wave(router,keys,concurrent)
            chk(switch.wait(70),"new_never_prewarmed")
            # Verify current router points to new; old still alive and had
            # served requests while the successor prewarmed.
            with router.lock:
                chk(router.upstream==new[2]["port"],"cutover_not_atomic")
                counts=dict(router.hits_by_port)
                errors=router.errors
                active=router.active
            chk(counts.get(old[2]["port"],0)>0,"old_did_not_serve")
            chk(errors==0 and active==0,("routing_failures",errors,active))
            url="http://127.0.0.1:"+str(router.server_address[1])
            for i in range(4):
                co=v.COMPANIES[(i//2)%2]
                chk(fetch(url,keys,i)["status"]==200,"new_not_serving")
            newstat=ctl(new,"stats")
            oldstat=ctl(old,"stats")
            chk(newstat["prewarm_sql"]==2,"new_extra_SQL")
            chk(oldstat["prewarm_sql"]==2,"old_extra_SQL")
            records.append({"concurrent":concurrent,"rolling_response":outcome,
              "new_prewarm_seconds":newstat["prewarm_seconds"],
              "old_served":counts.get(old[2]["port"],0),
              "new_served":counts.get(new[2]["port"],0),
              "old_sql_auth":oldstat["auth_sql"],
              "new_sql_auth":newstat["auth_sql"],
              "old_notification_SQL":oldstat["revocation_sql"],
              "new_notification_SQL":newstat["revocation_sql"],
              "cutover_zero_http_errors":True})
            print("QA_ROLLING_PHASE_JSON="+js(records[-1]),flush=True)
            # No active HTTP requests on old before retirement. Old router
            # requests may already have completed; server work drained.
            chk(oldstat["peak_http_active"]<=20,"old_active_limit")
            close(old);all_processes.remove(old)
            old=new
        security=security_midstream(old,keys)
        last=ctl(old,"stats")
        check=0
        with v.con() as c:
            db=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
            idx=int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')"))
            wal=int(v.scalar(c,"SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(lsn,)))
            check=int(v.scalar(c,"SELECT count(*) FROM public.playback_logs"))
        chk(check==20664,"synthetic_history_lost")
        metrics={"result":"PASS","pg17_disposable":True,"initial_boot_ready_seconds":round(initial_ready_time,3),
            "rolling_100_300":records,"stream_security":security,
            "last_replica":last,"rls_table_count":audit["table_count"],
            "source_events_preserved":check,"database_before_bytes":initial_size,
            "database_after_bytes":db,"index_bytes":idx,"wal_after_fixture_bytes":wal,
            "archive_external_gets":0,
            "auth_consistency":"LISTEN notification + 2s per-instance reconciliation; bounded lease 6s, QA only",
            "nonzero_notification_propagation_gap":True,
            "not_multi_host":True,"production_go":False,"no_prod_access":True,
            "parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "elapsed_seconds":round(time.perf_counter()-started,3)}
        print("QA_ROLLING_SUMMARY_JSON="+js(metrics),flush=True)
        print("QA_ROLLING_RESTART_PASS=true",flush=True)
    finally:
        if router:
            router.shutdown();router.server_close()
            if router_worker:router_worker.join(4)
        for item in all_processes:
            if item[0].is_alive():close(item)

if __name__=="__main__":main()
