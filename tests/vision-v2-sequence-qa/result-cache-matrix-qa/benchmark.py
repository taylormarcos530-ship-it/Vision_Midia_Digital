"""Vision V2 result-cache matrix: 110KB / 512KB / 2MB, 100/300 HTTP queries.
Original GitHub RPC SQL + commercial export parity verified on cache fills;
hot responses are stored canonical full JSON/export bytes, not only digests.
Read only synthetic source rows; PG17 disposable, no production deploy.
"""
from __future__ import annotations
from collections import defaultdict,OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
import argparse,hashlib,hmac,json,math,resource,secrets,threading,time,uuid
import psycopg
from urllib import request,error
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
import importlib.util

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location("v2_concurrent_prior",ROOT/"concurrent-ondemand-qa"/"benchmark.py")
prior=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(prior)
v=prior.v
p=prior.p
CACHE_TTL=90.0
QUOTAS=(110_000,512_000,2_000_000)
PG_PERMITS=12
def dump(data):return p.canon(data)
def sha(b):return hashlib.sha256(b).hexdigest()
def pctl(a,n):
    z=sorted(a);return round(z[math.ceil(n*len(z))-1],3)

class ResultCache:
    def __init__(self,quota,ttl):
        self.quota=quota;self.ttl=ttl
        self.items=defaultdict(OrderedDict);self.bytes=defaultdict(int)
        self.mutex=threading.RLock()
        self.per_key=defaultdict(threading.Lock)
        self.hits=0;self.misses=0;self.evicted=0;self.expired=0;self.uncacheable=0
        self.peak=0
    def clear(self,company=None):
        with self.mutex:
            if company is None:
                self.items.clear();self.bytes.clear()
            else:
                self.items.pop(company,None);self.bytes.pop(company,None)
    def hit(self,company,key):
        with self.mutex:
            obj=self.items[company].get(key)
            if obj is None:
                self.misses+=1;return None
            deadline,body,size=obj
            if time.monotonic()>=deadline:
                self.items[company].pop(key,None)
                self.bytes[company]-=size;self.expired+=1;self.misses+=1
                return None
            self.items[company].move_to_end(key)
            self.hits+=1
            return body
    def put(self,company,key,body):
        size=len(body)
        with self.mutex:
            if size>self.quota:
                self.uncacheable+=1;return False
            bucket=self.items[company]
            if key in bucket:
                _,_,previous=bucket.pop(key)
                self.bytes[company]-=previous
            while bucket and size+self.bytes[company]>self.quota:
                _,(_,_,ev_size)=bucket.popitem(last=False)
                self.bytes[company]-=ev_size
                self.evicted+=1
            bucket[key]=(time.monotonic()+self.ttl,body,size)
            self.bytes[company]+=size
            if self.bytes[company]>self.quota:raise AssertionError("cache_tenant_quota")
            self.peak=max(self.peak,sum(self.bytes.values()))
            return True
    def snapshot(self):
        with self.mutex:
            return {"hits":self.hits,"misses":self.misses,"evictions":self.evicted,
                    "expired":self.expired,"oversize_skip":self.uncacheable,
                    "peak_total_bytes":self.peak,"current_per_tenant_bytes":dict(self.bytes),
                    "entries":sum(map(len,self.items.values()))}

