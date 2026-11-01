"""Vision V2: 100/300 concurrent HTTP report/export requests with CQRS daily-only
and encrypted on-demand AES-GCM, tenant TTL/quota cache, bounded DB pool,
synthetic JWT/RLS and failure recovery. GitHub Actions disposable PG17 ONLY.
No second permanent event table. All 664 synthetic originals preserved.
"""
from __future__ import annotations
from collections import OrderedDict,defaultdict
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import date,datetime
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import hashlib, hmac, importlib.util, json, math, os, resource, secrets, threading,time,uuid
from pathlib import Path
from urllib import request,error
import psycopg

BASE=Path(__file__).resolve().parent
SRC=BASE.parent/"compact-ondemand-qa"/"compact.py"
spec=importlib.util.spec_from_file_location("v2_compact_qa",SRC)
compact=importlib.util.module_from_spec(spec);spec.loader.exec_module(compact)
v=compact.v

def canon(obj):return compact.canon(obj)
def p95(xs):return compact.pctl(xs,.95)
def p99(xs):return compact.pctl(xs,.99)

class TenantCache:
    def __init__(self,object_base,key,manifest,quota_bytes=256_000,ttl_seconds=30.0):
        self.base=object_base
        self.key=key
        self.manifest=manifest
        self.limit=quota_bytes;self.ttl=ttl_seconds
        self.locks=defaultdict(threading.RLock)
        self.store=defaultdict(OrderedDict)  # company -> segment filename -> (expiry,rows,bytes)
        self.lock=threading.Lock()
        self.hits=0;self.misses=0;self.evictions=0;self.expired=0
        self.failures=0;self.objects_bytes=0;self.http_gets=0
        self.peak_cache_bytes=0
    def now(self):return time.monotonic()
    def total_size(self):
        return sum(v[2] for entries in self.store.values() for v in entries.values())
    def get(self,company,meta):
        identity=meta["descriptor"]
        tenant=str(company)
        if identity["company"]!=tenant:raise PermissionError("cache_cross_tenant")
        key=meta["file"]
        with self.locks[tenant]:
            current=self.store[tenant]
            item=current.get(key)
            if item and item[0]>self.now():
                current.move_to_end(key)
                with self.lock:self.hits+=1
                return item[1]
            if item:
                del current[key]
                with self.lock:self.expired+=1
            for attempt in range(3):
                with self.lock:self.http_gets+=1
                try:
                    with request.urlopen(self.base+"/"+key,timeout=8) as reply:
                        body=reply.read()
                    rows=compact.decrypt(self.key,meta,body)
                    break
                except Exception:
                    with self.lock:self.failures+=1
                    if attempt>=2:raise
                    time.sleep(.04*(attempt+1))
            weight=len(canon(rows))
            with self.lock:
                self.misses+=1
                self.objects_bytes+=len(body)
            if weight<=self.limit:
                used=sum(entry[2] for entry in current.values())
                while current and used+weight>self.limit:
                    _,victim=current.popitem(last=False)
                    used-=victim[2]
                    with self.lock:self.evictions+=1
                current[key]=(self.now()+self.ttl,rows,weight)
                with self.lock:self.peak_cache_bytes=max(self.peak_cache_bytes,self.total_size())
            return rows
    def select(self,company,begin,end):
        selected=[]
        for m in self.manifest["segments"]:
            descriptor=m["descriptor"]
            if descriptor["company"]!=str(company):continue
            day=date.fromisoformat(descriptor["local_day"])
            if begin<=day<=end:selected.extend(self.get(company,m))
        return selected
    def stats(self):
        with self.lock:
            return {x:getattr(self,x) for x in
              ("hits","misses","evictions","expired","failures","objects_bytes",
               "http_gets","peak_cache_bytes")} | {
                "per_tenant_current_bytes":{k:sum(x[2] for x in val.values()) for k,val in self.store.items()},
                "ttl_seconds":self.ttl,"quota_bytes_per_tenant":self.limit}

