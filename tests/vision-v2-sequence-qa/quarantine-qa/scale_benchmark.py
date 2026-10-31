"""VISION V2 benchmark. PostgreSQL 17 disposable + loopback HTTP. Never Supabase.

Each run owns a fresh ephemeral database. 1000 events/TV bulk loaded through
COPY (storage benchmark), then 50 events/TV sent over HTTP 3 times concurrently
(ACK/replay benchmark). Do not confuse bulk-load throughput with Edge capacity.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import statistics
import time
import urllib.error
import urllib.request

import psycopg
from server import DSN, event_hash, hash_token, start_test_server

INITIAL_PER_TV=1000
HTTP_PER_TV=50
RETRY_FACTOR=3

def event(seq):
    return {"sequence":seq,"event_id":f"proof-{seq:08d}","media_id":f"ad-{seq%10}",
            "boot_id":"boot-qa-0001","mono_ms":seq*15000,
            "seconds":15,"completed":True}

def ident(i, tv_count):
    return {"device":f"device-{i:03d}","stream":f"stream-{i:03d}",
            "company":f"tenant-{i%max(2,tv_count//10):02d}",
            "token":f"qa-token-{i:03d}-random-fixture-0123456789"}

def conn():
    return psycopg.connect(DSN,connect_timeout=8)

def sqlone(query, params=()):
    with conn() as db:
        return db.execute(query,params).fetchone()[0]

def size_stats():
    with conn() as db:
        row=db.execute("""
        SELECT
        pg_relation_size('v2_quarantine_qa.receipts'),
        pg_indexes_size('v2_quarantine_qa.receipts'),
        pg_total_relation_size('v2_quarantine_qa.receipts'),
        pg_total_relation_size('v2_quarantine_qa.devices'),
        pg_database_size(current_database()),
        (SELECT count(*) FROM v2_quarantine_qa.receipts)
        """).fetchone()
    names=("receipt_heap_bytes","receipt_index_bytes","receipt_total_bytes",
           "devices_total_bytes","database_total_bytes","receipt_rows")
    return dict(zip(names,map(int,row)))

def lsn():
    return sqlone("SELECT pg_current_wal_insert_lsn()")

def wal_diff(begin,end):
    return int(sqlone("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",(end,begin)))

def data_seed(tv_count):
    start=time.perf_counter()
    with conn() as db:
        with db.cursor() as cur:
            for i in range(tv_count):
                t=ident(i,tv_count)
                cur.execute("""INSERT INTO v2_quarantine_qa.devices
                    (company_id,device_id,stream_id,token_sha256,watermark)
                    VALUES(%s,%s,%s,%s,%s)""",
                    (t["company"],t["device"],t["stream"],hash_token(t["token"]),INITIAL_PER_TV))
            with cur.copy("""COPY v2_quarantine_qa.receipts
                   (device_id,company_id,stream_id,sequence,event_id,media_id,
                    boot_id,mono_ms,seconds,completed,payload_sha256)
                   FROM STDIN""") as writer:
                for i in range(tv_count):
                    t=ident(i,tv_count)
                    for seq in range(1,INITIAL_PER_TV+1):
                        e=event(seq)
                        writer.write_row((t["device"],t["company"],t["stream"],
                            seq,e["event_id"],e["media_id"],e["boot_id"],
                            e["mono_ms"],e["seconds"],e["completed"],event_hash(e)))
    duration=time.perf_counter()-start
    expected=tv_count*INITIAL_PER_TV
    assert size_stats()["receipt_rows"]==expected
    assert sqlone("SELECT count(*) FROM v2_quarantine_qa.receipts WHERE billable OR event_played_at IS NOT NULL")==0
    print("QA_BULK_LOAD_PASS initial_rows="+str(expected)+" seconds="+str(round(duration,3)),flush=True)
    return duration

def post(url, t, events, token_override=None):
    payload=json.dumps({"device_id":t["device"],"stream_id":t["stream"],
                        "events":events},separators=(",",":")).encode()
    req=urllib.request.Request(url,data=payload,method="POST",
        headers={"x-device-token":token_override or t["token"],
                 "Content-Type":"application/json"})
    began=time.perf_counter()
    try:
        with urllib.request.urlopen(req,timeout=30) as resp:
            return resp.status,json.load(resp),time.perf_counter()-began
    except urllib.error.HTTPError as exc:
        return exc.code,json.loads(exc.read()),time.perf_counter()-began

def parallel_http(tv_count):
    server,thread=start_test_server()
    url=f"http://127.0.0.1:{server.server_address[1]}/qa/quarantine"
    batch=[event(j) for j in range(INITIAL_PER_TV+1,INITIAL_PER_TV+HTTP_PER_TV+1)]
    tasks=[(ident(i,tv_count),batch) for i in range(tv_count) for _ in range(RETRY_FACTOR)]
    try:
        start=time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
            results=list(executor.map(lambda task:post(url,*task),tasks))
        seconds=time.perf_counter()-start
        failed=[(code,msg) for code,msg,_ in results if code!=200]
        assert not failed, f"unexpected HTTP errors {failed[:3]}"
        accepted=sum(msg["accepted"] for _,msg,_ in results)
        duplicates=sum(msg["duplicates"] for _,msg,_ in results)
        assert accepted==tv_count*HTTP_PER_TV,(accepted,tv_count)
        assert duplicates==tv_count*HTTP_PER_TV*(RETRY_FACTOR-1),duplicates
        assert all(msg["ack"]==INITIAL_PER_TV+HTTP_PER_TV and
                   msg["quarantined"]==msg["accepted"] and
                   msg["billable"]==0 for _,msg,_ in results)
        timings=sorted([lat*1000 for _,_,lat in results])
        p95=timings[max(0,__import__("math").ceil(.95*len(timings))-1)]
        assert sqlone("SELECT count(*) FROM v2_quarantine_qa.receipts")==tv_count*(INITIAL_PER_TV+HTTP_PER_TV)
        assert sqlone("SELECT count(*) FROM v2_quarantine_qa.devices WHERE watermark=%s",
                      (INITIAL_PER_TV+HTTP_PER_TV,))==tv_count
        assert sqlone("SELECT count(*) FROM v2_quarantine_qa.receipts WHERE billable OR event_played_at IS NOT NULL")==0
        status,_data,_=post(url,ident(0,tv_count),[event(1052)])
        assert status==409, status
        other=ident(1,tv_count)
        status,_data,_=post(url,other,[event(1051)],token_override=ident(0,tv_count)["token"])
        assert status==401,status
        rows_before=sqlone("SELECT count(*) FROM v2_quarantine_qa.receipts")
        replay=post(url,ident(0,tv_count),batch)
        assert replay[0]==200 and replay[1]["accepted"]==0 and replay[1]["duplicates"]==50
        assert sqlone("SELECT count(*) FROM v2_quarantine_qa.receipts")==rows_before
        print("QA_HTTP_CONCURRENT_PASS tvs="+str(tv_count)+" requests="+str(len(tasks))+
              " accepted="+str(accepted)+" duplicates="+str(duplicates)+
              " ack="+str(INITIAL_PER_TV+HTTP_PER_TV)+
              " seconds="+str(round(seconds,3))+" p95_ms="+str(round(p95,2)),flush=True)
        return {"requests":len(tasks),"accepted":accepted,"duplicates":duplicates,
                "seconds":round(seconds,3),"p95_ms":round(p95,2)}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(3)

def shadow_archive(tv_count):
    """A *copy*, not deletion or long-term retention. Keep all originals."""
    script=Path(__file__).with_name("shadow_archive.sql").read_text()
    with conn() as db: db.execute(script)
    first=ident(0,tv_count)
    device,stream=first["device"],first["stream"]
    before_ack=sqlone("SELECT watermark FROM v2_quarantine_qa.devices WHERE device_id=%s",(device,))
    before_rows=sqlone("SELECT count(*) FROM v2_quarantine_qa.receipts")
    with conn() as db:
        with db.cursor() as cur:
            cur.execute("""INSERT INTO v2_archive_shadow_qa.proofs
                SELECT * FROM v2_quarantine_qa.receipts
                WHERE device_id=%s AND stream_id=%s AND sequence<=1000 ORDER BY sequence""",
                (device,stream))
            cur.execute("""SELECT sequence,payload_sha256 FROM v2_archive_shadow_qa.proofs
                WHERE device_id=%s ORDER BY sequence""",(device,))
            digest=hashlib.sha256()
            rows=cur.fetchall()
            assert len(rows)==1000
            for seq,hashed in rows:
                digest.update(f"{seq}:{hashed}\n".encode())
            cur.execute("""INSERT INTO v2_archive_shadow_qa.manifests
                (device_id,stream_id,first_seq,last_seq,proofs_count,digest_sha256)
                VALUES(%s,%s,1,1000,1000,%s)""",(device,stream,digest.hexdigest()))
    assert sqlone("""SELECT count(*) FROM
        ((SELECT * FROM v2_archive_shadow_qa.proofs)
          EXCEPT
         (SELECT * FROM v2_quarantine_qa.receipts)) q""")==0, "archive deviates from source"
    assert sqlone("SELECT count(*) FROM v2_quarantine_qa.receipts")==before_rows
    assert sqlone("SELECT watermark FROM v2_quarantine_qa.devices WHERE device_id=%s",(device,))==before_ack
    # Independently recheck the saved SHA-256 manifest against the original
    # payload hashes after the transaction committed.
    with conn() as db:
        archived=db.execute("""SELECT sequence,payload_sha256 FROM v2_archive_shadow_qa.proofs
            WHERE device_id=%s ORDER BY sequence""",(device,)).fetchall()
        source=db.execute("""SELECT sequence,payload_sha256 FROM v2_quarantine_qa.receipts
            WHERE device_id=%s AND sequence<=1000 ORDER BY sequence""",(device,)).fetchall()
        manifest=db.execute("""SELECT proofs_count,digest_sha256 FROM v2_archive_shadow_qa.manifests
            WHERE device_id=%s AND stream_id=%s AND first_seq=1 AND last_seq=1000""",
            (device,stream)).fetchone()
    assert archived==source and len(archived)==manifest[0]==1000
    actual=hashlib.sha256()
    for seq,digest_value in source:
        actual.update((f"{seq}:{digest_value}"+chr(10)).encode())
    assert actual.hexdigest()==manifest[1],"manifest does not match source"
    # Fault mid-archive-copy must roll back all new archive rows, without
    # touching originals. 1001 is a receipt not yet shadow archived.
    failed=False
    try:
        with conn() as db:
            db.execute("""INSERT INTO v2_archive_shadow_qa.proofs SELECT *
                FROM v2_quarantine_qa.receipts
                WHERE device_id=%s AND sequence=1001""",(device,))
            db.execute("""INSERT INTO v2_archive_shadow_qa.proofs SELECT *
                FROM v2_quarantine_qa.receipts
                WHERE device_id=%s AND sequence=1001""",(device,))
    except psycopg.errors.UniqueViolation:
        failed=True
    assert failed,"expected archive copy conflict"
    assert sqlone("SELECT count(*) FROM v2_archive_shadow_qa.proofs")==1000
    assert sqlone("SELECT count(*) FROM v2_quarantine_qa.receipts")==before_rows
    # Replay AFTER archiving must remain a duplicate, with no ACK change.
    replay_server,replay_thread=start_test_server()
    try:
        url=f"http://127.0.0.1:{replay_server.server_address[1]}/qa/quarantine"
        s,reply,_=post(url,first,[event(j) for j in range(1001,1051)])
        assert s==200 and reply["ack"]==1050
        assert reply["accepted"]==0 and reply["duplicates"]==50
    finally:
        replay_server.shutdown()
        replay_server.server_close()
        replay_thread.join(3)
    assert sqlone("SELECT count(*) FROM v2_quarantine_qa.receipts")==before_rows
    assert sqlone("SELECT watermark FROM v2_quarantine_qa.devices WHERE device_id=%s",(device,))==before_ack
    print("QA_ARCHIVE_REPLAY_ROLLBACK_PASS manifest_sha256_verified=true "+
          "after_archive_duplicates=50 rollback_preserved=1000",flush=True)
    with conn() as db:
        try:
            with db.transaction():
                db.execute("UPDATE v2_archive_shadow_qa.proofs SET media_id='altered' WHERE device_id=%s",(device,))
        except psycopg.Error as exc:
            assert "archive_immutable" in str(exc),str(exc)
        else:
            raise AssertionError("immutable archive accepted update")
    archive_bytes=sqlone("SELECT pg_total_relation_size('v2_archive_shadow_qa.proofs')")
    manifest_bytes=sqlone("SELECT pg_total_relation_size('v2_archive_shadow_qa.manifests')")
    print("QA_ARCHIVE_SHADOW_PASS tvs="+str(tv_count)+" proofs=1000"+
          " archive_bytes="+str(archive_bytes)+" manifest_bytes="+str(manifest_bytes)+
          " originals_unchanged="+str(before_rows)+" ack_unchanged="+str(before_ack),
          flush=True)
    return {"proofs":1000,"archive_bytes":archive_bytes,
            "manifest_bytes":manifest_bytes}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--tvs",type=int,required=True,choices=[7,12,20,50,100])
    args=parser.parse_args()
    with conn() as db:
        actual=db.execute("SELECT current_database()").fetchone()[0]
        assert actual=="vision_v2_quarantine_disposable","NO-GO: not disposable DB"
    started=lsn()
    seed_seconds=data_seed(args.tvs)
    after_seed=lsn()
    bulk_stats=size_stats()
    bulk_wal=wal_diff(started,after_seed)
    http=parallel_http(args.tvs)
    after_http=lsn()
    http_wal=wal_diff(after_seed,after_http)
    final_stats=size_stats()
    assert final_stats["receipt_rows"]==args.tvs*(INITIAL_PER_TV+HTTP_PER_TV)
    assert final_stats["receipt_total_bytes"]>=bulk_stats["receipt_total_bytes"]
    archive=shadow_archive(args.tvs)
    after_archive=lsn()
    archive_wal=wal_diff(after_http,after_archive)
    assert sqlone("SELECT COUNT(*) FROM v2_quarantine_qa.receipts")==final_stats["receipt_rows"]
    results={"status":"PASS","tvs":args.tvs,"events_per_tv":INITIAL_PER_TV+HTTP_PER_TV,
             "bulk_load_seconds":round(seed_seconds,3),
             "bulk_wal_bytes":bulk_wal,
             "http_wal_bytes":http_wal,
             "archive_copy_wal_bytes":archive_wal,
             "bulk":bulk_stats,"final":final_stats,
             "http":http,"shadow_archive":archive}
    print("V2_SCALE_RESULT_JSON="+json.dumps(results,sort_keys=True,separators=(",",":")),flush=True)
    print("V2_SCALE_"+str(args.tvs)+"_TV=PASS",flush=True)

if __name__=="__main__":main()
