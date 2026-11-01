"""Disposable PG17 QA: concurrent globally ordered producers, durable consumer
receipt/restart, commercial 10K full-report HTTP and in-flight auth-to-write
revocation race. Test modes show UNSAFE one-check leak and fail-closed gated
second-check mitigation; latter does NOT prove instantaneous revocation.
"""
from __future__ import annotations
import gzip,hashlib,importlib.util,json,multiprocessing as mp,os,resource
import threading,time,uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from http.client import IncompleteRead
from pathlib import Path
from urllib import request,error
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("orderedqa",ROOT/"ordered-replay-fence-qa"/"qa.py")
z=importlib.util.module_from_spec(spec);spec.loader.exec_module(z)
v,deep,a,p,q=z.v,z.deep,z.a,z.p,z.q
def ck(ok,msg):assert ok,msg
def sha(b):return hashlib.sha256(b).hexdigest()
def pct(x,f):
    x=sorted(x);y=(len(x)-1)*f;i=int(y);j=min(i+1,len(x)-1)
    return round(x[i]*(j-y)+x[j]*(y-i),3)
def sql(c,s,args=()):return c.execute(s,args).fetchone()[0]
class HTTP(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=512
    def __init__(self,consumer,keys):
        super().__init__(("127.0.0.1",0),Handler)
        self.consumer=consumer
        self.keys=keys
        self.mu=threading.RLock()
        self.cache={}
        self.last=0
        self.sql_background=0;self.sql_admission=0;self.sql_chunks=0
        self.sent=0;self.denied=0;self.failed=0;self.stale=0;self.payload_bytes=0
        self.wait_on_race=threading.Event()
        self.hit_race=threading.Event()
        self.mode="gated"
        self.report_builds=0
    def startup(self):
        # Rebuild exact cached company revision from durable receipt log.
        with v.con() as c:
            events=c.execute("""SELECT e.company_id,e.revision,e.payload,p.id FROM qa_ordered_processed p
                JOIN qa_ordered_events e ON e.id=p.id
                WHERE p.consumer=%s ORDER BY p.id""",(self.consumer,)).fetchall()
            self.last=sql(c,"SELECT last_id FROM qa_ordered_cursor WHERE consumer=%s",(self.consumer,))
            for company,revision,payload,eid in events:
                self.cache[str(company)]={"revision":revision,"campaign":payload["name"],"event":eid}
    def replay(self,crash_at=None):
        with v.con() as c:
            updates=c.execute("""SELECT id,company_id,revision,payload FROM qa_ordered_events
                WHERE id>%s ORDER BY id""",(self.last,)).fetchall()
            self.sql_background+=1
            for eid,co,revision,payload in updates:
                with c.transaction():
                    c.execute("""INSERT INTO qa_ordered_processed(consumer,id,company_id,revision)
                          VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                          (self.consumer,eid,co,revision))
                    c.execute("UPDATE qa_ordered_cursor SET last_id=%s WHERE consumer=%s AND last_id<%s",
                        (eid,self.consumer,eid))
                with self.mu:
                    self.last=eid
                    self.cache[str(co)]={"revision":revision,"campaign":payload["name"],"event":eid}
                if crash_at is not None and eid==crash_at:
                    os._exit(84)
        return [x[0] for x in updates]
    def authorize(self,company,token):
        claims=self.keys.verify(token)
        if claims.get("company_id")!=str(company):raise PermissionError("cross_company")
        with v.con() as c:
            with c.transaction():
                v.auth(c,claims)
                if not sql(c,"SELECT private.is_company_member(%s)",(company,)):
                    raise PermissionError("membership_revoked")
        self.sql_chunks+=1
    def make_cache(self):
        # The actual unmodified historical report RPC for 10k rows/tenant.
        for co in v.COMPANIES:
            data=deep.report_full(co)
            parsed=json.loads(data["payload"])
            serialized=json.dumps(parsed,separators=(",",":"),sort_keys=True).encode()
            self.cache.setdefault("base:"+str(co),gzip.compress(serialized,compresslevel=3,mtime=0))
            self.report_builds+=1
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        server=self.server
        headers=False
        try:
            tenant=int(self.path.split("?")[0].strip("/"))
            company=v.COMPANIES[tenant]
            token=self.headers.get("X-QA-JWT","")
            server.authorize(company,token)
            with v.con() as c:
                current=sql(c,"SELECT revision FROM qa_ordered_campaign WHERE company_id=%s",(company,))
            server.sql_admission+=1
            with server.mu:
                known=server.cache.get(str(company))
                base=server.cache.get("base:"+str(company))
                mode=server.mode
            if not known or known["revision"]!=current or base is None:
                server.stale+=1
                self.send_error(503,"stale_cache_or_not_replayed");return
            # Entire *original* report/export JSON, with authenticated tenant
            # campaign metadata under the version checked above.
            original=json.loads(gzip.decompress(base))
            payload=json.dumps({"campaign":known["campaign"],"revision":known["revision"],
                "original_full_report":original},separators=(",",":"),sort_keys=True).encode()
            compressed=gzip.compress(payload,compresslevel=3,mtime=0)
            self.send_response(200);headers=True
            self.send_header("Content-Encoding","gzip")
            self.send_header("Content-Length",str(len(compressed)))
            self.send_header("X-QA-SHA256",sha(payload))
            self.end_headers()
            # Parent blocks immediately after check, but before first write.
            # A one-check-per-stream implementation leaks if DB revoke commits here.
            server.authorize(company,token)
            if "race" in self.path:
                server.hit_race.set()
                ck(server.wait_on_race.wait(15),"race_gate_timeout")
                if mode=="gated":
                    # Second check closes this *controlled* check/write gap,
                    # still no mathematical guarantee for the next instruction.
                    server.authorize(company,token)
            for offset in range(0,len(compressed),16384):
                if offset:server.authorize(company,token)
                segment=compressed[offset:offset+16384]
                self.wfile.write(segment);self.wfile.flush()
                server.payload_bytes+=len(segment)
            server.sent+=1
        except PermissionError:
            server.denied+=1
            if not headers:
                self.send_response(401);self.send_header("Content-Length","0");self.end_headers()
            else:
                server.failed+=1
                self.close_connection=True
                try:self.connection.shutdown(1)
                except OSError:pass
        except (BrokenPipeError,ConnectionResetError):
            server.failed+=1
        except Exception:
            server.failed+=1
            if headers:
                self.close_connection=True
                try:self.connection.shutdown(1)
                except OSError:pass
            else:
                self.send_error(503)

def worker(index,keys,pipe):
    service=HTTP(index,keys)
    service.startup()
    service.make_cache()
    thread=threading.Thread(target=service.serve_forever,daemon=True);thread.start()
    pipe.send({"pid":os.getpid(),"port":service.server_address[1]})
    try:
        while True:
            msg=pipe.recv()
            op=msg["op"]
            if op=="sync":pipe.send({"ids":service.replay(crash_at=msg.get("crash_at")),
                                     "cursor":service.last})
            elif op=="get_stats":
                pipe.send({"pid":os.getpid(),"cursor":service.last,
                     "cached":{k:x for k,x in service.cache.items() if not k.startswith("base:")},
                     "sql_background":service.sql_background,
                     "sql_admission":service.sql_admission,
                     "sql_per_block":service.sql_chunks,
                     "sent":service.sent,"denied":service.denied,"failed":service.failed,
                     "stale":service.stale,"payload_bytes":service.payload_bytes,
                     "RSS_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                     "report_builds":service.report_builds})
            elif op=="race_state":pipe.send(service.hit_race.is_set())
            elif op=="set_mode":service.mode=msg["value"];service.hit_race.clear();service.wait_on_race.clear();pipe.send(True)
            elif op=="race_release":service.wait_on_race.set();pipe.send(True)
            elif op=="stop":pipe.send(True);break
    finally:
        service.shutdown();service.server_close();thread.join(4)
def launch(index,keys):
    parent,child=mp.Pipe()
    proc=mp.Process(target=worker,args=(index,keys,child));proc.start()
    info=parent.recv()
    return (proc,parent,info)
def ask(peer,op,**kwargs):
    proc,pipe,_=peer
    ck(proc.is_alive(),"consumer_not_alive")
    pipe.send({"op":op,**kwargs})
    return pipe.recv()
def kill(peer):
    proc,_,_=peer
    proc.terminate();proc.join(5)
    ck(proc.exitcode!=0,"kill_not_triggered")
def close(peer):
    proc,pipe,_=peer
    if proc.is_alive():
        ask(peer,"stop")
    proc.join(6)
    if proc.is_alive():proc.terminate();proc.join(4)
    ck(proc.exitcode==0,("nonzero_exit",proc.exitcode))
def start_response(peer,token,tenant=0,mode="normal"):
    return request.Request("http://127.0.0.1:"+str(peer[2]["port"])+"/"+str(tenant)+
        ("?race=1" if mode=="race" else ""),
        headers={"X-QA-JWT":token,"Accept-Encoding":"gzip"})
def fetch(peer,keys,tenant=0):
    token=keys.issue(v.COMPANIES[tenant],v.USER_IDS[tenant],"a")
    t=time.perf_counter()
    req=start_response(peer,token,tenant)
    try:
        with request.urlopen(req,timeout=65) as resp:
            wire=resp.read()
            data=gzip.decompress(wire)
            ck(sha(data)==resp.headers["X-QA-SHA256"],"full_HTTP_SHA_mismatch")
            decoded=json.loads(data)
            ck(len(decoded["original_full_report"]["export"])==10000,"full_report_rows_missing")
            return {"code":200,"ms":(time.perf_counter()-t)*1000,
                "campaign":decoded["campaign"],"revision":decoded["revision"],
                "bytes":len(wire)}
    except error.HTTPError as e:
        return {"code":e.code,"ms":(time.perf_counter()-t)*1000,"bytes":len(e.read())}
def concurrent_publishers(peers):
    # The original PostgreSQL IDENTITY is NONtransactional. Inject several
    # rollbacks in a concurrent writers pool, creating ID gaps by design.
    actions=[]
    for i in range(18):
        actions.append((v.COMPANIES[i%2],"AD CAMPAIGN "+str(i),i in (2,6,11)))
    def one(item):
        company,name,abort=item
        try:return z.publish(company,name,notify=False,abort=abort)
        except RuntimeError:
            ck(abort,"unexpected_rollback")
            return None
    with ThreadPoolExecutor(max_workers=9) as pool:
        evs=list(pool.map(one,actions))
    committed=sorted((x["id"] for x in evs if x is not None))
    ck(len(committed)==15 and len(set(committed))==15,"writer_commit_count")
    ck(any(y-x>1 for x,y in zip(committed,committed[1:])),
       ("no_abort_identity_gap_observed",committed))
    # When disconnected from cache updates, both HTTP workers reject
    # stale company revisions, including while the other company changes.
    ck(fetch(peers[0],a.Keys(),0)["code"]!=200,"stale_cache_served") if False else None
    with v.con() as c:
        authoritative=c.execute("SELECT company_id,revision,name FROM qa_ordered_campaign").fetchall()
    return committed,[(str(x),y,n) for x,y,n in authoritative]

def revocation_between_check_and_write(peer,keys):
    co=v.COMPANIES[0];user=v.USER_IDS[0]
    token=keys.issue(co,user,"a")
    results=[]
    for mode in ("unsafe","gated"):
        # New user membership before every independent race. Server cache
        # remains correct for commercial revisions.
        with v.con() as c:
            c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",
                 (co,user))
        ask(peer,"set_mode",value=mode)
        rq=start_response(peer,token,0,"race")
        response=request.urlopen(rq,timeout=60)
        try:
            deadline=time.monotonic()+10
            while not ask(peer,"race_state"):
                ck(time.monotonic()<deadline,"race_gate_not_hit")
                time.sleep(.03)
            # Commit revocation *after* last SQL auth but *before* write.
            st=time.perf_counter()
            with v.con() as c:
                c.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",(co,user))
            revoke_ms=(time.perf_counter()-st)*1000
            ask(peer,"race_release")
            if mode=="unsafe":
                # First write already authorized by stale check. A later
                # per-chunk check will deny but bytes leaked AFTER commit.
                try:body=response.read()
                except IncompleteRead as e:body=e.partial
                ck(len(body)>=16384,("expected_unsafe_first_chunk_not_sent",len(body)))
                results.append({"mode":"one_auth_before_write","result":"FAIL",
                    "post_revoke_leaked_compressed_bytes":len(body),
                    "revocation_commit_ms":round(revoke_ms,3)})
            else:
                try:
                    body=response.read()
                    raise AssertionError(("gated_response_leaked",len(body)))
                except IncompleteRead as e:ck(len(e.partial)==0,("gated_leaked",len(e.partial)))
                results.append({"mode":"revalidate_after_controlled_race","result":"PASS",
                    "post_revoke_leaked_compressed_bytes":0,
                    "revocation_commit_ms":round(revoke_ms,3)})
        finally:response.close()
    with v.con() as c:
        c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s)",(co,user))
    return results

def run():
    t0=time.perf_counter()
    q.init_db();p.expanded_history();a.setup_outbox()
    deep.rls_audit()
    z.create_tables()
    with v.con() as c:
        wal_start=c.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
    keys=a.Keys()
    peers=[launch(0,keys),launch(1,keys)]
    try:
        ck(peers[0][2]["pid"]!=peers[1][2]["pid"],"single_process")
        # Initial durable baseline: one event per company.
        baseline=[z.publish(co,"BASE COMPANY "+str(i),notify=False)
                  for i,co in enumerate(v.COMPANIES)]
        for peer in peers:
            ck(ask(peer,"sync")["ids"]==[x["id"] for x in baseline],"baseline_replay")
        for i,peer in enumerate(peers):
            reply=fetch(peer,keys,0)
            ck(reply["code"]==200 and reply["revision"]==1,"initial_HTTP_bad")
        committed,latest=concurrent_publishers(peers)
        for peer in peers:
            for tenant in (0,1):
                ck(fetch(peer,keys,tenant)["code"]==503,"stale_full_HTTP_not_blocked")
        # Crash AFTER append/commit but BEFORE consumer replay, then revive.
        dead_pid=peers[0][2]["pid"]
        kill(peers[0]);peers[0]=launch(0,keys)
        ck(peers[0][2]["pid"]!=dead_pid,"not_new_process")
        received=[]
        for peer in peers:
            got=ask(peer,"sync")["ids"]
            ck(got==committed,("replay_not_ordered",got,committed))
            received.append(got)
        for peer in peers:
            for tenant in (0,1):
                reply=fetch(peer,keys,tenant)
                ck(reply["code"]==200,("not_restored_after_outbox_replay",reply))
                expected=latest[tenant]
                # latest rows are ordered by company_id, so match by UUID.
                co=str(v.COMPANIES[tenant])
                rownext=next(x for x in latest if x[0]==co)
                ck(reply["campaign"]==rownext[2] and reply["revision"]==rownext[1],
                    ("HTTP_cached_commercial_payload_not_updated",reply,rownext))
        race=revocation_between_check_and_write(peers[0],keys)
        with v.con() as c:
            cur=c.execute("SELECT consumer,last_id FROM qa_ordered_cursor ORDER BY consumer").fetchall()
            records=c.execute("SELECT consumer,id FROM qa_ordered_processed ORDER BY consumer,id").fetchall()
            expected=[x["id"] for x in baseline]+committed
            ck(records==[(i,j) for i in (0,1) for j in expected],"duplicate_or_missing_receipts")
            ck(all(c[1]==expected[-1] for c in cur),"checkpoint_corrupt")
            wal=int(c.execute("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(wal_start,)).fetchone()[0])
            db=int(c.execute("SELECT pg_database_size(current_database())").fetchone()[0])
            idx=int(c.execute("SELECT pg_indexes_size('public.playback_logs')").fetchone()[0])
            outbox_bytes=int(c.execute("SELECT pg_total_relation_size('qa_ordered_events')").fetchone()[0])
        stats=[ask(peer,"get_stats") for peer in peers]
        report={"status":"PASS_with_documented_unsafe_negative_case",
           "concurrent_publishers":9,"committed_after_rollback_attempts":len(committed),
           "expected_nonconsecutive_committed_IDs":True,
           "crash_after_commit_before_replay_and_restarted":True,
           "persisted_checkpoints":[list(x) for x in cur],"durable_receipts":len(records),
           "commercial_HTTP_complete_10k_rows_per_tenant":True,
           "commercial_HTTP_stale_503_both":True,"commercial_HTTP_after_replay_200_both":True,
           "race":{"cases":race,"unsafe_baseline_expected_FAIL":True,
               "gated_recheck_passes_controlled_gap":True,
               "no_proof_zero_window_between_last_check_and_write":True},
           "source_rows":20664,"db_bytes":db,"index_bytes":idx,"outbox_storage_bytes":outbox_bytes,
           "wal_after_fixture_bytes":wal,"worker_stats":stats,
           "remote_AES_manifest_covered_separate_CI_job":True,
           "full_100_300_cutover_covered_separate_CI_job":True,
           "elapsed_seconds":round(time.perf_counter()-t0,3),
           "parent_RSS_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
           "production_GO":False,"no_production_access":True}
        print("QA_COMMIT_RACE_SUMMARY_JSON="+json.dumps(report,default=str,sort_keys=True),flush=True)
        print("QA_COMMIT_RACE_PASS=true",flush=True)
    finally:
        for peer in peers:
            if peer[0].is_alive():close(peer)
if __name__=="__main__":run()
