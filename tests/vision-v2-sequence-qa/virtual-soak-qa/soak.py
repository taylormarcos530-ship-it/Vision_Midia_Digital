"""Vision V2 virtual-time soak, real SQLite files/HTTP/PostgreSQL17 QA ONLY.

Scenarios explicitly sample a virtual clock:
24h: 1 receipt per 300 simulated seconds (288 per TV)
7d: 1 receipt per 900 simulated seconds (672 per TV).
This is NOT the 15-second production cadence: that would create 40,320
receipts per TV per week. Measurements must not be projected as that load.

Real: SQLite persistence, loopback HTTP requests, PG17 transactions,
CQRS SQL and WAL/index sizes. Synthetic: virtual time, network outages,
lost ACK, storage quota check and push notices. NO deploy / Supabase access.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date,timedelta
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import urllib.error
import urllib.request

import psycopg

DSN="postgresql://postgres:qa-only-local-password@127.0.0.1:5432/vision_v2_quarantine_disposable"
BEGIN_DAY=date(2026,10,31)
LIMIT_EVENTS_PER_BATCH=50
MAX_LOCAL_PENDING=50000
PG_QUOTA_BYTES=256*1024*1024
MAX_CONNECTIONS=12
def canonical(data):return json.dumps(data,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
def sha(s):return hashlib.sha256(s).hexdigest()
def con():return psycopg.connect(DSN,autocommit=True,connect_timeout=6)
def one(db,sql,args=()):return db.execute(sql,args).fetchone()[0]
def p95(values):
    values=sorted(values)
    return round(values[max(0,math.ceil(len(values)*.95)-1)],3) if values else 0
BOOT_SWITCH=1
CADENCE=300
def body_for(seq,boot_id):
    base=BOOT_SWITCH if boot_id=='qa-boot-B' else 1
    assert seq>=base
    return {"seq":seq,"id":f"evt-{seq:08d}","boot":boot_id,
            "mono":(seq-base)*CADENCE*1000}
def expected_digest(record):return sha(canonical(record))
def values_for_total(tvs,days):
    seconds=days*86400
    cadence=300 if days==1 else 900
    assert seconds%cadence==0
    return seconds//cadence,cadence

class Queue:
    """One SQLite file per device; old proofs remain even after ACK."""
    def __init__(self,folder,index,tvs,limit=MAX_LOCAL_PENDING):
        self.device=f"tv-{index:03d}"
        self.stream=f"qa-stream-{index:03d}"
        self.company=f"company-{index%max(2,tvs//10):02d}"
        self.token=f"qa-token-{index:03d}-synthetic-2026"
        self.limit=limit
        self.path=Path(folder)/(self.device+".sqlite")
        self.db=None
        self.open()
        self.http_posts=0
        self.http_errors=0
        self.duplicate=0
        self.latencies=[]
        self.boots=1
    def open(self):
        self.db=sqlite3.connect(self.path,check_same_thread=False,timeout=5)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""CREATE TABLE IF NOT EXISTS queue(
            seq INTEGER PRIMARY KEY,event_id TEXT NOT NULL UNIQUE,
            boot TEXT NOT NULL,mono INTEGER NOT NULL,played_at INTEGER NULL
            CHECK(played_at IS NULL),hash_sha256 TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
            ack INTEGER NOT NULL DEFAULT 0);
        INSERT OR IGNORE INTO state VALUES(1,0);
        """)
    def reopen(self):
        self.db.close()
        self.open()
        self.boots+=1
        assert self.db.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
    def ack(self):
        return self.db.execute("SELECT ack FROM state WHERE singleton=1").fetchone()[0]
    def pending(self):
        return self.db.execute("SELECT COUNT(*) FROM queue WHERE seq>?",(self.ack(),)).fetchone()[0]
    def append(self,first,last,boot):
        count=last-first+1
        if self.pending()+count>self.limit:raise OverflowError("offline_queue_quota_preserve_originals")
        payload=[]
        for seq in range(first,last+1):
            e=body_for(seq,boot)
            payload.append((seq,e["id"],e["boot"],e["mono"],expected_digest(e)))
        with self.db:
            self.db.executemany("""INSERT INTO queue(seq,event_id,boot,mono,hash_sha256)
                        VALUES(?,?,?,?,?)""",payload)
    def batch(self):
        rows=self.db.execute("""SELECT seq,event_id,boot,mono,hash_sha256
            FROM queue WHERE seq>? ORDER BY seq LIMIT ?""",
            (self.ack(),LIMIT_EVENTS_PER_BATCH)).fetchall()
        return [{"seq":r[0],"id":r[1],"boot":r[2],"mono":r[3],
                 "hash":r[4]} for r in rows]
    def apply_ack(self,ack):
        old=self.ack()
        maximum=one(self.db,"SELECT COALESCE(MAX(seq),0) FROM queue")
        if not old<=ack<=maximum:raise ValueError("unverified_ack_range")
        with self.db:self.db.execute("UPDATE state SET ack=? WHERE singleton=1",(ack,))
    def bytes(self):
        return sum(p.stat().st_size for suffix in ["","-wal","-shm"]
                   if (p:=Path(str(self.path)+suffix)).exists())
    def close(self):
        if self.db:self.db.close();self.db=None

