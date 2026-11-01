"""Vision V2 QA only: real 300 HTTP cutover AND rollback with two ready OS
processes, PostgreSQL17-authoritative per-stream-chunk RLS, durable outbox,
silent LISTEN, 30s batched per-instance reconciliation, full original gzip JSON.

NO production access, no deployment, no claim of instantaneous revocation.
"""
from __future__ import annotations
import hashlib,importlib.util,json,multiprocessing as mp,os,resource
import threading,time,uuid
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead
from urllib import request,error
from pathlib import Path
BASE=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("v2_rolling_existing",BASE/"rolling-restart-qa"/"qa.py")
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
v,p,q,a,deep=old.v,old.p,old.q,old.a,old.deep
RECONCILE_SECONDS=30.0 # QA budget model; does not authorize production settings
NOTIFY_CHANNEL=a.CHANNEL
def chk(ok,msg):assert ok,msg
def jd(o):return old.js(o)

class AuthoritativeHandler(old.pre.Handler):
    # Every block must pass native synthetic PostgreSQL membership/RLS.
    # Never trust a stale in-process membership snapshot for authorization.
    # This adds SQL proportional to actual served bytes, not idle TV count.
    def check_auth(self,company,token):
        super().check_auth(company,token)

class AuthoritativeServer(old.pre.Server):
    def __init__(self,keys):
        super().__init__(keys)
        self.RequestHandlerClass=AuthoritativeHandler
        self.monitor_stop=threading.Event()
        self.notification_block=threading.Event()
        self.monitor_ready=threading.Event()
        self.monitor_lock=threading.RLock()
        self.background_sql=0
        self.notifies=0
        self.last_outbox=0
        self.monitor_failures=0
        self.background_connections=0
        self.watch_thread=threading.Thread(target=self.watch,daemon=True)
        self.reconcile_thread=threading.Thread(target=self.reconcile,daemon=True)
        self.watch_thread.start()
        self.reconcile_thread.start()
    def reconcile_once(self):
        # One SQL query shared across tenants per app process: durable outbox
        # is read for consistency, NOT for granting access.
        with v.con() as c:
            n=int(c.execute("SELECT coalesce(max(id),0) FROM qa_v2_outbox").fetchone()[0])
        with self.monitor_lock:
            self.last_outbox=max(self.last_outbox,n)
            self.background_sql+=1
        self.monitor_ready.set()
    def reconcile(self):
        while not self.monitor_stop.is_set():
            try:self.reconcile_once()
            except Exception:
                with self.monitor_lock:self.monitor_failures+=1
            self.monitor_stop.wait(RECONCILE_SECONDS)
    def watch(self):
        while not self.monitor_stop.is_set():
            try:
                with v.con() as c:
                    c.execute("LISTEN "+NOTIFY_CHANNEL)
                    with self.monitor_lock:self.background_connections+=1
                    while not self.monitor_stop.is_set():
                        # Intentionally make notification delivery silent while
                        # SQL auth continues to be checked per streamed block.
                        if self.notification_block.is_set():
                            self.monitor_stop.wait(.1)
                            continue
                        for note in c.notifies(timeout=.1,stop_after=1):
                            with self.monitor_lock:self.notifies+=1
                            self.reconcile_once()
            except Exception:
                with self.monitor_lock:self.monitor_failures+=1
                self.monitor_stop.wait(.2)
    def finish(self):
        self.monitor_stop.set()
        self.reconcile_thread.join(3)
        self.watch_thread.join(2)

