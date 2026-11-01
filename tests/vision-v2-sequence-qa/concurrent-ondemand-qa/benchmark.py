"""Vision V2: bounded tenant cache and real 100/300 HTTP report query concurrency.
Only QA PostgreSQL17 database in GitHub Actions. Synthetic originals retained.
No permanent event-level read-model, no production credentials or deployed RPC.
"""
from __future__ import annotations
from collections import defaultdict, OrderedDict
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import date
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib import request,error
import argparse,hashlib,hmac,json,math,resource,secrets,threading,time,uuid
import importlib.util

SRC=Path(__file__).resolve().parents[1]/"compact-ondemand-qa"/"compact.py"
SPEC=importlib.util.spec_from_file_location("vision_compact_previous",SRC)
p=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)
v=p.v
CACHE_QUOTA_BYTES=110_000
CACHE_TTL_SECONDS=10.0
DB_CONCURRENCY=12
MAX_QUEUE_WAIT_S=40
RUNNER_TIMEOUT_S=480
def canon(x):return p.canon(x)
def sha(x):return hashlib.sha256(x).hexdigest()
def percentile(a,pr):
    z=sorted(a)
    return round(z[math.ceil(pr*len(z))-1],3) if z else 0

class BoundedCache:
    def __init__(self,base,manifest,key,quota=CACHE_QUOTA_BYTES,ttl=CACHE_TTL_SECONDS):
        self.base,self.manifest,self.key=base,manifest,key
        self.quota,self.ttl=quota,ttl
        self.caches=defaultdict(OrderedDict)
        self.sizes=defaultdict(int)
        self.lock=threading.RLock()
        self.filelocks=defaultdict(threading.Lock)
        self.hits=self.misses=self.evictions=self.expired=self.failures=self.retry_attempts=0
        self.bytes_fetched=0;self.max_cache_bytes=0
    def clear(self,company=None):
        with self.lock:
            if company:
                self.caches.pop(company,None);self.sizes.pop(company,None)
            else:
                self.caches.clear();self.sizes.clear()
    def stats(self):
        with self.lock:
            return {"hits":self.hits,"misses":self.misses,
                "evictions":self.evictions,"expired":self.expired,
                "fetch_failures":self.failures,"retries":self.retry_attempts,
                "http_bytes_downloaded":self.bytes_fetched,
                "cache_bytes":sum(self.sizes.values()),
                "max_cache_bytes":self.max_cache_bytes,
                "per_tenant_cached_bytes":dict(self.sizes)}
    def get(self,company,entry,retries=1):
        ident=entry["descriptor"]
        if company!=ident["company"]:raise PermissionError("tenant_mismatch")
        filename=entry["file"]
        with self.lock:
            lock=self.filelocks[(company,filename)]
        # Singleflight: identical pending segment fetches are de-duplicated.
        with lock:
            with self.lock:
                slot=self.caches[company]
                item=slot.get(filename)
                if item:
                    expiry,rows,size=item
                    if time.monotonic()<expiry:
                        slot.move_to_end(filename);self.hits+=1
                        return rows
                    self.expired+=1
                    self.sizes[company]-=size
                    slot.pop(filename,None)
            for attempt in range(retries+1):
                try:
                    with request.urlopen(self.base+"/"+filename,timeout=6) as response:
                        blob=response.read()
                    rows=p.decrypt(self.key,entry,blob)
                    break
                except Exception as exc:
                    with self.lock:self.failures+=1
                    if attempt==retries:raise IOError("unavailable_or_invalid_segment") from exc
                    with self.lock:self.retry_attempts+=1
                    time.sleep(.015*(attempt+1))
            size=len(canon(rows))
            with self.lock:
                self.misses+=1;self.bytes_fetched+=len(blob)
                if size<=self.quota:
                    slot=self.caches[company]
                    while slot and self.sizes[company]+size>self.quota:
                        old,(_,_,old_size)=slot.popitem(last=False)
                        self.sizes[company]-=old_size;self.evictions+=1
                    slot[filename]=(time.monotonic()+self.ttl,rows,size)
                    self.sizes[company]+=size
                    if self.sizes[company]>self.quota:
                        raise AssertionError("tenant_cache_quota_exceeded")
                    self.max_cache_bytes=max(self.max_cache_bytes,sum(self.sizes.values()))
            return rows
    def select(self,company,begin,end):
        rows=[]
        for entry in self.manifest["segments"]:
            d=entry["descriptor"]
            if d["company"]!=company:continue
            dt=date.fromisoformat(d["local_day"])
            if begin<=dt<=end:rows.extend(self.get(company,entry))
        return rows

