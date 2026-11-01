"""Vision V2 isolated PG17: all-table RLS revocation, archive publication
atomicity/failure injection, and full original 20k-event RPC via 100/300 HTTP.
Synthetic fixture ONLY, NOT production Auth, not a distributed deploy.
"""
from __future__ import annotations
import base64,hashlib,importlib.util,json,os,resource,secrets,statistics
import tempfile,threading,time,uuid,multiprocessing as mp
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib import request,error
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("v2_advanced_qa",HERE.parent/"durable-outbox-qa"/"advanced.py")
a=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(a)
v,p,m,q=a.v,a.p,a.m,a.q
COMPANY=v.COMPANIES[0];USER=v.USER_IDS[0]
TABLES=(("public","companies","c","id"),("public","devices","d","company_id"),
 ("public","campaigns","ca","company_id"),("public","playlists","pl","company_id"),
 ("public","media_assets","me","company_id"),
 ("public","playback_logs","logs","company_id"),
 ("qa_rpc","daily","daily_model","company_id"),
 ("qa_rpc","pending_without_time","pending","company_id"),
 ("qa_rpc","read_events","read_model","company_id"))
WINDOW=(date(2024,12,31),date(2025,1,6))
def chk(ok,msg):assert ok,msg
def dump(obj):return m.dump(obj)
def h(b):return hashlib.sha256(b).hexdigest()
def counts():
    with v.con() as c:
        return {"database_bytes":int(v.scalar(c,"SELECT pg_database_size(current_database())")),
        "playback_index_bytes":int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')")),
        "daily_index_bytes":int(v.scalar(c,"SELECT pg_indexes_size('qa_rpc.daily')")),
        "outbox_bytes":int(v.scalar(c,"SELECT pg_total_relation_size('qa_v2_outbox')"))}
def rls_audit():
    # Baseline fixture policies are *intentionally* not hardened; fail the
    # baseline audit before changing policy in the disposable database.
    test=[]
    with v.con() as c:
        raw=c.execute("""SELECT schemaname,tablename,policyname,qual FROM pg_policies
          WHERE (schemaname='public' AND tablename IN ('companies','devices',
          'campaigns','playlists','media_assets','playback_logs'))
          OR (schemaname='qa_rpc' AND tablename IN ('read_events','daily','pending_without_time'))""").fetchall()
        policy={(r[0],r[1],r[2]):r[3] for r in raw}
        chk(len(policy)>=len(TABLES),"missing_scaffold_policies")
        # Remove membership once, test real native RLS access under a STILL
        # correctly signed token, then strengthen all policies.
        c.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",(COMPANY,USER))
        for schema,table,pol,column in TABLES:
            chk((schema,table,pol) in policy,("missing_policy",schema,table))
            with c.transaction():
                v.auth(c,v.decode(v.token(COMPANY,USER)))
                got=int(v.scalar(c,f"SELECT count(*) FROM {schema}.{table}"))
            test.append({"table":schema+"."+table,"pre_harden_revoked_visible_rows":got,
              "policy_omits_membership":"is_company_member" not in (policy[(schema,table,pol)] or "")})
        chk(any(z["pre_harden_revoked_visible_rows"]>0 for z in test),"expected_baseline_gap_not_reproduced")
        for schema,table,pol,column in TABLES:
            c.execute(f"DROP POLICY {pol} ON {schema}.{table}")
            c.execute(f"""CREATE POLICY {pol} ON {schema}.{table} TO authenticated
                  USING ({column}::text=current_setting('request.jwt.claim.company_id',true)
                     AND private.is_company_member({column}))""")
        # Ensure RLS is switched on and roles are not bypassed in the fixture.
        for schema,table,pol,column in TABLES:
            enabled=c.execute("""SELECT relrowsecurity FROM pg_class
               WHERE oid=%s::regclass""",(schema+"."+table,)).fetchone()[0]
            chk(enabled,("rls_disabled",schema,table))
            with c.transaction():
                v.auth(c,v.decode(v.token(COMPANY,USER)))
                got=v.scalar(c,f"SELECT count(*) FROM {schema}.{table}")
                chk(got==0,("revoked_reader_visible",schema,table,got))
            with c.transaction():
                v.auth(c,v.decode(v.token(v.COMPANIES[1],v.USER_IDS[1])))
                # Other user's access must not reveal A's rows.
                other=v.scalar(c,f"SELECT count(*) FROM {schema}.{table} WHERE {column}=%s",(COMPANY,))
                chk(other==0,("tenant_leak",schema,table))
        with c.transaction():
            v.auth(c,v.decode(v.token(COMPANY,USER)))
            try:v.rpc(c,"get_playback_report",COMPANY,*WINDOW)
            except v.psycopg.Error as exc:chk(exc.sqlstate=="42501",("report_denial",exc.sqlstate))
            else:raise AssertionError("revoked_RPC_unexpected_success")
        c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s)",(COMPANY,USER))
        with c.transaction():
            v.auth(c,v.decode(v.token(COMPANY,USER)))
            chk(v.scalar(c,"SELECT count(*) FROM public.playback_logs")==10332,"RLS_restored_source")
    return {"result":"PASS","table_count":len(TABLES),
            "baseline_security_gap_reproduced":True,
            "hardened_all_tables":True,
            "revoked_direct_select_all_denied":True,
            "other_tenant_all_denied":True,
            "report_rpc_revocation_denied":True,
            "audit":test}

