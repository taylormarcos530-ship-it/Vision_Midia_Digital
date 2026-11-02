"""Disposable PG17 causal audit: two local HTTP proxy instances, one upstream.
No retries; each response has an explicit failure origin and per-attempt bytes.
Proxy coordination uses one real PostgreSQL gate, NOT shared Python gate state.
No official credentials, endpoints, Supabase, TVs, APKs, or production data.
"""
from __future__ import annotations
import contextlib,gzip,hashlib,http.client,json,os,queue,resource,socket,statistics,threading,time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib import request,error
import psycopg

N=300
POOL=int(os.environ["QA_POOL"])
CHUNK=int(os.environ["QA_CHUNK"])
assert POOL in (8,12,20) and CHUNK in (65536,262144)
assert os.environ.get("QA_STREAM_GUARD_GROUP","1")=="1"
assert os.environ.get("GITHUB_REF")=="refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031"
for item in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE"):
    assert not os.environ.get(item),("official_environment_refused",item)
DB="vision_v2_quarantine_disposable"
KW=dict(host="127.0.0.1",port=5432,dbname=DB,user="postgres",password="qa-only-local-password",connect_timeout=3)
LOCK_MEM=63918078
LOCK_GATE=63918079
def ck(condition,message):
    assert condition,message
def pg():
    return psycopg.connect(**KW)
def pct(numbers,p):
    s=sorted(numbers);k=(len(s)-1)*p;i=int(k);j=min(i+1,len(s)-1)
    return round(s[i]*(j-k)+s[j]*(k-i),3)
def fixture():
    with pg() as c:
        v=int(c.execute("SELECT current_setting('server_version_num')").fetchone()[0])
        ck(170000<=v<180000,"not_actual_pg17")
        c.execute("CREATE ROLE qa_causal_reader NOLOGIN")
        c.execute("CREATE TABLE qa_causal_membership(tenant text PRIMARY KEY, permitted boolean NOT NULL)")
        c.execute("INSERT INTO qa_causal_membership VALUES('synthetic-tenant',true)")
        c.execute("ALTER TABLE qa_causal_membership ENABLE ROW LEVEL SECURITY")
        c.execute("ALTER TABLE qa_causal_membership FORCE ROW LEVEL SECURITY")
        c.execute("CREATE POLICY causal_member ON qa_causal_membership FOR SELECT TO qa_causal_reader USING(tenant=current_setting('qa.tenant',true) AND permitted)")
        c.execute("GRANT USAGE ON SCHEMA public TO qa_causal_reader")
        c.execute("GRANT SELECT ON qa_causal_membership TO qa_causal_reader")
        c.execute("CREATE TABLE qa_causal_gate(id int PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL, epoch bigint NOT NULL)")
        c.execute("INSERT INTO qa_causal_gate VALUES(1,true,1)")
        c.execute("GRANT SELECT ON qa_causal_gate TO qa_causal_reader")
        c.execute("REVOKE INSERT,UPDATE,DELETE ON qa_causal_membership,qa_causal_gate FROM qa_causal_reader")
        return c.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
def update_member(permitted):
    with pg() as db:
        with db.transaction():
            db.execute("SELECT pg_advisory_xact_lock(%s)",(LOCK_MEM,))
            db.execute("UPDATE qa_causal_membership SET permitted=%s",(permitted,))
def update_gate(enabled):
    with pg() as db:
        with db.transaction():
            db.execute("SELECT pg_advisory_xact_lock(%s)",(LOCK_GATE,))
            db.execute("UPDATE qa_causal_gate SET enabled=%s,epoch=epoch+1 WHERE id=1",(enabled,))
class Pool:
    def __init__(self,n):
        self.q=queue.LifoQueue(n);self.mu=threading.Lock();self.borrows=0;self.peak=0;self.active=0
        for _ in range(n):self.q.put(pg())
    @contextlib.contextmanager
    def borrow(self):
        c=self.q.get(timeout=15)
        with self.mu:
            self.borrows+=1;self.active+=1;self.peak=max(self.active,self.peak)
        try:yield c
        finally:
            with self.mu:self.active-=1
            self.q.put(c)
    def close(self):
        while not self.q.empty():self.q.get_nowait().close()
    def stats(self):
        return dict(created=POOL,borrowed=self.borrows,peak=self.peak)
class Counters:
    def __init__(self):
        self.lock=threading.Lock();self.count=Counter()
    def add(self,key,n=1):
        with self.lock:self.count[key]+=n
    def snapshot(self):
        with self.lock:return dict(self.count)