class HttpGateway(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self):
        super().__init__(("127.0.0.1",0),Handler)
        self.mu=threading.Lock()
        self.network_down=False
        self.lost=set()
        self.failed_sql=False
        self.posts=0
        self.gets=0
        self.failures=0
        self.new_rows=0
        self.duplicates=0
        self.max_batch=0
        self.commands_changed=0
    def accept(self,envelope,token):
        if not isinstance(envelope,dict) or set(envelope)!={"device","stream","events","server_day"}:
            raise ValueError("bad_envelope")
        device=envelope["device"]
        events=envelope["events"]
        day=date.fromisoformat(envelope["server_day"])
        month=day.replace(day=1)
        if not isinstance(events,list) or not 1<=len(events)<=LIMIT_EVENTS_PER_BATCH:
            raise ValueError("invalid_batch")
        with self.mu:self.max_batch=max(self.max_batch,len(events))
        if any(set(e)!={"seq","id","boot","mono","hash"} for e in events):
            raise ValueError("bad_event")
        if any(e["hash"]!=expected_digest({k:e[k] for k in ("seq","id","boot","mono")}) for e in events):
            raise ValueError("bad_payload_sha")
        if any(events[i]["seq"]+1!=events[i+1]["seq"] for i in range(len(events)-1)):
            raise ValueError("non_contiguous")
        # The received server day comes from local test harness only; no TV
        # would be authorized to choose this value in a production gateway.
        with con() as db:
            with db.transaction():
                row=db.execute("""SELECT company,stream,token_sha256,watermark
                       FROM v2_soak_qa.devices WHERE device=%s FOR UPDATE""",(device,)).fetchone()
                if not row or row[1]!=envelope["stream"] or row[2]!=sha(token.encode()):
                    raise PermissionError("tenant_or_stream")
                company,stream,_,watermark=row
                prefix=[e for e in events if e["seq"]<=watermark]
                pending=[e for e in events if e["seq"]>watermark]
                if prefix:
                    received={seq:hashvalue for seq,hashvalue in db.execute("""
                         SELECT seq,hash_sha256 FROM v2_soak_qa.receipts
                         WHERE device=%s AND seq BETWEEN %s AND %s""",
                         (device,prefix[0]["seq"],prefix[-1]["seq"])).fetchall()}
                    if any(received.get(e["seq"])!=e["hash"] for e in prefix):
                        raise ValueError("replay_conflict_or_archive_missing")
                new_count=len(pending)
                if pending:
                    if pending[0]["seq"]!=watermark+1:raise ValueError("gap_no_ack")
                    if pending[-1]["seq"]>MAX_LOCAL_PENDING:raise OverflowError("qa_stream_quota")
                    args=(month,day,company,device,stream,
                          [e["seq"] for e in pending],[e["id"] for e in pending],
                          [e["boot"] for e in pending],[e["mono"] for e in pending],
                          [e["hash"] for e in pending])
                    db.execute("""INSERT INTO v2_soak_qa.receipts
                        (received_month,received_day,company,device,stream,seq,
                         event_id,boot_id,elapsed_ms,hash_sha256)
                        SELECT %s,%s,%s,%s,%s,seq,event_id,boot_id,elapsed_ms,hash_value
                        FROM unnest(%s::bigint[],%s::text[],%s::text[],
                                    %s::bigint[],%s::text[])
                        AS x(seq,event_id,boot_id,elapsed_ms,hash_value)""",args)
                    if device=="tv-000" and pending[0]["seq"]>=51:
                        with self.mu:
                            if not self.failed_sql:
                                self.failed_sql=True
                                raise RuntimeError("synthetic_sql_crash_before_commit")
                    db.execute("UPDATE v2_soak_qa.devices SET watermark=%s WHERE device=%s",
                               (pending[-1]["seq"],device))
                ack=watermark+new_count
        with self.mu:
            self.new_rows+=new_count
            self.duplicates+=len(prefix)
        return {"ack":ack,"new":new_count,"duplicate":len(prefix),"billable":0}
    def command(self,device,token,current_rev):
        with con() as db:
            row=db.execute("""SELECT d.token_sha256,c.revision
                    FROM v2_soak_qa.devices d JOIN v2_soak_qa.commands c
                    ON d.device=c.device WHERE d.device=%s""",(device,)).fetchone()
        if not row or row[0]!=sha(token.encode()):raise PermissionError("invalid_command_token")
        if row[1]>current_rev:
            with self.mu:self.commands_changed+=1
        return {"revision":row[1],"changed":row[1]>current_rev}
    def snapshot(self):
        with self.mu:
            return {k:getattr(self,k) for k in ("posts","gets","failures","new_rows",
                    "duplicates","max_batch","commands_changed")}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def send(self,status,payload):
        data=canonical(payload)
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_POST(self):
        if self.path!="/qa/events":return self.send(404,{"error":"missing"})
        with self.server.mu:self.server.posts+=1
        if self.server.network_down:
            with self.server.mu:self.server.failures+=1
            return self.send(503,{"error":"offline_injected"})
        try:
            size=int(self.headers.get("Content-Length","0"))
            if not 0<size<25000:raise ValueError("upload_size")
            envelope=json.loads(self.rfile.read(size))
            outcome=self.server.accept(envelope,self.headers.get("X-QA-Token",""))
            with self.server.mu:
                if envelope["device"] not in self.server.lost:
                    self.server.lost.add(envelope["device"])
                    self.server.failures+=1
                    return self.send(503,{"error":"ack_lost_after_postgres_commit"})
            return self.send(200,outcome)
        except PermissionError:return self.send(401,{"error":"unauthorized"})
        except ValueError:return self.send(409,{"error":"idempotency_or_gap"})
        except OverflowError:return self.send(507,{"error":"quota_reject"})
        except Exception:
            with self.server.mu:self.server.failures+=1
            return self.send(503,{"error":"injected_sql_rollback"})
    def do_GET(self):
        if not self.path.startswith("/qa/commands?"):
            return self.send(404,{"error":"unknown"})
        with self.server.mu:self.server.gets+=1
        if self.server.network_down:
            with self.server.mu:self.server.failures+=1
            return self.send(503,{"error":"offline"})
        try:
            from urllib.parse import parse_qs,urlsplit
            args=parse_qs(urlsplit(self.path).query)
            out=self.server.command(args["device"][0],self.headers.get("X-QA-Token",""),
                                    int(args["known"][0]))
            return self.send(200,out)
        except PermissionError:return self.send(401,{"error":"unauthorized"})
        except Exception:return self.send(400,{"error":"malformed"})

