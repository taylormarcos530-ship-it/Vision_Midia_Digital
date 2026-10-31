"""Disposable PostgreSQL 17 CQRS + monthly partition experiment.

All proofs synthetic, no Supabase, no customer data, no production migrations.
Uses a server-received MONTH for pruning, not unverifiable played-at time.
Single write endpoint streams an event; a separate scheduled worker updates the
read-model in batches. No new Android/TV HTTP requests are introduced.
"""
import os, json, psycopg, random, time

DSN=os.environ["VISION_V2_QA_POSTGRES_DSN"]
DDL="""
DO $$ BEGIN
 IF current_database()<>'vision_v2_quarantine_disposable'
 THEN RAISE EXCEPTION 'not_disposable'; END IF;
END $$;
CREATE SCHEMA v2_cqrs_qa;
CREATE TABLE v2_cqrs_qa.streams(
 device TEXT PRIMARY KEY,
 company TEXT NOT NULL,
 next_seq BIGINT NOT NULL DEFAULT 1 CHECK(next_seq>0));
CREATE TABLE v2_cqrs_qa.received_event(
 device TEXT NOT NULL, company TEXT NOT NULL, seq BIGINT NOT NULL,
 received_month DATE NOT NULL, payload_hash TEXT NOT NULL,
 event_played_at TIMESTAMPTZ,
 billable BOOLEAN NOT NULL DEFAULT FALSE CHECK(billable=FALSE),
 PRIMARY KEY(received_month,device,seq)
) PARTITION BY RANGE (received_month);
CREATE TABLE v2_cqrs_qa.received_2026_10 PARTITION OF v2_cqrs_qa.received_event
 FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE v2_cqrs_qa.received_2026_11 PARTITION OF v2_cqrs_qa.received_event
 FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE v2_cqrs_qa.project_cursor(
 device TEXT PRIMARY KEY REFERENCES v2_cqrs_qa.streams(device),
 through_seq BIGINT NOT NULL DEFAULT 0);
CREATE TABLE v2_cqrs_qa.read_month(
 device TEXT NOT NULL, company TEXT NOT NULL,
 received_month DATE NOT NULL, pending_time BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY(device,received_month)
);
CREATE INDEX qa_company_month ON v2_cqrs_qa.read_month(company,received_month);
REVOKE ALL ON ALL TABLES IN SCHEMA v2_cqrs_qa FROM PUBLIC;
"""

def conn():return psycopg.connect(DSN,connect_timeout=5)
def get(sql,parameters=()):
    with conn() as db:return db.execute(sql,parameters).fetchone()[0]
def store(device,company,seq,month):
    """Serial watermark, atomic receipt commit. no per-event persistent second ledger."""
    with conn() as db:
        with db.transaction():
            cursor=db.execute("SELECT next_seq,company FROM v2_cqrs_qa.streams WHERE device=%s FOR UPDATE",(device,)).fetchone()
            if not cursor or cursor[1]!=company: raise ValueError("tenant_not_authorized")
            if seq!=cursor[0]:raise ValueError("duplicate_or_gap")
            db.execute("""INSERT INTO v2_cqrs_qa.received_event(device,company,seq,received_month,payload_hash)
                          VALUES (%s,%s,%s,%s,%s)""",
                       (device,company,seq,month,f"synthetic-{device}-{seq}"))
            db.execute("UPDATE v2_cqrs_qa.streams SET next_seq=next_seq+1 WHERE device=%s",(device,))
    return seq

def project(device,limit=500):
    """Read-model checkpoint + counts in ONE transaction: safe to replay worker."""
    with conn() as db:
        with db.transaction():
            marker=db.execute("""SELECT through_seq FROM v2_cqrs_qa.project_cursor
                                 WHERE device=%s FOR UPDATE""",(device,)).fetchone()[0]
            rows=db.execute("""SELECT company,received_month,seq
                 FROM v2_cqrs_qa.received_event
                 WHERE device=%s AND seq>%s ORDER BY seq LIMIT %s""",
                 (device,marker,limit)).fetchall()
            if not rows:return 0
            # No missing sequence may be silently summarized.
            if any(r[2]!=marker+i for i,r in enumerate(rows,1)):
                raise ValueError("projection_sequence_gap")
            from collections import Counter
            counts=Counter((r[0],r[1]) for r in rows)
            for (company,month),count in counts.items():
                db.execute("""INSERT INTO v2_cqrs_qa.read_month
                    (device,company,received_month,pending_time) VALUES(%s,%s,%s,%s)
                    ON CONFLICT (device,received_month) DO UPDATE
                    SET pending_time=v2_cqrs_qa.read_month.pending_time+EXCLUDED.pending_time""",
                    (device,company,month,count))
            db.execute("UPDATE v2_cqrs_qa.project_cursor SET through_seq=%s WHERE device=%s",
                       (rows[-1][2],device))
            return len(rows)

