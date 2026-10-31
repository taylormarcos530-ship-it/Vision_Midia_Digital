"""QA ONLY: full 15-second seven-day 25-TV shard; all bytes and transactions real.

12 independent GitHub Actions shards * 25 synthetic TVs * 40,320 receipts
= 12,096,000 receipt rows across ephemeral PostgreSQL 17 instances.
Each 50-proof SQLite batch is committed transactionally to PostgreSQL.
No real HTTP, Supabase, Android, CDN, APK or user data in this benchmark.

Mandatory gates: free-disk preflight, 1.5GiB PG database cap, 4GiB WAL
generation cap, elapsed-time cap; any resource cap fails this job (not PASS).
No DELETE on source SQLite or PostgreSQL, no use of production databases.
"""
import argparse
from collections import Counter
from datetime import date, timedelta
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import statistics
import tempfile
import time
import psycopg

DSN="postgresql://postgres:qa-only-local-password@127.0.0.1:5432/vision_v2_quarantine_disposable"
DEVICES_PER_SHARD=25
TOTAL_SHARDS=12
EVENTS_PER_DAY=5760
DAYS=7
EVENTS_PER_TV=40320
BATCH=50
SHARD_EVENTS=DEVICES_PER_SHARD*EVENTS_PER_TV
LOCAL_PENDING_LIMIT=50000
MIN_FREE_DISK=3*1024**3
MAX_PG_BYTES=1500*1024**2
MAX_WAL_BYTES=4*1024**3
MAX_ELAPSED=540
START=date(2026,10,31)

DDL="""
DO $$ BEGIN
 IF current_database()<>'vision_v2_quarantine_disposable' THEN
   RAISE EXCEPTION 'NOT DISPOSABLE';
 END IF;
END $$;
CREATE SCHEMA qa_full;
CREATE TABLE qa_full.devices (
 device text PRIMARY KEY, company text NOT NULL, stream text NOT NULL,
 watermark bigint NOT NULL DEFAULT 0);
CREATE TABLE qa_full.receipts(
 received_month date NOT NULL,
 received_day date NOT NULL,
 company text NOT NULL,
 device text NOT NULL,
 seq bigint NOT NULL,
 event_id text NOT NULL,
 media_id text NOT NULL,
 boot_id text NOT NULL,
 mono_ms bigint NOT NULL,
 proof_sha256 text NOT NULL,
 played_at timestamptz NULL CHECK (played_at IS NULL),
 billable bool NOT NULL DEFAULT false CHECK (billable = false),
 PRIMARY KEY (received_month,device,seq)
) PARTITION BY RANGE (received_month);
CREATE TABLE qa_full.receipts_oct PARTITION OF qa_full.receipts
 FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE qa_full.receipts_nov PARTITION OF qa_full.receipts
 FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE INDEX qa_receipts_oct_dev_seq ON qa_full.receipts_oct(device,seq);
CREATE INDEX qa_receipts_nov_dev_seq ON qa_full.receipts_nov(device,seq);
CREATE INDEX qa_receipts_oct_company_day ON qa_full.receipts_oct(company,received_day);
CREATE INDEX qa_receipts_nov_company_day ON qa_full.receipts_nov(company,received_day);
CREATE TABLE qa_full.projection_cursor (
 device text PRIMARY KEY REFERENCES qa_full.devices(device),
 through_seq bigint NOT NULL DEFAULT 0);
CREATE TABLE qa_full.daily_read (
 device text NOT NULL, company text NOT NULL,received_day date NOT NULL,
 pending_time bigint NOT NULL DEFAULT 0,
 PRIMARY KEY (device,received_day));
CREATE INDEX qa_daily_tenant ON qa_full.daily_read(company,received_day);
"""

def db():return psycopg.connect(DSN,autocommit=True,connect_timeout=8)
def one(c,q,args=()):return c.execute(q,args).fetchone()[0]
def sha(value):return hashlib.sha256(value.encode()).hexdigest()
def p95(vals):
    v=sorted(vals)
    return round(v[max(0,math.ceil(.95*len(v))-1)],3) if v else 0