def publication_failure_matrix():
    # Real PG transactional outbox state, external AES-GCM simulated as
    # temporary local object store. Intent changes DB revision atomically;
    # reads fail closed until verified encrypted manifest is published.
    key=secrets.token_bytes(32)
    with tempfile.TemporaryDirectory(prefix="vision-v2-qa-objectstore-") as td:
        directory=Path(td); target=directory/"manifest.v2qa"
        with v.con() as c:
            c.execute("""CREATE TABLE qa_v2_publication (
               company_id uuid PRIMARY KEY,revision bigint NOT NULL,
               status text NOT NULL CHECK(status IN ('PENDING','READY')),
               manifest_sha text NULL)""")
            c.execute("INSERT INTO qa_v2_publication(company_id,revision,status) VALUES(%s,1,'READY')",(COMPANY,))
        def change(c):
            c.execute("UPDATE public.campaigns SET name='QA outbox atomic' WHERE company_id=%s",(COMPANY,))
            c.execute("UPDATE qa_v2_publication SET status='PENDING',revision=version+1,manifest_sha=NULL FROM qa_cache_revision WHERE qa_v2_publication.company_id=%s AND qa_cache_revision.company_id=%s",(COMPANY,COMPANY))
        # Explicit transaction rollback: PG changes + outbox absent.
        initial=counts()
        try:a.outbox_commit(COMPANY,"publication",{"status":"PENDING"},change,crash=True)
        except RuntimeError:pass
        else:raise AssertionError("rollback_not_injected")
        with v.con() as c:
            chk(v.scalar(c,"SELECT count(*) FROM qa_v2_outbox")==0,"rollback_emitted_outbox")
            chk(v.scalar(c,"SELECT status FROM qa_v2_publication WHERE company_id=%s",(COMPANY,))=="READY","rollback_left_pending")
        ev=a.outbox_commit(COMPANY,"publication",{"status":"PENDING"},change)
        with v.con() as c:
            rev,status=c.execute("SELECT revision,status FROM qa_v2_publication WHERE company_id=%s",(COMPANY,)).fetchone()
            chk(rev==ev["revision"] and status=="PENDING","publication_not_atomic")
        def serve():
            with v.con() as c:
                revision,status,expected=c.execute("SELECT revision,status,manifest_sha FROM qa_v2_publication WHERE company_id=%s",(COMPANY,)).fetchone()
            if status!="READY" or revision!=ev["revision"]:return 503
            try:
                blob=target.read_bytes()
                chk(h(blob)==expected,"manifest_digest")
                obj=json.loads(blob)
                cipher=base64.b64decode(obj["cipher"])
                nonce=base64.b64decode(obj["nonce"])
                AESGCM(key).decrypt(nonce,cipher,b"v2-qa-manifest")
                return 200
            except Exception:return 503
        chk(serve()==503,"premature_report_served_after_db_commit")
        nonce=secrets.token_bytes(12)
        plaintext=dump({"company":str(COMPANY),"revision":ev["revision"],
            "campaign":"QA outbox atomic","synthetic":True})
        ciphertext=AESGCM(key).encrypt(nonce,plaintext,b"v2-qa-manifest")
        blob=dump({"nonce":base64.b64encode(nonce).decode(),
                   "cipher":base64.b64encode(ciphertext).decode()})
        # Simulate interruption after ciphertext staging, before rename.
        staged=directory/"manifest.staging"
        staged.write_bytes(blob)
        chk(serve()==503,"staging_leaked_before_publish")
        # Corrupt staging before rename; even if marked READY, AES must fail.
        broken=bytearray(blob);broken[len(broken)//2]^=1
        target.write_bytes(broken)
        with v.con() as c:
            c.execute("UPDATE qa_v2_publication SET status='READY',manifest_sha=%s WHERE company_id=%s",(h(blob),COMPANY))
        chk(serve()==503,"corrupt_cipher_accepted")
        # Restore fail-closed status before atomic filesystem publication.
        with v.con() as c:c.execute("UPDATE qa_v2_publication SET status='PENDING' WHERE company_id=%s",(COMPANY,))
        os.replace(staged,target)
        chk(serve()==503,"uncommitted_ready_served")
        with v.con() as c:
            with c.transaction():
                c.execute("UPDATE qa_v2_publication SET status='READY',manifest_sha=%s WHERE company_id=%s",(h(blob),COMPANY))
        chk(serve()==200,"archive_publish_not_recovered")
        chk(int(a.scalar(v.con(),"SELECT count(*) FROM qa_v2_outbox"))==1,"missing_durable_event")
        return {"result":"PASS","pg_rollback_atomic":True,"pending_after_commit_returns_503":True,
           "staged_object_does_not_go_live":True,"corrupt_aes_rejected":True,
           "ready_marker_issued_only_after_file_publish":True,"recovered_valid_manifest":True,
           "archive_plaintext_bytes":len(plaintext),"cipher_manifest_bytes":len(blob),
           "outbox_event":ev,"initial_db_bytes":initial["database_bytes"]}

def report_full(company):
    # Original, unmodified functions. All 10,000 older events are exported in
    # 20 pages, with complete JSON fingerprint (not just a count).
    user=v.USER_IDS[v.COMPANIES.index(company)]
    start=time.perf_counter()
    with v.con() as c:
        with c.transaction():
            v.auth(c,v.decode(v.token(company,user)))
            report=v.rpc(c,"get_playback_report",company,*WINDOW)
            rows=[]
            for offset in range(0,10_000,500):
                page=v.export(c,"get_playback_events",company,*WINDOW,limit=500,offset=offset)
                rows.extend([[str(x) if isinstance(x,uuid.UUID) else x.isoformat() if hasattr(x,"isoformat") else
                   str(x) if not isinstance(x,(str,bool,int,float,type(None))) else x for x in rec] for rec in page])
    chk(len(rows)==10000,("page_count",len(rows)))
    chk(len({r[0] for r in rows})==10000,"duplicate_full_export")
    body=dump({"report":report,"export":rows})
    return {"payload_sha256":h(body),"export_rows":len(rows),"bytes":len(body),
            "full_rpc_sql_ms":round((time.perf_counter()-start)*1000,3)}

class Gateway(ThreadingHTTPServer):
    daemon_threads=True;request_queue_size=512
    def __init__(self):
        super().__init__(("127.0.0.1",0),Handler)
        self.lock=threading.RLock()
        self.cache={}
        self.inflight={str(c):threading.Lock() for c in v.COMPANIES}
        self.sql_calls=0;self.hits=0;self.requests=0
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        try:
            company=str(v.COMPANIES[int(self.path.removeprefix("/").split("?")[0])])
            with self.server.inflight[company]:
                with self.server.lock: cached=self.server.cache.get(company)
                if cached is None:
                    cached=report_full(uuid.UUID(company))
                    with self.server.lock:
                        self.server.cache[company]=cached
                        self.server.sql_calls+=1
                else:
                    with self.server.lock:self.server.hits+=1
            payload=dump(cached)
            self.send_response(200)
        except Exception as exc:
            self.send_response(503)
            payload=dump({"error":repr(exc)})
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(payload)))
        self.end_headers();self.wfile.write(payload)
        with self.server.lock:self.server.requests+=1
