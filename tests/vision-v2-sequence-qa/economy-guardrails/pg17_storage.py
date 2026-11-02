"""Disposable PG17 budget sampling: 300,000 receipt rows + 100/300 HTTP-like batch writers.

Synthetic dataset, intentionally simple audit schema: no claims of production
compression or official billing. PG 17 MUST run only on loopback disposable
database. No Supabase URL, deploy, destructive operation on real database.
"""
from __future__ import annotations
import hashlib,json,math,os,queue,resource,statistics,time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import psycopg
DB="vision_v2_quarantine_disposable"
KW=dict(host="127.0.0.1",port=5432,dbname=DB,user="postgres",
        password="qa-only-local-password",connect_timeout=6)
N=300_000;TVS=300;MONTH=51_840_000
assert os.environ.get("QA_STREAM_GUARD_GROUP","1")=="1"
assert os.environ.get("GITHUB_REF","")=="refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031"
assert all(not os.getenv(k) for k in ("SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","DATABASE_URL","PGHOST","PGSERVICE"))
def db():return psycopg.connect(**KW,autocommit=True)
def scalar(c,s,p=()):return c.execute(s,p).fetchone()[0]
def pct(xs,p):
    s=sorted(xs);v=(len(s)-1)*p;a=math.floor(v);b=math.ceil(v)
    return round(s[a]*(b-v)+s[b]*(v-a),3) if len(s)>1 else round(s[0],3)
def size(c):
    return c.execute("""SELECT pg_total_relation_size('qa_economy.proofs'),
       pg_indexes_size('qa_economy.proofs'),
       pg_relation_size('qa_economy.proofs'),
       pg_database_size(current_database())""").fetchone()
def setup(c):
    assert scalar(c,"SELECT current_database()")==DB
    assert int(scalar(c,"SHOW server_version_num"))//10000==17
    c.execute("CREATE SCHEMA qa_economy")
    c.execute("""CREATE TABLE qa_economy.proofs(
      device TEXT NOT NULL,
      sequence BIGINT NOT NULL,
      client_event_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      played_at TIMESTAMPTZ NOT NULL,
      digest TEXT NOT NULL,
      PRIMARY KEY(device,sequence))""")
    c.execute("CREATE UNIQUE INDEX qa_economy_by_event ON qa_economy.proofs(device,client_event_id)")
    c.execute("CREATE INDEX qa_economy_by_time ON qa_economy.proofs(played_at,media_id)")
def seed(c):
    started=time.perf_counter()
    c.execute("""INSERT INTO qa_economy.proofs(device,sequence,client_event_id,media_id,played_at,digest)
      SELECT
        'tv-' || lpad(((g-1)%300)::text,3,'0'),
        ((g-1)/300+1)::bigint,
        md5('event-'||g::text),
        'media-' || ((g-1)%21)::text,
        '2026-11-01T00:00:00+00'::timestamptz + ((g-1)/300)*interval '15 second',
        md5('synthetic-proof-' || g::text)
      FROM generate_series(1,%s) AS g""",(N,))
    assert scalar(c,"SELECT count(*) FROM qa_economy.proofs")==N
    return round(time.perf_counter()-started,3)
def sample1000(c):
    before=scalar(c,"SELECT count(*) FROM qa_economy.proofs")
    c.execute("""INSERT INTO qa_economy.proofs
     SELECT * FROM qa_economy.proofs ORDER BY device,sequence LIMIT 1000
     ON CONFLICT DO NOTHING""")
    after=scalar(c,"SELECT count(*) FROM qa_economy.proofs")
    assert before==after
def load_waves():
    pool=queue.Queue()
    for i in range(12):pool.put(db())
    def submit(i):
        con=pool.get(timeout=25)
        started=time.perf_counter()
        try:
            # 50 receipts in ONE SQL statement. A real gateway may require
            # more SQL; this isolates physical DB growth and dedup under load.
            con.execute("""INSERT INTO qa_economy.proofs
              SELECT %s::text, s::bigint,
                md5(%s::text || '-' || s::text),
                'media-qa',
                '2026-11-02T00:00:00Z'::timestamptz + s*interval '15 sec',
                md5('qa-batch-' || %s::text || '-' || s::text)
              FROM generate_series(1001,1050) AS s
              ON CONFLICT DO NOTHING""",(f"tv-{i:03d}",f"tv-{i:03d}",f"tv-{i:03d}"))
            return round((time.perf_counter()-started)*1000,3)
        finally:pool.put(con)
    stages=[]
    try:
        for n in (100,300,300):
            begin=time.perf_counter()
            with ThreadPoolExecutor(max_workers=12) as executors:
                times=list(executors.map(submit,range(n)))
            with db() as c:total=scalar(c,"SELECT count(*) FROM qa_economy.proofs")
            expected=N+(100 if n==100 else 300)*50
            assert total==expected,(n,total,expected)
            stages.append({"clients":n,"completed":len(times),"inserted":total-N,
                           "SQL_statements":n,"max_concurrent":12,
                           "p95_sql_ms":pct(times,.95),"p99_sql_ms":pct(times,.99),
                           "wall_sec":round(time.perf_counter()-begin,3),
                           "duplicate_retry":len(stages)==2})
    finally:
        for i in range(12):pool.get_nowait().close()
    return stages
def main():
    start=time.perf_counter()
    with db() as c:
        setup(c)
        before=size(c)
        wal0=scalar(c,"SELECT pg_current_wal_insert_lsn()")
        t=seed(c);mid=size(c)
        sample1000(c)
        assert size(c)[0]==mid[0],"duplicate altered relation footprint"
    waves=load_waves()
    with db() as c:
        final=size(c)
        rows=scalar(c,"SELECT count(*) FROM qa_economy.proofs")
        assert rows==315000,rows
        distinct=scalar(c,"SELECT count(*) FROM (SELECT device,sequence FROM qa_economy.proofs GROUP BY 1,2) x")
        assert rows==distinct
        wal=int(scalar(c,"SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),%s)",(wal0,)))
    assert mid[0]>before[0]
    bytes_per_sample=(mid[0]-before[0])/N
    assert bytes_per_sample>50,"unexpected physical row lower bound"
    extrapolated=round(bytes_per_sample*MONTH)
    result={"result":"PASS","server":"PostgreSQL17","synthetic_only":True,
      "proof_sample_rows":N,"sample_total_relation_bytes":mid[0],
      "sample_heap_bytes":mid[2],"sample_indexes_bytes":mid[1],
      "sample_delta_relation_bytes":mid[0]-before[0],
      "estimated_bytes_per_proof":round(bytes_per_sample,3),
      "model_300_TV_30days_15s_proofs":MONTH,
      "linear_extrapolated_300TV_month_relation_bytes":extrapolated,
      "free_db_500MB_if_all_proofs_permanent":extrapolated>500_000_000,
      "db_total_sample_bytes":mid[3],"db_total_after_waves_bytes":final[3],
      "WAL_insert_bytes_including_waves":wal,
      "sample_seed_seconds":t,"HTTP_like_50proof_batch_waves":waves,
      "no_duplicate_proofs":True,"no_official_supabase":True,
      "rss_python_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
      "not_measured":["official Supabase RLS","API invocation charge","network egress",
        "real commercial table/index","WAL over full month","kernel and PG worker RSS",
        "long-term vacuum","billing costs in R$"],
      "production_go":False,"elapsed_seconds":round(time.perf_counter()-start,3)}
    print("QA_ECONOMY_PG17_JSON="+json.dumps(result,sort_keys=True),flush=True)
if __name__=="__main__":main()