POOL_SQL=Pool(POOL)
MET=Counters()
def sql_allowed():
    with POOL_SQL.borrow() as db:
        with db.transaction():
            db.execute("SET LOCAL ROLE qa_causal_reader")
            db.execute("SELECT set_config('qa.tenant','synthetic-tenant',true)")
            db.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK_MEM,))
            row=db.execute("SELECT permitted FROM qa_causal_membership WHERE tenant='synthetic-tenant'").fetchone()
            MET.add("membership_guards")
            return row is not None
def route_allowed():
    with POOL_SQL.borrow() as db:
        with db.transaction():
            db.execute("SET LOCAL ROLE qa_causal_reader")
            db.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK_GATE,))
            row=db.execute("SELECT enabled,epoch FROM qa_causal_gate WHERE id=1").fetchone()
            MET.add("proxy_gate_sql")
            return bool(row and row[0])
ROWS=[{"event":i,"digest":hashlib.sha256(("causal-"+str(i)).encode()).hexdigest(),"marker":"synthetic"} for i in range(10000)]
RAW=json.dumps({"tenant":"synthetic-tenant","revision":1,"original_full_report":{"export":ROWS}},
               sort_keys=True,separators=(",",":")).encode()
WIRE=gzip.compress(RAW,compresslevel=3)
SHA=hashlib.sha256(RAW).hexdigest()
ck(len(WIRE)>262144,("fixture_not_crossing_256k",len(WIRE)))
class Quiet(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*args):pass
    def respond(self,code,cause,body=b"",sha=False):
        self.send_response(code);self.send_header("Content-Length",str(len(body)))
        self.send_header("X-QA-Cause",cause)
        if sha:
            self.send_header("Content-Encoding","gzip")
            self.send_header("X-QA-SHA256",SHA)
        self.end_headers()
        if body:self.wfile.write(body);self.wfile.flush()
class Upstream(Quiet):
    def do_GET(self):
        MET.add("upstream_attempts")
        if self.headers.get("X-QA-Token")!="synthetic-valid":
            self.respond(401,"upstream_401");return
        if not sql_allowed():
            self.respond(401,"revoked_401");return
        if self.path=="/upstream503":
            self.respond(503,"upstream_http");return
        if self.path=="/timeout":
            time.sleep(.6);self.respond(503,"too_late");return
        self.send_response(200)
        self.send_header("Content-Length",str(len(WIRE)))
        self.send_header("Content-Encoding","gzip")
        self.send_header("X-QA-SHA256",SHA)
        self.end_headers()
        if self.path=="/truncate":
            self.wfile.write(WIRE[:7000]);self.wfile.flush()
            MET.add("upstream_body_written",7000)
            self.close_connection=True
            try:self.connection.shutdown(socket.SHUT_WR)
            except OSError:pass
            return
        try:
            for i in range(0,len(WIRE),CHUNK):
                # One DB transaction and authorization fence PER CHUNK.
                with POOL_SQL.borrow() as db:
                    with db.transaction():
                        db.execute("SET LOCAL ROLE qa_causal_reader")
                        db.execute("SELECT set_config('qa.tenant','synthetic-tenant',true)")
                        db.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK_MEM,))
                        allowed=db.execute("SELECT permitted FROM qa_causal_membership WHERE tenant='synthetic-tenant'").fetchone()
                        MET.add("membership_guards")
                        if not allowed:
                            MET.add("aborted_after_revoke")
                            self.close_connection=True
                            try:self.connection.shutdown(socket.SHUT_WR)
                            except OSError:pass
                            return
                        body=WIRE[i:i+CHUNK]
                        self.wfile.write(body);self.wfile.flush()
                        MET.add("upstream_body_written",len(body))
                if self.path=="/hold" and i==0:
                    self.server.first_block.set()
                    ck(self.server.release_block.wait(8),"hold_release_timeout")
        except (BrokenPipeError,ConnectionResetError,socket.timeout):
            MET.add("upstream_socket_errors")