def http(method,url,token,payload=None):
    request=urllib.request.Request(url,data=canonical(payload) if payload is not None else None,
             method=method,headers={"X-QA-Token":token,"Content-Type":"application/json"})
    t=time.perf_counter()
    try:
        with urllib.request.urlopen(request,timeout=30) as result:
            return result.status,json.loads(result.read()),(time.perf_counter()-t)*1000
    except urllib.error.HTTPError as problem:
        return problem.code,json.loads(problem.read()),(time.perf_counter()-t)*1000

def flush(client,base,day,max_tries=3,drain=True):
    responses=0
    while True:
        records=client.batch()
        if not records:return responses
        payload={"device":client.device,"stream":client.stream,
                 "server_day":day.isoformat(),"events":records}
        for attempt in range(max_tries):
            status,result,lat=http("POST",base+"/qa/events",client.token,payload)
            client.http_posts+=1
            client.latencies.append(lat)
            responses+=1
            if status==200:
                client.apply_ack(result["ack"])
                client.duplicate+=result["duplicate"]
                break
            client.http_errors+=1
            if status!=503:
                raise AssertionError(f"unexpected_upload_fail={status} {result}")
        else:raise AssertionError("retries_exhausted")
        if not drain:return responses

def projection_one(device):
    with con() as db:
        with db.transaction():
            watermark=one(db,"SELECT through_seq FROM v2_soak_qa.projectors WHERE device=%s FOR UPDATE",(device,))
            rows=db.execute("""SELECT seq,company,received_day FROM v2_soak_qa.receipts
                 WHERE device=%s AND seq>%s ORDER BY seq""",(device,watermark)).fetchall()
            if not rows:return 0
            if any(r[0]!=watermark+i for i,r in enumerate(rows,1)):
                raise AssertionError("sequence_gap_in_projector")
            from collections import Counter
            daily=Counter((r[1],r[2]) for r in rows)
            for (company,day),count in daily.items():
                db.execute("""INSERT INTO v2_soak_qa.daily_read
                  (company,device,received_day,pending_time) VALUES(%s,%s,%s,%s)
                  ON CONFLICT(device,received_day) DO UPDATE
                  SET pending_time=v2_soak_qa.daily_read.pending_time+EXCLUDED.pending_time""",
                  (company,device,day,count))
            db.execute("UPDATE v2_soak_qa.projectors SET through_seq=%s WHERE device=%s",
                       (rows[-1][0],device))
            return len(rows)

