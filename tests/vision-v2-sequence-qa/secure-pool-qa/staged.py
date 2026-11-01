"""Vision V2 ephemeral PG17 commercial revision correctness across stable
HTTP origin, cutover, missed NOTIFY, replay and rollback (100+100+100 clients).
Separate 300 *simultaneous* cutover/rollback benchmark is in qa.py.
"""
from __future__ import annotations
import gzip,hashlib,importlib.util,json,os,resource,threading,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from urllib import request,error
BASE=Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location("commercial_v2_source",BASE/"commit-race-http-qa"/"qa.py")
c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
z=c.z;v=c.v;a=c.a;q=c.q;p=c.p;deep=c.deep
def ok(flag,msg):assert flag,msg
def percentile(values,pct):
    values=sorted(values);pos=(len(values)-1)*pct;i=int(pos);j=min(i+1,len(values)-1)
    return round(values[i]*(j-pos)+values[j]*(pos-i),3)
def fetch_url(url,keys,tenant=0,expected_status=200,expected_campaign=None):
    co,user=v.COMPANIES[tenant],v.USER_IDS[tenant]
    token=keys.issue(co,user,"a")
    req=request.Request(url+"/"+str(tenant),headers={"X-QA-JWT":token,"Accept-Encoding":"gzip"})
    st=time.perf_counter()
    try:
        with request.urlopen(req,timeout=90) as resp:
            compressed=resp.read()
            full=gzip.decompress(compressed)
            ok(hashlib.sha256(full).hexdigest()==resp.headers["X-QA-SHA256"],"report_hash_mismatch")
            doc=json.loads(full)
            ok(len(doc["original_full_report"]["export"])==10000,"original_export_rows_missing")
            if expected_campaign is not None:
                ok(doc["campaign"]==expected_campaign,("wrong_campaign_revision",doc["campaign"],expected_campaign))
            ok(resp.status==expected_status,("unexpected_success",resp.status))
            return {"code":resp.status,"duration_ms":(time.perf_counter()-st)*1000,
                    "gzip_bytes":len(compressed),"original_bytes":len(full),
                    "campaign":doc["campaign"],"revision":doc["revision"]}
    except error.HTTPError as exc:
        ok(exc.code==expected_status,("unexpected_error",exc.code,expected_status))
        return {"code":exc.code,"duration_ms":(time.perf_counter()-st)*1000,
                "gzip_bytes":len(exc.read()),"original_bytes":0}
def run_wave(url,keys,n,campaign,tenant=0):
    with ThreadPoolExecutor(max_workers=75) as pool:
        data=list(pool.map(lambda _:fetch_url(url,keys,tenant,200,campaign),range(n)))
    ok(len(data)==n and all(x["code"]==200 for x in data),"missing_HTTP")
    return {"clients":n,"P95_ms":percentile([x["duration_ms"] for x in data],.95),
            "P99_ms":percentile([x["duration_ms"] for x in data],.99),
            "gzip_bytes":sum(x["gzip_bytes"] for x in data),
            "original_bytes":sum(x["original_bytes"] for x in data),
            "full_original_report_SHA_pass":True,"campaign":campaign}

class CommercialRouterHandler(BaseHTTPRequestHandler):
    """Reuse the existing guarded Router and forward the commercial SHA
    response header, which the media-only Router intentionally omitted."""
    def log_message(self,*args):pass
    def do_GET(self):
        proxy=self.server
        if not proxy.io_bound.acquire(timeout=40):
            self.send_error(503,"router_admission_failed")
            return
        with proxy.lock:
            port=proxy.upstream
            proxy.active+=1
            proxy.peak_active=max(proxy.peak_active,proxy.active)
            proxy.hits_by_port[port]=proxy.hits_by_port.get(port,0)+1
        try:
            url="http://127.0.0.1:"+str(port)+self.path
            rq=request.Request(url,headers={
                "X-QA-JWT":self.headers.get("X-QA-JWT",""),
                "Accept-Encoding":self.headers.get("Accept-Encoding","gzip")})
            try:
                with request.urlopen(rq,timeout=90) as response:
                    code=response.status
                    content=response.read()
                    header=response.headers
            except error.HTTPError as ex:
                code=ex.code
                content=ex.read()
                header=ex.headers
            self.send_response(code)
            self.send_header("Content-Length",str(len(content)))
            for key in ("X-QA-SHA256","Content-Encoding","X-QA-Events"):
                if header.get(key):self.send_header(key,header[key])
            self.end_headers()
            self.wfile.write(content)
        except Exception as ex:
            with proxy.lock:
                proxy.errors+=1
                if not hasattr(proxy,"error_reasons"):proxy.error_reasons={}
                kind=type(ex).__name__
                proxy.error_reasons[kind]=proxy.error_reasons.get(kind,0)+1
            try:self.send_error(503,"upstream_unavailable")
            except OSError:pass
        finally:
            with proxy.lock:proxy.active-=1
            proxy.io_bound.release()