def execute():
    with conn() as db:
        assert db.execute("SELECT current_database()").fetchone()[0]=="vision_v2_quarantine_disposable"
        db.execute(DDL)
        db.execute("INSERT INTO v2_cqrs_qa.streams(device,company) VALUES('qa-tv-01','qa-company')")
        db.execute("INSERT INTO v2_cqrs_qa.project_cursor(device) VALUES('qa-tv-01')")
    start=time.perf_counter()
    for seq in range(1,1001):
        month="2026-10-01" if seq<=650 else "2026-11-01"
        store("qa-tv-01","qa-company",seq,month)
    write_seconds=time.perf_counter()-start
    assert get("SELECT COUNT(*) FROM v2_cqrs_qa.received_event")==1000
    try:
        store("qa-tv-01","qa-company",1000,"2026-11-01")
    except ValueError:pass
    else:raise AssertionError("duplicate_write")
    assert get("SELECT COUNT(*) FROM v2_cqrs_qa.received_event")==1000
    assert get("SELECT next_seq FROM v2_cqrs_qa.streams WHERE device='qa-tv-01'")==1001
    print("CQRS_WRITE_IDEMPOTENCY=PASS events=1000 single_stream_watermark=1001",flush=True)

    assert project("qa-tv-01",250)==250
    assert project("qa-tv-01",250)==250
    assert project("qa-tv-01",250)==250
    assert project("qa-tv-01",250)==250
    assert project("qa-tv-01",250)==0
    assert get("SELECT sum(pending_time) FROM v2_cqrs_qa.read_month")==1000
    assert get("SELECT pending_time FROM v2_cqrs_qa.read_month WHERE received_month='2026-10-01'")==650
    assert get("SELECT pending_time FROM v2_cqrs_qa.read_month WHERE received_month='2026-11-01'")==350
    assert get("SELECT through_seq FROM v2_cqrs_qa.project_cursor WHERE device='qa-tv-01'")==1000
    print("CQRS_PROJECTION_IDEMPOTENCY=PASS events=1000 read_rows=2 oct=650 nov=350",flush=True)

    # Query planner: monthly predicate only touches November partition.
    with conn() as db:
        plan=[r[0] for r in db.execute("""EXPLAIN (COSTS OFF)
            SELECT count(*) FROM v2_cqrs_qa.received_event
            WHERE received_month='2026-11-01' AND company='qa-company'""")]
        text="\n".join(plan)
        if "received_2026_11" not in text or "received_2026_10" in text:
            raise AssertionError("no_partition_pruning:"+text)
        raw_bytes=db.execute("SELECT pg_total_relation_size('v2_cqrs_qa.received_event')").fetchone()[0]
        # A partitioned parent may have 0 storage; sum real child data+index.
        parts=db.execute("""SELECT
         pg_total_relation_size('v2_cqrs_qa.received_2026_10')+
         pg_total_relation_size('v2_cqrs_qa.received_2026_11')""").fetchone()[0]
        read_bytes=db.execute("SELECT pg_total_relation_size('v2_cqrs_qa.read_month')").fetchone()[0]
    assert parts>0 and read_bytes>0
    print(f"CQRS_PARTITION_PRUNING=PASS used=received_2026_11 ignored=received_2026_10",flush=True)
    print(f"CQRS_STORAGE_METRIC raw_partition_bytes={parts} read_projection_bytes={read_bytes} "+
          f"raw_events=1000 projection_rows=2 write_seconds={write_seconds:.2f}",flush=True)
    # Failure injection: partial projection always rolls back and maintains cursor.
    with conn() as db:
        db.execute("""CREATE OR REPLACE FUNCTION v2_cqrs_qa.fail_projection()
          RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''qa_injected_projection_failure''; END'""")
        db.execute("""CREATE TRIGGER fail_projection_qa BEFORE UPDATE ON v2_cqrs_qa.read_month
          FOR EACH ROW EXECUTE FUNCTION v2_cqrs_qa.fail_projection()""")
    for seq in range(1001,1006):
        store("qa-tv-01","qa-company",seq,"2026-11-01")
    try:
        project("qa-tv-01")
    except psycopg.Error:pass
    else:raise AssertionError("projection_failure_should_rollback")
    assert get("SELECT through_seq FROM v2_cqrs_qa.project_cursor WHERE device='qa-tv-01'")==1000
    assert get("SELECT sum(pending_time) FROM v2_cqrs_qa.read_month")==1000
    with conn() as db:
        db.execute("DROP TRIGGER fail_projection_qa ON v2_cqrs_qa.read_month")
    assert project("qa-tv-01")==5
    assert project("qa-tv-01")==0
    assert get("SELECT sum(pending_time) FROM v2_cqrs_qa.read_month")==1005
    print("CQRS_PROJECTION_ROLLBACK_RECOVERY=PASS restart_idempotent=true",flush=True)
    assert get("SELECT COUNT(*) FROM v2_cqrs_qa.received_event WHERE billable OR event_played_at IS NOT NULL")==0
    print("CQRS_NO_FAKE_TIME=PASS all_pending_nonbillable=true",flush=True)
    print("CQRS_PG17_ISOLATED=PASS",flush=True)

if __name__=="__main__":execute()