def worker(keys,pipe):
    srv=AuthoritativeServer(keys)
    thread=threading.Thread(target=srv.serve_forever,daemon=True)
    thread.start();chk(srv.monitor_ready.wait(10),"reconcile_not_ready")
    pipe.send({"pid":os.getpid(),"port":srv.server_address[1]})
    warming=None
    try:
        while True:
            op=pipe.recv()
            if op=="prewarm_async":
                warming=threading.Thread(target=srv.prewarm,daemon=True)
                warming.start();pipe.send(True)
            elif op=="ready":pipe.send(bool(srv.ready))
            elif op=="notification_blackhole":
                srv.notification_block.set();pipe.send(True)
            elif op=="notification_restore":
                srv.notification_block.clear();pipe.send(True)
            elif op=="outbox_reconcile":
                srv.reconcile_once();pipe.send(True)
            elif op=="pause_state":pipe.send(srv.paused.is_set())
            elif op=="resume":srv.pause.set();pipe.send(True)
            elif op=="rotate_b_only":srv.keys.accept={"b"};pipe.send(True)
            elif op=="auth_db_failure":
                # Explicit authorization fail-closed test without modifying PG
                # production or network; injected checker error returns 401/503.
                srv.inject_auth_failure=True;pipe.send(True)
            elif op=="auth_db_recover":
                srv.inject_auth_failure=False;pipe.send(True)
            elif op=="stats":
                with srv.mx:
                    out={"pid":os.getpid(),"ready":srv.ready,"prewarm_sql":srv.prewarm_sql,
                    "prewarm_seconds":round(srv.prewarm_duration,3),"auth_sql":srv.auth_sql,
                    "responses":srv.responses,"denied":srv.denied,
                    "failed_streams":srv.failed_streams,"peak_http_active":srv.peak_active,
                    "bytes_sent":srv.bytes_out,"rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                    "cache_bytes":sum(len(x["raw"])+len(x["gzip"]) for x in srv.cache.values())}
                with srv.monitor_lock:out.update({
                    "background_sql":srv.background_sql,"outbox_highwater":srv.last_outbox,
                    "notifies":srv.notifies,"monitor_failures":srv.monitor_failures,
                    "listener_connections":srv.background_connections,
                    "blackholed":srv.notification_block.is_set()})
                pipe.send(out)
            elif op=="stop":pipe.send(True);break
            else:raise RuntimeError("unknown_command:"+str(op))
    finally:
        srv.shutdown();srv.server_close();thread.join(4);srv.finish()
        if warming:warming.join(4)
def create(keys):
    parent,child=mp.Pipe();proc=mp.Process(target=worker,args=(keys,child));proc.start()
    info=parent.recv()
    return proc,parent,info
def ctl(item,cmd):
    proc,conn,_=item
    chk(proc.is_alive(),"worker_dead")
    conn.send(cmd);return conn.recv()
def dispose(item):
    proc,_,_=item
    if proc.is_alive():ctl(item,"stop")
    proc.join(5)
    if proc.is_alive():proc.terminate();proc.join(5)
    chk(proc.exitcode==0,"bad_worker_exit")
def until(fn,seconds=65):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if fn():return True
        time.sleep(.025)
    raise AssertionError("condition_timeout")
def auth_url(replica,tenant,keys,kid="a",pause=False):
    co=v.COMPANIES[tenant];user=v.USER_IDS[tenant]
    tok=keys.issue(co,user,kid)
    url="http://127.0.0.1:"+str(replica[2]["port"])+"/"+str(tenant)
    if pause:url+="?pause=1"
    return request.Request(url,headers={"X-QA-JWT":tok,"Accept-Encoding":"gzip"})
def publish(company,member,allowed):
    def mutation(c):
        if allowed:
            c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(company,member))
        else:
            c.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",(company,member))
    return a.outbox_commit(company,"membership_restored" if allowed else "membership_revoked",
                          {"user_id":member,"allowed":allowed},mutation)