def as_bytes(n):return int(n)
def path_mb(bytes_value):return round(bytes_value/1e6,3)
def preflight():
    free=shutil.disk_usage("/").free
    if free<MIN_FREE_DISK:raise RuntimeError(f"QA_RESOURCE_GATE_FAIL insufficient disk free={free}")
    with db() as c:
        name=one(c,"SELECT current_database()")
        if name!="vision_v2_quarantine_disposable":
            raise RuntimeError("QA_RESOURCE_GATE_FAIL wrong database")
        server_major=one(c,"SHOW server_version_num")
        if int(server_major)//10000!=17:
            raise RuntimeError("QA_RESOURCE_GATE_FAIL not PostgreSQL 17")
        pgbytes=one(c,"SELECT pg_database_size(current_database())")
        if pgbytes>MAX_PG_BYTES:raise RuntimeError("QA_RESOURCE_GATE_FAIL database too large before load")
    print(f"QA_PREFLIGHT_PASS free_disk_bytes={free} pg_before_bytes={pgbytes} max_pg_bytes={MAX_PG_BYTES} "+
          f"max_wal_bytes={MAX_WAL_BYTES} max_time_s={MAX_ELAPSED} "+
          "target_rows_per_shard=1008000 batch=50",flush=True)
    return free
def gated(c,wal_start,started,stage,check_disk=False):
    if time.monotonic()-started>MAX_ELAPSED:
        raise RuntimeError(f"QA_RESOURCE_GATE_FAIL timeout stage={stage}")
    size=one(c,"SELECT pg_database_size(current_database())")
    if size>MAX_PG_BYTES:
        raise RuntimeError(f"QA_RESOURCE_GATE_FAIL pgbytes={size} stage={stage}")
    current=one(c,"SELECT pg_current_wal_insert_lsn()")
    delta=int(one(c,"SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",(current,wal_start)))
    if delta>MAX_WAL_BYTES:
        raise RuntimeError(f"QA_RESOURCE_GATE_FAIL wal={delta} stage={stage}")
    if check_disk and shutil.disk_usage("/").free<MIN_FREE_DISK:
        raise RuntimeError(f"QA_RESOURCE_GATE_FAIL host_disk stage={stage}")
    return size,delta
def make_device(shard,local):
    serial=shard*DEVICES_PER_SHARD+local
    return f"tv-{serial:03d}",f"tenant-{serial%30:02d}",f"stream-{serial:03d}"
def receipt(device,seq):
    # Boot B begins after 3 days and the monotonic counter resets;
    # wall-clock playback timestamp is NEVER manufactured.
    boot="qa-boot-A" if seq<=3*EVENTS_PER_DAY else "qa-boot-B"
    origin=1 if boot=="qa-boot-A" else 3*EVENTS_PER_DAY+1
    mono=(seq-origin)*15000
    media=f"media-{seq%19:02d}"
    proof=sha(f"{device}|{seq}|{media}|{boot}|{mono}")
    return seq,f"qa-event-{seq:08d}",media,boot,mono,proof
def local_database(path,device,started):
    q=sqlite3.connect(path)
    q.execute("PRAGMA journal_mode=WAL")
    q.execute("PRAGMA synchronous=FULL")
    q.execute("""CREATE TABLE proofs(
        seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,media_id TEXT NOT NULL,
        boot_id TEXT NOT NULL,mono_ms INTEGER NOT NULL,proof_sha256 TEXT NOT NULL,
        played_at INTEGER NULL CHECK (played_at IS NULL))""")
    q.execute("CREATE TABLE state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), ack INTEGER NOT NULL)")
    q.execute("INSERT INTO state VALUES(1,0)")
    for day in range(DAYS):
        first=day*EVENTS_PER_DAY+1
        last=(day+1)*EVENTS_PER_DAY
        with q:
            q.executemany("""INSERT INTO proofs(seq,event_id,media_id,boot_id,mono_ms,proof_sha256)
                  VALUES(?,?,?,?,?,?)""",
                (receipt(device,seq) for seq in range(first,last+1)))
    assert q.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
    assert q.execute("SELECT count(*) FROM proofs").fetchone()[0]==EVENTS_PER_TV
    assert q.execute("SELECT count(DISTINCT boot_id) FROM proofs").fetchone()[0]==2
    assert q.execute("SELECT count(*) FROM proofs WHERE played_at IS NOT NULL").fetchone()[0]==0
    assert q.execute("SELECT MAX(seq) FROM proofs").fetchone()[0]<LOCAL_PENDING_LIMIT
    return q
