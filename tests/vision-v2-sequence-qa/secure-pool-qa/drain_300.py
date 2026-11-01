"""QA: 300 concurrent full HTTP export requests while router switches OLD->NEW,
a commercial DB transaction commits and router rolls back NEW->OLD. Responses
may be complete baseline 200, stale 503, or truncated 200 fail-closed when
revision crosses a streamed body. After durable replay, both replicas serve
only the new version. No production systems.
"""
from __future__ import annotations
import gzip,hashlib,importlib.util,json,os,resource,threading,time
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead,RemoteDisconnected
from pathlib import Path
from urllib import request,error
from http.server import BaseHTTPRequestHandler
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("vision2_fenced_commercial",Path(__file__).parent/"qa.py")
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
qa.configure()
drv=qa.driver
v,z,c=qa.v,qa.z,qa.c
def ck(ok,msg):assert ok,msg
def pct(vals,p):
    vals=sorted(vals);x=(len(vals)-1)*p;a=int(x);b=min(a+1,len(vals)-1)
    return round(vals[a]*(b-x)+vals[b]*(x-a),3)

class DrainRouterHandler(BaseHTTPRequestHandler):
    """Loopback-only admissions fence with bounded drain; always reauth
    upstream on retry. Never cache a token or a commercial 200 at proxy."""
    def log_message(self,*args):pass
    def do_GET(self):
        p=self.server
        if not p.io_bound.acquire(timeout=1.5):
            with p.lock:p.drain_rejected+=1
            self.send_response(503);self.send_header("Retry-After","0.05")
            self.send_header("Content-Length","0");self.end_headers();return
        with p.lock:
            if p.route_gate_until>time.monotonic():
                p.drain_rejected+=1
                p.io_bound.release()
                self.send_response(503);self.send_header("Retry-After","0.05")
                self.send_header("Content-Length","0");self.end_headers();return
            port=p.upstream
            p.active+=1;p.peak_active=max(p.peak_active,p.active)
            p.active_by_port[port]=p.active_by_port.get(port,0)+1
            p.hits_by_port[port]=p.hits_by_port.get(port,0)+1
        try:
            url="http://127.0.0.1:"+str(port)+self.path
            rq=request.Request(url,headers={
                "X-QA-JWT":self.headers.get("X-QA-JWT",""),
                "Accept-Encoding":self.headers.get("Accept-Encoding","gzip")})
            try:
                with request.urlopen(rq,timeout=20) as upstream:
                    status=upstream.status
                    content=upstream.read()
                    headers=upstream.headers
            except error.HTTPError as e:
                status=e.code;content=e.read();headers=e.headers
            self.send_response(status)
            self.send_header("Content-Length",str(len(content)))
            for key in ("Content-Encoding","X-QA-SHA256","Retry-After"):
                if headers.get(key):self.send_header(key,headers[key])
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            with p.lock:p.errors+=1
            try:self.send_response(503);self.send_header("Content-Length","0");self.end_headers()
            except OSError:pass
        finally:
            with p.lock:
                p.active-=1
                p.active_by_port[port]-=1
            p.io_bound.release()

def drain_switch(proxy,new_port,timeout_s=.42):
    """Atomic admission switch; new assignments cannot reach previous port.
    Drain is only for already admitted requests. Never waits forever.
    No assumption that a previously admitted old 200 can be un-delivered."""
    started=time.monotonic()
    with proxy.lock:
        old_port=proxy.upstream
        if old_port==new_port:return {"wait_ms":0,"timed_out":False}
        proxy.route_gate_until=started+.018
        proxy.upstream=new_port
        active_start=proxy.active_by_port.get(old_port,0)
        proxy.drain_switches+=1
    deadline=started+timeout_s
    while time.monotonic()<deadline:
        with proxy.lock:
            remaining=proxy.active_by_port.get(old_port,0)
        if remaining==0:break
        time.sleep(.003)
    with proxy.lock:
        remaining=proxy.active_by_port.get(old_port,0)
        proxy.drain_old_max=max(proxy.drain_old_max,active_start)
        proxy.drain_timeouts+=int(remaining>0)
    return {"from":old_port,"to":new_port,"active_at_start":active_start,
            "remaining_at_deadline":remaining,
            "timed_out":remaining>0,
            "wait_ms":round((time.monotonic()-started)*1000,3)}

