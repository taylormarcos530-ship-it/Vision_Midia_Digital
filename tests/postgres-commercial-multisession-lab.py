#!/usr/bin/env python3
"""OFFLINE TEST ONLY: real PostgreSQL independent sessions inside disposable CI service.
No Supabase, device credentials, real customer records, remote staging or deployment.
Production token authentication, media integrity and pixel proof are NOT implemented.
"""
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import random
import threading
import time
import uuid

import psycopg2

if os.environ.get("VISION_ISOLATED_PG") != "1":
    raise SystemExit("Refusing: VISION_ISOLATED_PG=1 required")
if os.environ.get("PGHOST") != "127.0.0.1":
    raise SystemExit("Refusing: loopback-only PostgreSQL host required")
if os.environ.get("PGDATABASE") != "vision_atomic_lab" or os.environ.get("PGUSER") != "vision_atomic_lab":
    raise SystemExit("Refusing: dedicated disposable laboratory database and role required")

DB = dict(host="127.0.0.1", port=int(os.getenv("PGPORT", "5432")),
          dbname="vision_atomic_lab", user="vision_atomic_lab",
          password=os.environ["PGPASSWORD"], connect_timeout=8, sslmode="disable")
assert DB["port"] == 5432, "Only disposable GitHub Actions PostgreSQL port is allowed"


def uid(n):
    return str(uuid.UUID(int=n))


TV1, TV2, COMPANY = uid(1), uid(2), uid(10)
CAMPAIGN, REVISION, MEDIA = uid(20), uid(21), uid(22)
BASE = [(i, "Mídia do ponto " + str(i)) for i in range(1, 7)]


def connect():
    c = psycopg2.connect(**DB)
    with c.cursor() as cur:
        cur.execute("SET statement_timeout = '12s'")
        cur.execute("SET lock_timeout = '10s'")
    c.commit()
    return c


def initialize():
    with connect() as c:
        with c.cursor() as q:
            q.execute("""
            CREATE SCHEMA IF NOT EXISTS commercial_lab;
            CREATE TABLE commercial_lab.device_programs(
              device_id uuid PRIMARY KEY, company_id uuid NOT NULL,
              program_epoch integer NOT NULL DEFAULT 1,
              commercial_enabled boolean NOT NULL DEFAULT false
            );
            CREATE TABLE commercial_lab.occurrences(
              device_id uuid NOT NULL, occurrence_id uuid NOT NULL,
              company_id uuid NOT NULL, campaign_id uuid NOT NULL,
              revision_id uuid NOT NULL, media_id uuid NOT NULL,
              program_epoch integer NOT NULL,
              issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
              status text NOT NULL CHECK(status IN ('issued','cancelled','finalized')),
              PRIMARY KEY(device_id, occurrence_id),
              UNIQUE(device_id, occurrence_id, revision_id),
              FOREIGN KEY(device_id) REFERENCES commercial_lab.device_programs(device_id),
              CHECK(expires_at > issued_at)
            );
            CREATE TABLE commercial_lab.receipts(
              device_id uuid NOT NULL, occurrence_id uuid NOT NULL,
              client_event_id text NOT NULL CHECK(char_length(client_event_id) BETWEEN 1 AND 120),
              revision_id uuid NOT NULL, completed boolean NOT NULL,
              ended_at timestamptz, received_at timestamptz NOT NULL,
              canonical_hash text NOT NULL,
              PRIMARY KEY(device_id,client_event_id),
              UNIQUE(device_id,occurrence_id),
              FOREIGN KEY(device_id,occurrence_id,revision_id)
                REFERENCES commercial_lab.occurrences(device_id,occurrence_id,revision_id),
              CHECK(NOT completed OR ended_at IS NOT NULL)
            );
            CREATE TABLE commercial_lab.point_media(
              item_no integer PRIMARY KEY, label text NOT NULL
            );
            """)
            q.executemany("INSERT INTO commercial_lab.point_media VALUES (%s,%s)", BASE)


def occurrence(n):
    return uid(1000 + n)


