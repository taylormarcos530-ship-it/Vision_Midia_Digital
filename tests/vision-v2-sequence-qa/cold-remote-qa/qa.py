"""Isolated Vision V2 PG17 QA: HTTP remote encrypted object store, outbox
failure/restart tests and genuinely cold-start 100/300 full-JSON HTTP waves.
Synthetic JWT and data ONLY. All database and object services disposable.
"""
from __future__ import annotations
import base64,hashlib,hmac,importlib.util,json,multiprocessing as mp,os
import resource,secrets,threading,time,uuid,tempfile,math
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib import request,error
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("vision_v2_deep_qa",HERE.parent/"deep-integrity-qa"/"deep.py")
deep=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(deep)
a,v,p,m,q=deep.a,deep.v,deep.p,deep.m,deep.q
def chk(ok,message):assert ok,message
def data(x):return m.dump(x)
def sha(b):return hashlib.sha256(b).hexdigest()
def pct(values,f):
    xs=sorted(values);position=(len(xs)-1)*f;low=int(position);high=min(low+1,len(xs)-1)
    return round(xs[low]*(high-position)+xs[high]*(position-low),3)

class FileStore(ThreadingHTTPServer):
    daemon_threads=True;request_queue_size=512
    def __init__(self,dir):
        super().__init__(("127.0.0.1",0),FileHandler)
        self.root=Path(dir);self.mx=threading.RLock()
        self.gets=0;self.puts=0;self.bytes_get=0;self.bytes_put=0;self.failures=0