def exact_crossing(router,keys,old_rep,new_rep):
    # Both are ready. In one 300-client burst: old -> new -> rollback old
    # while requests are still in flight; record actual assignment counts.
    url="http://127.0.0.1:"+str(router.server_address[1])
    op, np = old_rep[2]["port"],new_rep[2]["port"]
    before=dict(router.hits_by_port)
    zero_old=before.get(op,0);zero_new=before.get(np,0)
    t0=time.perf_counter()
    start=threading.Event()
    release_after_rollback=threading.Event()
    def hit(i):
        start.wait()
        if i>=220:release_after_rollback.wait()
        return old.fetch(url,keys,i)
    with ThreadPoolExecutor(max_workers=300) as pool:
        futures=[pool.submit(hit,i) for i in range(300)]
        start.set()
        until(lambda:router.hits_by_port.get(op,0)-zero_old>=20,18)
        chk(router.active>0,"no_inflight_during_first_cutover")
        old_at_cutover=router.hits_by_port.get(op,0)
        router.switch(np)
        until(lambda:router.hits_by_port.get(np,0)-zero_new>=30,18)
        chk(router.active>0,"no_inflight_during_rollback")
        old_at_rollback=router.hits_by_port.get(op,0)
        router.switch(op)
        release_after_rollback.set()
        results=[f.result(timeout=90) for f in futures]
    counts={str(op):router.hits_by_port.get(op,0)-zero_old,
            str(np):router.hits_by_port.get(np,0)-zero_new}
    after_rollback_old=router.hits_by_port.get(op,0)-old_at_rollback
    chk(after_rollback_old>=80,("rollback_no_post_traffic",after_rollback_old))
    chk(counts[str(op)]>=20 and counts[str(np)]>=30,("not_covered_both_hosts",counts))
    chk(all(x["status"]==200 for x in results),("http_non_200",counts))
    chk(router.errors==0 and router.active==0,"router_errors")
    chk(sum(counts.values())==300,("unexpected_routing_total",counts))
    chk(router.upstream==op,"router_not_rolled_back")
    return {"clients":300,"P95_ms":old.percentile([x["ms"] for x in results],.95),
        "P99_ms":old.percentile([x["ms"] for x in results],.99),
        "cutover_then_rollback_while_requests_active":True,
        "upstream_assignments":counts,
        "old_before_first_cutover":old_at_cutover-zero_old,
        "old_after_rollback":after_rollback_old,
        "controlled_post_rollback_clients":80,
        "full_json_http_200":300,"compressed_bytes":sum(x["wire"] for x in results),
        "uncompressed_bytes":sum(x["plain"] for x in results),
        "duration_s":round(time.perf_counter()-t0,3)}
def security_silent_listener(replica,keys):
    ctl(replica,"notification_blackhole")
    first=ctl(replica,"stats")
    chk(first["blackholed"],"not_blackholed")
    r=request.urlopen(auth_url(replica,0,keys,pause=True),timeout=40)
    try:
        initial=r.read(16384);chk(len(initial)==16384,"stream_start_bad")
        chk(ctl(replica,"pause_state"),"pause_not_observed")
        event=publish(v.COMPANIES[0],v.USER_IDS[0],False)
        # Do NOT wait on LISTEN or background reconciliation. This proves
        # authoritative RLS rejects next chunk even with stale outbox watcher.
        stale=ctl(replica,"stats")
        chk(stale["blackholed"],"watcher_not_blocked")
        ctl(replica,"resume")
        try:
            rest=r.read()
            raise AssertionError(("revoked_stream_leaked",len(rest)))
        except IncompleteRead as e:
            chk(len(e.partial)==0,("revoked_late_bytes",len(e.partial)))
    finally:r.close()
    for tenant in (0,):
        req=auth_url(replica,tenant,keys)
        try:request.urlopen(req,timeout=20)
        except error.HTTPError as e:chk(e.code in (401,503),"revoked_returned_wrong_status")
        else:raise AssertionError("revoked_JWT_accepted")
    # Make sure the durable outbox is recoverable despite the lost signal.
    ctl(replica,"outbox_reconcile")
    current=ctl(replica,"stats")
    chk(current["outbox_highwater"]>=event["id"],"outbox_highwater_stale")
    ctl(replica,"notification_restore")
    restore=publish(v.COMPANIES[0],v.USER_IDS[0],True)
    ctl(replica,"outbox_reconcile")
    restored=ctl(replica,"stats")
    chk(restored["outbox_highwater"]>=restore["id"],"restore_outbox_stale")
    with request.urlopen(auth_url(replica,0,keys),timeout=20) as ok:
        chk(ok.status==200 and len(ok.read())>100000,"valid_auth_failed_after_restore")
    return {"result":"PASS","listener_blackholed_during_revocation":True,
       "returned_chunks_after_commit":0,"durable_outbox_recovered":True,
       "membership_SQL_at_stream_chunk_boundary":True,
       "asynchronous_revocation_gap_between_SQL_check_and_byte_write":"not zero-proven",
       "outbox_events":2}
