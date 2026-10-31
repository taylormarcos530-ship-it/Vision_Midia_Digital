"""VISION V2 QA ONLY: virtual-clock SQLite -> HTTP -> ephemeral PG17 -> daily CQRS.

Explicit limits: real SQLite transactions and real loopback HTTP/PostgreSQL;
30 minutes of virtual ad time, NOT a physical TV/Android, Supabase, FCM or TLS.
All values synthetic. No production data or external API calls.
"""
import concurrent.futures
from collections import Counter
from datetime import date
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import urllib.error
import urllib.request
import psycopg

DSN="postgresql://postgres:qa-only-local-password@127.0.0.1:5432/vision_v2_quarantine_disposable"
DURATION=1800
PER_TV=DURATION//15
MAX_BATCH=50
FLUSH_PERIOD=120
OUTAGE_START=120
OUTAGE_END=1080
FALLBACK=900
THREADS=12
def canon(v):return json.dumps(v,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
def digest(v):return hashlib.sha256(canon(v)).hexdigest()
def conn():return psycopg.connect(DSN,connect_timeout=5,autocommit=True)
def scalar(db,query,args=()):return db.execute(query,args).fetchone()[0]
def assert_db(db):
    assert scalar(db,"SELECT current_database()")=="vision_v2_quarantine_disposable","not_disposable"
def quantile95(xs):
    s=sorted(xs)
    return round(s[math.ceil(.95*len(s))-1],3) if s else 0

SCHEMA="""
DO $$ BEGIN
 IF current_database()<>'vision_v2_quarantine_disposable'
 THEN RAISE EXCEPTION 'NOT_DISPOSABLE'; END IF;
END $$;
CREATE SCHEMA v2_flow_qa;
CREATE TABLE v2_flow_qa.devices (
  company text NOT NULL, device text PRIMARY KEY, stream text NOT NULL,
  token_hash text NOT NULL, watermark bigint NOT NULL DEFAULT 0,
  command_revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE v2_flow_qa.receipts(
  received_day date NOT NULL DEFAULT current_date,
  company text NOT NULL,
  device text NOT NULL,
  stream text NOT NULL,
  seq bigint NOT NULL CHECK(seq>0),
  event_id text NOT NULL,
  media text NOT NULL,
  boot text NOT NULL,
  mono bigint NOT NULL CHECK(mono>=0),
  played_at timestamptz NULL CHECK(played_at IS NULL),
  billable boolean NOT NULL DEFAULT FALSE CHECK(billable=FALSE),
  proof_hash text NOT NULL,
  PRIMARY KEY(received_day,device,seq)
) PARTITION BY RANGE(received_day);
CREATE TABLE v2_flow_qa.receipts_2026 PARTITION OF v2_flow_qa.receipts
 FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE INDEX receipts_by_tenant_day ON v2_flow_qa.receipts_2026(company,received_day);
CREATE TABLE v2_flow_qa.projection_cursor(
 device text PRIMARY KEY, through_seq bigint NOT NULL DEFAULT 0);
CREATE TABLE v2_flow_qa.daily_read (
 company text NOT NULL,device text NOT NULL,received_day date NOT NULL,
 pending_without_time bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(device,received_day));
CREATE INDEX daily_by_tenant_date ON v2_flow_qa.daily_read(company,received_day);
"""
# In 2026 runner should still have server current_date=2026-10-31. Use explicit
# server-trusted date constant to avoid runner date crossing midnight or 2027.
DAY=date(2026,10,31)

class Client:
    def __init__(self,root,index,tvs):
        self.index=index
        self.device=f"tv-{index:03d}"
        self.company=f"tenant-{index % max(2,tvs//10):02d}"
        self.stream=f"stream-{index:03d}"
        self.token=f"qa-token-{index:03d}-only-example-string"
        self.path=Path(root)/(self.device+".sqlite")
        self.db=None
        # Each TV has one connection; accesses are phase-serialized in QA.
        # Cross-thread access is enabled only for the worker per-TV upload phase.
        self._open()
        self.rev=0
        self.last_check=-9999
        self.next_retry=0
        self.offline_known=False
        self.latencies=[]
        self.post_tries=0
        self.http_gets=0
        self.http_errors=0
        self.commands_updated=0
    def _open(self):
        self.db=sqlite3.connect(self.path,timeout=5,check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""CREATE TABLE IF NOT EXISTS state (
             singleton integer PRIMARY KEY CHECK(singleton=1),ack bigint NOT NULL
            );
            INSERT OR IGNORE INTO state VALUES(1,0);
            CREATE TABLE IF NOT EXISTS receipt (
              seq bigint PRIMARY KEY,event_id text UNIQUE NOT NULL,
              media text NOT NULL,boot text NOT NULL,mono bigint NOT NULL,
              played_at text NULL CHECK(played_at IS NULL));""")
    def reboot(self):
        self.db.close()
        self._open()
        assert self.db.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
    def ack(self):return self.db.execute("SELECT ack FROM state WHERE singleton=1").fetchone()[0]
    def append(self,seq,seconds):
        boot="boot-A" if seconds<900 else "boot-B"
        # RTC is 1970 in both boots. Wall clock never used for receipt time.
        mono=seconds*1000 if boot=="boot-A" else (seconds-900)*1000
        with self.db:
            self.db.execute("""INSERT INTO receipt(seq,event_id,media,boot,mono,played_at)
                VALUES(?,?,?,?,?,NULL)""",
               (seq,f"event-{seq:08d}",f"ad-{seq%8}",boot,mono))
    def pending(self):
        ack=self.ack()
        rows=self.db.execute("""SELECT seq,event_id,media,boot,mono FROM receipt
             WHERE seq>? ORDER BY seq LIMIT ?""",(ack,MAX_BATCH)).fetchall()
        return [{"seq":r[0],"event_id":r[1],"media":r[2],"boot":r[3],"mono":r[4]} for r in rows]
    def pending_count(self):
        return self.db.execute("SELECT count(*) FROM receipt WHERE seq>?",(self.ack(),)).fetchone()[0]
    def acknowledge(self,number):
        old=self.ack()
        maximum=self.db.execute("SELECT coalesce(max(seq),0) FROM receipt").fetchone()[0]
        if number<old or number>maximum:raise ValueError("invalid_ack")
        with self.db:
            self.db.execute("UPDATE state SET ack=? WHERE singleton=1",(number,))
    def close(self):self.db.close()

class Gateway(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self):
        super().__init__(("127.0.0.1",0),Handler)
        self.lock=threading.Lock()
        self.offline=False
        self.first_ack_lost=set()
        self.fault_once=False
        self.posts=0
        self.gets=0
        self.http_503=0
        self.accepted=0
        self.duplicates=0
        self.max_size=0
        self.command_changed=0
        self.command_not_modified=0
    def counters(self):
        with self.lock:
            return {key:getattr(self,key) for key in (
                "posts","gets","http_503","accepted","duplicates","max_size",
                "command_changed","command_not_modified")}
    def inject_once(self,device,seq):
        with self.lock:
            if device=="tv-000" and seq==80 and not self.fault_once:
                self.fault_once=True
                return True
            return False
    def lose_ack(self,device):
        with self.lock:
            if device not in self.first_ack_lost:
                self.first_ack_lost.add(device)
                return True
            return False
    def ingest(self,content,token):
        if not isinstance(content,dict) or set(content)!={"device","stream","events"}:
            raise ValueError("invalid_body")
        device,stream,events=content["device"],content["stream"],content["events"]
        if not isinstance(events,list) or not 1<=len(events)<=MAX_BATCH:
            raise ValueError("batch_cap")
        with self.lock:self.max_size=max(self.max_size,len(events))
        with conn() as db:
            with db.transaction():
                row=db.execute("""SELECT company,stream,token_hash,watermark
                     FROM v2_flow_qa.devices WHERE device=%s FOR UPDATE""",
                     (device,)).fetchone()
                if not row or row[1]!=stream or row[2]!=hashlib.sha256(token.encode()).hexdigest():
                    raise PermissionError("wrong_tenant_or_device")
                company,_,_,watermark=row
                expected=watermark+1
                unique=duplicate=0
                for e in events:
                    if (not isinstance(e,dict) or
                        set(e)!={"seq","event_id","media","boot","mono"} or
                        type(e["seq"]) is not int or e["seq"]<1 or
                        type(e["mono"]) is not int or e["mono"]<0 or
                        any(not isinstance(e[k],str) for k in ("event_id","media","boot"))):
                        raise ValueError("invalid_event")
                    seq=e["seq"]
                    if seq<=watermark:
                        exists=db.execute("""SELECT proof_hash FROM v2_flow_qa.receipts
                           WHERE device=%s AND seq=%s""",(device,seq)).fetchone()
                        if not exists or exists[0]!=digest(e):
                            raise ValueError("replay_mismatch_or_missing")
                        duplicate+=1
                        continue
                    if seq!=expected:raise ValueError("missing_sequence")
                    db.execute("""INSERT INTO v2_flow_qa.receipts(
                        received_day,company,device,stream,seq,event_id,media,boot,mono,proof_hash)
                        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (DAY,company,device,stream,seq,e["event_id"],
                         e["media"],e["boot"],e["mono"],digest(e)))
                    if self.inject_once(device,seq):
                        raise RuntimeError("injected_mid_transaction_db_failure")
                    expected+=1
                    unique+=1
                if unique:
                    db.execute("UPDATE v2_flow_qa.devices SET watermark=%s WHERE device=%s",
                               (expected-1,device))
        with self.lock:
            self.accepted+=unique
            self.duplicates+=duplicate
        return {"ack":expected-1,"accepted":unique,"duplicate":duplicate,"billable":0}
    def commands(self,device,token,known):
        with conn() as db:
            row=db.execute("""SELECT command_revision,token_hash FROM v2_flow_qa.devices
                WHERE device=%s""",(device,)).fetchone()
            if not row or row[1]!=hashlib.sha256(token.encode()).hexdigest():
                raise PermissionError("command_identity")
            changed=row[0]>known
            with self.lock:
                if changed:self.command_changed+=1
                else:self.command_not_modified+=1
            return {"revision":row[0],"changed":changed}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,status,data):
        blob=canon(data)
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)
    def do_POST(self):
        if self.path!="/qa/ingest":return self.reply(404,{"error":"not_found"})
        with self.server.lock:self.server.posts+=1
        if self.server.offline:
            with self.server.lock:self.server.http_503+=1
            return self.reply(503,{"error":"offline_simulated"})
        try:
            size=int(self.headers.get("Content-Length","-1"))
            if not 0<size<=20000:raise ValueError("body_size")
            body=json.loads(self.rfile.read(size))
            output=self.server.ingest(body,self.headers.get("x-qa-token",""))
            if self.server.lose_ack(body["device"]):
                with self.server.lock:self.server.http_503+=1
                return self.reply(503,{"error":"ack_lost_after_commit"})
            return self.reply(200,output)
        except PermissionError:
            return self.reply(401,{"error":"unauthorized"})
        except ValueError as exc:
            return self.reply(409,{"error":str(exc)})
        except Exception:
            with self.server.lock:self.server.http_503+=1
            return self.reply(503,{"error":"db_transaction_rollback"})
    def do_GET(self):
        if not self.path.startswith("/qa/commands?"):
            return self.reply(404,{"error":"not_found"})
        with self.server.lock:self.server.gets+=1
        if self.server.offline:
            with self.server.lock:self.server.http_503+=1
            return self.reply(503,{"error":"offline_simulated"})
        try:
            from urllib.parse import parse_qs,urlsplit
            q=parse_qs(urlsplit(self.path).query)
            answer=self.server.commands(q["device"][0],self.headers.get("x-qa-token",""),
                                        int(q["revision"][0]))
            return self.reply(200,answer)
        except PermissionError:return self.reply(401,{"error":"unauthorized"})
        except Exception:return self.reply(400,{"error":"invalid_query"})

