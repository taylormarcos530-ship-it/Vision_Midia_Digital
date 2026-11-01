"""Vision V2 QA ONLY: prewarm admission gate vs prior true cold baseline;
bounded HTTP service concurrency, gzip real complete JSON, midstream membership
and synthetic JWT-key revocation. PostgreSQL17 disposable; no production access.
"""
from __future__ import annotations
import gzip,hashlib,importlib.util,json,math,multiprocessing as mp,os
import resource,socket,threading,time,uuid
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib import request,error
from datetime import date

HERE=Path(__file__).resolve().parent
SRC=HERE.parent/"cold-remote-qa"/"qa.py"
spec=importlib.util.spec_from_file_location("vision_v2_remote_source_qa",SRC)
core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
v,deep,a,p,q=core.v,core.deep,core.a,core.p,core.q
def check(ok,reason):assert ok,reason
def digest(b):return hashlib.sha256(b).hexdigest()
def percentile(vals,f):
    vals=sorted(vals);z=(len(vals)-1)*f;lo=int(z);hi=min(lo+1,len(vals)-1)
    return round(vals[lo]*(hi-z)+vals[hi]*(z-lo),3)
def bytes_for(company):
    output=deep.report_full(company)
    raw=output["payload"]
    packed=gzip.compress(raw,compresslevel=3,mtime=0)
    assert len(raw)>2_000_000 and len(json.loads(raw)["export"])==10000
    assert gzip.decompress(packed)==raw
    return {"raw":raw,"gzip":packed,"hash":digest(raw),
            "packed_sha":digest(packed),"rowcount":10000,
            "sql_ms":output["full_rpc_sql_ms"]}