class ReportGateway(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=512
    def __init__(self,cache,baseline):
        super().__init__(("127.0.0.1",0),ReportHandler)
        self.cache,self.baseline=cache,baseline
        self.sema=threading.BoundedSemaphore(DB_CONCURRENCY)
        self.mu=threading.Lock()
        self.completed=0;self.denied=0;self.failed=0;self.request_count=0
        self.inflight=0;self.max_inflight=0;self.queued=0;self.max_queued=0
        self.backpressure=0;self.db_session_errors=0
        self.acked=set()
    def snapshot(self):
        with self.mu:
            return {k:getattr(self,k) for k in
                ("completed","denied","failed","request_count","max_inflight","max_queued",
                 "backpressure","db_session_errors")}
    def compute(self,idx,token,request_id):
        claim=v.decode(token)
        reference=self.baseline[idx]
        case=reference["case"]
        if claim["company_id"]!=case["company"] or claim["sub"]!=v.USER_IDS[v.COMPANIES.index(uuid.UUID(case["company"]))]:
            raise PermissionError("cross_tenant_or_user")
        company=uuid.UUID(case["company"])
        start=date.fromisoformat(case["start"])
        end=date.fromisoformat(case["end"])
        campaign=uuid.UUID(case["campaign"]) if case["campaign"] else None
        device=uuid.UUID(case["device"]) if case["device"] else None
        rows=self.cache.select(str(company),start,end)
        with self.mu:
            self.queued+=1
            self.max_queued=max(self.max_queued,self.queued)
        acquired=self.sema.acquire(timeout=MAX_QUEUE_WAIT_S)
        with self.mu:
            self.queued-=1
            if acquired:
                self.inflight+=1
                self.max_inflight=max(self.max_inflight,self.inflight)
        if not acquired:
            with self.mu:self.backpressure+=1
            raise TimeoutError("report_gateway_busy")
        try:
            # Exactly one connection per HTTP request. Temporary playback rows
            # cease to exist on connection close; never shared across tenants.
            with v.con() as c:
                p.load_table(c,rows)
                with c.transaction():
                    v.auth(c,claim)
                    # Server-side tenant isolation in PG17 RLS as well as JWT.
                    assert v.scalar(c,"SELECT count(*) FROM pg_temp.qa_ondemand_events WHERE company_id<>%s",(company,))==0
                    report=v.rpc(c,"get_playback_report_ondemand",company,start,end,campaign,device)
                    events=v.export(c,"get_playback_events_ondemand",company,start,end,campaign,device,limit=1000)
                    output={"report":report,"export":[list(x) for x in events]}
                    result_bytes=canon(output)
                    if not hmac.compare_digest(sha(result_bytes),sha(canon(reference["result"]))):
                        raise ValueError("full_json_or_export_mismatch")
            # An ACK means both complete JSON and export were validated;
            # no ACK is recorded on network failure or wrong tenant.
            with self.mu:
                self.completed+=1
                self.acked.add((str(company),request_id))
            return {"verified":True,"sha256":sha(result_bytes),
                    "event_export_count":len(events),"bytes_validated":len(result_bytes),
                    "request_id":request_id}
        finally:
            with self.mu:self.inflight-=1
            self.sema.release()

class ReportHandler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def respond(self,status,obj):
        b=canon(obj)
        self.send_response(status);self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(b)));self.end_headers();self.wfile.write(b)
    def do_POST(self):
        with self.server.mu:self.server.request_count+=1
        if self.path!="/qa/report":return self.respond(404,{"error":"not_found"})
        try:
            length=int(self.headers.get("Content-Length","-1"))
            if length<2 or length>3000:raise ValueError("invalid_request")
            inp=json.loads(self.rfile.read(length))
            if set(inp)!={"case_id","request_id"} or type(inp["case_id"]) is not int:
                raise ValueError("schema")
            idx=inp["case_id"]
            if not 0<=idx<len(self.server.baseline):raise ValueError("case_range")
            if not isinstance(inp["request_id"],str) or not 1<=len(inp["request_id"])<=90:
                raise ValueError("id")
            token=self.headers.get("Authorization","").removeprefix("Bearer ")
            result=self.server.compute(idx,token,inp["request_id"])
            return self.respond(200,result)
        except (PermissionError,):
            with self.server.mu:self.server.denied+=1
            return self.respond(401,{"error":"untrusted"})
        except (ValueError,IndexError):
            with self.server.mu:self.server.denied+=1
            return self.respond(409,{"error":"invalid"})
        except Exception:
            with self.server.mu:self.server.failed+=1
            return self.respond(503,{"error":"archive_or_backend_unavailable"})