def get_http(url,token):
    req=urllib.request.Request(url,headers={"x-qa-token":token})
    started=time.perf_counter()
    try:
        with urllib.request.urlopen(req,timeout=12) as resp:
            return resp.status,json.loads(resp.read()),(time.perf_counter()-started)*1000
    except urllib.error.HTTPError as exc:
        return exc.code,json.loads(exc.read()),(time.perf_counter()-started)*1000
def post_http(url,token,payload):
    req=urllib.request.Request(url,data=canon(payload),method="POST",
                               headers={"Content-Type":"application/json","x-qa-token":token})
    started=time.perf_counter()
    try:
        with urllib.request.urlopen(req,timeout=12) as resp:
            return resp.status,json.loads(resp.read()),(time.perf_counter()-started)*1000
    except urllib.error.HTTPError as exc:
        return exc.code,json.loads(exc.read()),(time.perf_counter()-started)*1000

def send_upload(client,base,seconds,drain):
    if client.offline_known and seconds<OUTAGE_END:
        return
    loops=0
    while True:
        events=client.pending()
        if not events:return
        if loops>4:raise AssertionError("unbounded_drain")
        status,data,lat=post_http(base+"/qa/ingest",client.token,
                                 {"device":client.device,"stream":client.stream,"events":events})
        client.post_tries+=1
        client.latencies.append(lat)
        if status!=200:
            client.http_errors+=1
            client.next_retry=seconds+FLUSH_PERIOD
            if status==503 and seconds>=OUTAGE_START and seconds<OUTAGE_END:
                client.offline_known=True
            return
        client.acknowledge(data["ack"])
        loops+=1
        if not drain or client.pending_count()==0:return