class FileServer(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,archive_dir):
        super().__init__(("127.0.0.1",0),FileHandler)
        self.archive_dir=archive_dir;self.mu=threading.Lock()
        self.fail_once=set();self.requests=0;self.bytes=0;self.failures=0
class FileHandler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        name=self.path.removeprefix("/")
        with self.server.mu:
            self.server.requests+=1
            if name in self.server.fail_once:
                self.server.fail_once.remove(name)
                self.server.failures+=1
                self.send_response(503);self.end_headers()
                return
        if name not in {p.name for p in self.server.archive_dir.glob("*.v2qa")}:
            self.send_response(404);self.end_headers();return
        body=(self.server.archive_dir/name).read_bytes()
        with self.server.mu:self.server.bytes+=len(body)
        self.send_response(200);self.send_header("Content-Length",str(len(body)))
        self.end_headers();self.wfile.write(body)

class HTTPGateway(ThreadingHTTPServer):
    daemon_threads=True;request_queue_size=512
    def __init__(self,rows,cache,sql_permits=12,queue_permits=320):
        super().__init__(("127.0.0.1",0),ReportHandler)
        self.rows=rows;self.cache=cache
        self.sql=threading.BoundedSemaphore(sql_permits)
        self.queue=threading.BoundedSemaphore(queue_permits)
        self.lock=threading.Lock()
        self.sessions=0;self.peak_sessions=0;self.waiting=0;self.peak_waiting=0
        self.posts=0;self.rejections=0;self.errors=0
        self.app_response_bytes=0;self.app_inbound_bytes=0
        self.sql_permits=sql_permits
    def load(self,case):
        index=case["index"];mode=case["mode"]
        item=self.rows[index]["case"]
        company=uuid.UUID(item["company"])
        begin=date.fromisoformat(item["start"]);end=date.fromisoformat(item["end"])
        campaign=uuid.UUID(item["campaign"]) if item["campaign"] else None
        device=uuid.UUID(item["device"]) if item["device"] else None
        with self.lock:
            self.waiting+=1
            self.peak_waiting=max(self.peak_waiting,self.waiting)
        if not self.sql.acquire(timeout=65):
            with self.lock:self.waiting-=1
            raise TimeoutError("db_backpressure_timeout")
        with self.lock:
            self.waiting-=1;self.sessions+=1
            self.peak_sessions=max(self.sessions,self.peak_sessions)
        try:
            segment_rows=self.cache.select(company,begin,end)
            with v.con() as c:
                compact.load_table(c,segment_rows)
                with c.transaction():
                    auth=v.decode(case["jwt"])
                    v.auth(c,auth) # transaction-scoped synthetic auth role/claims
                    # RLS is actually enabled on qa_rpc.daily, postgres role authenticated.
                    visible=v.scalar(c,"SELECT count(*) FROM qa_rpc.daily")
                    assert visible>0
                    other=v.COMPANIES[1-v.COMPANIES.index(company)]
                    assert v.scalar(c,"SELECT count(*) FROM qa_rpc.daily WHERE company_id=%s",(other,))==0
                    assert v.scalar(c,"SELECT count(*) FROM pg_temp.qa_ondemand_events WHERE company_id<>%s",(company,))==0
                    if mode=="report":
                        output=v.rpc(c,"get_playback_report_ondemand",company,begin,end,campaign,device)
                        expected=self.rows[index]["result"]["report"]
                    else:
                        output=[list(x) for x in v.export(c,"get_playback_events_ondemand",company,begin,end,campaign,device,limit=1000)]
                        expected=self.rows[index]["result"]["export"]
                    if canon(output)!=canon(expected):
                        raise AssertionError("full_rpc_json_mismatch")
                    return output
        finally:
            with self.lock:self.sessions-=1
            self.sql.release()