class CacheAPI(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=512
    def __init__(self,archive,ref,quota):
        super().__init__(("127.0.0.1",0),Handler)
        self.archive=archive;self.baseline=ref
        self.cache=ResultCache(quota,CACHE_TTL)
        self.sem=threading.BoundedSemaphore(PG_PERMITS)
        self.mx=threading.RLock()
        self.revision={str(c):1 for c in v.COMPANIES}
        self.requests=0;self.approved=0;self.denied=0;self.failed=0
        self.db_misses=0;self.max_inflight=0;self.inflight=0
        self.waiters=0;self.max_waiters=0;self.queue_timeout=0
        self.acked=set()
    def auth_guard(self,claim,company):
        # Optional hook used by the two-replica isolated QA only.
        return None
    def snapshot(self):
        with self.mx:
            return {k:getattr(self,k) for k in
                    ("requests","approved","denied","failed","db_misses",
                     "max_inflight","max_waiters","queue_timeout")}
    def bump(self,company):
        with v.con() as c:
            with c.transaction():
                row=c.execute("""UPDATE qa_cache_revision
                   SET version=version+1 WHERE company_id=%s
                   RETURNING version""",(company,)).fetchone()
                assert row is not None
                version=row[0]
        with self.mx:self.revision[str(company)]=version
        self.cache.clear(str(company))
        return version
    def compute(self,idx,token,reqid):
        # Authenticate BEFORE any result cache access.
        claim=v.decode(token)
        reference=self.baseline[idx];case=reference["case"]
        company=case["company"]
        if claim["company_id"]!=company:
            raise PermissionError("tenant_cross")
        user=v.USER_IDS[v.COMPANIES.index(uuid.UUID(company))]
        if claim["sub"]!=user:raise PermissionError("wrong_user")
        with self.mx:
            self.auth_guard(claim,company)
            revision=self.revision[company]
        key=(case["start"],case["end"],case["campaign"],case["device"],revision)
        with self.cache.mutex: single=self.cache.per_key[(company,key)]
        # Singleflight ensures 300 identical concurrent requests cannot
        # cause 300 duplicate expensive decrypt/report operations.
        with single:
            body=self.cache.hit(company,key)
            if body is None:
                begin=date.fromisoformat(case["start"]);end=date.fromisoformat(case["end"])
                campaign=uuid.UUID(case["campaign"]) if case["campaign"] else None
                device=uuid.UUID(case["device"]) if case["device"] else None
                # Archive integrity/unavailability is a transient backend
                # failure, not an invalid request. Return 503 with no ACK.
                try:
                    archive_rows=self.archive.select(company,begin,end)
                except Exception as exc:
                    raise OSError("archive_missing_or_invalid") from exc
                with self.mx:
                    self.waiters+=1;self.max_waiters=max(self.waiters,self.max_waiters)
                acquired=self.sem.acquire(timeout=45)
                with self.mx:
                    self.waiters-=1
                    if acquired:
                        self.inflight+=1
                        self.max_inflight=max(self.max_inflight,self.inflight)
                    else:self.queue_timeout+=1
                if not acquired:raise TimeoutError("pg_backpressure")
                try:
                    with v.con() as c:
                        p.load_table(c,archive_rows)
                        with c.transaction():
                            v.auth(c,claim)
                            assert v.scalar(c,"SELECT count(*) FROM pg_temp.qa_ondemand_events WHERE company_id<>%s",(uuid.UUID(company),))==0
                            obj=v.rpc(c,"get_playback_report_ondemand",uuid.UUID(company),begin,end,campaign,device)
                            exported=v.export(c,"get_playback_events_ondemand",uuid.UUID(company),begin,end,campaign,device,limit=1000)
                            result={"report":obj,"export":[list(r) for r in exported]}
                            body=dump(result)
                            if not hmac.compare_digest(sha(body),sha(dump(reference["result"]))):
                                raise ValueError("full_json_parity")
                    with self.mx:self.db_misses+=1
                    self.cache.put(company,key,body)
                finally:
                    with self.mx:self.inflight-=1
                    self.sem.release()
        with self.mx:
            # Fail closed for an invalidation/revocation racing a cache fill.
            if self.revision[company]!=revision:
                raise OSError("revision_changed_during_request")
            self.auth_guard(claim,company)
            self.approved+=1
            self.acked.add((company,reqid))
        return {"verified":True,"sha256":sha(body),"request_id":reqid,
                "revision":revision,"json_bytes":len(body)}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def send(self,status,obj):
        b=dump(obj)
        self.send_response(status);self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(b)));self.end_headers();self.wfile.write(b)
    def do_POST(self):
        with self.server.mx:self.server.requests+=1
        if self.path!="/qa/report":return self.send(404,{"error":"path"})
        try:
            n=int(self.headers.get("Content-Length","-1"))
            if n<2 or n>3000:raise ValueError("length")
            data=json.loads(self.rfile.read(n))
            if set(data)!={"case_id","request_id"}:raise ValueError("envelope")
            idx=data["case_id"]
            if type(idx) is not int or not 0<=idx<len(self.server.baseline):raise ValueError("idx")
            reqid=data["request_id"]
            if not isinstance(reqid,str) or not 1<=len(reqid)<=90:raise ValueError("reqid")
            token=self.headers.get("Authorization","").removeprefix("Bearer ")
            result=self.server.compute(idx,token,reqid)
            return self.send(200,result)
        except PermissionError:
            with self.server.mx:self.server.denied+=1
            return self.send(401,{"error":"unauthorized"})
        except (ValueError,KeyError,IndexError):
            with self.server.mx:self.server.denied+=1
            return self.send(409,{"error":"rejected"})
        except Exception:
            with self.server.mx:self.server.failed+=1
            return self.send(503,{"error":"archive_or_sql_unavailable"})

