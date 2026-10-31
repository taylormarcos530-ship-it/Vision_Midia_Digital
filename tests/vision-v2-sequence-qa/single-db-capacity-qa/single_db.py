"""Vision V2 single PostgreSQL 17 progressive capacity QA, entirely disposable.

All records synthetic. Actual SQL INSERT...SELECT generates rows inside ONE PG17
database at 1M/3M/6M/12.096M checkpoints; this is fast server-side bulk load,
NOT real HTTP ingress. A separate loopback HTTP test sends up to 300 clients
concurrently, each with 50 proofs, to the same database.

Never connect to Supabase or production. No DELETE of original receipts.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date,timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib,json,math,os,resource,shutil,sys,threading,time
from urllib.parse import parse_qs,urlsplit
import urllib.request,urllib.error
import psycopg

DSN="postgresql://postgres:qa-only-local-password@127.0.0.1:5432/vision_v2_quarantine_disposable"
TARGET=12_096_000
TVS=300
CHUNK=100_000
STAGES=[1_000_000,3_000_000,6_000_000,12_096_000]
DISK_MIN=4*1024**3
PG_MAX=5*1024**3
WAL_MAX=12*1024**3
MAX_TIME=1350
BASE_DATE=date(2026,10,31)
def db():return psycopg.connect(DSN,autocommit=True,connect_timeout=6)
def one(c,q,args=()):return c.execute(q,args).fetchone()[0]
def sha(v):return hashlib.sha256(v.encode()).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(",",":")).encode()
def p95(v):
    v=sorted(v)
    return round(v[math.ceil(.95*len(v))-1],3) if v else 0
def free():return shutil.disk_usage("/").free
def device(n):return f"tv-{n:03d}"
def tenant(n):return f"tenant-{n%30:02d}"
def event(dev,seq):
    boot="qa-A" if seq<=17280 else "qa-B"
    first=1 if boot=="qa-A" else 17281
    elapsed=(seq-first)*15000
    media=f"media-{seq%19:02d}"
    hashed=sha(f"{dev}|{seq}|{media}|{boot}|{elapsed}")
    return {"seq":seq,"event_id":f"proof-{seq:08d}","media":media,
            "boot":boot,"mono":elapsed,"hash":hashed}
DDL="""
DO $$ BEGIN IF current_database()<>'vision_v2_quarantine_disposable' THEN
 RAISE EXCEPTION 'NO PRODUCTION DATABASE'; END IF; END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA qa_single;