class ReportHandler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def answer(self,status,body):
        raw=canon(body)
        with self.server.lock:self.server.app_response_bytes+=len(raw)
        self.send_response(status);self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(raw)));self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_POST(self):
        with self.server.lock:self.server.posts+=1
        if self.path!="/qa/report":return self.answer(404,{"error":"unknown_endpoint"})
        if not self.server.queue.acquire(timeout=1):
            with self.server.lock:self.server.rejections+=1
            return self.answer(429,{"error":"backpressure"})
        try:
            count=int(self.headers.get("Content-Length","-1"))
            if count<=0 or count>2000:
                return self.answer(400,{"error":"bad_body"})
            data=self.rfile.read(count)
            with self.server.lock:self.server.app_inbound_bytes+=len(data)
            body=json.loads(data)
            if set(body)!={"index","mode","jwt"} or body["mode"] not in ("report","export"):
                return self.answer(400,{"error":"schema"})
            if not isinstance(body["index"],int) or not 0<=body["index"]<48:
                return self.answer(400,{"error":"index"})
            claims=v.decode(body["jwt"])
            expected=self.server.rows[body["index"]]["case"]
            if claims["company_id"]!=expected["company"] or claims["sub"]!=v.USER_IDS[v.COMPANIES.index(uuid.UUID(expected["company"]))]:
                with self.server.lock:self.server.rejections+=1
                return self.answer(403,{"error":"wrong_company"})
            output=self.server.load(body)
            return self.answer(200,output)
        except PermissionError:
            with self.server.lock:self.server.rejections+=1
            return self.answer(401,{"error":"jwt"})
        except (ValueError,KeyError):
            with self.server.lock:self.server.rejections+=1
            return self.answer(409,{"error":"bad_payload"})
        except Exception as exc:
            with self.server.lock:self.server.errors+=1
            return self.answer(503,{"error":"temporarily_unavailable"})
        finally:self.server.queue.release()

def submit(url,request_body,timeout=85):
    data=canon(request_body)
    req=request.Request(url,data=data,method="POST",
                        headers={"Content-Type":"application/json"})
    start=time.perf_counter()
    try:
        with request.urlopen(req,timeout=timeout) as response:
            received=response.read()
            return response.status,json.loads(received),(time.perf_counter()-start)*1000,len(received)
    except error.HTTPError as exc:
        raw=exc.read()
        return exc.code,json.loads(raw),(time.perf_counter()-start)*1000,len(raw)