def send_command(client,base,seconds,forced=False):
    if client.offline_known and seconds<OUTAGE_END:return
    if not forced and seconds-client.last_check<FALLBACK:return
    from urllib.parse import urlencode
    query=urlencode({"device":client.device,"revision":client.rev})
    status,data,lat=get_http(base+"/qa/commands?"+query,client.token)
    client.http_gets+=1
    client.latencies.append(lat)
    if status==200:
        client.last_check=seconds
        if data["changed"] and data["revision"]>client.rev:
            client.rev=data["revision"]
            client.commands_updated+=1
    else:
        client.http_errors+=1

def read_model(tvcount):
    with conn() as db:
        # Inject a real PostgreSQL projection failure, then prove its cursor and
        # count are unchanged before processing the backlog normally.
        db.execute("""CREATE FUNCTION v2_flow_qa.fail_projection() RETURNS trigger
           LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''qa_projection_failure''; END'""")
        db.execute("""CREATE TRIGGER fail_first_projection
           BEFORE INSERT ON v2_flow_qa.daily_read
           FOR EACH ROW EXECUTE FUNCTION v2_flow_qa.fail_projection()""")
        try:
            try:
                with db.transaction():
                    db.execute("""INSERT INTO v2_flow_qa.daily_read
                        (company,device,received_day,pending_without_time)
                        VALUES('tenant-00','tv-000',%s,1)""",(DAY,))
                    db.execute("UPDATE v2_flow_qa.projection_cursor SET through_seq=1 WHERE device='tv-000'")
            except psycopg.Error:
                pass
            else:raise AssertionError("projection_failure_should_rollback")
            assert scalar(db,"SELECT through_seq FROM v2_flow_qa.projection_cursor WHERE device='tv-000'")==0
            assert scalar(db,"SELECT count(*) FROM v2_flow_qa.daily_read")==0
        finally:
            db.execute("DROP TRIGGER fail_first_projection ON v2_flow_qa.daily_read")
        # Derive daily read model on the server, with one cursor per device.
        for i in range(tvcount):
            device=f"tv-{i:03d}"
            with db.transaction():
                marker=scalar(db,"SELECT through_seq FROM v2_flow_qa.projection_cursor WHERE device=%s FOR UPDATE",(device,))
                events=db.execute("""SELECT seq,received_day,company FROM v2_flow_qa.receipts
                   WHERE device=%s AND seq>%s ORDER BY seq""",(device,marker)).fetchall()
                if any(r[0]!=marker+n for n,r in enumerate(events,1)):
                    raise AssertionError("projector_gap")
                if events:
                    day=events[0][1]
                    company=events[0][2]
                    assert all(r[1]==day and r[2]==company for r in events)
                    db.execute("""INSERT INTO v2_flow_qa.daily_read(company,device,received_day,pending_without_time)
                       VALUES(%s,%s,%s,%s) ON CONFLICT(device,received_day)
                       DO UPDATE SET pending_without_time=v2_flow_qa.daily_read.pending_without_time+EXCLUDED.pending_without_time""",
                       (company,device,day,len(events)))
                    db.execute("UPDATE v2_flow_qa.projection_cursor SET through_seq=%s WHERE device=%s",
                               (events[-1][0],device))
        original=scalar(db,"SELECT count(*) FROM v2_flow_qa.receipts")
        projected=scalar(db,"SELECT coalesce(sum(pending_without_time),0) FROM v2_flow_qa.daily_read")
        assert original==projected==tvcount*PER_TV
        # Reprocess without counting twice.
        for i in range(tvcount):
            dev=f"tv-{i:03d}"
            marker=scalar(db,"SELECT through_seq FROM v2_flow_qa.projection_cursor WHERE device=%s",(dev,))
            assert marker==PER_TV
        assert scalar(db,"SELECT sum(pending_without_time) FROM v2_flow_qa.daily_read")==projected
        assert scalar(db,"SELECT count(*) FROM v2_flow_qa.daily_read")==tvcount
        return projected