def stats(tvs,days,per_tv,cadence,queues,server,projection_lag_max,
          projection_seconds,command_info,wal_start):
    with con() as db:
        assert one(db,"SELECT count(*) FROM v2_soak_qa.receipts")==tvs*per_tv
        assert one(db,"SELECT count(*) FROM v2_soak_qa.receipts WHERE billable OR played_at IS NOT NULL")==0
        assert one(db,"SELECT count(*) FROM v2_soak_qa.devices WHERE watermark=%s",(per_tv,))==tvs
        assert one(db,"SELECT count(*) FROM v2_soak_qa.projectors WHERE through_seq=%s",(per_tv,))==tvs
        assert one(db,"SELECT COALESCE(sum(pending_time),0) FROM v2_soak_qa.daily_read")==tvs*per_tv
        assert one(db,"SELECT count(*) FROM v2_soak_qa.receipts WHERE boot_id LIKE %s",("qa-boot-%",))==tvs*per_tv
        assert one(db,"SELECT count(*) FROM v2_soak_qa.receipts_oct")>0
        if days==7:assert one(db,"SELECT count(*) FROM v2_soak_qa.receipts_nov")>0
        table=one(db,"SELECT pg_total_relation_size('v2_soak_qa.receipts_oct')")+one(db,"SELECT pg_total_relation_size('v2_soak_qa.receipts_nov')")
        indexes=one(db,"SELECT pg_indexes_size('v2_soak_qa.receipts_oct')")+one(db,"SELECT pg_indexes_size('v2_soak_qa.receipts_nov')")
        cqrs=one(db,"SELECT pg_total_relation_size('v2_soak_qa.daily_read')")
        database=one(db,"SELECT pg_database_size(current_database())")
        wal_end=one(db,"SELECT pg_current_wal_insert_lsn()")
        wal=int(one(db,"SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",(wal_end,wal_start)))
        assert database<PG_QUOTA_BYTES, f"pg_qa_quota_reached:{database}"
        sql_raw="""SELECT count(*) FROM v2_soak_qa.receipts
             WHERE company=%s AND received_day=%s"""
        sql_cqrs="""SELECT sum(pending_time) FROM v2_soak_qa.daily_read
             WHERE company=%s AND received_day=%s"""
        example=queues[0]
        day=BEGIN_DAY+timedelta(days=days-1)
        args=(example.company,day)
        assert one(db,sql_raw,args)==one(db,sql_cqrs,args)
        raw_plan=db.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+sql_raw,args).fetchone()[0][0]
        cqrs_plan=db.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+sql_cqrs,args).fetchone()[0][0]
        qraw=round(raw_plan["Execution Time"],4)
        qcqrs=round(cqrs_plan["Execution Time"],4)
    counts=server.snapshot()
    assert counts["new_rows"]==tvs*per_tv
    assert counts["duplicates"]>=tvs*min(per_tv,50),counts
    assert counts["max_batch"]<=LIMIT_EVENTS_PER_BATCH and counts["max_batch"]>=LIMIT_EVENTS_PER_BATCH
    assert counts["failures"]>=tvs*3
    assert all(q.ack()==per_tv and q.pending()==0 and q.boots==2 for q in queues)
    measured_sqlite=sum(q.bytes() for q in queues)
    durations=[v for q in queues for v in q.latencies]
    return {"status":"PASS","tv_count":tvs,"virtual_days":days,
      "sample_interval_seconds":cadence,"events_per_tv":per_tv,
      "sampled_events":tvs*per_tv,"theoretical_15s_events":tvs*days*5760,
      "http_post_attempts":counts["posts"],"http_get_commands":counts["gets"],
      "http_failures_injected":counts["failures"],"duplicates_idempotent":counts["duplicates"],
      "ack_all":per_tv,"max_batch":counts["max_batch"],"p95_http_ms":p95(durations),
      "wal_generated_bytes":wal,"pg_receipts_heap_indexes_bytes":table,
      "pg_receipts_indexes_bytes":indexes,"pg_daily_cqrs_bytes":cqrs,"pg_database_bytes":database,
      "sqlite_local_bytes":measured_sqlite,"pg_quota_guard_bytes":PG_QUOTA_BYTES,
      "sqlite_pending_quota":MAX_LOCAL_PENDING,"max_projector_lag_events":projection_lag_max,
      "projection_catchup_seconds":round(projection_seconds,3),
      "read_query_ms":qcqrs,"history_query_ms":qraw,
      "commands":command_info,"no_fake_played_at":True,
      "backend_rollback_injected":server.failed_sql,
      "ack_lost_devices":len(server.lost)}