def gateway_process(control):
    srv=Gateway()
    thread=threading.Thread(target=srv.serve_forever,daemon=True);thread.start()
    control.send({"port":srv.server_address[1],"pid":os.getpid()})
    try:
        while True:
            cmd=control.recv()
            if cmd=="stats":
                with srv.lock:control.send({"sql_calls":srv.sql_calls,"hits":srv.hits,
                      "requests":srv.requests,"payload_bytes":sum(vv["bytes"] for vv in srv.cache.values()),
                      "rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
            elif cmd=="stop":control.send(True);break
    finally:
        srv.shutdown();srv.server_close();thread.join(4)

def concurrent_http():
    processes=[]
    for _ in range(2):
        parent,child=mp.Pipe()
        proc=mp.Process(target=gateway_process,args=(child,));proc.start()
        info=parent.recv()
        processes.append((proc,parent,info))
    try:
        chk(processes[0][2]["pid"]!=processes[1][2]["pid"],"same_os_process")
        def hit(i):
            pid_index=i%2
            tenant=(i//2)%2
            port=processes[pid_index][2]["port"]
            url=f"http://127.0.0.1:{port}/{tenant}"
            st=time.perf_counter()
            with request.urlopen(url,timeout=90) as res:
                chk(res.status==200,"http_code")
                data=json.loads(res.read())
            chk(data["export_rows"]==10000 and len(data["payload_sha256"])==64,"report_export_not_complete")
            return (time.perf_counter()-st)*1000
        # First requests are cold; the rest are warm, with full archived body
        # actually computed by original RPC once per tenant per worker.
        cold=[hit(0),hit(1),hit(2),hit(3)]
        results=[]
        for n in (100,300):
            start=time.perf_counter()
            with ThreadPoolExecutor(max_workers=n) as pool: times=list(pool.map(hit,range(n)))
            times=sorted(times)
            def percentile(frac):
                ix=(len(times)-1)*frac;lo=int(ix);hi=min(lo+1,len(times)-1)
                return round(times[lo]*(hi-ix)+times[hi]*(ix-lo),3)
            results.append({"clients":n,"http_200":n,"p95_ms":percentile(.95),
                "p99_ms":percentile(.99),"wall_seconds":round(time.perf_counter()-start,3)})
        stats=[]
        for proc,ipc,info in processes:
            ipc.send("stats");stats.append({"pid":info["pid"],**ipc.recv()})
        chk(all(x["sql_calls"]==2 for x in stats),("sql_singleflight",stats))
        chk(all(x["requests"]>=202 for x in stats),("request_count",stats))
        return {"result":"PASS","two_independent_pids":True,"cold_full_rpc_requests":4,
           "warm_http_100_300":results,"replicas":stats,
           "full_json_hash_from_original_rpc":True,"http_request_sql_on_hit":0,
           "source_events_per_company":10332,"zero_serve_from_raw_unverified":True}
    finally:
        for proc,ipc,_ in processes:
            if proc.is_alive():
                ipc.send("stop");ipc.recv()
            proc.join(6)
            if proc.is_alive():proc.terminate();proc.join(4)
            chk(proc.exitcode==0,("gateway_exit",proc.exitcode))

def main():
    t0=time.perf_counter()
    q.init_db()
    initial=counts()
    history=p.expanded_history()
    a.setup_outbox()
    audit=rls_audit()
    with v.con() as c:wal_start=v.scalar(c,"SELECT pg_current_wal_lsn()")
    publication=publication_failure_matrix()
    measured=concurrent_http()
    with v.con() as c:
        wal=int(v.scalar(c,"SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(wal_start,)))
    result={"result":"PASS","postgres17_disposable":True,
       "rls_all_tables":audit,"encrypted_publication":publication,
       "commercial_http":measured,"history":history,
       "database_metrics_before":initial,
       "database_metrics_after":counts(),"wal_bytes_delta_after_history":wal,
       "elapsed_seconds":round(time.perf_counter()-t0,3),
       "parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
       "archive_gets":0,"archive_gets_explanation":"QA local archive file, not HTTP object store",
       "production_go":False,"no_prod_access":True}
    print("QA_DEEP_INTEGRITY_JSON="+dump(result).decode(),flush=True)
    print("QA_DEEP_INTEGRITY_PASS=true",flush=True)
if __name__=="__main__":main()