def reset():
    issued_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=45)
    ends = issued_at + dt.timedelta(minutes=5)
    with connect() as c:
        with c.cursor() as q:
            q.execute("TRUNCATE commercial_lab.receipts, commercial_lab.occurrences, commercial_lab.device_programs")
            q.executemany(
                "INSERT INTO commercial_lab.device_programs(device_id,company_id,program_epoch,commercial_enabled) VALUES (%s,%s,1,true)",
                [(TV1, COMPANY), (TV2, COMPANY)])
            items = []
            for tv in (TV1, TV2):
                for i in range(1, 111):
                    items.append((tv, occurrence(i), COMPANY, CAMPAIGN, REVISION, MEDIA, issued_at, ends))
            q.executemany("""
                INSERT INTO commercial_lab.occurrences
                  (device_id,occurrence_id,company_id,campaign_id,revision_id,media_id,
                   program_epoch,issued_at,expires_at,status)
                VALUES (%s,%s,%s,%s,%s,%s,1,%s,%s,'issued')
            """, items)
    return issued_at


def receipt(i=1, event="event-1", device=TV1, completed=True, end_time=None):
    if end_time is None and completed:
        end_time = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=2)
    return dict(device=device, company=COMPANY, occurrence=occurrence(i),
                event=event, revision=REVISION, completed=completed,
                ended_at=end_time)