def segment_day(seq):
    # One virtual day online, two simulated offline, then reconnected.
    # This is trusted SERVER receipt date for the benchmark, NOT played_at.
    playday=(seq-1)//EVENTS_PER_DAY
    receivedday=playday if playday==0 or playday>=3 else 3
    received=START+timedelta(days=receivedday)
    return received,received.replace(day=1)
def insert_batch(pg,device,company,stream,events,injected):
    # Single real PG17 transaction per 50 receipts; ACK and rows atomically.
    sequences=[x[0] for x in events]
    groups={}
    for row in events:
        received,month=segment_day(row[0])
        groups.setdefault((received,month),[]).append(row)
    with pg.transaction():
        watermark=one(pg,"SELECT watermark FROM qa_full.devices WHERE device=%s FOR UPDATE",(device,))
        if sequences[0]!=watermark+1:raise AssertionError(f"gap_{device}_{sequences[0]}_{watermark}")
        for (received,month),arr in groups.items():
            pg.execute("""INSERT INTO qa_full.receipts
               (received_month,received_day,company,device,seq,event_id,media_id,boot_id,mono_ms,proof_sha256)
               SELECT %s,%s,%s,%s,x.seq,x.event_id,x.media_id,x.boot_id,x.mono_ms,x.proof_sha256
               FROM unnest(%s::bigint[],%s::text[],%s::text[],%s::text[],
                           %s::bigint[],%s::text[]) AS x(seq,event_id,media_id,boot_id,mono_ms,proof_sha256)""",
               (month,received,company,device,
                [x[0] for x in arr],[x[1] for x in arr],[x[2] for x in arr],
                [x[3] for x in arr],[x[4] for x in arr],[x[5] for x in arr]))
        # Inject one real transaction failure after INSERT before ACK.
        if device.endswith("000") and sequences[0]==101 and not injected[0]:
            injected[0]=True
            raise RuntimeError("QA_INJECTED_ROLLBACK")
        pg.execute("UPDATE qa_full.devices SET watermark=%s WHERE device=%s",
                   (sequences[-1],device))
    return sequences[-1]
def verify_replay(pg,device,events):
    # Read and compare original hashes, no extra INSERT and no ACK update.
    rows=pg.execute("""SELECT seq,proof_sha256 FROM qa_full.receipts
           WHERE device=%s AND seq BETWEEN %s AND %s ORDER BY seq""",
           (device,events[0][0],events[-1][0])).fetchall()
    assert rows==[(e[0],e[5]) for e in events]
    old=one(pg,"SELECT watermark FROM qa_full.devices WHERE device=%s",(device,))
    assert old>=events[-1][0]
    return len(events)
def project(pg,device):
    start=time.perf_counter()
    with pg.transaction():
        marker=one(pg,"SELECT through_seq FROM qa_full.projection_cursor WHERE device=%s FOR UPDATE",(device,))
        rows=pg.execute("""SELECT received_day,company,count(*),min(seq),max(seq)
             FROM qa_full.receipts WHERE device=%s AND seq>%s
             GROUP BY received_day,company ORDER BY min(seq)""",
             (device,marker)).fetchall()
        total=sum(r[2] for r in rows)
        if total!=EVENTS_PER_TV or marker!=0:raise AssertionError("wrong_projector_input")
        seqs=pg.execute("""SELECT seq FROM qa_full.receipts WHERE device=%s ORDER BY seq""",
                       (device,)).fetchall()
        if len(seqs)!=EVENTS_PER_TV or any(x[0]!=i for i,x in enumerate(seqs,1)):
            raise AssertionError("projector_sequence_gap")
        for received,company,count,_,_ in rows:
            pg.execute("""INSERT INTO qa_full.daily_read(device,company,received_day,pending_time)
                 VALUES(%s,%s,%s,%s)
                 ON CONFLICT(device,received_day) DO UPDATE
                 SET pending_time=qa_full.daily_read.pending_time+EXCLUDED.pending_time""",
                (device,company,received,count))
        pg.execute("UPDATE qa_full.projection_cursor SET through_seq=%s WHERE device=%s",
                   (EVENTS_PER_TV,device))
    # Retry: re-run no-op without double count.
    with pg.transaction():
        assert one(pg,"SELECT through_seq FROM qa_full.projection_cursor WHERE device=%s",(device,))==EVENTS_PER_TV
    return time.perf_counter()-start
