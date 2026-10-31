"""Vision V2 sustained local HTTP + PG17 CQRS index comparison, QA ONLY.

Each cohort runs 12 five-second upload cycles (~55s) for 100 and 300
concurrent synthetic clients, 50 proofs per cycle, on ONE disposable PG17.
No production sources / JWT / actual Supabase / APK / destructive migrations.
Failures: lost reply after commit, repeat network-503 before commit, DB rollback,
cross-tenant token, changed replay, noncontiguous batch, restart HTTP gateway.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import date
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from collections import Counter
from pathlib import Path
import hashlib,json,math,os,resource,statistics,subprocess,threading,time
from urllib import request,error
import psycopg

DSN="postgresql://postgres:qa-only-local-password@127.0.0.1:5432/vision_v2_quarantine_disposable"
COHORTS=(100,300)
WAVES=12
INTERVAL=5
BATCH=50
SEED_DAY=date(2026,10,31)

def jbytes(x):return json.dumps(x,sort_keys=True,separators=(",",":")).encode()
def sha(x):return hashlib.sha256(x.encode()).hexdigest()
def db():return psycopg.connect(DSN,autocommit=True,connect_timeout=8)
def val(c,query,args=()):return c.execute(query,args).fetchone()[0]
def pct(xs,q):
    if not xs:return 0
    z=sorted(xs)
    return round(z[math.ceil(q*len(z))-1],2)
def auth(cohort,i):return f"qa-token-for-{cohort}-{i:03d}-not-real"
def device(cohort,i):return f"q{cohort}-{i:03d}"
def company(i):return f"tenant-{i%30:02d}"
def event(d,n):
    boot="boot-a" if n<=300 else "boot-b"
    mono=(n-1 if n<=300 else n-301)*15000
    media=f"media-{n%13:02d}"
    return {"seq":n,"event_id":f"evt-{n:08d}","media":media,
            "boot":boot,"mono":mono,
            "hash":sha(f"{d}|{n}|{media}|{boot}|{mono}")}
DDL="""
DO $$ BEGIN IF current_database()<>'vision_v2_quarantine_disposable'
THEN RAISE EXCEPTION 'production DB denied'; END IF; END $$;
CREATE SCHEMA qa_sustain;
CREATE TABLE qa_sustain.devices (
   device text PRIMARY KEY, company text NOT NULL,
   token_sha256 text NOT NULL, watermark bigint NOT NULL DEFAULT 0
);
CREATE TABLE qa_sustain.receipts (
  device text NOT NULL, company text NOT NULL,seq bigint NOT NULL,
  event_id text NOT NULL, media text NOT NULL,boot text NOT NULL,
  mono bigint NOT NULL,hash_sha256 text NOT NULL,
  campaign_id text NULL,
  received_day date NOT NULL,
  played_at timestamptz NULL CHECK(played_at IS NULL),
  billable boolean NOT NULL DEFAULT false CHECK(billable=FALSE),
  PRIMARY KEY(device,seq)
);
CREATE INDEX qa_receipt_company_day ON qa_sustain.receipts(company,received_day);
CREATE INDEX qa_receipt_company_device_day ON qa_sustain.receipts(company,device,received_day);
CREATE TABLE qa_sustain.project_cursor(
  device text PRIMARY KEY,through_seq bigint NOT NULL DEFAULT 0);