def main():
    started=time.perf_counter()
    q.init_db();p.expanded_history();a.setup_outbox()
    audit=deep.rls_audit()
    with v.con() as c:
        lsn=v.scalar(c,"SELECT pg_current_wal_lsn()")
        before=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
    keys=a.Keys()
    one=create(keys);two=create(keys)
    chk(one[2]["pid"]!=two[2]["pid"],"same_process")
    router=None;router_thread=None
    try:
        ctl(one,"prewarm_async")
        until(lambda:ctl(one,"ready"),70)
        router=old.Router(one[2]["port"])
        router_thread=threading.Thread(target=router.serve_forever,daemon=True)
        router_thread.start()
        # 100-client full JSON while successor is warming.
        ctl(two,"prewarm_async")
        first=old.wave(router,keys,100)
        chk(first["full_json_200"]==100,"rolling_100_fail")
        until(lambda:ctl(two,"ready"),70)
        prepared={"a":ctl(one,"stats"),"b":ctl(two,"stats")}
        chk(prepared["a"]["prewarm_sql"]==2 and prepared["b"]["prewarm_sql"]==2,"extra_preloads")
        second=exact_crossing(router,keys,one,two)
        # Still serving OLD due rollback; verify NEW is ready and can serve.
        router.switch(two[2]["port"])
        for i in range(4):
            co=v.COMPANIES[(i//2)%2]
            chk(old.fetch("http://127.0.0.1:"+str(router.server_address[1]),keys,i)["status"]==200,"post_cutover_not_ready")
        sec=security_silent_listener(two,keys)
        final={"a":ctl(one,"stats"),"b":ctl(two,"stats")}
        with v.con() as c:
            after=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
            index=int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')"))
            wal=int(v.scalar(c,"SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(lsn,)))
            event_count=int(v.scalar(c,"SELECT count(*) FROM public.playback_logs"))
        chk(event_count==20664,"source_rows_mutated")
        bg_total=final["a"]["background_sql"]+final["b"]["background_sql"]
        chk(bg_total<25,("unexpected_poll_amplification",bg_total))
        result={"result":"PASS","PG17_disposable":True,"rollover_100":first,
            "cutover_rollback_300":second,"prepared":prepared,
            "after":final,"security":sec,"RLS_tables":audit["table_count"],
            "source_events":event_count,"database_before":before,"database_after":after,
            "history_index_bytes":index,"WAL_post_fixture_bytes":wal,
            "two_report_PIDs":[one[2]["pid"],two[2]["pid"]],
            "per_replica_reconcile_seconds":RECONCILE_SECONDS,
            "background_sql_observed":bg_total,
            "background_sql_30d_two_replicas_model":2*30*24*3600//int(RECONCILE_SECONDS),
            "background_reduction_vs_2s_two_tenant_sql_pct":round(100*(1-(2*30*24*3600/int(RECONCILE_SECONDS))/(2*2*30*24*3600/2)),3),
            "auth_checks_per_served_chunk_not_free":True,
            "object_http_gets_this_suite":0,"full_report_gzip":True,
            "host_isolation":"two OS processes on one disposable CI runner, not two physical hosts",
            "parent_RSS_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "no_production_access":True,"production_GO":False,
            "elapsed_s":round(time.perf_counter()-started,3)}
        print("QA_ROLLBACK_SUMMARY_JSON="+jd(result),flush=True)
        print("QA_ROLLBACK_PASS=true",flush=True)
    finally:
        if router:
            router.shutdown();router.server_close()
            router_thread.join(3)
        for item in (one,two):
            if item[0].is_alive():dispose(item)
if __name__=="__main__":main()