CREATE TABLE qa_single.devices (
    device TEXT PRIMARY KEY, company TEXT NOT NULL,stream TEXT NOT NULL,
    token_sha256 TEXT NOT NULL, watermark BIGINT NOT NULL DEFAULT 0,
    command_revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE qa_single.proofs (
    received_month DATE NOT NULL,received_day DATE NOT NULL,
    device TEXT NOT NULL,company TEXT NOT NULL,seq BIGINT NOT NULL,
    event_id TEXT NOT NULL,media TEXT NOT NULL,boot TEXT NOT NULL,
    mono BIGINT NOT NULL, hash_sha256 TEXT NOT NULL,
    played_at TIMESTAMPTZ NULL CHECK (played_at IS NULL),
    billable BOOL NOT NULL DEFAULT FALSE CHECK (billable=FALSE),
    PRIMARY KEY(received_month,device,seq)
) PARTITION BY RANGE(received_month);
CREATE TABLE qa_single.proofs_oct PARTITION OF qa_single.proofs
 FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE qa_single.proofs_nov PARTITION OF qa_single.proofs
 FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE INDEX qa_single_dev_seq_oct ON qa_single.proofs_oct(device,seq);
CREATE INDEX qa_single_dev_seq_nov ON qa_single.proofs_nov(device,seq);
CREATE INDEX qa_single_company_day_oct ON qa_single.proofs_oct(company,received_day);
CREATE INDEX qa_single_company_day_nov ON qa_single.proofs_nov(company,received_day);
CREATE TABLE qa_single.projector(device TEXT PRIMARY KEY, through_seq BIGINT NOT NULL DEFAULT 0);
CREATE TABLE qa_single.daily(
    device TEXT NOT NULL,company TEXT NOT NULL,received_day DATE NOT NULL,
    count_unverified BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY(device,received_day));
CREATE INDEX qa_single_daily_company_day ON qa_single.daily(company,received_day);
REVOKE ALL ON ALL TABLES IN SCHEMA qa_single FROM PUBLIC;
"""
# ordinal = (seq-1)*TVS + tv_index + 1, guarantees 1..40320 per TV
# in one database. SQL SHA-256 identical to Python event(). 
BULK_SQL="""
WITH source AS (
 SELECT ((g-1) %% 300)::int AS tv,
        ((g-1) / 300 + 1)::bigint AS seq
 FROM generate_series(%s::bigint,%s::bigint) AS g
), ids AS (
 SELECT ('tv-' || lpad(tv::text,3,'0')) AS device,
        ('tenant-' || lpad((tv%%30)::text,2,'0')) AS company,
        seq,
        ('proof-' || lpad(seq::text,8,'0')) AS event_id,
        ('media-' || lpad((seq%%19)::text,2,'0')) AS media,
        CASE WHEN seq<=17280 THEN 'qa-A' ELSE 'qa-B' END AS boot,
        (seq-CASE WHEN seq<=17280 THEN 1 ELSE 17281 END)*15000 AS mono,
        ('2026-10-31'::date + ((seq-1)/5760)::int) AS received_day
 FROM source
)
INSERT INTO qa_single.proofs
 (received_month,received_day,device,company,seq,event_id,media,boot,mono,hash_sha256)
SELECT date_trunc('month',received_day)::date,received_day,device,company,seq,
       event_id,media,boot,mono,
       encode(digest(device||'|'||seq||'|'||media||'|'||boot||'|'||mono,'sha256'),'hex')
FROM ids
"""
def load_chunk(c,start,end):
    with c.transaction():
        c.execute(BULK_SQL,(start,end))
        # Atomic cursor update in same commit as receipts. 
        c.execute("""UPDATE qa_single.devices d SET watermark=
           CASE WHEN %s::bigint>=CAST(substring(d.device FROM 4) AS integer)+1
             THEN ((%s::bigint-(CAST(substring(d.device FROM 4) AS integer)+1))/300)+1
             ELSE 0 END""",(end,end))
def project(c):
    began=time.perf_counter()
    with c.transaction():
        lag=one(c,"""SELECT MAX(d.watermark-p.through_seq) FROM qa_single.devices d
              JOIN qa_single.projector p USING(device)""")
        c.execute("""INSERT INTO qa_single.daily(device,company,received_day,count_unverified)
            SELECT r.device,r.company,r.received_day,count(*)
            FROM qa_single.proofs r JOIN qa_single.projector p USING(device)
            WHERE r.seq>p.through_seq
            GROUP BY r.device,r.company,r.received_day
            ON CONFLICT(device,received_day) DO UPDATE
            SET count_unverified=qa_single.daily.count_unverified+EXCLUDED.count_unverified""")
        c.execute("""UPDATE qa_single.projector p SET through_seq=d.watermark
            FROM qa_single.devices d WHERE d.device=p.device""")
    return {"lag_events_max":lag,"catchup_s":round(time.perf_counter()-began,3)}
def metrics(c,wal_start):
    size=one(c,"SELECT pg_database_size(current_database())")
    wal=int(one(c,"SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),%s::pg_lsn)",(wal_start,)))
    idx=sum(one(c,"SELECT pg_indexes_size(%s::regclass)",(f"qa_single.proofs_{m}",)) for m in ("oct","nov"))
    rel=sum(one(c,"SELECT pg_total_relation_size(%s::regclass)",(f"qa_single.proofs_{m}",)) for m in ("oct","nov"))
    cqrs=one(c,"SELECT pg_total_relation_size('qa_single.daily')")
    c.execute("SELECT pg_stat_clear_snapshot()")
    stat=c.execute("""SELECT COALESCE(sum(n_dead_tup),0),COALESCE(sum(autovacuum_count),0),
                COALESCE(sum(vacuum_count),0)
                FROM pg_stat_all_tables WHERE schemaname='qa_single'""").fetchone()
    activity=c.execute("""SELECT state,count(*) FROM pg_stat_activity
                 WHERE datname=current_database() GROUP BY state""").fetchall()
    waiting=one(c,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")
    deadlocks=one(c,"SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()")
    # PostgreSQL memory context pertains only to this session; RSS includes Python.
    mem=one(c,"SELECT sum(total_bytes) FROM pg_backend_memory_contexts")
    return {"database_bytes":size,"wal_generated_bytes":wal,"receipt_relation_bytes":rel,
            "receipt_indexes_bytes":idx,"cqrs_bytes":cqrs,
            "pg_dead_tup_estimate":int(stat[0]),"pg_autovacuum_count":int(stat[1]),
            "pg_manual_vacuum_count":int(stat[2]),"pg_lock_waiters_sample":waiting,
            "pg_deadlocks":deadlocks,"pg_sessions_sample":dict(activity),
            "pg_backend_memory_context_bytes_sample":int(mem or 0),
            "runner_python_peak_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "host_free_disk_bytes":free()}
def guard(c,initial_wal,began,at,required_next=0):
    m=metrics(c,initial_wal)
    elapsed=time.monotonic()-began
    why=[]
    if elapsed>MAX_TIME:why.append("time")
    if m["database_bytes"]>=PG_MAX:why.append("pg_database")
    if m["wal_generated_bytes"]>=WAL_MAX:why.append("pg_wal_generated")
    if m["host_free_disk_bytes"]<DISK_MIN:why.append("host_free_disk")
    # Linear safety estimate from the actual rows already ingested to avoid a
    # disk/quota failure in the next 100K chunk (not a physical hard quota).
    rows=at
    if rows>0 and required_next:
        projected_size=m["database_bytes"]+(m["database_bytes"]/rows)*(required_next-at)*1.5
        if projected_size>PG_MAX:why.append("predicted_next_chunk_db")
    return why,m
def explain(c,company,day):
    args=(company,day)
    direct="SELECT count(*) FROM qa_single.proofs WHERE company=%s AND received_day=%s"
    summary="SELECT sum(count_unverified) FROM qa_single.daily WHERE company=%s AND received_day=%s"
    assert one(c,direct,args)==one(c,summary,args)
    def plan(sql):return c.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) "+sql,args).fetchone()[0][0]
    a,b=plan(direct),plan(summary)
    return {"historical_ms":round(a["Execution Time"],4),"cqrs_ms":round(b["Execution Time"],4)}
class Gate(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=512
    def __init__(self,capacity=16):
        super().__init__(("127.0.0.1",0),Handler)
        self.permits=threading.BoundedSemaphore(capacity)
        self.mu=threading.Lock()
        self.accepted=0;self.duplicates=0;self.failed=0;self.posts=0;self.max_batch=0
        self.lost_ack=set()
        self.fail_once=set()
    def ingest(self,payload,token):
        if not isinstance(payload,dict) or set(payload)!={"device","company","events"}:
            raise ValueError("body")
        name=payload["device"];company=payload["company"];events=payload["events"]
        if not isinstance(events,list) or not 1<=len(events)<=50 or \
           not all(isinstance(e,dict) and set(e)=={"seq","event_id","media","boot","mono","hash"} for e in events):
            raise ValueError("batch")
        if not all(e["hash"]==sha(f"{name}|{e['seq']}|{e['media']}|{e['boot']}|{e['mono']}") for e in events):
            raise ValueError("hash")
        with self.mu:self.max_batch=max(self.max_batch,len(events))
        with self.permits:
            with db() as c:
                with c.transaction():
                    state=c.execute("""SELECT company,token_sha256,watermark FROM qa_single.devices
                                  WHERE device=%s FOR UPDATE""",(name,)).fetchone()
                    if not state or state[0]!=company or state[1]!=sha(token):
                        raise PermissionError("tenant_auth")
                    watermark=state[2]
                    old=[e for e in events if e["seq"]<=watermark]
                    fresh=[e for e in events if e["seq"]>watermark]
                    if old:
                        found=dict(c.execute("""SELECT seq,hash_sha256 FROM qa_single.proofs
                          WHERE device=%s AND seq BETWEEN %s AND %s""",
                          (name,old[0]["seq"],old[-1]["seq"])).fetchall())
                        if any(found.get(e["seq"])!=e["hash"] for e in old):
                            raise ValueError("replay_invalid")
                    if fresh:
                        if fresh[0]["seq"]!=watermark+1 or any(fresh[i]["seq"]+1!=fresh[i+1]["seq"] for i in range(len(fresh)-1)):
                            raise ValueError("sequence_gap")
                        new_day=BASE_DATE+timedelta(days=6)
                        c.execute("""INSERT INTO qa_single.proofs(received_month,received_day,device,
                            company,seq,event_id,media,boot,mono,hash_sha256)
                          SELECT %s,%s,%s,%s,seq,event_id,media,boot,mono,hash
                          FROM unnest(%s::bigint[],%s::text[],%s::text[],%s::text[],
                            %s::bigint[],%s::text[]) AS r(seq,event_id,media,boot,mono,hash)""",
                          (date(2026,11,1),new_day,name,company,
                           [e["seq"] for e in fresh],[e["event_id"] for e in fresh],
                           [e["media"] for e in fresh],[e["boot"] for e in fresh],
                           [e["mono"] for e in fresh],[e["hash"] for e in fresh]))
                        c.execute("UPDATE qa_single.devices SET watermark=%s WHERE device=%s",
                                  (fresh[-1]["seq"],name))
                        if name.endswith("000") and name not in self.fail_once:
                            self.fail_once.add(name)
                            raise RuntimeError("qa_mid_transaction_rollback")
            with self.mu:
                self.accepted+=len(fresh);self.duplicates+=len(old)
            return {"ack":watermark+len(fresh),"new":len(fresh),"duplicates":len(old)}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def output(self,status,obj):
        raw=canonical(obj);self.send_response(status);self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        if self.path!="/qa/ingest":return self.output(404,{"error":"route"})
        with self.server.mu:self.server.posts+=1
        try:
            count=int(self.headers.get("Content-Length","-1"))
            if not 0<count<=14000:raise ValueError("body_size")
            pay=json.loads(self.rfile.read(count))
            result=self.server.ingest(pay,self.headers.get("X-QA-Token",""))
            if pay["device"].endswith("001") and pay["device"] not in self.server.lost_ack:
                self.server.lost_ack.add(pay["device"])
                with self.server.mu:self.server.failed+=1
                return self.output(503,{"error":"lost_ack_after_commit"})
            return self.output(200,result)
        except PermissionError:return self.output(401,{"error":"unauthorized"})
        except ValueError:return self.output(409,{"error":"conflict"})
        except Exception as exc:
            with self.server.mu:self.server.failed+=1
            return self.output(503,{"error":"qa_rollback_or_unavailable"})
def send(url,payload,token):
    request=urllib.request.Request(url,data=canonical(payload),method="POST",
                                   headers={"X-QA-Token":token,"Content-Type":"application/json"})
    t=time.perf_counter()
    try:
        with urllib.request.urlopen(request,timeout=55) as resp:
            return resp.status,json.loads(resp.read()),(time.perf_counter()-t)*1000
    except urllib.error.HTTPError as exc:
        return exc.code,json.loads(exc.read()),(time.perf_counter()-t)*1000
def concurrent_http(count,loaded):
    service=Gate()
    t=threading.Thread(target=service.serve_forever,daemon=True);t.start()
    url=f"http://127.0.0.1:{service.server_address[1]}/qa/ingest"
    durations=[];responses=[];success=0;total_tries=0
    def client(i):
        dev=device(i);company=tenant(i);token=f"test-token-{dev}-long-secret"
        # calculate next seq from seeded 1M/3M/etc milestone; do not assume equal.
        seq=(loaded-(i+1))//TVS+2 if loaded>=i+1 else 1
        payload={"device":dev,"company":company,
                 "events":[event(dev,k) for k in range(seq,seq+50)]}
        timings=[]
        for retry in range(4):
            try:status,body,elapsed=send(url,payload,token)
            except (urllib.error.URLError,TimeoutError,OSError) as exc:
                status,body,elapsed=599,{"error":str(exc)},0
            timings.append(elapsed)
            if status==200:
                assert body["ack"]==seq+49
                assert body["new"] in (0,50)
                return {"status":200,"timings":timings,"retries":retry,"new":body["new"],
                        "duplicate":body["duplicates"]}
            if status!=503 and status!=599:raise AssertionError(f"unexpected HTTP={status}: {body}")
            time.sleep(.03*(retry+1))
        raise AssertionError(f"HTTP_UNRECOVERED_CLIENT_{dev}")
    begin=time.perf_counter()
    try:
        with ThreadPoolExecutor(max_workers=count) as executor:
            futures=[executor.submit(client,i) for i in range(count)]
            outcomes=[f.result() for f in as_completed(futures)]
        # Verify identical replay of a complete prior batch and cross-tenant rejection.
        first=device(0);token=f"test-token-{first}-long-secret"
        seq=(loaded-1)//TVS+2 if loaded>=1 else 1
        replay={"device":first,"company":tenant(0),"events":[event(first,k) for k in range(seq,seq+50)]}
        status,response,lat=send(url,replay,token)
        if status!=200 or response["duplicates"]!=50 or response["new"]!=0:
            raise AssertionError(f"replay_unsafe:{status},{response}")
        bad,status_detail,_=send(url,replay,f"wrong-{token}")
        if bad!=401:raise AssertionError("tenant_token_bypass")
        durations=[d for o in outcomes for d in o["timings"]]
        with db() as c:
            n=one(c,"SELECT count(*) FROM qa_single.proofs")
            assert n==loaded+50*count
            assert one(c,"SELECT count(*) FROM qa_single.proofs WHERE billable OR played_at IS NOT NULL")==0
            lock_wait_sample=one(c,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")
        return {"clients_concurrent":count,"actual_http_posts":service.posts,
                "http_successful_clients":len(outcomes),"http_error_attempts":service.failed,
                "p95_http_ms":p95(durations),"wall_seconds":round(time.perf_counter()-begin,2),
                "max_batch":service.max_batch,"new_receipts":service.accepted,
                "duplicate_receipts":service.duplicates,
                "retry_attempts":sum(o["retries"] for o in outcomes),
                "source_rows_verified":n,
                "db_pool_permits":16,"pg_lock_waiters_sample":lock_wait_sample}
    finally:service.shutdown();service.server_close();t.join(4)
def main(target):
    started=time.monotonic()
    print(f"QA_PREFLIGHT_CONFIG target={target} pg_max={PG_MAX} wal_cap={WAL_MAX} min_disk={DISK_MIN} max_seconds={MAX_TIME}",flush=True)
    with db() as c:
        assert one(c,"SELECT current_database()")=="vision_v2_quarantine_disposable"
        assert int(one(c,"SHOW server_version_num"))//10000==17
        if free()<DISK_MIN:raise RuntimeError("QA_CAPACITY_NO_GO disk preflight")
        c.execute(DDL)
        with c.transaction():
            with c.cursor() as cur:
                cur.executemany("""INSERT INTO qa_single.devices(device,company,stream,token_sha256)
                      VALUES(%s,%s,%s,%s)""",
                 [(device(i),tenant(i),f"stream-{i:03d}",sha(f"test-token-{device(i)}-long-secret")) for i in range(TVS)])
                cur.executemany("INSERT INTO qa_single.projector(device) VALUES(%s)",
                                [(device(i),) for i in range(TVS)])
        wal_start=one(c,"SELECT pg_current_wal_insert_lsn()")
        last=0;results=[];why=[]
        for stage in STAGES:
            if stage>target:break
            current=last
            while current<stage:
                upcoming=min(current+CHUNK,stage)
                reason,measurement=guard(c,wal_start,started,current,upcoming)
                if reason:why=reason;break
                load_chunk(c,current+1,upcoming)
                current=upcoming
                if current%500_000==0:
                    print(f"QA_LOAD_PROGRESS rows={current} elapsed_s={round(time.monotonic()-started,1)}",flush=True)
            if why:break
            project_info=project(c)
            assert one(c,"SELECT count(*) FROM qa_single.proofs")==stage
            assert one(c,"SELECT sum(count_unverified) FROM qa_single.daily")==stage
            assert one(c,"SELECT count(*) FROM qa_single.proofs WHERE billable OR played_at IS NOT NULL")==0
            m=metrics(c,wal_start)
            entry={"target":stage,"result":"PASS","projection":project_info,**m}
            results.append(entry)
            print("QA_SINGLE_STAGE_JSON="+json.dumps(entry,sort_keys=True,separators=(",",":")),flush=True)
            last=stage
        if not results:raise RuntimeError("QA_NO_SAFE_STAGE_COMPLETED reason="+str(why))
        # Real local HTTP with 100 concurrent clients, then 300 in same single PG.
        m_before=metrics(c,wal_start)
        tests=[]
        for n in (100,300):
            if time.monotonic()-started>MAX_TIME-180 or free()<DISK_MIN:
                why.append("insufficient_budget_for_http")
                break
            current_total=one(c,"SELECT count(*) FROM qa_single.proofs")
            x=concurrent_http(n,last)
            # The second concurrent round starts from the same baseline for
            # clients 0..99, so they should be duplicate after first test;
            # intentional idempotent retry, not a second new 50. 
            tests.append(x)
            print("QA_SINGLE_HTTP_JSON="+json.dumps(x,sort_keys=True,separators=(",",":")),flush=True)
        proj=project(c)
        final=metrics(c,wal_start)
        assert one(c,"SELECT sum(count_unverified) FROM qa_single.daily")==one(c,"SELECT count(*) FROM qa_single.proofs")
        all_pass=len(results)>0 and len(tests)==2 and all(x["http_successful_clients"]==x["clients_concurrent"] for x in tests)
        statement={"result":"PASS" if all_pass else "LIMITED","highest_capacity_rows":last,
                  "requested_rows":target,"stage_count":len(results),"http_tests":len(tests),
                  "capacity_limit_reasons":why,"final":final,"post_http_projection":proj}
        print("QA_SINGLE_DB_FINAL_JSON="+json.dumps(statement,sort_keys=True,separators=(",",":")),flush=True)
        if not all_pass:raise RuntimeError("QA_HTTP_UNFINISHED "+str(why))
if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--target",type=int,choices=STAGES,default=1_000_000)
    main(parser.parse_args().target)