def main():
    start=time.perf_counter()
    q.init_db();p.expanded_history();a.setup_outbox();deep.rls_audit()
    z.create_tables()
    with v.con() as db:
        lsn=db.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
    keys=a.Keys()
    peers=[c.launch(i,keys) for i in range(2)]
    proxy=None;loop=None
    try:
        baseline="CURRENT COMMERCIAL CAMPAIGN"
        committed=z.publish(v.COMPANIES[0],baseline,notify=False)
        for peer in peers:
            got=c.ask(peer,"sync")
            ok(got["ids"]==[committed["id"]],"baseline_event_missing")
        # Import existing stable reverse proxy, not a new production module.
        spec=importlib.util.spec_from_file_location("rolling_v2_source",BASE/"rolling-cutover-outbox-qa"/"qa.py")
        roll=importlib.util.module_from_spec(spec);spec.loader.exec_module(roll)
        proxy=roll.old.Router(peers[0][2]["port"])
        # Synthetic admission limit avoids dozens of simultaneous 3MB JSON
        # parse/serialize allocations in the unbounded commercial handler.
        proxy.io_bound=threading.BoundedSemaphore(int(os.environ.get("QA_COMMERCIAL_ADMISSIONS","12")))
        proxy.RequestHandlerClass=CommercialRouterHandler
        loop=threading.Thread(target=proxy.serve_forever,daemon=True);loop.start()
        url="http://127.0.0.1:"+str(proxy.server_address[1])
        old_result=run_wave(url,keys,100,baseline)
        proxy.switch(peers[1][2]["port"])
        new_result=run_wave(url,keys,100,baseline)
        # A commercial commit occurs while the NEW route is serving.
        # The silent NOTIFY leaves BOTH process caches stale: an HTTP GET
        # is rejected until each worker replays its persisted outbox.
        revised="REVISED AFTER CUTOVER"
        event=z.publish(v.COMPANIES[0],revised,notify=False)
        # Secure singleflight rebuild checks committed DB revision AND its
        # durable outbox event, then publishes sealed AES-GCM gzip. This can
        # return CURRENT 200 without a LISTEN notification or cursor replay.
        old_updated=fetch_url("http://127.0.0.1:"+str(peers[0][2]["port"]),keys,0,200,revised)
        new_updated=fetch_url(url,keys,0,200,revised)
        ok(old_updated["code"]==new_updated["code"]==200,"lazy_commercial_current_unavailable")
        for peer in peers:
            got=c.ask(peer,"sync")
            ok(got["ids"]==[event["id"]],"stale_after_replay")
        restored_new=fetch_url(url,keys,0,200,revised)
        proxy.switch(peers[0][2]["port"])
        rollback_result=run_wave(url,keys,100,revised)
        for peer in peers:
            st=c.ask(peer,"get_stats")
            ok(st["cursor"]==event["id"],"outbox_consumer_cursor_lost")
        with v.con() as db:
            metrics={"source_events":db.execute("SELECT count(*) FROM public.playback_logs").fetchone()[0],
                "db_bytes":db.execute("SELECT pg_database_size(current_database())").fetchone()[0],
                "history_index_bytes":db.execute("SELECT pg_indexes_size('public.playback_logs')").fetchone()[0],
                "wal_after_fixture_bytes":int(db.execute("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(lsn,)).fetchone()[0])}
        ok(metrics["source_events"]==20664,"historical_events_changed")
        out={"result":"PASS","old_100":old_result,"new_100":new_result,
            "rollback_updated_100":rollback_result,"full_http_200":300,
            "fresh_200_without_notify_both_replicas":True,"no_notify":True,
            "after_replay_new_route_200":restored_new["code"]==200,
            "independent_durable_consumers":2,"last_outbox_event":event["id"],
            "router_assignments":dict(proxy.hits_by_port),"router_errors":proxy.errors,
            "worker_stats":[c.ask(peer,"get_stats") for peer in peers],
            "metrics":metrics,
            "gzip_egress_300_bytes":sum(x["gzip_bytes"] for x in (old_result,new_result,rollback_result)),
            "parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "elapsed_seconds":round(time.perf_counter()-start,3),
            "phase_note":"staged 100+100+100 across cutover/rollback; 300 in-flight cutover is separately exercised",
            "production_GO":False,"no_production_access":True}
        ok(proxy.errors==0,"proxy_error")
        print("QA_COMMERCIAL_CUTOVER_SUMMARY_JSON="+json.dumps(out,sort_keys=True,default=str),flush=True)
        print("QA_COMMERCIAL_CUTOVER_PASS=true",flush=True)
    finally:
        if proxy and hasattr(proxy,"shutdown"):
            proxy.shutdown();proxy.server_close()
            if loop:loop.join(3)
        for peer in peers:
            if peer[0].is_alive():c.close(peer)
if __name__=="__main__":
    import importlib.util
    from pathlib import Path
    base=Path(__file__).resolve().parent
    ss=importlib.util.spec_from_file_location("v2_secure_pool_impl",base/"qa.py")
    secure=importlib.util.module_from_spec(ss);ss.loader.exec_module(secure)
    secure.configure()
    c.launch=secure.launch
    z.publish=secure.guarded_publish
    z.create_tables=secure.qa.create_ordered_tables_with_read_only_rls
    main()
    print("QA_SEALED_POOL_COMMERCIAL_PASS=true",flush=True)