def quota_check(root):
    q=Queue(root,900,1000,limit=5)
    q.append(1,5,"qa-boot-quota")
    prior=q.ack()
    try:q.append(6,6,"qa-boot-quota")
    except OverflowError:pass
    else:raise AssertionError("quota_did_not_reject")
    assert q.ack()==prior and q.pending()==5
    assert one(q.db,"SELECT count(*) FROM queue")==5
    q.reopen()
    assert q.pending()==5
    q.close()
    return True

def run(tvs,days):
    global BOOT_SWITCH,CADENCE
    per_tv,cadence=values_for_total(tvs,days)
    CADENCE=cadence
    BOOT_SWITCH=2*per_tv//5+1
    with con() as db:
        assert one(db,"SELECT current_database()")=="vision_v2_quarantine_disposable"
        db.execute(Path(__file__).with_name("schema.sql").read_text())
    with tempfile.TemporaryDirectory(prefix="v2-soak-virtual-") as root:
        quota_check(root)
        clients=[Queue(root,i,tvs) for i in range(tvs)]
        with con() as db:
            with db.transaction():
                with db.cursor() as cur:
                    cur.executemany("""INSERT INTO v2_soak_qa.devices(device,company,stream,token_sha256)
                          VALUES(%s,%s,%s,%s)""",[(c.device,c.company,c.stream,sha(c.token.encode())) for c in clients])
                    cur.executemany("INSERT INTO v2_soak_qa.projectors(device) VALUES(%s)",
                                    [(c.device,) for c in clients])
                    cur.executemany("INSERT INTO v2_soak_qa.commands(device) VALUES(%s)",
                                    [(c.device,) for c in clients])
            wal_start=one(db,"SELECT pg_current_wal_insert_lsn()")
        server=HttpGateway()
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        base=f"http://127.0.0.1:{server.server_address[1]}"
        worker=ThreadPoolExecutor(max_workers=MAX_CONNECTIONS)
        max_lag=0
        projection_duration=0.0
        command_gets=0
        try:
            def round_upload(day):
                list(worker.map(lambda q:flush(q,base,day),clients))
            def round_project():
                nonlocal max_lag,projection_duration
                with con() as db:
                    lag=one(db,"SELECT COALESCE(MAX(d.watermark-p.through_seq),0) FROM v2_soak_qa.devices d JOIN v2_soak_qa.projectors p USING(device)")
                    max_lag=max(max_lag,lag)
                now=time.perf_counter()
                list(worker.map(lambda q:projection_one(q.device),clients))
                projection_duration+=time.perf_counter()-now
            # Five phases of the VIRTUAL clock. Outages span multiple hours or days.
            cuts=[0,per_tv//5,2*per_tv//5,3*per_tv//5,4*per_tv//5,per_tv]
            for phase in range(5):
                left=cuts[phase]+1
                right=cuts[phase+1]
                boot="qa-boot-A" if phase<2 else "qa-boot-B"
                for q in clients:q.append(left,right,boot)
                if phase==2:
                    for q in clients:q.reopen()
                server_day=BEGIN_DAY+timedelta(days=min(days-1,((right-1)*cadence)//86400))
                if phase in (1,3):
                    server.network_down=True
                    # Two explicit network outages; exactly one 503 per TV per outage.
                    def outage_call(q):
                        payload={"device":q.device,"stream":q.stream,
                           "server_day":server_day.isoformat(),"events":q.batch()}
                        status,_,lat=http("POST",base+"/qa/events",q.token,payload)
                        q.http_posts+=1
                        q.latencies.append(lat)
                        q.http_errors+=1
                        assert status==503,status
                    list(worker.map(outage_call,clients))
                    server.network_down=False
                    # Reconnect and drain without losing original SQLite rows.
                round_upload(server_day)
                round_project()
                # A second call with no new events should not increment projector.
                if phase==0:
                    assert projection_one(clients[0].device)==0
            assert all(q.pending()==0 and q.ack()==per_tv for q in clients)
            # Historical replay: last acknowledged batch valid but count remains fixed.
            first=clients[0]
            rows=first.db.execute("SELECT seq,event_id,boot,mono,hash_sha256 FROM queue WHERE seq<=50 ORDER BY seq").fetchall()
            hist=[{"seq":r[0],"id":r[1],"boot":r[2],"mono":r[3],"hash":r[4]} for r in rows]
            historical={"device":first.device,"stream":first.stream,
                       "server_day":BEGIN_DAY.isoformat(),"events":hist}
            old=server.snapshot()["new_rows"]
            status,response,_=http("POST",base+"/qa/events",first.token,historical)
            assert status==200 and response["duplicate"]==50
            assert server.snapshot()["new_rows"]==old
            # Fake token of another TV cannot submit receipts or commands.
            status,_,_=http("POST",base+"/qa/events",clients[1].token,historical)
            assert status==401
            # Quota rejects without touching the write cursor.
            # A sentinel QA stream is explicitly set to the quota boundary.
            with con() as db:
                db.execute("""INSERT INTO v2_soak_qa.devices(device,company,stream,token_sha256,watermark)
                      VALUES('quota-boundary','qa','qa-stream-quota',%s,%s)""",
                      (sha(b"synthetic-boundary-key"),MAX_LOCAL_PENDING))
            e=body_for(MAX_LOCAL_PENDING+1,"qa-boot-overquota")
            quota_env={"device":"quota-boundary","stream":"qa-stream-quota",
                       "server_day":BEGIN_DAY.isoformat(),
                       "events":[{**e,"hash":expected_digest(e)}]}
            code,_,_=http("POST",base+"/qa/events","synthetic-boundary-key",quota_env)
            assert code==507
            with con() as db:
                assert one(db,"SELECT watermark FROM v2_soak_qa.devices WHERE device='quota-boundary'")==MAX_LOCAL_PENDING
            # Command changes at virtual day boundaries; only event notifications
            # prompt immediate GETs. fallback checks every 15m are calculated
            # from virtual schedule, NOT sent as 100k real requests.
            def cmd_fetch(q,known):
                from urllib.parse import urlencode
                params=urlencode({"device":q.device,"known":known})
                code,res,_=http("GET",base+"/qa/commands?"+params,q.token)
                assert code==200
                return res
            initial=list(worker.map(lambda q:cmd_fetch(q,0),clients))
            assert all(x["revision"]==0 and not x["changed"] for x in initial)
            for revision in (1,2):
                with con() as db:db.execute("UPDATE v2_soak_qa.commands SET revision=%s",(revision,))
                got=list(worker.map(lambda q:cmd_fetch(q,revision-1),clients))
                assert all(x["changed"] and x["revision"]==revision for x in got)
                # duplicate notification does not cause another GET
            fallback=list(worker.map(lambda q:cmd_fetch(q,2),clients))
            assert all(not x["changed"] for x in fallback)
            # Comparison of schedules for 24h or 7d (NO permanent WebSockets).
            duration_minutes=days*1440
            baseline_poll=tvs*(duration_minutes//2)
            revision_fallback=tvs*(duration_minutes//15+2)
            revision_reduction=round(100*(1-revision_fallback/baseline_poll),2)
            assert revision_fallback<baseline_poll
            commands={"poll_every_2min_virtual_gets":baseline_poll,
                      "revision_fallback_every_15min_plus_two_changes_virtual_gets":revision_fallback,
                      "virtual_command_get_reduction_percent":revision_reduction,
                      "real_http_gets_exercised":server.snapshot()["gets"],
                      "push_notifications":"simulated_not_real",
                      "websocket_connections":0}
            assert server.snapshot()["gets"]==4*tvs
            report=stats(tvs,days,per_tv,cadence,clients,server,max_lag,
                         projection_duration,commands,wal_start)
            assert report["ack_lost_devices"]==tvs
            assert report["backend_rollback_injected"]
            print("V2_VIRTUAL_SOAK_RESULT="+json.dumps(report,sort_keys=True,separators=(",",":")),flush=True)
            print(f"V2_VIRTUAL_SOAK_{days}D_{tvs}TV_PASS=true",flush=True)
        finally:
            worker.shutdown(wait=True)
            server.shutdown();server.server_close();thread.join(4)
            for q in clients:
                try:q.close()
                except Exception:pass

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--tvs",type=int,choices=[100,300],required=True)
    parser.add_argument("--days",type=int,choices=[1,7],required=True)
    args=parser.parse_args()
    run(args.tvs,args.days)