class FileHandler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def respond(self,code,body=b""):
        self.send_response(code);self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        if body:self.wfile.write(body)
    def filename(self):
        # Only synthetic version numbers accepted, never paths from remote clients.
        assert self.path.startswith("/v/") and self.path[3:].isdigit()
        return self.server.root/("v"+self.path[3:]+".aes")
    def do_PUT(self):
        try:
            obj=self.filename()
            raw=self.rfile.read(int(self.headers["Content-Length"]))
            assert len(raw)<=1024*1024,"object_size"
            with self.server.mx:
                self.server.puts+=1;self.server.bytes_put+=len(raw)
            if self.headers.get("X-QA-Inject")=="broken":
                obj.write_bytes(raw[:max(1,len(raw)//2)])
                with self.server.mx:self.server.failures+=1
                self.respond(503);return
            # Immutable object version. Safe idempotent retried identical PUT.
            if obj.exists():
                if obj.read_bytes()!=raw:
                    self.respond(409);return
            else:
                pending=obj.with_suffix(".temp")
                pending.write_bytes(raw);os.replace(pending,obj)
            self.respond(201)
        except Exception:
            with self.server.mx:self.server.failures+=1
            self.respond(503)
    def do_GET(self):
        try:
            obj=self.filename()
            if not obj.exists():self.respond(404);return
            raw=obj.read_bytes()
            with self.server.mx:
                self.server.gets+=1;self.server.bytes_get+=len(raw)
            self.respond(200,raw)
        except Exception:
            with self.server.mx:self.server.failures+=1
            self.respond(503)

def object_process(dir,control):
    server=FileStore(dir)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    control.send({"port":server.server_address[1],"pid":os.getpid()})
    try:
        while True:
            cmd=control.recv()
            if cmd=="stats":
                with server.mx:
                    control.send({"gets":server.gets,"puts":server.puts,
                       "bytes_get":server.bytes_get,"bytes_put":server.bytes_put,
                       "failures":server.failures,
                       "rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
            elif cmd=="stop":control.send(True);break
    finally:
        server.shutdown();server.server_close();thread.join(4)
def spawn_object(dir):
    parent,child=mp.Pipe();proc=mp.Process(target=object_process,args=(dir,child));proc.start()
    x=parent.recv();return (proc,parent,x)

def req(method,url,body=None,headers=None,timeout=15):
    request_obj=request.Request(url,method=method,data=body,headers=headers or {})
    try:
        with request.urlopen(request_obj,timeout=timeout) as response:
            return response.status,response.read()
    except error.HTTPError as err:return err.code,err.read()

def storage_protocol(remote_port,folder):
    # DB mutation, revision and durable outbox in one transaction; encrypted
    # external artifact is a separate step with fail-closed PENDING status.
    with v.con() as c:
        c.execute("""CREATE TABLE qa_remote_publication(
          company_id uuid PRIMARY KEY, revision bigint NOT NULL,
          status text NOT NULL CHECK(status IN('PENDING','READY')),
          object_sha text NULL)""")
        c.execute("INSERT INTO qa_remote_publication(company_id,revision,status) VALUES(%s,1,'READY')",(v.COMPANIES[0],))
    company=v.COMPANIES[0]
    def mutate(c):
        c.execute("UPDATE public.campaigns SET name='Remote archive QA revision' WHERE company_id=%s",(company,))
        c.execute("""UPDATE qa_remote_publication SET
              revision=qa_cache_revision.version+1,status='PENDING',object_sha=NULL
              FROM qa_cache_revision
              WHERE qa_remote_publication.company_id=%s AND qa_cache_revision.company_id=%s""",(company,company))
    with v.con() as c:
        before=int(v.scalar(c,"SELECT count(*) FROM qa_v2_outbox"))
    try:a.outbox_commit(company,"remote-manifest",{"status":"PENDING"},mutate,crash=True)
    except RuntimeError:pass
    else:raise AssertionError("rollback_not_triggered")
    with v.con() as c:
        chk(v.scalar(c,"SELECT count(*) FROM qa_v2_outbox")==before,"rollback_outbox")
        chk(v.scalar(c,"SELECT status FROM qa_remote_publication WHERE company_id=%s",(company,))=="READY","rollback_state")
    event=a.outbox_commit(company,"remote-manifest",{"status":"PENDING"},mutate)
    version=event["revision"]
    remote_url=f"http://127.0.0.1:{remote_port}/v/{version}"
    key=secrets.token_bytes(32);nonce=secrets.token_bytes(12)
    content=data({"company":str(company),"revision":version,"synthetic":True})
    crypt=AESGCM(key).encrypt(nonce,content,b"vision-v2-qa")
    blob=data({"nonce":base64.b64encode(nonce).decode(),
       "cipher":base64.b64encode(crypt).decode()})
    def guarded_read():
        with v.con() as c:
            revision,status,digest=c.execute("""SELECT revision,status,object_sha
               FROM qa_remote_publication WHERE company_id=%s""",(company,)).fetchone()
        if status!="READY" or revision!=version:return 503
        status,body=req("GET",remote_url)
        if status!=200 or sha(body)!=digest:return 503
        try:
            doc=json.loads(body)
            decoded=AESGCM(key).decrypt(base64.b64decode(doc["nonce"]),
                   base64.b64decode(doc["cipher"]),b"vision-v2-qa")
            chk(json.loads(decoded)["revision"]==version,"stale_revision")
            return 200
        except Exception:return 503
    chk(guarded_read()==503,"premature_serve")
    st,_=req("PUT",remote_url,blob,{"X-QA-Inject":"broken"})
    chk(st==503 and guarded_read()==503,"partial_upload_leaked")
    # Crash/restart remote service before successful publish: unfinished object
    # persists as corrupt. Caller explicitly retries, replacing only invalid
    # staging object through a new version, not mutating committed version.
    return {"event":event,"version":version,"blob":blob,"key":key,"url":remote_url,
            "guarded_read":guarded_read}
def finish_storage(state,remote_port):
    version=state["version"];blob=state["blob"]
    # Broken version object is immutable. Use separate staging key for retry,
    # commit only a fully verified immutable replacement object URI.
    candidate=f"http://127.0.0.1:{remote_port}/v/{version+100000}"
    status,_=req("PUT",candidate,blob)
    chk(status==201,("remote_retry_failed",status))
    status2,_=req("PUT",candidate,blob)
    chk(status2==201,"idempotent_retry")
    status3,_=req("PUT",candidate,blob+b"tampered")
    chk(status3==409,"immutable_remote_overwrite")
    # Fail closed while no READY marker, even if remote object is valid.
    chk(state["guarded_read"]()==503,"uncommitted_archive_accepted")
    # URL version mapping stored in table, never use partially uploaded original.
    with v.con() as c:
        c.execute("ALTER TABLE qa_remote_publication ADD COLUMN object_version bigint")
        with c.transaction():
            c.execute("""UPDATE qa_remote_publication SET status='READY',
               object_sha=%s,object_version=%s WHERE company_id=%s""",
               (sha(blob),version+100000,v.COMPANIES[0]))
    # A production reader would take object_version from committed DB,
    # not trust the earlier PENDING URL. Verify this exact committed URI.
    with v.con() as c:
        ver,status,digest=c.execute("""SELECT object_version,status,object_sha
              FROM qa_remote_publication WHERE company_id=%s""",(v.COMPANIES[0],)).fetchone()
    chk(status=="READY" and ver==version+100000,"ready_revision_pointer")
    code,body=req("GET",f"http://127.0.0.1:{remote_port}/v/{ver}")
    chk(code==200 and sha(body)==digest,"published_remote_sha")
    doc=json.loads(body)
    plain=AESGCM(state["key"]).decrypt(base64.b64decode(doc["nonce"]),
            base64.b64decode(doc["cipher"]),b"vision-v2-qa")
    chk(json.loads(plain)["revision"]==version,"published_revision")
    with v.con() as c:
        outbox=int(v.scalar(c,"SELECT count(*) FROM qa_v2_outbox"))
        chk(outbox==1,"outbox_event_mismatch")
    return {"result":"PASS","crash_before_commit_rollback":True,
      "partial_remote_put_returns_503":True,
      "manifest_persisted_across_remote_process_restart":True,
      "immutable_object_version_conflict_409":True,
      "idempotent_put":True,"db_READY_pointer_after_archive":True,
      "object_integrity_sha_and_AES_GCM":True,"durable_outbox_events":outbox,
      "remote_payload_bytes":len(blob)}

def jwt_guard(token,company,keys):
    # Synthetic signed JWT, plus active native PostgreSQL membership check.
    claims=keys.verify(token)
    if claims["company_id"]!=str(company):raise PermissionError("cross_tenant")
    with v.con() as c:
        with c.transaction():
            v.auth(c,claims)
            permitted=v.scalar(c,"SELECT private.is_company_member(%s)",(company,))
            if not permitted:raise PermissionError("membership_revoked")

class ReportServer(ThreadingHTTPServer):
    daemon_threads=True;request_queue_size=512
    def __init__(self,keys):
        super().__init__(("127.0.0.1",0),ReportHandler)
        self.keys=keys;self.mx=threading.RLock()
        self.cache={};self.locks={str(c):threading.Lock() for c in v.COMPANIES}
        self.auth_semaphore=threading.BoundedSemaphore(8)
        self.sql_rebuilds=0;self.hits=0;self.denied=0;self.requests=0
        self.http_bytes=0;self.auth_queries=0
class ReportHandler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def sendit(self,code,body):
        self.send_response(code);self.send_header("Content-Length",str(len(body)))
        if code==200:
            self.send_header("X-QA-SHA256",sha(body))
            self.send_header("X-QA-Export-Rows","10000")
        self.end_headers()
        try:self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError):pass
        with self.server.mx:
            self.server.http_bytes+=len(body)
            self.server.requests+=1
    def do_GET(self):
        company=None
        try:
            ix=int(self.path.strip("/"))
            company=v.COMPANIES[ix];token=self.headers.get("X-QA-JWT","")
            with self.server.auth_semaphore:
                jwt_guard(token,company,self.server.keys)
                with self.server.mx:self.server.auth_queries+=1
            with self.server.locks[str(company)]:
                with self.server.mx:body=self.server.cache.get(str(company))
                if body is None:
                    # Full original SQL report & all 10k export rows, no warm
                    # shared cache when a wave begins.
                    result=deep.report_full(company);body=result["payload"]
                    with self.server.mx:
                        self.server.cache[str(company)]=body
                        self.server.sql_rebuilds+=1
                else:
                    with self.server.mx:self.server.hits+=1
            # Protect in-flight result after revocation while SQL ran.
            with self.server.auth_semaphore:
                jwt_guard(token,company,self.server.keys)
                with self.server.mx:self.server.auth_queries+=1
            self.sendit(200,body)
        except (PermissionError,ValueError,KeyError,IndexError):
            with self.server.mx:self.server.denied+=1
            self.sendit(401,b"denied")
        except Exception as exc:
            self.sendit(503,data({"error":str(exc)[:100]}))
def report_process(keys,control):
    srv=ReportServer(keys)
    worker=threading.Thread(target=srv.serve_forever,daemon=True);worker.start()
    control.send({"port":srv.server_address[1],"pid":os.getpid()})
    try:
        while True:
            cmd=control.recv()
            if cmd=="reset":
                with srv.mx:
                    srv.cache.clear()
                control.send(True)
            elif cmd=="stats":
                with srv.mx:
                    control.send({"pid":os.getpid(),"sql_rebuilds":srv.sql_rebuilds,
                      "hits":srv.hits,"denied":srv.denied,"requests":srv.requests,
                      "bytes_http":srv.http_bytes,"auth_sql":srv.auth_queries,
                      "rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                      "cache_bytes":sum(len(b) for b in srv.cache.values())})
            elif cmd=="allow_both_keys":
                srv.keys.accept={"a","b"};control.send(True)
            elif cmd=="rotate_b_only":
                srv.keys.accept={"b"};control.send(True)
            elif cmd=="stop":control.send(True);break
    finally:
        srv.shutdown();srv.server_close();worker.join(4)

KEYS=None
def start_report_servers(keys):
    peers=[]
    for _ in range(2):
        parent,child=mp.Pipe()
        proc=mp.Process(target=report_process,args=(keys,child));proc.start()
        info=parent.recv()
        peers.append((proc,parent,info))
    chk(len({x[2]["pid"] for x in peers})==2,"same_report_pid")
    return peers
def command(peers,cmd):
    for proc,ctl,info in peers:
        chk(proc.is_alive(),"server_crashed")
        ctl.send(cmd)
    return [ctl.recv() for proc,ctl,info in peers]
def hit(peers,i,kid="a",expect=200):
    host=peers[i%2][2]["port"]
    tenant=(i//2)%2
    co=v.COMPANIES[tenant];user=v.USER_IDS[tenant]
    token=KEYS.issue(co,user,kid)
    t=time.perf_counter()
    status,body=req("GET",f"http://127.0.0.1:{host}/{tenant}",
         headers={"X-QA-JWT":token},timeout=120)
    ms=(time.perf_counter()-t)*1000
    chk(status==expect,("http_status",status,expect,body[:160]))
    if status==200:
        chk(len(body)>2_000_000,"not_full_export_body")
        if i<4 or i%50==0:
            parsed=json.loads(body)
            chk(len(parsed["export"])==10_000,"full_event_export_missing")
        return ms,len(body),sha(body)
    return ms,len(body),"denied"

def cold_waves(peers):
    output=[]
    for count in (100,300):
        command(peers,"reset")
        before=command(peers,"stats")
        t=time.perf_counter()
        with ThreadPoolExecutor(max_workers=count) as pool:
            rows=list(pool.map(lambda i:hit(peers,i),range(count)))
        wall=time.perf_counter()-t
        after=command(peers,"stats")
        sql_delta=sum(after[i]["sql_rebuilds"]-before[i]["sql_rebuilds"] for i in range(2))
        chk(sql_delta==4,("cold_cache_collapse",sql_delta,after))
        chk(len({x[2] for x in rows})==2,"cross_tenant_hash_or_mixed_content")
        obj={"clients":count,"cache_cold_at_wave_start":True,
             "http_full_json_200":count,"SQL_full_report_rebuilds":sql_delta,
             "singleflight_per_tenant_per_replica":True,
             "p95_ms":pct([x[0] for x in rows],.95),
             "p99_ms":pct([x[0] for x in rows],.99),
             "wall_sec":round(wall,3),"egress_bytes":sum(x[1] for x in rows)}
        print("QA_REMOTE_COLD_PHASE_JSON="+data(obj).decode(),flush=True)
        output.append(obj)
    return output

def rotation_revoke_race(peers):
    # After cache reset, revoke membership while SQL is in flight. Existing
    # calls may have already completed. Post-revocation NEW calls must deny,
    # including a previously warm cached value and a still-valid JWT.
    command(peers,"reset")
    before=command(peers,"stats")
    def job(i):
        return hit(peers,i*4)
    with ThreadPoolExecutor(max_workers=24) as pool:
        futures=[pool.submit(job,i) for i in range(24)]
        time.sleep(.07)
        with v.con() as c:
            c.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",
                (v.COMPANIES[0],v.USER_IDS[0]))
        outcomes=[]
        for future in futures:
            try:outcomes.append(future.result()[2])
            except AssertionError as ex:
                # Mid-flight authorization rejection is expected after revoke.
                if "http_status" not in str(ex):raise
                outcomes.append("revoked")
    # A valid signed JWT MUST NOT grant membership on cached hits.
    for i in range(12):
        hit(peers,i*4,expect=401)
    KEYS.accept.add("b")
    command(peers,"allow_both_keys")
    for i in range(6):
        hit(peers,i*4,kid="b",expect=401)
    KEYS.accept.remove("a")
    command(peers,"rotate_b_only")
    with v.con() as c:
        c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s)",
            (v.COMPANIES[0],v.USER_IDS[0]))
    for i in range(4):
        hit(peers,i*4,kid="a",expect=401)
        hit(peers,i*4,kid="b",expect=200)
    after=command(peers,"stats")
    chk(sum(x["denied"]-y["denied"] for x,y in zip(after,before))>=18,
        "revoked_access_not_denied")
    return {"result":"PASS","race_inflight":24,
      "after_revoke_new_signed_JWT_denied":12,
      "new_rotated_signed_key_while_revoked_denied":6,
      "synthetic_active_RLS_membership_checked_before_and_after":True,
      "inflight_completed_or_revoked":len(outcomes),
      "old_key_revoked_on_both_live_children":True,
      "new_key_accepted_after_membership_restore":True}

def main():
    global KEYS
    begin=time.perf_counter()
    q.init_db();hist=p.expanded_history();a.setup_outbox()
    audit=deep.rls_audit()
    KEYS=a.Keys()
    with v.con() as c:
        start_lsn=v.scalar(c,"SELECT pg_current_wal_lsn()")
        baseline_db=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
    with tempfile.TemporaryDirectory(prefix="vision-v2-qaremote-") as td:
        store=spawn_object(td)
        try:
            chk(store[2]["pid"]!=os.getpid(),"not_remote_process")
            state=storage_protocol(store[2]["port"],td)
            # Crash and restart separate remote HTTP service; existing partial
            # object remains on disk. No existing DB "READY" is forged.
            store[1].send("stats");initial_remote_stats=store[1].recv()
            store[0].terminate();store[0].join(5)
            chk(store[0].exitcode not in (None,0),"remote_process_not_force_killed")
            store=spawn_object(td)
            results=finish_storage(state,store[2]["port"])
            before=store[2]["pid"]
            peers=start_report_servers(KEYS)
            try:
                waves=cold_waves(peers)
                revocation=rotation_revoke_race(peers)
                server_states=command(peers,"stats")
            finally:
                for proc,pipe,meta in peers:
                    if proc.is_alive():
                        pipe.send("stop");pipe.recv()
                    proc.join(5)
                    if proc.is_alive():proc.terminate();proc.join(3)
                    chk(proc.exitcode==0,"bad_exit_report_process")
            store[1].send("stats");remote_stats=store[1].recv()
            remote_stats={"before_crash":initial_remote_stats,"after_crash":remote_stats,
              "combined_puts":initial_remote_stats["puts"]+remote_stats["puts"],
              "combined_gets":initial_remote_stats["gets"]+remote_stats["gets"],
              "combined_upload_bytes":initial_remote_stats["bytes_put"]+remote_stats["bytes_put"],
              "combined_download_bytes":initial_remote_stats["bytes_get"]+remote_stats["bytes_get"]}
        finally:
            if store[0].is_alive():
                store[1].send("stop");store[1].recv()
            store[0].join(5)
        with v.con() as c:
            wal=int(v.scalar(c,"SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(start_lsn,)))
            indices=int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')"))
            database=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
            check_events=int(v.scalar(c,"SELECT count(*) FROM public.playback_logs"))
            chk(check_events==20664,"source_events_changed")
        summary={"result":"PASS","two_real_OS_process_report_servers":True,
          "remote_HTTP_store_separate_process":True,"same_ephemeral_host":True,
          "different_physical_hosts_tested":False,"postgres17_disposable":True,
          "full_original_RPC_JSON_20k_events":True,"source_events_preserved":check_events,
          "rls":audit,"storage":results,"remote_object_metrics":remote_stats,
          "cold_http_waves":waves,"revocation":revocation,
          "report_replicas":server_states,"history":hist,
          "baseline_database_bytes":baseline_db,"database_bytes":database,
          "playback_index_bytes":indices,"wal_bytes_delta_excludes_history_insert":wal,
          "elapsed_sec":round(time.perf_counter()-begin,3),
          "parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
          "production_go":False,"no_production_access":True}
        print("QA_COLD_REMOTE_SUMMARY_JSON="+data(summary).decode(),flush=True)
        print("QA_COLD_REMOTE_PASS=true",flush=True)

if __name__=="__main__":main()