CREATE TABLE qa_sustain.daily(
   company text NOT NULL, device text NOT NULL,received_day date NOT NULL,
   unverified bigint NOT NULL DEFAULT 0,
   PRIMARY KEY(device,received_day)
);
CREATE INDEX qa_daily_company_day ON qa_sustain.daily(company,received_day);
REVOKE ALL ON ALL TABLES IN SCHEMA qa_sustain FROM PUBLIC;
"""

class Service(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=512
    def __init__(self):
        super().__init__(("127.0.0.1",0),Handler)
        self.sema=threading.BoundedSemaphore(16)
        self.mu=threading.Lock()
        self.posts=0
        self.errors_503=0
        self.unauth=0
        self.conflicts=0
        self.inserted=0
        self.replayed=0
        self.max_batch=0
        self.after_commit_fail=set()
        self.network_fail=set()
        self.rollback_fail=set()
    def stats(self):
        with self.mu:
            return {key:len(getattr(self,key)) if isinstance(getattr(self,key),set) else getattr(self,key)
                    for key in ("posts","errors_503","unauth","conflicts","inserted","replayed",
                                "max_batch","after_commit_fail","network_fail","rollback_fail")}
    def fail_before(self,d,seq):
        if seq not in (151,351):return False
        key=(d,seq)
        with self.mu:
            if key in self.network_fail:return False
            self.network_fail.add(key)
            # Handler accounts the single 503 response; do not double count.
        return True
    def ingest(self,payload,token):
        if not isinstance(payload,dict) or set(payload)!={"device","company","events"}:
            raise ValueError("envelope")
        d,co,es=payload["device"],payload["company"],payload["events"]
        if not isinstance(es,list) or not 1<=len(es)<=BATCH:
            raise ValueError("batch")
        if any(not isinstance(e,dict) or set(e)!={"seq","event_id","media","boot","mono","hash"}
               for e in es):raise ValueError("event_schema")
        if any(not isinstance(e["seq"],int) or not isinstance(e["mono"],int) or
               e["seq"]<1 or e["mono"]<0 or
               e["hash"]!=sha(f"{d}|{e['seq']}|{e['media']}|{e['boot']}|{e['mono']}")
               for e in es):raise ValueError("event_hash")
        if any(es[i]["seq"]+1!=es[i+1]["seq"] for i in range(len(es)-1)):
            raise ValueError("batch_not_contiguous")
        with self.mu:self.max_batch=max(self.max_batch,len(es))
        if self.fail_before(d,es[0]["seq"]):
            raise RuntimeError("synthetic_network_outage")
        with self.sema:
            with db() as c:
                with c.transaction():
                    row=c.execute("""SELECT company,token_sha256,watermark
                        FROM qa_sustain.devices WHERE device=%s FOR UPDATE""",(d,)).fetchone()
                    if not row or row[0]!=co or row[1]!=sha(token):
                        raise PermissionError("tenant_or_token")
                    old=[e for e in es if e["seq"]<=row[2]]
                    new=[e for e in es if e["seq"]>row[2]]
                    if old:
                        stored=dict(c.execute("""SELECT seq,hash_sha256 FROM qa_sustain.receipts
                          WHERE device=%s AND seq BETWEEN %s AND %s""",
                          (d,old[0]["seq"],old[-1]["seq"])).fetchall())
                        if any(stored.get(e["seq"])!=e["hash"] for e in old):
                            raise ValueError("replay_payload_mismatch")
                    if new:
                        if new[0]["seq"]!=row[2]+1:raise ValueError("gap")
                        c.execute("""INSERT INTO qa_sustain.receipts
                         (device,company,seq,event_id,media,boot,mono,hash_sha256,received_day)
                         SELECT %s,%s,seq,event_id,media,boot,mono,hash,%s
                         FROM unnest(%s::bigint[],%s::text[],%s::text[],%s::text[],
                           %s::bigint[],%s::text[])
                            AS x(seq,event_id,media,boot,mono,hash)""",
                          (d,co,SEED_DAY,[e["seq"] for e in new],[e["event_id"] for e in new],
                           [e["media"] for e in new],[e["boot"] for e in new],
                           [e["mono"] for e in new],[e["hash"] for e in new]))
                        fail_key=(d,new[0]["seq"])
                        if d.endswith("-000") and new[0]["seq"]==101 and fail_key not in self.rollback_fail:
                            with self.mu:self.rollback_fail.add(fail_key)
                            raise RuntimeError("sql_rollback_after_insert_before_watermark")
                        c.execute("UPDATE qa_sustain.devices SET watermark=%s WHERE device=%s",
                                   (new[-1]["seq"],d))
            with self.mu:self.inserted+=len(new);self.replayed+=len(old)
            return {"ack":row[2]+len(new),"new":len(new),"duplicate":len(old)}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def respond(self,status,data):
        b=jbytes(data);self.send_response(status);self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(b)));self.end_headers();self.wfile.write(b)
    def do_POST(self):
        with self.server.mu:self.server.posts+=1
        if self.path!="/qa/ingest":return self.respond(404,{"error":"path"})
        try:
            size=int(self.headers.get("Content-Length","-1"))
            if not 0<size<=16000:raise ValueError("too_large")
            payload=json.loads(self.rfile.read(size))
            out=self.server.ingest(payload,self.headers.get("X-QA-Token",""))
            d=payload["device"]
            with self.server.mu:
                if d not in self.server.after_commit_fail:
                    self.server.after_commit_fail.add(d)
                    self.server.errors_503+=1
                    return self.respond(503,{"error":"lost_reply_after_commit"})
            return self.respond(200,out)
        except PermissionError:
            with self.server.mu:self.server.unauth+=1
            return self.respond(401,{"error":"unauthorized"})
        except ValueError as e:
            with self.server.mu:self.server.conflicts+=1
            return self.respond(409,{"error":str(e)})
        except Exception:
            with self.server.mu:self.server.errors_503+=1
            return self.respond(503,{"error":"simulated_transient"})
def send(base,payload,token):
    u=base+"/qa/ingest"
    req=request.Request(u,method="POST",data=jbytes(payload),
                         headers={"Content-Type":"application/json","X-QA-Token":token})
    start=time.perf_counter()
    try:
        with request.urlopen(req,timeout=25) as r:
            return r.status,json.loads(r.read()),(time.perf_counter()-start)*1000
    except error.HTTPError as e:
        return e.code,json.loads(e.read()),(time.perf_counter()-start)*1000
def project(c):
    start=time.perf_counter()
    with c.transaction():
        pending=c.execute("""SELECT r.device,r.company,r.received_day,
                count(*)::bigint,max(r.seq)::bigint
             FROM qa_sustain.receipts r JOIN qa_sustain.project_cursor p USING(device)
             WHERE r.seq>p.through_seq
             GROUP BY r.device,r.company,r.received_day""").fetchall()
        for d,co,day,count,sequence in pending:
            c.execute("""INSERT INTO qa_sustain.daily(company,device,received_day,unverified)
                VALUES(%s,%s,%s,%s) ON CONFLICT(device,received_day)
                DO UPDATE SET unverified=qa_sustain.daily.unverified+EXCLUDED.unverified""",
                (co,d,day,count))
            c.execute("UPDATE qa_sustain.project_cursor SET through_seq=%s WHERE device=%s",
                      (sequence,d))
    return {"projected_groups":len(pending),"elapsed_ms":round((time.perf_counter()-start)*1000,2)}
class Sampler:
    def __init__(self):
        self.stop=threading.Event()
        self.max_lock=0;self.max_backend=0;self.max_rss=0;self.samples=0
    def loop(self):
        try:
            with db() as c:
                while not self.stop.is_set():
                    try:
                        rows=c.execute("""SELECT count(*) FILTER(WHERE wait_event_type='Lock'),
                              count(*) FROM pg_stat_activity WHERE datname=current_database()""").fetchone()
                        self.max_lock=max(self.max_lock,rows[0])
                        self.max_backend=max(self.max_backend,rows[1])
                        self.max_rss=max(self.max_rss,resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
                        self.samples+=1
                    except psycopg.Error:pass
                    self.stop.wait(.25)
        except Exception as err:print(f"QA_SAMPLER_ERROR={type(err).__name__}",flush=True)
def verify_company(c,d,co):
    rows=c.execute("SELECT count(*) FROM qa_sustain.receipts WHERE device=%s AND company=%s",(d,co)).fetchone()[0]
    assert rows==WAVES*BATCH
def cohort(n):
    service=Service()
    th=threading.Thread(target=service.serve_forever,daemon=True);th.start()
    base=f"http://127.0.0.1:{service.server_address[1]}"
    sampler=Sampler();monitor=threading.Thread(target=sampler.loop,daemon=True);monitor.start()
    lat=[];attempts=[];errors=[]
    start=time.monotonic()
    def client(i):
        d=device(n,i);co=company(i);token=auth(n,i)
        mine=[];failure=0;retries=0
        for wave in range(WAVES):
            # 5-second pacing creates a sustained, not instantaneous, load.
            pause=start+wave*INTERVAL-time.monotonic()
            if pause>0:time.sleep(pause)
            a=wave*BATCH+1
            envelope={"device":d,"company":co,"events":[event(d,k) for k in range(a,a+BATCH)]}
            for trial in range(12):
                try:code,res,elapsed=send(base,envelope,token)
                except Exception as exc:
                    code,res,elapsed=599,{"error":type(exc).__name__},0
                mine.append(elapsed)
                if code==200:
                    assert res["ack"]==a+BATCH-1 and res["new"] in (0,BATCH)
                    retries+=trial
                    break
                failure+=1
                if code not in (503,599):raise AssertionError(f"unexpected_{code}_{res}")
                time.sleep(min(.08*(trial+1),.6))
            else:raise AssertionError(f"not_recovered_{d}_wave{wave}")
        return mine,retries,failure
    try:
        with ThreadPoolExecutor(max_workers=n) as executor:
            futures=[executor.submit(client,i) for i in range(n)]
            for f in as_completed(futures):
                a,b,c=f.result();lat.extend(a);attempts.append(b);errors.append(c)
        with db() as c:
            for i in range(n):
                d=device(n,i)
                assert val(c,"SELECT watermark FROM qa_sustain.devices WHERE device=%s",(d,))==WAVES*BATCH
                verify_company(c,d,company(i))
            # Cross-tenant rejection and altered historic proof.
            d=device(n,0);token=auth(n,0)
            payload={"device":d,"company":company(0),"events":[event(d,k) for k in range(1,51)]}
            code,res,_=send(base,payload,token)
            assert code==200 and res["duplicate"]==50 and res["new"]==0
            code,res,_=send(base,payload,auth(n,1))
            assert code==401
            corrupt=json.loads(jbytes(payload))
            corrupt["events"][0]["media"]="tampered"
            code,res,_=send(base,corrupt,token)
            assert code==409
            gap={"device":d,"company":company(0),"events":[event(d,602)]}
            code,res,_=send(base,gap,token)
            assert code==409
            before=val(c,"SELECT count(*) FROM qa_sustain.receipts")
            out=project(c)
            assert val(c,"SELECT count(*) FROM qa_sustain.receipts")==before
            assert val(c,"SELECT COALESCE(sum(unverified),0) FROM qa_sustain.daily")==before
            assert project(c)["projected_groups"]==0
            assert val(c,"SELECT count(*) FROM qa_sustain.receipts WHERE billable OR played_at IS NOT NULL")==0
            c.execute("SELECT pg_stat_clear_snapshot()")
            s=c.execute("""SELECT coalesce(sum(autovacuum_count),0),coalesce(sum(n_dead_tup),0)
                 FROM pg_stat_all_tables WHERE schemaname='qa_sustain'""").fetchone()
            deadlocks=val(c,"SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()")
            status=service.stats()
            metrics={"result":"PASS","clients":n,"elapsed_s":round(time.monotonic()-start,2),
                     "p95_http_ms":pct(lat,.95),"p99_http_ms":pct(lat,.99),
                     "requests":status["posts"],"accepted_rows":n*WAVES*BATCH,
                     "transient_errors_503":status["errors_503"],
                     "retries":sum(attempts),"duplicate_events":status["replayed"],
                     "network_failures_injected":status["network_fail"],
                     "lost_ack_after_commit_injected":status["after_commit_fail"],
                     "atomic_sql_rollback_injected":status["rollback_fail"],
                     "cross_tenant_auth_rejections":status["unauth"],
                     "payload_or_gap_conflicts":status["conflicts"],
                     "max_batch":status["max_batch"],"max_pg_lock_waiters_sample":sampler.max_lock,
                     "max_pg_backends_seen":sampler.max_backend,
                     "max_python_rss_kib":sampler.max_rss,
                     "sampler_samples":sampler.samples,
                     "autovacuum_count":int(s[0]),"dead_tuple_estimate":int(s[1]),
                     "deadlocks":deadlocks,"cqrs_projector":out,
                     "receipts_relation_bytes":val(c,"SELECT pg_total_relation_size('qa_sustain.receipts')"),
                     "receipt_indexes_bytes":val(c,"SELECT pg_indexes_size('qa_sustain.receipts')"),
                     "daily_bytes":val(c,"SELECT pg_total_relation_size('qa_sustain.daily')")}
            assert status["inserted"]==n*WAVES*BATCH
            assert status["after_commit_fail"]==n
            assert status["network_fail"]==n*2
            assert status["rollback_fail"]==1
            assert status["errors_503"]==3*n+1
            assert sum(attempts)==3*n+1
            assert len(lat)>=n*WAVES
            return metrics
    finally:
        sampler.stop.set();monitor.join(4)
        service.shutdown();service.server_close();th.join(4)
def index_comparison():
    with db() as c:
        # Side-by-side baseline-like indexes from GitHub migrations and
        # 2-index candidate: SAME data, separate disposable table.
        c.execute("""CREATE TABLE qa_sustain.baseline_like (LIKE qa_sustain.receipts INCLUDING ALL)""")
        c.execute("""CREATE INDEX baseline_company_started ON qa_sustain.baseline_like(company,received_day DESC)""")
        c.execute("""CREATE INDEX baseline_company_device_started ON qa_sustain.baseline_like(company,device,received_day DESC)""")
        c.execute("""CREATE INDEX baseline_company_campaign_started ON qa_sustain.baseline_like(company,campaign_id,received_day DESC)
                      WHERE campaign_id IS NOT NULL""")
        c.execute("""CREATE INDEX baseline_company_media_started ON qa_sustain.baseline_like(company,media,received_day DESC)
                      WHERE media IS NOT NULL""")
        c.execute("""CREATE INDEX baseline_campaign_created ON qa_sustain.baseline_like(campaign_id,received_day DESC)
                      WHERE campaign_id IS NOT NULL""")
        c.execute("""INSERT INTO qa_sustain.baseline_like SELECT * FROM qa_sustain.receipts""")
        c.execute("ANALYZE qa_sustain.receipts")
        c.execute("ANALYZE qa_sustain.baseline_like")
        counts=val(c,"SELECT count(*) FROM qa_sustain.receipts")
        assert counts==val(c,"SELECT count(*) FROM qa_sustain.baseline_like")
        idx1=val(c,"SELECT pg_indexes_size('qa_sustain.receipts')")
        idx2=val(c,"SELECT pg_indexes_size('qa_sustain.baseline_like')")
        q1="SELECT count(*) FROM qa_sustain.receipts WHERE company=%s AND received_day=%s"
        q2=q1.replace("qa_sustain.receipts","qa_sustain.baseline_like")
        args=("tenant-00",SEED_DAY)
        assert val(c,q1,args)==val(c,q2,args)
        def exp(q):
            j=c.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) "+q,args).fetchone()[0][0]
            return round(j["Execution Time"],4)
        out={"result":"PASS","rows":counts,"candidate_index_bytes":idx1,
             "baseline_like_index_bytes":idx2,
             "baseline_index_overhead_bytes":idx2-idx1,
             "candidate_query_ms":exp(q1),"baseline_like_query_ms":exp(q2),
             "description":"synthetic reconstruction of indexed columns from GitHub; NOT actual live Supabase indexes"}
        assert idx2>idx1
        return out
def main():
    with db() as c:
        assert val(c,"SELECT current_database()")=="vision_v2_quarantine_disposable"
        assert int(val(c,"SHOW server_version_num"))//10000==17
        c.execute(DDL)
        with c.transaction():
            with c.cursor() as cur:
                for n in COHORTS:
                    cur.executemany("INSERT INTO qa_sustain.devices VALUES(%s,%s,%s,0)",
                      [(device(n,i),company(i),sha(auth(n,i))) for i in range(n)])
                    cur.executemany("INSERT INTO qa_sustain.project_cursor VALUES(%s,0)",
                      [(device(n,i),) for i in range(n)])
    for n in COHORTS:
        result=cohort(n)
        print("QA_SUSTAIN_HTTP_JSON="+json.dumps(result,sort_keys=True,separators=(",",":")),flush=True)
    ix=index_comparison()
    print("QA_INDEX_COMPARISON_JSON="+json.dumps(ix,sort_keys=True,separators=(",",":")),flush=True)
    with db() as c:
        count=val(c,"SELECT count(*) FROM qa_sustain.receipts")
        daily=val(c,"SELECT sum(unverified) FROM qa_sustain.daily")
        assert count==daily==240000
        print("QA_SUSTAIN_FINAL_JSON="+json.dumps({
            "result":"PASS","rows":count,
            "db_bytes":val(c,"SELECT pg_database_size(current_database())"),
            "day_summary_rows":val(c,"SELECT count(*) FROM qa_sustain.daily"),
            "no_delete":True,"no_supabase":True
        },sort_keys=True,separators=(",",":")),flush=True)
if __name__=="__main__":main()