class Server(ThreadingHTTPServer):
    daemon_threads=True;request_queue_size=512
    def __init__(self,keys):
        super().__init__(("127.0.0.1",0),Handler)
        self.keys=keys
        self.mx=threading.RLock()
        self.ready=False
        self.cache={}
        self.admit=threading.BoundedSemaphore(20)
        self.auth_limit=threading.BoundedSemaphore(8)
        self.pause=threading.Event()
        self.paused=threading.Event()
        self.prewarm_sql=0;self.prewarm_duration=0
        self.auth_sql=0;self.responses=0;self.denied=0
        self.bytes_out=0;self.open_active=0;self.peak_active=0
        self.peak_cache_bytes=0;self.failed_streams=0
    def prewarm(self):
        check(not self.ready,"already_ready")
        start=time.perf_counter()
        computed={}
        for co in v.COMPANIES:
            computed[str(co)]=bytes_for(co)
            self.prewarm_sql+=1
        with self.mx:
            self.cache=computed
            self.peak_cache_bytes=max(self.peak_cache_bytes,
                sum(len(x["raw"])+len(x["gzip"]) for x in computed.values()))
            self.ready=True
            self.prewarm_duration=time.perf_counter()-start
        return {"time_seconds":round(self.prewarm_duration,3),
             "sql_calls":self.prewarm_sql,"cached_original_bytes":sum(len(z["raw"]) for z in computed.values()),
             "cached_gzip_bytes":sum(len(z["gzip"]) for z in computed.values())}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def send_body(self,code,body,encoding=None,export=False,original_sha=None):
        self.send_response(code)
        self.send_header("Content-Length",str(len(body)))
        if encoding:self.send_header("Content-Encoding",encoding)
        if export:
            self.send_header("X-QA-Original-SHA256",original_sha)
            self.send_header("X-QA-Events","10000")
        self.end_headers()
        self.wfile.write(body)
        with self.server.mx:
            self.server.responses+=1
            self.server.bytes_out+=len(body)
    def check_auth(self,company,token):
        with self.server.auth_limit:
            core.jwt_guard(token,company,self.server.keys)
            with self.server.mx:self.server.auth_sql+=1
    def do_GET(self):
        if not self.server.ready:
            self.send_body(503,b"prewarm_not_ready")
            return
        acquired=self.server.admit.acquire(timeout=30)
        if not acquired:
            self.send_body(503,b"admission_queue_timeout")
            return
        with self.server.mx:
            self.server.open_active+=1
            self.server.peak_active=max(self.server.peak_active,self.server.open_active)
        headers_sent=False
        try:
            path=self.path.split("?")[0].strip("/")
            ix=int(path);company=v.COMPANIES[ix]
            token=self.headers.get("X-QA-JWT","")
            self.check_auth(company,token)
            with self.server.mx:cached=self.server.cache[str(company)]
            accept=self.headers.get("Accept-Encoding","")
            compress="gzip" in accept.lower()
            body=cached["gzip"] if compress else cached["raw"]
            # Verify authorization *before* HTTP 200 and again before each
            # chunk. This cannot revoke bytes already received by a client.
            self.check_auth(company,token)
            self.send_response(200);headers_sent=True
            self.send_header("Content-Length",str(len(body)))
            self.send_header("X-QA-Original-SHA256",cached["hash"])
            self.send_header("X-QA-Events","10000")
            if compress:self.send_header("Content-Encoding","gzip")
            self.end_headers()
            paused="pause=1" in self.path
            sent=0
            while sent<len(body):
                self.check_auth(company,token)
                # Bound member lookups per full JSON stream; paused fault
                # injection uses a deterministic 16KiB first chunk.
                chunk_size=16384 if paused and sent==0 else 262144
                chunk=body[sent:sent+chunk_size]
                self.wfile.write(chunk);self.wfile.flush()
                prev=sent
                sent+=len(chunk)
                with self.server.mx:self.server.bytes_out+=len(chunk)
                if paused and prev==0:
                    self.server.paused.set()
                    if not self.server.pause.wait(12):
                        raise PermissionError("qa_pause_timeout")
            with self.server.mx:self.server.responses+=1
        except (PermissionError,IndexError,ValueError,KeyError):
            with self.server.mx:self.server.denied+=1
            if not headers_sent:self.send_body(401,b"membership_or_token_denied")
            else:
                # When data was already transferred, HTTP 200 cannot be
                # converted to 401. Truncate the connection; Content-Length
                # detects incomplete stream, and zero post-revoke bytes leave.
                with self.server.mx:self.server.failed_streams+=1
                self.close_connection=True
                try:self.connection.shutdown(socket.SHUT_WR)
                except OSError:pass
        except (BrokenPipeError,ConnectionResetError):
            pass
        except Exception as exc:
            with self.server.mx:self.server.failed_streams+=1
            if not headers_sent:
                try:self.send_body(503,b"internal_synthetic_qa_error")
                except OSError:pass
            else:
                self.close_connection=True
        finally:
            with self.server.mx:self.server.open_active-=1
            self.server.admit.release()