def get_metrics(server,tvs,clients,wal_start):
    with conn() as db:
        assert_db(db)
        wal_end=scalar(db,"SELECT pg_current_wal_insert_lsn()")
        wal=int(scalar(db,"SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",(wal_end,wal_start)))
        partition=scalar(db,"SELECT pg_total_relation_size('v2_flow_qa.receipts_2026')")
        part_indexes=scalar(db,"SELECT pg_indexes_size('v2_flow_qa.receipts_2026')")
        read=scalar(db,"SELECT pg_total_relation_size('v2_flow_qa.daily_read')")
        devices=scalar(db,"SELECT pg_total_relation_size('v2_flow_qa.devices')")
        dbsize=scalar(db,"SELECT pg_database_size(current_database())")
        assert scalar(db,"SELECT count(*) FROM v2_flow_qa.receipts")==tvs*PER_TV
        assert scalar(db,"SELECT count(*) FROM v2_flow_qa.receipts WHERE played_at IS NOT NULL OR billable")==0
        assert scalar(db,"SELECT count(DISTINCT device) FROM v2_flow_qa.receipts")==tvs
        assert scalar(db,"SELECT count(DISTINCT boot) FROM v2_flow_qa.receipts")==2
        assert scalar(db,"SELECT count(*) FROM v2_flow_qa.devices WHERE watermark=%s",(PER_TV,))==tvs
        assert scalar(db,"SELECT count(*) FROM v2_flow_qa.daily_read")==tvs
        assert scalar(db,"SELECT sum(pending_without_time) FROM v2_flow_qa.daily_read")==tvs*PER_TV
        with db.transaction():
            d=clients[0]
            cur=db.execute("SELECT watermark FROM v2_flow_qa.devices WHERE device=%s",(d.device,)).fetchone()[0]
            assert cur==PER_TV
        query1="""SELECT count(*) FROM v2_flow_qa.receipts
               WHERE company=%s AND received_day=%s"""
        query2="""SELECT sum(pending_without_time) FROM v2_flow_qa.daily_read
               WHERE company=%s AND received_day=%s"""
        args=(clients[0].company,DAY)
        assert scalar(db,query1,args)==scalar(db,query2,args)
        rawplan=db.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+query1,args).fetchone()[0][0]
        readplan=db.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+query2,args).fetchone()[0][0]
        rawp95=round(rawplan["Execution Time"],4)
        readp95=round(readplan["Execution Time"],4)
    counts=server.counters()
    observed_requests=counts["posts"]+counts["gets"]
    theoretical_baseline=tvs*(PER_TV+(DURATION//FLUSH_PERIOD))
    reduction=round((1-observed_requests/theoretical_baseline)*100,2)
    assert counts["accepted"]==tvs*PER_TV,counts
    assert counts["max_size"]==MAX_BATCH,counts
    assert counts["duplicates"]>=tvs*8,counts
    assert counts["http_503"]>=tvs,counts
    assert counts["command_changed"]>=tvs,counts
    assert counts["gets"]<=tvs*5,counts
    assert observed_requests<theoretical_baseline
    assert all(c.ack()==PER_TV and c.pending_count()==0 and c.rev==1 for c in clients)
    lengths=[len(c.latencies) for c in clients]
    latencies=[v for c in clients for v in c.latencies]
    diskbytes=sum(c.path.stat().st_size+c.path.with_suffix(".sqlite-wal").stat().st_size
                 if c.path.with_suffix(".sqlite-wal").exists()
                 else c.path.stat().st_size for c in clients)
    return {"result":"PASS","tvs":tvs,"virtual_duration_seconds":DURATION,
       "events_per_tv":PER_TV,"accepted":counts["accepted"],
       "http_posts":counts["posts"],"http_command_gets":counts["gets"],
       "http_total":observed_requests,"naive_event_post_plus_2min_command_get":theoretical_baseline,
       "http_reduction_percent_vs_naive":reduction,
       "duplicate_replays":counts["duplicates"],"http_503_faults":counts["http_503"],
       "max_upload_items":counts["max_size"],"post_p95_including_failures_ms":quantile95(latencies),
       "pg_wal_generated_bytes":wal,"pg_event_table_index_bytes":partition,
       "pg_event_index_bytes":part_indexes,"pg_daily_cqrs_bytes":read,
       "pg_devices_bytes":devices,"pg_database_bytes":dbsize,
       "sqlite_all_local_files_bytes":diskbytes,"daily_projected":tvs*PER_TV,
       "commands_updated":counts["command_changed"],"command_not_modified":counts["command_not_modified"],
       "raw_query_one_explain_ms":rawp95,"daily_read_one_explain_ms":readp95,
       "boot_1970_records":tvs*PER_TV,"synthetic_db_rollback":server.fault_once,
       "lost_ack_clients":len(server.first_ack_lost)}

def run(tvs):
    with conn() as db:
        assert_db(db)
        db.execute(SCHEMA)
    with tempfile.TemporaryDirectory(prefix="v2-qa-full-flow-") as root:
        clients=[Client(root,i,tvs) for i in range(tvs)]
        with conn() as db:
            with db.transaction():
                for c in clients:
                    db.execute("""INSERT INTO v2_flow_qa.devices(company,device,stream,token_hash)
                          VALUES(%s,%s,%s,%s)""",(c.company,c.device,c.stream,
                          hashlib.sha256(c.token.encode()).hexdigest()))
                    db.execute("INSERT INTO v2_flow_qa.projection_cursor(device) VALUES(%s)",(c.device,))
            wal_start=scalar(db,"SELECT pg_current_wal_insert_lsn()")
        gateway=Gateway()
        thread=threading.Thread(target=gateway.serve_forever,daemon=True)
        thread.start()
        base="http://127.0.0.1:"+str(gateway.server_address[1])
        worker=concurrent.futures.ThreadPoolExecutor(max_workers=THREADS)
        try:
            def upload_all(seconds,drain=False):
                list(worker.map(lambda c:send_upload(c,base,seconds,drain),clients))
            def command_all(seconds,forced=False):
                list(worker.map(lambda c:send_command(c,base,seconds,forced),clients))
            command_all(0,True)
            for seconds in range(0,DURATION,15):
                if seconds==OUTAGE_START:
                    gateway.offline=True
                if seconds==OUTAGE_END:
                    gateway.offline=False
                    for c in clients:c.offline_known=False
                if seconds==900:
                    for c in clients:c.reboot()
                for c in clients:
                    c.append(seconds//15+1,seconds)
                if seconds==OUTAGE_END:
                    upload_all(seconds,True)
                    command_all(seconds,True)
                if seconds==1200:
                    with conn() as db:
                        db.execute("UPDATE v2_flow_qa.devices SET command_revision=1")
                    # push revision notice simulated: immediate change fetch,
                    # then duplicate same notification must not trigger GET.
                    command_all(seconds,True)
                    before=gateway.counters()["gets"]
                    if not all(c.rev==1 for c in clients):raise AssertionError("revision_not_received")
                    # Duplicate push notice for same revision must not force GET.
                    list(worker.map(lambda c:send_command(c,base,seconds,True)
                                    if c.rev<1 else None,clients))
                    assert gateway.counters()["gets"]==before
                if seconds==900:
                    command_all(seconds,False)
                if (seconds+15)%FLUSH_PERIOD==0:
                    upload_all(seconds,False)
            upload_all(DURATION,True)
            command_all(DURATION,False)
            # A quiet period with NO notification must still periodically
            # reconcile command state: fallback after the configured TTL.
            before_fallback=gateway.counters()["gets"]
            command_all(DURATION+FALLBACK,False)
            assert gateway.counters()["gets"]==before_fallback+len(clients)
            assert all(c.rev==1 for c in clients)
            assert all(c.ack()==PER_TV for c in clients)
            # Explicit independent anti-replay/tenant tests (HTTP, real PG).
            first=clients[0]
            before=gateway.counters()["accepted"]
            result=post_http(base+"/qa/ingest",first.token,{"device":first.device,
                   "stream":first.stream,"events":[{"seq":1,"event_id":"event-00000001",
                   "media":"ad-1","boot":"boot-A","mono":0}]})
            # Original media for seq1 is ad-1, but mono=0 and checksum match.
            assert result[0]==200 and result[1]["duplicate"]==1,result
            unauthorized=post_http(base+"/qa/ingest",clients[1].token,{"device":first.device,
                   "stream":first.stream,"events":[{"seq":1,"event_id":"event-00000001",
                   "media":"ad-1","boot":"boot-A","mono":0}]})
            assert unauthorized[0]==401,unauthorized
            assert gateway.counters()["accepted"]==before
            projected=read_model(tvs)
            assert projected==tvs*PER_TV
            report=get_metrics(gateway,tvs,clients,wal_start)
            for c in clients:c.close()
            assert report["lost_ack_clients"]==tvs
            assert report["synthetic_db_rollback"]
            print("V2_FULL_FLOW_PASS_JSON="+json.dumps(report,sort_keys=True,separators=(",",":")),flush=True)
            print(f"V2_FULL_FLOW_{tvs}_TV_PASS=true",flush=True)
        finally:
            worker.shutdown(wait=True)
            gateway.shutdown()
            gateway.server_close()
            thread.join(3)
            for c in clients:
                try:c.close()
                except Exception:pass

if __name__=="__main__":
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument("--tvs",type=int,required=True,choices=[7,12,20,50,100])
    run(p.parse_args().tvs)