def negative(gateway,cache,manifest,file_server):
    url=f"http://127.0.0.1:{gateway.server_address[1]}/qa/report"
    a=0;co=v.COMPANIES[a];case=gateway.rows[0]["case"]
    payload={"index":0,"mode":"report","jwt":v.token(co,v.USER_IDS[a])}
    wrong={"index":24,"mode":"report","jwt":payload["jwt"]}
    assert submit(url,wrong)[0]==403
    assert submit(url,{"index":0,"mode":"report","jwt":v.token(co,v.USER_IDS[a],ttl=-5)})[0]==401
    forged=payload["jwt"][:-4]+"AAAA"
    assert submit(url,{"index":0,"mode":"report","jwt":forged})[0]==401
    assert submit(url,{"index":999,"mode":"report","jwt":payload["jwt"]})[0]==400
    # Cross tenant can never request an encrypted segment belonging to other company.
    foreign=next(x for x in manifest["segments"] if x["descriptor"]["company"]!=str(co))
    try:cache.get(co,foreign)
    except PermissionError:pass
    else:raise AssertionError("cross_tenant_cache_access")
    # Faults must reject silently corrupted objects, with recovery after restore.
    first=next(x for x in manifest["segments"] if x["descriptor"]["company"]==str(co))
    filename=first["file"]
    previous=(file_server.archive_dir/filename).read_bytes()
    try:
        altered=bytearray(previous);altered[len(altered)//2]^=16
        (file_server.archive_dir/filename).write_bytes(altered)
        try:cache.get(co,first)
        except Exception:pass
        else:raise AssertionError("tampered_archive_accepted")
    finally:(file_server.archive_dir/filename).write_bytes(previous)
    try:compact.decrypt(secrets.token_bytes(32),first,previous)
    except Exception:pass
    else:raise AssertionError("wrong_key_accepted")
    file_server.fail_once.add(filename)
    cache.get(co,first) # internal HTTP retry after injected 503
    # TTL explicitly tested independently of stress.
    temp=TenantCache(cache.base,cache.key,manifest,quota_bytes=256000,ttl_seconds=.1)
    temp.get(co,first)
    original_miss=temp.misses
    temp.get(co,first);assert temp.hits==1
    time.sleep(.13)
    temp.get(co,first);assert temp.misses==original_miss+1 and temp.expired==1
    # Quota forces refusal to retain outsized segments; a request still succeeds.
    tight=TenantCache(cache.base,cache.key,manifest,quota_bytes=256,ttl_seconds=10)
    tight.get(co,first)
    assert tight.total_size()<=256
    assert temp.total_size()<=256000
    return {"result":"PASS","forged_jwt_rejected":True,"expired_jwt_rejected":True,
        "cross_company_rejected":True,"cross_company_cache_access_denied":True,
        "damaged_archive_rejected":True,"wrong_key_rejected":True,
        "network_503_retried":True,"ttl_expiry_refetched":True,"tiny_quota_observed":True}

def run_cohort(n,gateway,wave,clients):
    url=f"http://127.0.0.1:{gateway.server_address[1]}/qa/report"
    lock=threading.Lock()
    latencies=[];out_bytes=0;attempts=0;http_errors=0;failures=[]
    start=time.perf_counter()
    def client(i):
        company_no=i%2
        case_index=(i//2*7+wave)%24+company_no*24
        mode="report" if (i+wave)%2==0 else "export"
        body={"index":case_index,"mode":mode,
              "jwt":v.token(v.COMPANIES[company_no],v.USER_IDS[company_no])}
        samples=[]
        for j in range(18):
            try:status,output,ms,size=submit(url,body)
            except (TimeoutError,error.URLError,ConnectionResetError):
                status,output,ms,size=599,{},0.0,0
            samples.append(ms)
            if status==200:
                expected=gateway.rows[case_index]["result"][mode]
                assert canon(output)==canon(expected),("http_payload_mismatch",n,i,case_index)
                return samples,j,sum(x>0 for x in samples)-1,size
            if status not in (429,503,599):
                raise AssertionError(f"unexpected_status_{status}")
            time.sleep(min(.08*(j+1),.6))
        raise AssertionError(f"unrecovered_client_{n}_{i}")
    with ThreadPoolExecutor(max_workers=n) as pool:
        futures=[pool.submit(client,i) for i in range(n)]
        for f in as_completed(futures):
            try:
                samples,tries,err,count=f.result()
                latencies.extend(samples);attempts+=tries;http_errors+=err;out_bytes+=count
            except Exception as exc:failures.append(str(exc))
    if failures:raise AssertionError(str(failures[:5]))
    return {"result":"PASS","clients_concurrent":n,"wave":wave,
        "requests_accepted":n,"response_bytes_to_clients":out_bytes,
        "p95_http_ms":p95(latencies),"p99_http_ms":p99(latencies),
        "wall_s":round(time.perf_counter()-start,2),
        "retries":attempts,"latency_samples":len(latencies)}

def main():
    from tempfile import TemporaryDirectory
    with TemporaryDirectory(prefix="vision-v2-http-qa-") as tmp:
        folder=Path(tmp)/"archive";keys=Path(tmp)/"keys"
        compact.producer(folder,keys)
        manifest=json.loads((folder/"manifest.json").read_text())
        baseline=json.loads((folder/"rpc-baseline.json").read_text())
        assert len(baseline)==48
        compact.install_on_demand_rpc()
        fs=FileServer(folder);fth=threading.Thread(target=fs.serve_forever,daemon=True);fth.start()
        cache=TenantCache(f"http://127.0.0.1:{fs.server_address[1]}",
             (keys/"synthetic-qa-key").read_bytes(),manifest)
        gate=HTTPGateway(baseline,cache)
        gth=threading.Thread(target=gate.serve_forever,daemon=True);gth.start()
        results=[]
        try:
            check=negative(gate,cache,manifest,fs)
            print("QA_HTTP_CACHE_SECURITY_JSON="+canon(check).decode(),flush=True)
            # enforce true cold start after negative tests; warm second wave
            cache.store.clear()
            for n in (100,300):
                r=run_cohort(n,gate,0,range(n))
                results.append(r)
                print("QA_HTTP_COHORT_JSON="+canon(r).decode(),flush=True)
                r=run_cohort(n,gate,1,range(n))
                results.append(r)
                print("QA_HTTP_COHORT_JSON="+canon(r).decode(),flush=True)
            with v.con() as c:
                dbbytes=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
                idx=int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')"))
                dailyidx=int(v.scalar(c,"SELECT pg_indexes_size('qa_rpc.daily')"))
                assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
                assert int(v.scalar(c,"SELECT count(*) FROM public.playback_logs"))==664
                assert int(v.scalar(c,"SELECT sum(started) FROM qa_rpc.daily"))==664
            cache_stats=cache.stats()
            assert all(size<=cache.limit for size in cache_stats["per_tenant_current_bytes"].values())
            assert cache_stats["hits"]>0 and cache_stats["misses"]>0
            # All PAYLOADS were compared to exact baseline JSON, not hashes only.
            with gate.lock:
                info={"posts":gate.posts,"http_4xx":gate.rejections,
                      "http_5xx":gate.errors,"max_sql_connections":gate.peak_sessions,
                      "max_sql_queue_depth":gate.peak_waiting,
                      "request_bytes":gate.app_inbound_bytes,
                      "response_bytes":gate.app_response_bytes}
            total_blob=sum(x["encrypted_bytes"] for x in manifest["segments"])
            manifest_size=(folder/"manifest.json").stat().st_size
            baseline_size=(folder/"rpc-baseline.json").stat().st_size
            costs={"assumptions_only_usd_per_gb_month":.025,
                   "assumptions_only_usd_per_1000_get":.0004,
                   "assumptions_only_usd_per_gb_egress":.09,
                   "archive_storage_usd_month":round(total_blob/1e9*.025,8),
                   "object_get_usd":round(fs.requests/1000*.0004,8),
                   "http_egress_usd":round(info["response_bytes"]/1e9*.09,8)}
            outcome={"result":"PASS","clients_tested":[100,300],
              "total_http_successful":sum(x["requests_accepted"] for x in results),
              "p95_worst_wave_ms":max(x["p95_http_ms"] for x in results),
              "p99_worst_wave_ms":max(x["p99_http_ms"] for x in results),
              "http_gateway":info,"object_get_count":fs.requests,
              "object_bytes_delivered":fs.bytes,"object_failed_gets":fs.failures,
              "cache":cache_stats,"python_peak_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              "db_bytes":dbbytes,"raw_index_bytes":idx,"daily_index_bytes":dailyidx,
              "encrypted_archive_bytes":total_blob,"manifest_bytes":manifest_size,
              "test_reference_bytes":baseline_size,
              "total_db_plus_object_plus_manifest_plus_test_ref_bytes":
                   dbbytes+total_blob+manifest_size+baseline_size+32,
              "assumed_costs_NOT_real_cloud_prices":costs,
              "original_rows_untouched":664,"daily_summary_only":True,
              "second_permanent_event_table":False,"full_report_and_export_JSON_verified":True,
              "no_net_saving_with_originals_retained":True}
            print("QA_HTTP_CONCURRENT_FINAL_JSON="+canon(outcome).decode(),flush=True)
        finally:
            gate.shutdown();gate.server_close();gth.join(5)
            fs.shutdown();fs.server_close();fth.join(5)
if __name__=="__main__":main()
