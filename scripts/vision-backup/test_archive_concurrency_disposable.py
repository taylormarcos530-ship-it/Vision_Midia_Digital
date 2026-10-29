#!/usr/bin/env python3
"""Two-connection PostgreSQL archive race test. ISOLATED TEST DB ONLY.
Requires psycopg 3: pip install 'psycopg[binary]'
Set TEST_DATABASE_URL to a disposable PostgreSQL database. No production URL.
All tables are TEMPORARY? No: each connection needs shared tables, so this
script uses a unique schema and removes it in finally. Never run on production.
"""
import os
import threading
import uuid
import psycopg

dsn = os.environ.get("TEST_DATABASE_URL")
if not dsn or os.environ.get("CONFIRM_DISPOSABLE_DATABASE") != "YES":
    raise SystemExit("Requires TEST_DATABASE_URL and CONFIRM_DISPOSABLE_DATABASE=YES")
schema = "vision_archive_race_" + uuid.uuid4().hex[:12]
errors = []
barrier = threading.Barrier(2)
def worker():
    try:
        with psycopg.connect(dsn, autocommit=False) as conn:
            barrier.wait(timeout=15)
            with conn.cursor() as cur:
                cur.execute(f"""
                    WITH inserted AS (
                      INSERT INTO {schema}.ledger(event_id)
                      VALUES ('a'),('b'),('c')
                      ON CONFLICT(event_id) DO NOTHING
                      RETURNING event_id
                    ), counted AS (SELECT count(*)::bigint n FROM inserted)
                    INSERT INTO {schema}.totals(bucket,n)
                    SELECT 'all',n FROM counted WHERE n>0
                    ON CONFLICT(bucket) DO UPDATE
                    SET n={schema}.totals.n+EXCLUDED.n
                """)
            conn.commit()
    except Exception as e:
        errors.append(str(e))

with psycopg.connect(dsn, autocommit=True) as admin:
    try:
        admin.execute(f"CREATE SCHEMA {schema}")
        admin.execute(f"CREATE TABLE {schema}.ledger(event_id text primary key)")
        admin.execute(f"CREATE TABLE {schema}.totals(bucket text primary key,n bigint not null)")
        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads: t.start()
        for t in threads: t.join(timeout=30)
        if any(t.is_alive() for t in threads):
            raise RuntimeError("Worker timed out")
        if errors:
            raise RuntimeError("; ".join(errors))
        ledger = admin.execute(f"SELECT count(*) FROM {schema}.ledger").fetchone()[0]
        total = admin.execute(f"SELECT coalesce(sum(n),0) FROM {schema}.totals").fetchone()[0]
        assert ledger == total == 3, (ledger,total)
        print("PASS: 2 concurrent transactions, 3 unique events, total=3")
    finally:
        admin.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