def post(base,case_id,token,request_id):
    req=request.Request(base+"/qa/report",data=canon({"case_id":case_id,"request_id":request_id}),
       method="POST",headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    before=time.perf_counter()
    try:
        with request.urlopen(req,timeout=70) as resp:
            status,body=resp.status,json.loads(resp.read())
    except error.HTTPError as resp:
        status,body=resp.code,json.loads(resp.read())
    return status,body,(time.perf_counter()-before)*1000

def test_failures(server,base,store,cache,reference,key,manifest):
    # One request from each tenant must work. Then reject cross-tenant/
    # tampered/expired tokens BEFORE reading a tenant's archived data.
    case0=reference[0]["case"]
    valid=v.token(uuid.UUID(case0["company"]),v.USER_IDS[0])
    status,body,_=post(base,0,valid,"preflight-good")
    assert status==200 and body["verified"]
    other=v.token(v.COMPANIES[1],v.USER_IDS[1])
    denied_before=server.snapshot()["completed"]
    for tok in (other,v.token(v.COMPANIES[0],v.USER_IDS[0],ttl=-5),
                valid[:-5]+"AAAAA"):
        status,_,_=post(base,0,tok,"bad-auth")
        assert status==401
    assert server.snapshot()["completed"]==denied_before
    # Validate actual SQL RLS and source RPC invoker membership restriction.
    with v.con() as c:
        with c.transaction():
            v.auth(c,v.decode(valid))
            assert v.scalar(c,"SELECT count(*) FROM public.playback_logs WHERE company_id=%s",(v.COMPANIES[1],))==0
            assert v.scalar(c,"SELECT count(*) FROM qa_rpc.daily WHERE company_id=%s",(v.COMPANIES[1],))==0
            try:v.rpc(c,"get_playback_report",v.COMPANIES[1],v.DAYS[0],v.DAYS[2])
            except psycopg.Error as err:assert err.sqlstate=="42501"
            else:raise AssertionError("RLS_or_original_RPC_bypassed")
    # First matching object must be fetched with a fresh cache.
    entry=next(x for x in manifest["segments"] if x["descriptor"]["company"]==case0["company"] and x["descriptor"]["local_day"]==case0["start"])
    name=entry["file"]
    cache.clear()
    with store.lock:store.offline.add(name)
    try:
        attempts=server.snapshot()["completed"]
        code,_,_=post(base,0,valid,"offline-denied")
        assert code==503
        assert server.snapshot()["completed"]==attempts
        assert (case0["company"],"offline-denied") not in server.acked
    finally:
        with store.lock:store.offline.clear()
    status,_,_=post(base,0,valid,"offline-recovered")
    assert status==200
    original=(store.folder/name).read_bytes()
    corrupt=bytearray(original);corrupt[len(corrupt)//2]^=1
    cache.clear();(store.folder/name).write_bytes(corrupt)
    try:
        before=server.snapshot()["completed"]
        status,_,_=post(base,0,valid,"tamper-denied")
        assert status==503 and server.snapshot()["completed"]==before
    finally:
        (store.folder/name).write_bytes(original)
    try:p.decrypt(secrets.token_bytes(32),entry,original)
    except Exception:pass
    else:raise AssertionError("wrong_key_not_rejected")
    status,_,_=post(base,0,valid,"tamper-recovered")
    assert status==200
    # Explicit TTL expiry and bounded per-company memory.
    cache.clear();cache.ttl=.08
    status,_,_=post(base,0,valid,"ttl-one")
    assert status==200
    hits=cache.stats()["hits"]
    status,_,_=post(base,0,valid,"ttl-two")
    assert status==200 and cache.stats()["hits"]>hits
    time.sleep(.10)
    stale=cache.stats()["expired"]
    status,_,_=post(base,0,valid,"ttl-three")
    assert status==200 and cache.stats()["expired"]>stale
    cache.ttl=CACHE_TTL_SECONDS
    cache.clear()
    return {"result":"PASS","cross_tenant_rejected":True,
        "expired_jwt_rejected":True,"tampered_jwt_rejected":True,
        "real_rls_checked":True,"original_rpc_membership_denied_other_company":True,
        "offline_and_tamper_failed_closed":True,"recovered_after_outage":True,
        "wrong_aes_key_rejected":True,"ttl_expired_and_refetched":True,
        "http_ack_only_after_json_parity":True}

def cohorts(base,cache,store,server,baseline):
    metrics=[]
    for count in (100,300):
        for phase in ("cold","warm"):
            if phase=="cold":cache.clear()
            idxs=[i%len(baseline) for i in range(count)]
            start=time.perf_counter()
            def invoke(i):
                idx=idxs[i];row=baseline[idx]
                company=uuid.UUID(row["case"]["company"])
                user=v.USER_IDS[v.COMPANIES.index(company)]
                jwt=v.token(company,user)
                result=post(base,idx,jwt,f"{count}-{phase}-{i}")
                code,body,lat=result
                assert code==200,(code,body,idx)
                assert body["verified"] and body["sha256"]==sha(canon(row["result"]))
                return lat,body["bytes_validated"]
            before_obj=store.requests
            before_cache=cache.stats()
            with ThreadPoolExecutor(max_workers=count) as pool:
                results=list(pool.map(invoke,range(count)))
            elapsed=time.perf_counter()-start
            times=[x[0] for x in results]
            bytes_out=sum(x[1] for x in results)
            cache_stats=cache.stats()
            snapshot=server.snapshot()
            assert len(times)==count
            assert cache_stats["max_cache_bytes"]<=2*CACHE_QUOTA_BYTES
            assert all(sz<=CACHE_QUOTA_BYTES for sz in cache_stats["per_tenant_cached_bytes"].values())
            entry={"clients":count,"phase":phase,"result":"PASS",
                "p95_ms":percentile(times,.95),"p99_ms":percentile(times,.99),
                "total_seconds":round(elapsed,3),"success":count,
                "cache_hits_delta":cache_stats["hits"]-before_cache["hits"],
                "cache_misses_delta":cache_stats["misses"]-before_cache["misses"],
                "cache_evictions_delta":cache_stats["evictions"]-before_cache["evictions"],
                "segment_http_get_delta":store.requests-before_obj,
                "validated_result_bytes":bytes_out,
                "max_inflight_pg":snapshot["max_inflight"],
                "max_queue_waiters":snapshot["max_queued"],
                "cache_bytes_end":cache_stats["cache_bytes"],
                "cache_quota_per_company":CACHE_QUOTA_BYTES}
            metrics.append(entry)
            print("QA_CONCURRENT_PHASE_JSON="+canon(entry).decode(),flush=True)
    return metrics

def cost_scenario(db_bytes,archive_bytes,manifest_bytes,ref_bytes,object_gets,outbytes):
    # Hypothetical rates ONLY; NOT current Supabase pricing or estimate of bill.
    gb=1_000_000_000
    rates={"object_gb_month_usd":0.023,"get_1000_usd":0.0004,
           "egress_gb_usd":0.09,"database_gb_month_usd":0.125}
    return {"model":"illustrative_not_supabase_pricing",
            "assumed_unit_rates":rates,
            "monthly_db_usd_at_example_rate":round(db_bytes/gb*rates["database_gb_month_usd"],8),
            "monthly_archive_usd_at_example_rate":round(archive_bytes/gb*rates["object_gb_month_usd"],8),
            "observed_get_cost_usd_at_example_rate":round(object_gets/1000*rates["get_1000_usd"],8),
            "observed_http_result_egress_cost_usd_at_example_rate":round(outbytes/gb*rates["egress_gb_usd"],8),
            "includes_actual_Supabase_Free_quota":False}

def main(archive_dir,key_dir):
    started=time.monotonic()
    manifest_bytes=(archive_dir/"manifest.json").read_bytes()
    manifest=json.loads(manifest_bytes)
    baseline_bytes=(archive_dir/"rpc-baseline.json").read_bytes()
    assert sha(baseline_bytes)==manifest["rpc_baseline_sha256"]
    baseline=json.loads(baseline_bytes)
    assert len(baseline)==48
    key=(key_dir/"synthetic-qa-key").read_bytes()
    assert len(key)==32
    # Existing scaffold preserves 664 original rows; remove event-level CQRS
    # and create only daily aggregates (identical to previous successful QA).
    setup=p.setup()
    p.install_on_demand_rpc()
    with v.con() as c:
        assert v.scalar(c,"SELECT count(*) FROM public.playback_logs")==664
        assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
        assert int(v.scalar(c,"SELECT sum(started) FROM qa_rpc.daily"))==664
    store=p.Store(archive_dir)
    storage=threading.Thread(target=store.serve_forever,daemon=True);storage.start()
    base_store=f"http://127.0.0.1:{store.server_address[1]}"
    cache=BoundedCache(base_store,manifest,key)
    service=ReportGateway(cache,baseline)
    api=threading.Thread(target=service.serve_forever,daemon=True);api.start()
    base=f"http://127.0.0.1:{service.server_address[1]}"
    try:
        fail=test_failures(service,base,store,cache,baseline,key,manifest)
        checks=cohorts(base,cache,store,service,baseline)
        snapshot=service.snapshot()
        cs=cache.stats()
        with v.con() as c:
            size=p.metric(c)
            assert v.scalar(c,"SELECT count(*) FROM public.playback_logs")==664
            assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
            assert int(v.scalar(c,"SELECT sum(started) FROM qa_rpc.daily"))==664
            assert v.scalar(c,"SELECT count(*) FROM qa_rpc.pending_without_time")==2
            source_indexes=int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')"))
            daily_indexes=int(v.scalar(c,"SELECT pg_indexes_size('qa_rpc.daily')"))
            lock_waits=int(v.scalar(c,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'"))
            deadlocks=int(v.scalar(c,"SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()"))
        external=sum(x["encrypted_bytes"] for x in manifest["segments"])
        objects_bytes=external+len(manifest_bytes)+len(baseline_bytes)+len(key)
        grand_total=size["database_bytes"]+objects_bytes
        bytes_validated=sum(x["validated_result_bytes"] for x in checks)
        fail_count=snapshot["denied"]+snapshot["failed"]
        assert fail_count>=5
        assert snapshot["completed"]>=800
        assert snapshot["max_inflight"]<=DB_CONCURRENCY
        assert cs["max_cache_bytes"]<=2*CACHE_QUOTA_BYTES
        assert time.monotonic()-started<RUNNER_TIMEOUT_S
        out={"result":"PASS","clients_tested":[100,300],
          "phases":checks,"security_failure_tests":fail,
          "requests":snapshot["request_count"],"errors_expected":fail_count,
          "completed_json_and_exports":snapshot["completed"],
          "archive_object_http_gets":store.requests,
          "cache":cs,"cache_max_bytes":cs["max_cache_bytes"],
          "pg_permit_max":snapshot["max_inflight"],"pg_queue_max":snapshot["max_queued"],
          "pg_backpressure_timeouts":snapshot["backpressure"],
          "pg_lock_waiters_final_sample":lock_waits,"pg_deadlocks":deadlocks,
          "python_peak_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
          "source_originals_retained":664,"daily_compact_groups":setup["daily_groups"],
          "permanent_extra_event_copies":0,
          "source_index_bytes":source_indexes,"daily_index_bytes":daily_indexes,
          "pg_database_bytes":size["database_bytes"],
          "encrypted_archive_bytes":external,"manifest_bytes":len(manifest_bytes),
          "qa_reference_bytes":len(baseline_bytes),"test_key_bytes":len(key),
          "total_db_plus_all_qa_artifacts_bytes":grand_total,
          "cost_assumptions":cost_scenario(size["database_bytes"],external,len(manifest_bytes),
                         len(baseline_bytes),store.requests,bytes_validated),
          "no_deletion":True,"no_supabase_prod":True}
        print("QA_V2_CONCURRENT_SUMMARY_JSON="+canon(out).decode(),flush=True)
        print("QA_V2_CONCURRENT_COMPACT_CQRS_PASS=true",flush=True)
    finally:
        service.shutdown();service.server_close();api.join(4)
        store.shutdown();store.server_close();storage.join(4)
if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--archive",type=Path,required=True)
    ap.add_argument("--key-dir",type=Path,required=True)
    a=ap.parse_args();main(a.archive,a.key_dir)