def post(base,idx,token,reqid):
    data=dump({"case_id":idx,"request_id":reqid})
    r=request.Request(base+"/qa/report",data=data,method="POST",
                      headers={"Content-Type":"application/json","Authorization":"Bearer "+token})
    start=time.perf_counter()
    try:
        with request.urlopen(r,timeout=70) as response:
            code=response.status;payload=json.loads(response.read())
    except error.HTTPError as e:
        code=e.code;payload=json.loads(e.read())
    return code,payload,(time.perf_counter()-start)*1000

def preflight(api,store,base,ref):
    case=ref[0]["case"];co=case["company"]
    valid=v.token(uuid.UUID(co),v.USER_IDS[0])
    def success(key):
        code,obj,_=post(base,0,valid,key)
        assert code==200 and obj["verified"] and obj["sha256"]==sha(dump(ref[0]["result"]))
        return obj
    success("preflight-valid")
    for forged in (v.token(v.COMPANIES[1],v.USER_IDS[1]),
                   v.token(v.COMPANIES[0],v.USER_IDS[0],ttl=-1),
                   valid[:-6]+"AAAAAA"):
        assert post(base,0,forged,"unauthorized")[0]==401
    # Original invoker RPC + native PostgreSQL RLS enforce tenant.
    with v.con() as c:
        with c.transaction():
            v.auth(c,v.decode(valid))
            assert v.scalar(c,"SELECT count(*) FROM public.playback_logs WHERE company_id=%s",(v.COMPANIES[1],))==0
            assert v.scalar(c,"SELECT count(*) FROM qa_rpc.daily WHERE company_id=%s",(v.COMPANIES[1],))==0
            try:v.rpc(c,"get_playback_report",v.COMPANIES[1],v.DAYS[0],v.DAYS[2])
            except psycopg.Error as ex:assert ex.sqlstate=="42501"
            else:raise AssertionError("company_RLS_broken")
    # Evict a previously valid result to prove archive failure is fail closed,
    # not hidden by existing cache. No ACK on failed request.
    target=next(x for x in api.archive.manifest["segments"] if x["descriptor"]["company"]==co and x["descriptor"]["local_day"]==case["start"])
    name=target["file"]
    api.cache.clear(co);api.archive.clear()
    with store.lock:store.offline.add(name)
    try:
        before=api.snapshot()["approved"]
        assert post(base,0,valid,"file-offline")[0]==503
        assert api.snapshot()["approved"]==before
        assert (co,"file-offline") not in api.acked
    finally:
        with store.lock:store.offline.clear()
    success("file-recovered")
    # AES-GCM wrong key and tamper must fail on cache miss.
    blob=(store.folder/name).read_bytes()
    try:p.decrypt(secrets.token_bytes(32),target,blob)
    except Exception:pass
    else:raise AssertionError("incorrect_aes_key_passed")
    api.cache.clear(co);api.archive.clear()
    corrupted=bytearray(blob);corrupted[len(corrupted)//2]^=1
    (store.folder/name).write_bytes(corrupted)
    try:assert post(base,0,valid,"file-tampered")[0]==503
    finally:(store.folder/name).write_bytes(blob)
    success("tamper-recovered")
    # Force TTL expiry even if quota cannot hold more than one result.
    api.cache.clear(co);api.cache.ttl=.05
    api.archive.clear()
    success("ttl-first")
    s=api.cache.snapshot()
    success("ttl-hit")
    if api.cache.snapshot()["hits"]<=s["hits"]:
        # 110 KB may legitimately reject oversize entries, but fixture
        # for case0 should still be small enough to cache.
        raise AssertionError("TTL_hit_not_cached")
    time.sleep(.075)
    old=api.cache.snapshot()["expired"]
    success("ttl-expired")
    assert api.cache.snapshot()["expired"]>old
    api.cache.ttl=CACHE_TTL
    # Revision is committed in disposable PG17, then atomically
    # invalidates only that tenant. Output remains same (no content edit).
    success("rev-prefill")
    previous=api.cache.snapshot()["misses"]
    new_rev=api.bump(uuid.UUID(co))
    assert new_rev==2
    revised=success("rev-new")
    assert revised["revision"]==2
    assert api.cache.snapshot()["misses"]>previous
    with v.con() as c:
        assert v.scalar(c,"SELECT version FROM qa_cache_revision WHERE company_id=%s",(uuid.UUID(co),))==2
    api.cache.clear();api.archive.clear()
    return {"result":"PASS","jwt_cross_tenant_rejected":True,
       "jwt_expired_rejected":True,"jwt_tampered_rejected":True,
       "postgres_RLS_checked":True,"original_rpc_membership_checked":True,
       "archive_503_fail_closed":True,"archive_tamper_rejected":True,
       "aes_wrong_key_rejected":True,"ttl_hit_and_expiration":True,
       "revision_transactional_bump_and_invalidate":True,
       "ack_only_after_full_json":True}

def waves(api,base,store,quota,baseline):
    metrics=[]
    for n in (100,300):
        # Every scenario has one cold and one immediate warm burst.
        # All 48 filter keys repeat, and same tenant never shares a key
        # with a different tenant.
        for phase in ("cold","warm"):
            if phase=="cold":
                api.cache.clear()
            # Reset archive cache so only the new result cache can save GETs.
            api.archive.clear()
            before_gets=store.requests
            prior_c=api.cache.snapshot()
            prior_api=api.snapshot()
            t0=time.perf_counter()
            def job(i):
                idx=i%len(baseline);row=baseline[idx]
                company=uuid.UUID(row["case"]["company"])
                user=v.USER_IDS[v.COMPANIES.index(company)]
                token=v.token(company,user)
                code,result,lat=post(base,idx,token,f"q{quota}-n{n}-{phase}-{i}")
                assert code==200,(code,idx,result)
                assert result["sha256"]==sha(dump(row["result"]))
                return lat
            with ThreadPoolExecutor(max_workers=n) as pool:
                values=list(pool.map(job,range(n)))
            elapsed=time.perf_counter()-t0
            stat=api.cache.snapshot();stat2=api.snapshot()
            assert len(values)==n
            assert stat["peak_total_bytes"]<=2*quota
            assert all(x<=quota for x in stat["current_per_tenant_bytes"].values())
            info={"quota_bytes_per_tenant":quota,"clients":n,"phase":phase,
              "result":"PASS","p95_http_ms":pctl(values,.95),
              "p99_http_ms":pctl(values,.99),
              "elapsed_sec":round(elapsed,3),
              "success":n,
              "cache_hit_delta":stat["hits"]-prior_c["hits"],
              "cache_miss_delta":stat["misses"]-prior_c["misses"],
              "cache_eviction_delta":stat["evictions"]-prior_c["evictions"],
              "cache_oversize_skip_delta":stat["oversize_skip"]-prior_c["oversize_skip"],
              "db_rpcs_delta":stat2["db_misses"]-prior_api["db_misses"],
              "archive_gets_delta":store.requests-before_gets,
              "peak_cache_bytes":stat["peak_total_bytes"],
              "max_sql_active":stat2["max_inflight"],
              "max_gateway_queue":stat2["max_waiters"],
              "timeouts":stat2["queue_timeout"]}
            print("QA_RESULT_CACHE_PHASE_JSON="+dump(info).decode(),flush=True)
            metrics.append(info)
    return metrics

def one_quota(quota,manifest,key,baseline,store):
    url=f"http://127.0.0.1:{store.server_address[1]}"
    archive=prior.BoundedCache(url,manifest,key,quota=quota,ttl=CACHE_TTL)
    api=CacheAPI(archive,baseline,quota)
    worker=threading.Thread(target=api.serve_forever,daemon=True)
    worker.start()
    try:
        safety=preflight(api,store,f"http://127.0.0.1:{api.server_address[1]}",baseline)
        metrics=waves(api,f"http://127.0.0.1:{api.server_address[1]}",store,quota,baseline)
        stat=api.snapshot();c=api.cache.snapshot()
        assert stat["max_inflight"]<=PG_PERMITS
        assert stat["queue_timeout"]==0
        assert stat["approved"]>=800
        segment=archive.stats()
        assert segment["max_cache_bytes"]<=2*quota
        assert all(x<=quota for x in segment["per_tenant_cached_bytes"].values())
        return {"quota":quota,"safety":safety,"phases":metrics,"service":stat,
                "cache":c,"segment_cache":segment}
    finally:
        api.shutdown();api.server_close();worker.join(4)

def run(archive_dir,key_dir):
    manifest=json.loads((archive_dir/"manifest.json").read_bytes())
    baseline_bytes=(archive_dir/"rpc-baseline.json").read_bytes()
    assert sha(baseline_bytes)==manifest["rpc_baseline_sha256"]
    baseline=json.loads(baseline_bytes);assert len(baseline)==48
    key=(key_dir/"synthetic-qa-key").read_bytes();assert len(key)==32
    setup=p.setup();p.install_on_demand_rpc()
    with v.con() as c:
        c.execute("""CREATE TABLE qa_cache_revision (
          company_id uuid PRIMARY KEY,
          version bigint NOT NULL DEFAULT 1 CHECK(version>=1))""")
        c.cursor().executemany("INSERT INTO qa_cache_revision(company_id) VALUES(%s)",
                            [(x,) for x in v.COMPANIES])
        assert v.scalar(c,"SELECT count(*) FROM public.playback_logs")==664
        assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
    store=p.Store(archive_dir)
    thread=threading.Thread(target=store.serve_forever,daemon=True);thread.start()
    try:
        cohorts=[]
        for quota in QUOTAS:
            result=one_quota(quota,manifest,key,baseline,store)
            cohorts.append(result)
            # Each quota has an independent tenant revision test starting 1.
            with v.con() as c:
                c.execute("UPDATE qa_cache_revision SET version=1")
        with v.con() as c:
            raw=v.scalar(c,"SELECT count(*) FROM public.playback_logs")
            daily=v.scalar(c,"SELECT sum(started) FROM qa_rpc.daily")
            indexes={"raw":int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')")),
               "daily":int(v.scalar(c,"SELECT pg_indexes_size('qa_rpc.daily')"))}
            size=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
            assert raw==daily==664
            assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
        encrypted=sum(x["encrypted_bytes"] for x in manifest["segments"])
        totals=size+encrypted+(archive_dir/"manifest.json").stat().st_size+len(baseline_bytes)+len(key)
        assert len(cohorts)==3 and all(len(x["phases"])==4 for x in cohorts)
        out={"result":"PASS","isolated_postgres17":True,"original_events":raw,
            "daily_groups":setup["daily_groups"],"permanent_second_event_table":False,
            "quota_results":cohorts,"indexes_bytes":indexes,
            "pg_database_bytes":size,"encrypted_archive_bytes":encrypted,
            "manifest_bytes":(archive_dir/"manifest.json").stat().st_size,
            "qa_reference_bytes":len(baseline_bytes),
            "synthetic_key_bytes":len(key),
            "total_storage_including_qa_reference_bytes":totals,
            "http_archive_gets_total":store.requests,
            "python_peak_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "cost_model":"No production pricing assumed; use measured bytes/GET counts only",
            "no_prod_sql":True,"no_delete":True}
        print("QA_RESULT_CACHE_MATRIX_SUMMARY_JSON="+dump(out).decode(),flush=True)
        print("QA_RESULT_CACHE_MATRIX_PASS=true",flush=True)
    finally:
        store.shutdown();store.server_close();thread.join(4)
if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--archive",type=Path,required=True)
    ap.add_argument("--key-dir",type=Path,required=True)
    a=ap.parse_args();run(a.archive,a.key_dir)