class Proxy(Quiet):
    def do_GET(self):
        MET.add("proxy_attempts")
        if self.path=="/proxy503":
            MET.add("proxy_local");self.respond(503,"proxy_local");return
        if not route_allowed():
            MET.add("proxy_gate");self.respond(503,"proxy_gate");return
        rq=request.Request(self.server.upstream+self.path,
                           headers={"X-QA-Token":self.headers.get("X-QA-Token","")})
        code=None;body=b"";headers=None
        try:
            with request.urlopen(rq,timeout=.15 if self.path=="/timeout" else 12) as upstream:
                body=upstream.read();code=upstream.status;headers=upstream.headers
        except error.HTTPError as ex:
            code=ex.code;body=ex.read();headers=ex.headers
        except (TimeoutError,socket.timeout) as ex:
            MET.add("upstream_timeout");self.respond(503,"upstream_timeout");return
        except http.client.IncompleteRead as ex:
            MET.add("upstream_incomplete");self.respond(503,"upstream_incomplete");return
        except (error.URLError,ConnectionError,OSError) as ex:
            MET.add("other_upstream_exception");self.respond(503,"unexpected_upstream_exception");return
        if code==401:
            MET.add("revoked_or_invalid_401");self.respond(401,headers.get("X-QA-Cause","upstream_401"));return
        if code==503:
            MET.add("upstream_http503");self.respond(503,"upstream_http");return
        if code!=200:
            MET.add("unexpected_status");self.respond(503,"unexpected_status");return
        ck(headers.get("X-QA-SHA256")==SHA,"upstream_header_sha_invalid")
        ck(hashlib.sha256(gzip.decompress(body)).hexdigest()==SHA,"upstream_body_sha_invalid")
        MET.add("proxied_complete_bytes",len(body))
        self.respond(200,"ok",body,sha=True)
def start(handler):
    s=ThreadingHTTPServer(("127.0.0.1",0),handler)
    s.daemon_threads=True
    t=threading.Thread(target=s.serve_forever,daemon=True);t.start()
    return s,t
LEDGER=[];LEDGER_MU=threading.Lock()
def get(node,path,token="synthetic-valid"):
    t=time.perf_counter()
    rq=request.Request("http://127.0.0.1:"+str(node.server_address[1])+path,
                       headers={"X-QA-Token":token,"Accept-Encoding":"gzip"})
    try:
        with request.urlopen(rq,timeout=20) as re:
            payload=re.read();status=re.status;headers=re.headers
    except error.HTTPError as ex:
        payload=ex.read();status=ex.code;headers=ex.headers
    cause=headers.get("X-QA-Cause","missing")
    result={"path":path,"proxy":node.server_address[1],"status":status,"cause":cause,
            "body_bytes":len(payload),"duration_ms":round((time.perf_counter()-t)*1000,3),
            "attempt":1,"retried":False}
    if status==200:
        raw=gzip.decompress(payload)
        ck(hashlib.sha256(raw).hexdigest()==headers.get("X-QA-SHA256"),"client_sha")
        ck(len(json.loads(raw)["original_full_report"]["export"])==10000,"original_rows_lost")
        ck(cause=="ok","success_cause_mismatch")
    else:
        ck(not payload,("error_body_unexpected",cause,len(payload)))
    with LEDGER_MU:LEDGER.append(result)
    return result
def expect(node,path,status,cause,token="synthetic-valid"):
    x=get(node,path,token)
    ck((x["status"],x["cause"])==(status,cause),("causal_failure_wrong",path,x))