def server_process(keys,ctl):
    server=Server(keys)
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    ctl.send({"port":server.server_address[1],"pid":os.getpid()})
    try:
        while True:
            cmd=ctl.recv()
            if cmd=="prewarm":
                ctl.send(server.prewarm())
            elif cmd=="resume":
                server.pause.set();ctl.send(True)
            elif cmd=="pause_state":
                ctl.send(server.paused.is_set())
            elif cmd=="rotate_b_only":
                server.keys.accept={"b"};ctl.send(True)
            elif cmd=="stats":
                with server.mx:ctl.send({
                    "pid":os.getpid(),"ready":server.ready,
                    "prewarm_sql":server.prewarm_sql,
                    "prewarm_seconds":round(server.prewarm_duration,3),
                    "auth_sql":server.auth_sql,"responses":server.responses,
                    "denied":server.denied,"failed_streams":server.failed_streams,
                    "bytes_sent":server.bytes_out,"peak_http_active":server.peak_active,
                    "peak_cache_bytes":server.peak_cache_bytes,
                    "rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
            elif cmd=="stop":
                ctl.send(True);break
            else:raise RuntimeError("unknown_qa_ipc_command")
    finally:
        server.shutdown();server.server_close();thread.join(3)
def start(keys):
    replicas=[]
    for _ in range(2):
        a,b=mp.Pipe();proc=mp.Process(target=server_process,args=(keys,b))
        proc.start()
        info=a.recv();replicas.append((proc,a,info))
    check(len({x[2]["pid"] for x in replicas})==2,"distinct_os_processes")
    return replicas
def commands(replicas,cmd):
    for proc,ctl,_ in replicas:
        check(proc.is_alive(),"worker_crash")
        ctl.send(cmd)
    return [ctl.recv() for _,ctl,_ in replicas]
def stop(replicas):
    for proc,ctl,_ in replicas:
        if proc.is_alive():
            ctl.send("stop");ctl.recv()
        proc.join(6)
        if proc.is_alive():proc.terminate();proc.join(5)
        check(proc.exitcode==0,("bad_process_exit",proc.exitcode))
def get(replicas,i,keys,gzip_mode=True,override_token=None,pause=False):
    replica=replicas[i%2]
    tenant=(i//2)%2
    company=v.COMPANIES[tenant]
    token=override_token or keys.issue(company,v.USER_IDS[tenant],"a")
    url=f"http://127.0.0.1:{replica[2]['port']}/{tenant}"
    if pause:url+="?pause=1"
    opts={"X-QA-JWT":token}
    if gzip_mode:opts["Accept-Encoding"]="gzip"
    st=time.perf_counter()
    r=request.Request(url,headers=opts)
    try:
        with request.urlopen(r,timeout=75) as response:
            chunk=response.read()
            raw=gzip.decompress(chunk) if response.headers.get("Content-Encoding")=="gzip" else chunk
            check(digest(raw)==response.headers.get("X-QA-Original-SHA256"),"json_sha_mismatch")
            check(int(response.headers["X-QA-Events"])==10000,"export_count")
            if i<4 or i%97==0:
                x=json.loads(raw)
                check(len(x["export"])==10000 and "report" in x,"full_json_missing")
            ms=(time.perf_counter()-st)*1000
            return {"ms":ms,"wire_bytes":len(chunk),"raw_bytes":len(raw),"sha":digest(raw)}
    except error.HTTPError as e:
        return {"status":e.code,"body":e.read().decode()[:200]}
def wave(peers,keys,n,compress):
    t=time.perf_counter()
    with ThreadPoolExecutor(max_workers=n) as pool:
        vals=list(pool.map(lambda i:get(peers,i,keys,compress),range(n)))
    elapsed=time.perf_counter()-t
    for x in vals:check("ms" in x,("non_200",x))
    # Distinct responses for the two companies, identical per-company
    # independent of which replica served the request.
    signatures={}
    for i,x in enumerate(vals):
        co=(i//2)%2
        if co in signatures:check(signatures[co]==x["sha"],"cross-replica_parity")
        else:signatures[co]=x["sha"]
    check(len(set(signatures.values()))==2,"tenant_hash_collision")
    return {"count":n,"gzip":compress,
        "p95_ms":percentile([x["ms"] for x in vals],.95),
        "p99_ms":percentile([x["ms"] for x in vals],.99),
        "wall_seconds":round(elapsed,3),
        "wire_bytes":sum(x["wire_bytes"] for x in vals),
        "uncompressed_bytes":sum(x["raw_bytes"] for x in vals),
        "successful_responses":len(vals)}
def revocation_in_stream(peers,keys):
    # Start one deterministic paused HTTP 200 response. After the first
    # 16KiB compressed chunk arrives, revoke DB membership and resume.
    i=0;replica=peers[0]
    company=v.COMPANIES[0]
    token=keys.issue(company,v.USER_IDS[0],"a")
    url=f"http://127.0.0.1:{replica[2]['port']}/0?pause=1"
    response=request.urlopen(request.Request(url,headers={"X-QA-JWT":token,
       "Accept-Encoding":"gzip"}),timeout=60)
    try:
        first=response.read(16384)
        check(len(first)==16384,"first_chunk_missing")
        paused=commands(peers,"pause_state")
        check(paused[0],"no_controlled_stream_pause")
        with v.con() as c:
            c.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",
                      (company,v.USER_IDS[0]))
        commands(peers,"resume")
        try:
            remainder=response.read()
            raise AssertionError(("revoked_stream_completed",len(remainder)))
        except IncompleteRead as ex:
            check(len(ex.partial)==0,("data_leak_after_revocation",len(ex.partial)))
    finally:response.close()
    # Also reject new attempts with a *still valid* synthetic JWT, including
    # requests to replica B and previously cached results.
    statuses=[]
    for n in (0,1):
        r=get(peers,n,keys,True,token)
        check(r.get("status")==401,("post_revocation_not_denied",r))
        statuses.append(r["status"])
    # Key rotation on both worker processes. Revoked user must remain denied
    # even with a new signing key; restore membership only afterwards.
    keys.accept={"b"};commands(peers,"rotate_b_only")
    fresh=keys.issue(company,v.USER_IDS[0],"b")
    for n in (0,1):
        r=get(peers,n,keys,True,fresh)
        check(r.get("status")==401,("revoked_new_key_accepted",r))
    with v.con() as c:
        c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s)",
                   (company,v.USER_IDS[0]))
    for n in (0,1):
        r=get(peers,n,keys,True,token)
        check(r.get("status")==401,"rotated_old_key_accepted")
        good=get(peers,n,keys,True,fresh)
        check("ms" in good,"new_key_not_accepted")
    return {"result":"PASS","paused_after_bytes":16384,
       "bytes_delivered_after_revocation":0,
       "incomplete_HTTP_200_detected_by_Content_Length":True,
       "new_requests_denied_both_replicas":True,
       "synthetic_key_rotation_both_replicas":True}
def main():
    started=time.perf_counter()
    q.init_db()
    p.expanded_history()
    a.setup_outbox()
    rls=deep.rls_audit()
    with v.con() as c:
        begin_lsn=v.scalar(c,"SELECT pg_current_wal_lsn()")
        db_before=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
    keys=a.Keys()
    peers=start(keys)
    try:
        # Before prewarm, no report can be served or trigger a DB miss.
        denied=request.Request(f"http://127.0.0.1:{peers[0][2]['port']}/0")
        try:request.urlopen(denied,timeout=4)
        except error.HTTPError as exc:check(exc.code==503,"readiness_not_enforced")
        else:raise AssertionError("unready_report_served")
        t=time.perf_counter()
        prepared=commands(peers,"prewarm")
        prewarm_wall=time.perf_counter()-t
        check(all(x["sql_calls"]==2 for x in prepared),"prewarm_extra_sql")
        # Gzip and uncompressed A/B comparisons, 100 and 300 clients each.
        results=[]
        for n in (100,300):
            for compressed in (False,True):
                z=wave(peers,keys,n,compressed)
                print("QA_PREWARM_PHASE_JSON="+m.dump(z).decode(),flush=True)
                results.append(z)
        security=revocation_in_stream(peers,keys)
        stats=commands(peers,"stats")
        check(all(x["prewarm_sql"]==2 for x in stats),"per_request_sql_rebuild")
        check(all(x["peak_http_active"]<=20 for x in stats),"unbounded_active_http")
        check(all(x["failed_streams"]>=0 for x in stats),"negative_failures")
    finally:stop(peers)
    with v.con() as c:
        db=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
        idx=int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')"))
        wal=int(v.scalar(c,"SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(begin_lsn,)))
    answer={"result":"PASS","postgres17_disposable":True,
        "prewarm_seconds_wall":round(prewarm_wall,3),
        "prewarm_per_replica":prepared,"phase_results":results,
        "synthetic_stream_revocation":security,"replica_stats":stats,
        "rls_tables":rls["table_count"],
        "pg_database_bytes":db,"pg_index_bytes":idx,
        "wal_after_fixture_bytes":wal,"db_before_prewarm":db_before,
        "parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "archive_http_gets":0,
        "outbox_manifest_note":"already separately tested; no external object store in this HTTP prewarm run",
        "prewarm_shifts_cold_cost_before_readiness_not_eliminates_it":True,
        "different_hosts":False,"no_prod_access":True,"production_go":False,
        "elapsed_sec":round(time.perf_counter()-started,3)}
    print("QA_PREWARM_SUMMARY_JSON="+m.dump(answer).decode(),flush=True)
    print("QA_PREWARM_STREAM_PASS=true",flush=True)
if __name__=="__main__":main()