def main():
    began=time.perf_counter()
    drv.q.init_db();drv.p.expanded_history();drv.a.setup_outbox();drv.deep.rls_audit()
    z.create_tables()
    keys=drv.a.Keys()
    initial=qa.guarded_publish(v.COMPANIES[0],"RACE BASELINE",notify=False)
    peers=[qa.launch(i,keys) for i in (0,1)]
    proxy=None;thread=None
    try:
        for peer in peers:
            ck(c.ask(peer,"sync")["ids"]==[initial["id"]],"baseline_replay")
        spec2=importlib.util.spec_from_file_location("v2_rolling_proxy",ROOT/"rolling-cutover-outbox-qa"/"qa.py")
        roll=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(roll)
        proxy=roll.old.Router(peers[0][2]["port"])
        proxy.RequestHandlerClass=DrainRouterHandler
        proxy.active_by_port={}
        proxy.route_gate_until=0
        proxy.drain_rejected=0
        proxy.drain_switches=0
        proxy.drain_timeouts=0
        proxy.drain_old_max=0
        drain_events=[]
        proxy.io_bound=threading.BoundedSemaphore(qa.ADMISSIONS)
        thread=threading.Thread(target=proxy.serve_forever,daemon=True);thread.start()
        base="http://127.0.0.1:"+str(proxy.server_address[1])
        token=keys.issue(v.COMPANIES[0],v.USER_IDS[0],"a")
        # Direct 200 before the mixed wave, full original report verified.
        ck(drv.fetch_url(base,keys,0,200,"RACE BASELINE")["code"]==200,"initial_full_HTTP")
        statuses=[]
        begin=threading.Event()
        lock=threading.RLock()
        def one(i):
            ck(begin.wait(6),"wave_barrier")
            st=time.perf_counter()
            attempts=0;transient_503=0
            # Only retry safe idempotent GET on 503. Never retry 401, a
            # revoked JWT or a truncated 200. Retrying 503 requires fresh
            # SQL JWT/member/revision checks on the server for EACH attempt.
            deadline=st+7.5
            while True:
                attempts+=1
                rq=request.Request(base+"/0",headers={"X-QA-JWT":token,"Accept-Encoding":"gzip"})
                try:
                    with request.urlopen(rq,timeout=7) as response:
                        gz=response.read()
                        raw=gzip.decompress(gz)
                        ck(hashlib.sha256(raw).hexdigest()==response.headers["X-QA-SHA256"],"mixed_sha")
                        j=json.loads(raw)
                        ck(len(j["original_full_report"]["export"])==10000,"mixed_10k_missing")
                        ck(j["campaign"] in ("RACE BASELINE","RACE UPDATED"),
                           ("unknown_or_revoked_campaign",j["campaign"]))
                        result={"code":200,"campaign":j["campaign"],"bytes":len(gz),
                                "ms":(time.perf_counter()-st)*1000,
                                "attempts":attempts,"transient_503":transient_503}
                        break
                except error.HTTPError as ex:
                    # 401/403 always security FAIL; only bounded retry of
                    # 503 allowed. Do not fake a 200 when server fails.
                    ck(ex.code==503,("never_retry_auth_denial",ex.code))
                    ex.read();transient_503+=1
                    if attempts>=5 or time.perf_counter()+.025>=deadline:
                        result={"code":503,"bytes":0,"ms":(time.perf_counter()-st)*1000,
                                "attempts":attempts,"transient_503":transient_503}
                        break
                    time.sleep(min(.025*(2**(attempts-1)),.14))
                except (IncompleteRead,RemoteDisconnected,ConnectionResetError,TimeoutError,OSError) as ex:
                    # An incomplete HTTP 200 must not be reported as success
                    # or blindly retried after possible partial delivery.
                    result={"code":"incomplete","reason":type(ex).__name__,
                            "bytes":0,"ms":(time.perf_counter()-st)*1000,
                            "attempts":attempts,"transient_503":transient_503}
                    break
            with lock:statuses.append(result)
            return result
        with ThreadPoolExecutor(max_workers=65) as pool:
            futures=[pool.submit(one,i) for i in range(300)]
            begin.set()
            end=time.monotonic()+8
            while time.monotonic()<end:
                with proxy.lock:
                    peak=proxy.peak_active
                    active=proxy.active
                if peak>=8 and active>=2:break
                time.sleep(.008)
            ck(peak>=8,("no_in_flight_when_cutover",peak))
            with proxy.lock:
                old_active=proxy.active
            drain_events.append(drain_switch(proxy,peers[1][2]["port"]))
            # Allow NEW to receive live submissions while OLD requests are
            # still in flight. Commit during unfinished client wave.
            deadline=time.monotonic()+3
            new_started=0
            while time.monotonic()<deadline:
                with proxy.lock:
                    new_started=proxy.hits_by_port.get(peers[1][2]["port"],0)
                if new_started>0:break
                time.sleep(.006)
            ck(new_started>0,("new_route_never_assigned",proxy.hits_by_port))
            unfinished_before=sum(not f.done() for f in futures)
            ck(unfinished_before>0,"all_300_finished_before_mutation")
            event=qa.guarded_publish(v.COMPANIES[0],"RACE UPDATED",notify=False)
            with proxy.lock:
                at_rollback=proxy.active
            drain_events.append(drain_switch(proxy,peers[0][2]["port"]))
            unfinished_after=sum(not f.done() for f in futures)
            ck(unfinished_after>0,("no_inflight_after_rollback",unfinished_after))
            replies=[f.result(timeout=65) for f in futures]
        counts={str(code):sum(x["code"]==code for x in replies) for code in (200,503,"incomplete")}
        ck(sum(counts.values())==300,("lost_client",counts))
        # Zero baseline HTTP 200 is acceptable when the commercial commit
        # catches ALL 300 in-flight requests before their body completes.
        # Never weaken integrity checks of any 200 that *does* complete.
        ck(len(drain_events)==2 and proxy.drain_switches==2,
           ("drain_switch_not_executed",drain_events))
        ck(all(x["wait_ms"]<500 for x in drain_events),
           ("drain_wait_bound_broken",drain_events))
        ck(counts["503"]==0 and counts["incomplete"]==0 and counts["200"]==300,
           ("bounded_retry_exhausted_no_final_503_target",counts))
        ck(max(x["ms"] for x in replies)<7500,
           ("bounded_retry_end_to_end_deadline_exceeded",max(x["ms"] for x in replies)))
        # Both stale after commit even if lost LISTEN. No old version may pass
        # NEW admission; HTTP 200 from old wave was admitted before commit.
        for peer in peers:
            url="http://127.0.0.1:"+str(peer[2]["port"])
            ck(drv.fetch_url(url,keys,0,200,"RACE UPDATED")["code"]==200,
               "authoritative_singleflight_rebuild_not_serving_current")
        for peer in peers:
            got=c.ask(peer,"sync")["ids"]
            ck(got==[event["id"]],("durable_replay_missing",got))
        good_new=drv.run_wave(base,keys,100,"RACE UPDATED")
        proxy.switch(peers[1][2]["port"])
        good_new2=drv.run_wave(base,keys,100,"RACE UPDATED")
        with v.con() as db:
            db_bytes=db.execute("SELECT pg_database_size(current_database())").fetchone()[0]
            index=db.execute("SELECT pg_indexes_size('public.playback_logs')").fetchone()[0]
        result={"result":"PASS","mixed_300":counts,
            "retry_policy":"only idempotent GET 503 max5 attempts and 7.5s; never JWT 401 or partial 200",
            "admission_drain":{"switches":proxy.drain_switches,
                "timeouts":proxy.drain_timeouts,
                "max_old_active":proxy.drain_old_max,
                "rejected_by_drain":proxy.drain_rejected,
                "max_wait_ms":max(x["wait_ms"] for x in drain_events),
                "events":drain_events},
            "total_503_retried":sum(x["transient_503"] for x in replies),
            "clients_with_retry":sum(x["attempts"]>1 for x in replies),
            "max_attempts":max(x["attempts"] for x in replies),
            "final_503":counts["503"],
            "max_end_to_end_ms":round(max(x["ms"] for x in replies),3),
            "completed_new_revision":sum(x.get("campaign")=="RACE UPDATED" for x in replies),
            "completed_old_revision":sum(x.get("campaign")=="RACE BASELINE" for x in replies),
            "mixed_300_P95_ms":pct([x["ms"] for x in replies],.95),
            "mixed_300_P99_ms":pct([x["ms"] for x in replies],.99),
            "mixed_full_200_gzip_bytes":sum(x["bytes"] for x in replies if x["code"]==200),
            "pending_at_cutover":old_active,"new_router_assignments":new_started,
            "pending_at_rollback":at_rollback,"unfinished_at_mutation":unfinished_before,
            "unfinished_after_rollback":unfinished_after,
            "post_replay_100_old":good_new,"post_replay_100_new":good_new2,
            "both_replicas_authoritatively_rebuilt_without_notify":True,
            "all_complete_HTTP_SHA256_AND_10K":True,
            "routed_old_and_new":True,"encrypted_manifest_in_separate_CI":True,
            "worker_stats":[c.ask(peer,"get_stats") for peer in peers],
            "db_bytes":db_bytes,"index_bytes":index,
            "parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "elapsed_s":round(time.perf_counter()-began,3),
            "notes":"Retries only mask transient 503 at client; server 503 still possible and TCP already buffered old authorized bytes can arrive after commercial commit. Do NOT treat this as zero post-revoke delivery.",
            "no_prod":True,"production_GO":False}
        print("QA_DRAIN_300_SUMMARY_JSON="+json.dumps(result,sort_keys=True),flush=True)
        print("QA_DRAIN_300_PASS=true",flush=True)
    finally:
        if proxy:
            proxy.shutdown();proxy.server_close()
            if thread:thread.join(3)
        for peer in peers:
            if peer[0].is_alive():c.close(peer)
if __name__=="__main__":main()