def main():
    started_at=time.perf_counter();wal0=fixture()
    upstream,ut=start(Upstream)
    upstream.first_block=threading.Event()
    upstream.release_block=threading.Event()
    nodes=[start(Proxy),start(Proxy)]
    for server,_ in nodes:server.upstream="http://127.0.0.1:"+str(upstream.server_address[1])
    try:
        def wave(i):
            return get(nodes[i%2][0],"/normal")
        with ThreadPoolExecutor(max_workers=60) as executor:
            normal=list(executor.map(wave,range(N)))
        ck(all(x["status"]==200 and x["body_bytes"]==len(WIRE) for x in normal),"300_clean_wave")
        for server,_ in nodes:
            expect(server,"/proxy503",503,"proxy_local")
            expect(server,"/upstream503",503,"upstream_http")
            expect(server,"/timeout",503,"upstream_timeout")
            expect(server,"/truncate",503,"upstream_incomplete")
        # Global PG coordination is visible at both independent HTTP proxies.
        update_gate(False)
        for server,_ in nodes:expect(server,"/normal",503,"proxy_gate")
        update_member(False)  # Revocation commits without waiting for route gate.
        update_gate(True)
        for server,_ in nodes:expect(server,"/normal",401,"revoked_401")
        update_member(True)
        for server,_ in nodes:expect(server,"/normal",200,"ok")
        # Actual midstream revocation, controlled after first socket block.
        with ThreadPoolExecutor(max_workers=1) as executor:
            future=executor.submit(get,nodes[0][0],"/hold")
            ck(upstream.first_block.wait(8),"upstream_did_not_write_first_block")
            update_member(False)
            before=MET.snapshot().get("upstream_body_written",0)
            upstream.release_block.set()
            interrupted=future.result(timeout=12)
            ck(interrupted["status"]==503 and interrupted["cause"]=="upstream_incomplete",
               ("revocation_stream_not_failclosed",interrupted))
            ck(MET.snapshot().get("upstream_body_written",0)==before,
               "new_application_bytes_after_revocation_commit")
        for server,_ in nodes:expect(server,"/normal",401,"revoked_401")
        update_member(True)
        for server,_ in nodes:expect(server,"/normal",200,"ok")
        counts=Counter((a["path"],a["status"],a["cause"]) for a in LEDGER)
        ck(len(LEDGER)==N+8+2+2+2+1+2+2,N+8+2+2+2+1+2+2)
        ck(all(a["attempt"]==1 and not a["retried"] for a in LEDGER),"retry_policy_changed")
        with pg() as c:
            dbbytes,idx,wal=c.execute("SELECT pg_database_size(current_database()),pg_indexes_size('qa_causal_membership'),pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(wal0,)).fetchone()
        stats=MET.snapshot()
        ck(stats.get("upstream_socket_errors",0)>=0,"socket_negative")
        ck(stats.get("upstream_incomplete")==3,"expected_2_FIN_plus_1_revoke")
        ck(stats.get("upstream_timeout")==2 and stats.get("upstream_http503")==2,"cause_telemetry")
        ck(stats.get("proxy_local")==2 and stats.get("proxy_gate")==2,"proxy_telemetry")
        ck(stats.get("aborted_after_revoke")==1,"revocation_chunk_not_enforced")
        ck(POOL_SQL.stats()["peak"]<=POOL,"pool_capacity_violated")
        summary={"status":"PASS","clients":N,"pool":POOL,"chunk_bytes":CHUNK,
            "http_proxy_instances":2,"upstream_instances":1,"actual_http_sockets":True,
            "one_python_process":True,"shared_coordinator":"local disposable PostgreSQL17",
            "normal_completed":N,"normal_P95_ms":pct([x["duration_ms"] for x in normal],.95),
            "normal_P99_ms":pct([x["duration_ms"] for x in normal],.99),
            "requests_all_attempts":len(LEDGER),"no_retry_401":True,"no_retry_truncated_200":True,
            "failure_types":[{"path":p,"status":status,"cause":why,"count":n} for (p,status,why),n in sorted(counts.items())],
            "body_bytes_all_attempts":sum(x["body_bytes"] for x in LEDGER),
            "complete_gzip_body_bytes":sum(x["body_bytes"] for x in LEDGER if x["status"]==200),
            "error_body_bytes":sum(x["body_bytes"] for x in LEDGER if x["status"]!=200),
            "SQL_guard_calls_measured":stats.get("membership_guards",0)+stats.get("proxy_gate_sql",0),
            "SQL_proxy_gate_checks":stats.get("proxy_gate_sql",0),
            "SQL_membership_guards":stats.get("membership_guards",0),
            "WAL_bytes_after_fixture":int(wal),"db_bytes":dbbytes,"membership_index_bytes":idx,
            "RSS_runner_Python_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "pool_stats":POOL_SQL.stats(),"upstream_incomplete":stats.get("upstream_incomplete"),
            "proxy_local":stats.get("proxy_local"),"proxy_gate":stats.get("proxy_gate"),
            "upstream_http503":stats.get("upstream_http503"),"upstream_timeout":stats.get("upstream_timeout"),
            "upstream_bytes_written":stats.get("upstream_body_written",0),
            "original_rows":10000,"SHA256_verified":True,
            "two_proxy_gate_coordinated":True,"revoke_during_open_gate_and_stream":True,
            "no_new_socket_writes_post_revoke":True,"total_SQL_statements_measured":False,
            "real_supabase_or_TVs_tested":False,"cross_host_coordination_proven":False,
            "costs_R_measured":False,"production_GO":False,
            "elapsed_seconds":round(time.perf_counter()-started_at,3)}
        Path("qa-causal-ledger.json").write_text(json.dumps({"summary":summary,"attempts":LEDGER},sort_keys=True))
        print("QA_CAUSAL_TWO_PROXY_SUMMARY_JSON="+json.dumps(summary,sort_keys=True),flush=True)
        print("QA_CAUSAL_TWO_PROXY_PASS=true",flush=True)
    finally:
        upstream.release_block.set()
        for server,t in nodes+[(upstream,ut)]:
            server.shutdown();server.server_close();t.join(5)
        POOL_SQL.close()
if __name__=="__main__":main()