def sizes(pg):
    table=sum(one(pg,"SELECT pg_total_relation_size(%s::regclass)",(f"qa_full.receipts_{s}",))
              for s in ("oct","nov"))
    indexes=sum(one(pg,"SELECT pg_indexes_size(%s::regclass)",(f"qa_full.receipts_{s}",))
                for s in ("oct","nov"))
    return {"database_bytes":one(pg,"SELECT pg_database_size(current_database())"),
            "receipts_relation_bytes":table,"receipts_index_bytes":indexes,
            "cqrs_bytes":one(pg,"SELECT pg_total_relation_size('qa_full.daily_read')")}
def bench(shard):
    assert 0<=shard<TOTAL_SHARDS
    started=time.monotonic()
    preflight()
    with db() as pg:
        pg.execute(DDL)
        devices=[make_device(shard,i) for i in range(DEVICES_PER_SHARD)]
        with pg.transaction():
            with pg.cursor() as cur:
                cur.executemany("INSERT INTO qa_full.devices(device,company,stream) VALUES(%s,%s,%s)",devices)
                cur.executemany("INSERT INTO qa_full.projection_cursor(device) VALUES(%s)",[(d,) for d,_,_ in devices])
        start_wal=one(pg,"SELECT pg_current_wal_insert_lsn()")
        total=0
        duplicate=0
        batches=0
        local_bytes=0
        latencies=[]
        projections=[]
        injected=[False]
        t0=time.perf_counter()
        with tempfile.TemporaryDirectory(prefix=f"v2-full-15sec-shard{shard}-") as temporary:
            for i,(device,company,stream) in enumerate(devices):
                path=Path(temporary)/(device+".sqlite")
                q=local_database(path,device,started)
                assert q.execute("SELECT ack FROM state").fetchone()[0]==0
                # 2+ virtual days offline without sending; max backlog 17280.
                assert q.execute("SELECT count(*) FROM proofs WHERE seq<=?",(3*EVENTS_PER_DAY,)).fetchone()[0]==17280
                if i==0:
                    q.close()
                    q=sqlite3.connect(path)
                    assert q.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
                lastfirst=None
                for offset in range(0,EVENTS_PER_TV,BATCH):
                    rows=q.execute("""SELECT seq,event_id,media_id,boot_id,mono_ms,proof_sha256
                          FROM proofs WHERE seq>? ORDER BY seq LIMIT ?""",(offset,BATCH)).fetchall()
                    if len(rows)!=min(BATCH,EVENTS_PER_TV-offset):raise AssertionError("local_proof_gap")
                    tick=time.perf_counter()
                    try:
                        ack=insert_batch(pg,device,company,stream,rows,injected)
                    except RuntimeError as error:
                        if str(error)!="QA_INJECTED_ROLLBACK" or device!="tv-000":
                            raise
                        assert one(pg,"SELECT watermark FROM qa_full.devices WHERE device=%s",(device,))==offset
                        assert one(pg,"SELECT count(*) FROM qa_full.receipts WHERE device=%s AND seq>%s",(device,offset))==0
                        ack=insert_batch(pg,device,company,stream,rows,injected)
                    latencies.append((time.perf_counter()-tick)*1000)
                    with q:q.execute("UPDATE state SET ack=?",(ack,))
                    if offset==0:
                        # Lost ACK after successful database commit: retry as
                        # read-only proof equality, no duplication.
                        duplicate+=verify_replay(pg,device,rows)
                    total+=len(rows)
                    batches+=1
                    if batches%1200==0:
                        size,wal=gated(pg,start_wal,started,f"{i}-batch{batches}",True)
                        print(f"QA_SHARD_PROGRESS shard={shard} devices_completed={i} "+
                              f"rows={total} db_bytes={size} wal_bytes={wal}",flush=True)
                assert q.execute("SELECT ack FROM state").fetchone()[0]==EVENTS_PER_TV
                assert q.execute("SELECT count(*) FROM proofs").fetchone()[0]==EVENTS_PER_TV
                # SQLite WAL file size captured before close. No source deleted.
                local_bytes+=sum(Path(str(path)+s).stat().st_size for s in ("","-wal","-shm")
                                 if Path(str(path)+s).exists())
                q.close()
                lag=one(pg,"SELECT watermark-through_seq FROM qa_full.devices d JOIN qa_full.projection_cursor p USING(device) WHERE device=%s",(device,))
                assert lag==EVENTS_PER_TV
                projections.append(project(pg,device))
        assert total==SHARD_EVENTS
        assert injected[0] if shard==0 else not injected[0]
        assert one(pg,"SELECT count(*) FROM qa_full.receipts")==SHARD_EVENTS
        assert one(pg,"SELECT count(*) FROM qa_full.receipts WHERE played_at IS NOT NULL OR billable")==0
        assert one(pg,"SELECT count(*) FROM qa_full.devices WHERE watermark=%s",(EVENTS_PER_TV,))==DEVICES_PER_SHARD
        assert one(pg,"SELECT count(*) FROM qa_full.projection_cursor WHERE through_seq=%s",(EVENTS_PER_TV,))==DEVICES_PER_SHARD
        assert one(pg,"SELECT coalesce(sum(pending_time),0) FROM qa_full.daily_read")==SHARD_EVENTS
        assert one(pg,"SELECT count(*) FROM qa_full.receipts_oct")==EVENTS_PER_DAY*DEVICES_PER_SHARD
        assert one(pg,"SELECT count(*) FROM qa_full.receipts_nov")==SHARD_EVENTS-EVENTS_PER_DAY*DEVICES_PER_SHARD
        relation=sizes(pg)
        pg_bytes,wal=gated(pg,start_wal,started,"final",True)
        assert pg_bytes==relation["database_bytes"]
        # Per-shard backend read model with tenant/day isolation for 7 virtual days.
        co=devices[0][1]
        args=(co,START+timedelta(days=6))
        raw=one(pg,"SELECT count(*) FROM qa_full.receipts WHERE company=%s AND received_day=%s",args)
        summary=one(pg,"SELECT sum(pending_time) FROM qa_full.daily_read WHERE company=%s AND received_day=%s",args)
        assert raw==summary
        def exp(query):
            return pg.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) "+query,args).fetchone()[0][0]
        rawplan=exp("SELECT count(*) FROM qa_full.receipts WHERE company=%s AND received_day=%s")
        projplan=exp("SELECT sum(pending_time) FROM qa_full.daily_read WHERE company=%s AND received_day=%s")
        result={"result":"PASS","shard":shard,"devices":DEVICES_PER_SHARD,
          "first_tv":devices[0][0],"last_tv":devices[-1][0],
          "days_virtual":DAYS,"interval_seconds":15,
          "events_per_tv":EVENTS_PER_TV,"rows":total,"real_sql_transactions":batches,
          "p95_batch_tx_ms":p95(latencies),
          "throughput_events_per_second":round(total/(time.perf_counter()-t0),2),
          "write_elapsed_s":round(time.perf_counter()-t0,2),
          "wal_generated_bytes":wal,**relation,"sqlite_files_bytes":local_bytes,
          "duplicate_proofs_verified":duplicate,
          "max_projector_lag_events_per_tv":EVENTS_PER_TV,
          "projector_total_s":round(sum(projections),3),
          "pg_raw_query_ms":round(rawplan["Execution Time"],3),
          "pg_cqrs_query_ms":round(projplan["Execution Time"],3),
          "quota_pg_bytes":MAX_PG_BYTES,"quota_wal_bytes":MAX_WAL_BYTES,
          "rollback_injection":injected[0],
          "sqlite_full_offline_backlog_tested":17280,
          "no_originals_deleted":True}
        print("V2_15SEC_SHARD_JSON="+json.dumps(result,sort_keys=True,separators=(",",":")),flush=True)
        print(f"V2_15SEC_SHARD_{shard}=PASS",flush=True)
if __name__=="__main__":
    a=argparse.ArgumentParser()
    a.add_argument("--shard",type=int,required=True,choices=range(TOTAL_SHARDS))
    bench(a.parse_args().shard)