def hash_receipt(p):
    blob = json.dumps(dict(occurrence=p["occurrence"], revision=p["revision"],
                           event=p["event"], completed=p["completed"],
                           ended_at=p["ended_at"].isoformat() if p["ended_at"] else None),
                      sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


def receive(p, after_lock=None):
    """One simulated verified-server receipt; independent PostgreSQL session per call."""
    if p["company"] != COMPANY:
        return "unauthorized"
    c = connect()
    try:
        with c:
            with c.cursor() as q:
                q.execute("""
                  SELECT company_id, program_epoch, commercial_enabled
                  FROM commercial_lab.device_programs WHERE device_id=%s FOR UPDATE
                """, (p["device"],))
                epoch = q.fetchone()
                if epoch is None or str(epoch[0]) != p["company"]:
                    return "unauthorized"
                if after_lock:
                    after_lock()
                fp = hash_receipt(p)
                q.execute("""
                  SELECT occurrence_id,revision_id,completed,ended_at,canonical_hash
                  FROM commercial_lab.receipts WHERE device_id=%s AND client_event_id=%s
                """, (p["device"], p["event"]))
                existing = q.fetchone()
                if existing:
                    identical = (str(existing[0]) == p["occurrence"] and
                                 str(existing[1]) == p["revision"] and
                                 existing[2] == p["completed"] and
                                 existing[3] == p["ended_at"] and
                                 existing[4] == fp)
                    return "duplicate" if identical else "event_collision"
                q.execute("""
                  SELECT 1 FROM commercial_lab.receipts WHERE device_id=%s AND occurrence_id=%s
                """, (p["device"], p["occurrence"]))
                if q.fetchone():
                    return "occurrence_collision"
                # clock_timestamp is captured AFTER the per-device lock.
                q.execute("SELECT clock_timestamp()")
                now = q.fetchone()[0]
                q.execute("""
                  SELECT company_id,revision_id,issued_at,expires_at,status,program_epoch
                  FROM commercial_lab.occurrences
                  WHERE device_id=%s AND occurrence_id=%s
                """, (p["device"], p["occurrence"]))
                o = q.fetchone()
                if (not o or str(o[0]) != p["company"] or
                        str(o[1]) != p["revision"] or o[4] != "issued" or
                        o[5] != epoch[1] or not epoch[2]):
                    return "superseded_or_wrong_revision"
                if now < o[2] or now > o[3]:
                    return "expired_or_not_yet_issued"
                if p["completed"] and p["ended_at"] is None:
                    return "missing_completion_time"
                if p["ended_at"] is not None and not (o[2] <= p["ended_at"] <= now):
                    return "invalid_end_time"
                q.execute("""
                  INSERT INTO commercial_lab.receipts
                    (device_id,occurrence_id,client_event_id,revision_id,completed,
                     ended_at,received_at,canonical_hash)
                  VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                  ON CONFLICT DO NOTHING RETURNING client_event_id
                """, (p["device"], p["occurrence"], p["event"], p["revision"],
                      p["completed"], p["ended_at"], now, fp))
                if not q.fetchone():
                    return "conflicting_unique_key"
                q.execute("""
                  UPDATE commercial_lab.occurrences SET status='finalized'
                  WHERE device_id=%s AND occurrence_id=%s
                """, (p["device"], p["occurrence"]))
                return "accepted"
    finally:
        c.close()


def revoke(device=TV1, after_lock=None):
    c = connect()
    try:
        with c:
            with c.cursor() as q:
                q.execute("SELECT device_id FROM commercial_lab.device_programs WHERE device_id=%s FOR UPDATE", (device,))
                if after_lock:
                    after_lock()
                q.execute("""
                  UPDATE commercial_lab.device_programs
                  SET program_epoch=program_epoch+1,commercial_enabled=false
                  WHERE device_id=%s
                """, (device,))
                q.execute("""
                  UPDATE commercial_lab.occurrences SET status='cancelled'
                  WHERE device_id=%s AND status='issued'
                """, (device,))
        return "revoked"
    finally:
        c.close()


def accepted(device=TV1):
    with connect() as c:
        with c.cursor() as q:
            q.execute("SELECT count(*) FROM commercial_lab.receipts WHERE device_id=%s", (device,))
            return q.fetchone()[0]


def base_snapshot():
    with connect() as c:
        with c.cursor() as q:
            q.execute("SELECT item_no,label FROM commercial_lab.point_media ORDER BY item_no")
            return q.fetchall()


def parallel(n, make_payload):
    barrier = threading.Barrier(n, timeout=40)
    def worker(i):
        p = make_payload(i)
        barrier.wait(timeout=40)
        return receive(p)
    with concurrent.futures.ThreadPoolExecutor(max_workers=n) as pool:
        futures = [pool.submit(worker, i) for i in range(n)]
        return [f.result(timeout=55) for f in futures]


def check(name, test_fn):
    reset()
    old_base = base_snapshot()
    test_fn()
    assert base_snapshot() == old_base, name + ": customer's base media changed"
    print("PASS " + name, flush=True)


def test_same_event():
    results = parallel(32, lambda i: receipt(event="same-event", end_time=SHARED_END))
    assert results.count("accepted") == 1, results
    assert results.count("duplicate") == 31, results
    assert accepted() == 1


def test_different_events():
    results = parallel(32, lambda i: receipt(event="different-" + str(i), end_time=SHARED_END))
    assert results.count("accepted") == 1, results
    assert results.count("occurrence_collision") == 31, results
    assert accepted() == 1


def test_two_devices():
    results = parallel(16, lambda i: receipt(
        device=TV1 if i < 8 else TV2, event="both-tvs", end_time=SHARED_END))
    assert results.count("accepted") == 2, results
    assert accepted(TV1) == 1 and accepted(TV2) == 1


def test_many_occurrences():
    rng = random.Random(20261014)
    payloads = [receipt(i=i, event="event-" + str(i), end_time=SHARED_END)
                for i in range(1, 33)]
    rng.shuffle(payloads)
    results = parallel(32, lambda i: payloads[i])
    assert results.count("accepted") == 32, results
    assert accepted() == 32
    for p in payloads:
        assert receive(p) == "duplicate"
    assert accepted() == 32


def test_revocation_first():
    assert revoke() == "revoked"
    assert receive(receipt(end_time=SHARED_END)) == "superseded_or_wrong_revision"
    assert accepted() == 0


def test_receipt_first():
    payload = receipt(event="received-first", end_time=SHARED_END)
    assert receive(payload) == "accepted"
    assert revoke() == "revoked"
    assert receive(payload) == "duplicate"
    assert accepted() == 1


def test_actual_lock_contention():
    holding = threading.Event()
    release = threading.Event()
    payload = receipt(event="blocked-behind-revocation", end_time=SHARED_END)
    def hold_then_revoke():
        def pause():
            holding.set()
            assert release.wait(timeout=15), "revocation lock not released"
        return revoke(after_lock=pause)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(hold_then_revoke)
        assert holding.wait(timeout=15)
        second = pool.submit(receive, payload)
        time.sleep(0.15)  # Only for lock contentions, not order inference.
        assert not second.done(), "receipt unexpectedly bypassed locked device epoch"
        release.set()
        assert first.result(timeout=15) == "revoked"
        assert second.result(timeout=15) == "superseded_or_wrong_revision"
    assert accepted() == 0


def test_transaction_rollback():
    c = connect()
    try:
        with c.cursor() as q:
            q.execute("BEGIN")
            q.execute("""
             INSERT INTO commercial_lab.receipts
               (device_id,occurrence_id,client_event_id,revision_id,completed,ended_at,received_at,canonical_hash)
             VALUES (%s,%s,%s,%s,true,%s,clock_timestamp(),'demo')
            """, (TV1, occurrence(1), "rollback-1", REVISION, SHARED_END))
            try:
                q.execute("""
                 INSERT INTO commercial_lab.receipts
                   (device_id,occurrence_id,client_event_id,revision_id,completed,ended_at,received_at,canonical_hash)
                 VALUES (%s,%s,%s,%s,true,%s,clock_timestamp(),'second')
                """, (TV1, occurrence(1), "rollback-2", REVISION, SHARED_END))
                raise AssertionError("duplicate occurrence was accepted")
            except psycopg2.errors.UniqueViolation:
                pass
            c.rollback()
    finally:
        c.close()
    assert accepted() == 0


def test_after_commit_ack_lost():
    p = receipt(event="lost-ack", end_time=SHARED_END)
    assert receive(p) == "accepted"
    # Old connection has already been closed with COMMIT; a new session retries.
    assert receive(p) == "duplicate"
    assert accepted() == 1


def test_offline_expired():
    with connect() as c:
        with c.cursor() as q:
            q.execute("""
              UPDATE commercial_lab.occurrences SET
                issued_at=clock_timestamp()-interval '12 hours',
                expires_at=clock_timestamp()-interval '11 hours'
              WHERE device_id=%s AND occurrence_id=%s
            """, (TV1, occurrence(1)))
    assert receive(receipt(event="twelve-hours-late", end_time=SHARED_END)) == "expired_or_not_yet_issued"
    assert accepted() == 0


def test_completed_vs_attempt():
    p = receipt(i=1, event="good", end_time=SHARED_END)
    assert receive(p) == "accepted"
    incomplete = receipt(i=2, event="interrupted", completed=False)
    assert receive(incomplete) == "accepted"
    with connect() as c:
        with c.cursor() as q:
            q.execute("""
              SELECT count(*),count(*) FILTER(WHERE completed)
              FROM commercial_lab.receipts WHERE device_id=%s
            """, (TV1,))
            assert q.fetchone() == (2, 1)
    assert accepted() == 2


def test_unauthorized():
    p = receipt(end_time=SHARED_END)
    p["company"] = uid(555)
    assert receive(p) == "unauthorized"
    assert accepted() == 0


if __name__ == "__main__":
    initialize()
    SHARED_END = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=2)
    cases = [
        ("32 sessions, same receipt -> one accepted", test_same_event),
        ("32 sessions, different event IDs -> one occurrence", test_different_events),
        ("identical event ID allowed on distinct TVs", test_two_devices),
        ("32 independent occurrences + replay deduplication", test_many_occurrences),
        ("revocation before receipt", test_revocation_first),
        ("receipt accepted before revocation", test_receipt_first),
        ("real row lock blocks receipt until revocation commits", test_actual_lock_contention),
        ("failed SQL statement rolls back whole transaction", test_transaction_rollback),
        ("lost ACK replays across independent sessions", test_after_commit_ack_lost),
        ("12-hour offline first report expires safely", test_offline_expired),
        ("incomplete attempts do not count completed", test_completed_vs_attempt),
        ("synthetic verified identity mismatch rejected", test_unauthorized),
    ]
    for title, fn in cases:
        check(title, fn)
    print("RESULT: %s/%s PASS; 0 FAIL; independent PostgreSQL sessions; no external database" %
          (len(cases), len(cases)), flush=True)
