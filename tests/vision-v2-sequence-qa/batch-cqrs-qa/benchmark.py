"""Vision V2 isolated PostgreSQL 17 batch vs one-event write / CQRS benchmark.

Each mode gets SEPARATE tables inside its own ephemeral PostgreSQL 17 service.
No interaction with Supabase. No table is dropped or source row deleted.
Measurements are LOCAL SQL transaction latency, NOT HTTP/Edge/Android latency.
"""
import argparse
from collections import defaultdict
import json
import math
import statistics
import time
import psycopg

DSN = "postgresql://postgres:qa-only-local-password@127.0.0.1:5432/vision_v2_quarantine_disposable"
MODES = {"one":1, "batch50":50, "batch100":100, "batch500":500}
EVENTS_PER_TV = 500

def db():return psycopg.connect(DSN,connect_timeout=5)
def allowed(mode):
    if mode not in MODES:raise ValueError("mode")
    return mode
def quantile95(samples):
    items=sorted(samples)
    return round(items[max(0,math.ceil(.95*len(items))-1)]*1000,3)
def scalar(connection,sql,params=()):
    return connection.execute(sql,params).fetchone()[0]

def setup(connection,mode,tvs):
    m=allowed(mode)
    schema=f"v2_batch_{m}"
    connection.execute(f"CREATE SCHEMA {schema}")
    connection.execute(f"""CREATE TABLE {schema}.streams (
        device text PRIMARY KEY,company text NOT NULL, next_seq bigint NOT NULL DEFAULT 1
    )""")
    connection.execute(f"""CREATE TABLE {schema}.events(
        received_month date NOT NULL, device text NOT NULL, company text NOT NULL,
        seq bigint NOT NULL, event_hash text NOT NULL,
        played_at timestamptz NULL,
        billable boolean NOT NULL DEFAULT false CHECK (billable=false),
        PRIMARY KEY (received_month,device,seq)
    ) PARTITION BY RANGE(received_month)""")
    for month,nextmonth,suffix in [("2026-10-01","2026-11-01","oct"),
                                    ("2026-11-01","2026-12-01","nov")]:
        connection.execute(f"""CREATE TABLE {schema}.events_{suffix}
         PARTITION OF {schema}.events FOR VALUES FROM ('{month}') TO ('{nextmonth}')""")
        connection.execute(f"""CREATE INDEX events_company_{suffix} ON
         {schema}.events_{suffix} (company,received_month)""")
    connection.execute(f"""CREATE TABLE {schema}.cursor(
      device text PRIMARY KEY,through_seq bigint NOT NULL DEFAULT 0)""")
    connection.execute(f"""CREATE TABLE {schema}.read_month(
      device text NOT NULL,company text NOT NULL,received_month date NOT NULL,
      pending_time bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (device,received_month))""")
    connection.execute(f"CREATE INDEX read_company_{m} ON {schema}.read_month(company,received_month)")
    records=[(f"tv-{i:03d}",f"tenant-{i%max(2,tvs//10):02d}",1) for i in range(tvs)]
    with connection.cursor() as c:
        c.executemany(f"INSERT INTO {schema}.streams VALUES(%s,%s,%s)",records)
        c.executemany(f"INSERT INTO {schema}.cursor(device) VALUES(%s)",[(x[0],) for x in records])
    connection.commit()
    return schema,records

def event(seq):
    return ("2026-10-01" if seq<=350 else "2026-11-01",
            f"qa_sha256_{seq:08d}")

def write_batch(connection,schema,device,company,first,last):
    expected=scalar(connection,f"""SELECT next_seq FROM {schema}.streams
          WHERE device=%s AND company=%s FOR UPDATE""",(device,company))
    if first!=expected:
        raise ValueError("duplicate_or_gap_or_tenant")
    seqs=list(range(first,last+1))
    months=[event(i)[0] for i in seqs]
    hashes=[event(i)[1] for i in seqs]
    if len(seqs)==1:
        connection.execute(f"""INSERT INTO {schema}.events
             (received_month,device,company,seq,event_hash)
             VALUES(%s,%s,%s,%s,%s)""",
             (months[0],device,company,seqs[0],hashes[0]))
    else:
        connection.execute(f"""INSERT INTO {schema}.events
             (received_month,device,company,seq,event_hash)
             SELECT month::date,%s,%s,seq,hash
             FROM unnest(%s::text[],%s::bigint[],%s::text[])
                  AS src(month,seq,hash)""",
             (device,company,months,seqs,hashes))
    connection.execute(f"UPDATE {schema}.streams SET next_seq=%s WHERE device=%s",
                       (last+1,device))
    return last

def project(connection,schema,device,company):
    through=scalar(connection,f"""SELECT through_seq FROM {schema}.cursor
                  WHERE device=%s FOR UPDATE""",(device,))
    rows=connection.execute(f"""SELECT received_month,count(*),min(seq),max(seq)
        FROM {schema}.events WHERE device=%s AND seq>%s
        GROUP BY received_month ORDER BY received_month""",
        (device,through)).fetchall()
    if not rows:return 0
    totals=sum(x[1] for x in rows)
    max_seq=max(x[3] for x in rows)
    if max_seq-through!=totals:raise AssertionError("projection_gap")
    for month,count,_,_ in rows:
        connection.execute(f"""INSERT INTO {schema}.read_month
           (device,company,received_month,pending_time)
           VALUES(%s,%s,%s,%s)
           ON CONFLICT (device,received_month) DO UPDATE
           SET pending_time={schema}.read_month.pending_time+EXCLUDED.pending_time""",
            (device,company,month,count))
    connection.execute(f"UPDATE {schema}.cursor SET through_seq=%s WHERE device=%s",
                       (max_seq,device))
    return totals

def size(connection,schema):
    relation=lambda name:scalar(connection,"SELECT pg_total_relation_size(%s::regclass)",
                                (f"{schema}.{name}",))
    oct_bytes=relation("events_oct")
    nov_bytes=relation("events_nov")
    raw_bytes=oct_bytes+nov_bytes
    index_bytes=scalar(connection,"SELECT pg_indexes_size(%s::regclass)",(f"{schema}.events_oct",))+\
                scalar(connection,"SELECT pg_indexes_size(%s::regclass)",(f"{schema}.events_nov",))
    return {"raw_table_index_bytes":raw_bytes,"raw_index_bytes":index_bytes,
            "read_model_bytes":relation("read_month"),"streams_bytes":relation("streams"),
            "cursor_bytes":relation("cursor")}

def query_explain(connection,sql,args):
    explain=connection.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+sql,args).fetchone()[0][0]
    plan=explain["Plan"]
    def blocks(node):
        return node.get("Shared Hit Blocks",0)+sum(blocks(c) for c in node.get("Plans",[]))
    return round(explain["Execution Time"],4),blocks(plan)

def benchmark_one(tvs,mode):
    with db() as c:
        if scalar(c,"SELECT current_database()")!="vision_v2_quarantine_disposable":
            raise RuntimeError("NO_PRODUCTION")
        schema,records=setup(c,mode,tvs)
        startlsn=scalar(c,"SELECT pg_current_wal_insert_lsn()")
        durations=[]
        start=time.perf_counter()
        # Each logical batch is a real committed PostgreSQL transaction.
        for device,company,_ in records:
            for startseq in range(1,EVENTS_PER_TV+1,MODES[mode]):
                last=min(EVENTS_PER_TV,startseq+MODES[mode]-1)
                began=time.perf_counter()
                with c.transaction():
                    ack=write_batch(c,schema,device,company,startseq,last)
                assert ack==last
                durations.append(time.perf_counter()-began)
        elapsed=time.perf_counter()-start
        after_lsn=scalar(c,"SELECT pg_current_wal_insert_lsn()")
        wal=round(scalar(c,"SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",
                         (after_lsn,startlsn)))
        total=tvs*EVENTS_PER_TV
        count=scalar(c,f"SELECT count(*) FROM {schema}.events")
        assert count==total
        assert scalar(c,f"SELECT count(*) FROM {schema}.streams WHERE next_seq=501")==tvs
        assert scalar(c,f"SELECT count(*) FROM {schema}.events WHERE played_at IS NOT NULL OR billable")==0
        assert scalar(c,f"SELECT count(*) FROM {schema}.events_oct")==350*tvs
        assert scalar(c,f"SELECT count(*) FROM {schema}.events_nov")==150*tvs
        # A replay cannot advance ACK; other tenant cannot submit same device.
        d,co,_=records[0]
        for spoof in [(d,co,500,500),(d,"wrong-tenant",501,501),(d,co,502,502)]:
            try:
                with c.transaction():
                    write_batch(c,schema,*spoof)
            except (ValueError,TypeError):
                pass
            else:raise AssertionError("sequence_or_tenant_not_rejected")
        assert scalar(c,f"SELECT next_seq FROM {schema}.streams WHERE device=%s",(d,))==501
        assert scalar(c,f"SELECT count(*) FROM {schema}.events")==total

        # Projection is a distinct internal worker, never an extra TV call.
        projection_started=time.perf_counter()
        with c.transaction():
            for dev,tenant,_ in records:
                assert project(c,schema,dev,tenant)==EVENTS_PER_TV
            assert project(c,schema,records[0][0],records[0][1])==0
        projection_seconds=time.perf_counter()-projection_started
        assert scalar(c,f"SELECT sum(pending_time) FROM {schema}.read_month")==total
        assert scalar(c,f"SELECT count(*) FROM {schema}.read_month")==2*tvs
        s=size(c,schema)
        company=records[0][1]
        # identical predicates and expected answers; raw history vs read model.
        raw_sql=f"""SELECT count(*) FROM {schema}.events
             WHERE company=%s AND received_month=%s::date"""
        cqrs_sql=f"""SELECT sum(pending_time) FROM {schema}.read_month
             WHERE company=%s AND received_month=%s::date"""
        args=(company,"2026-11-01")
        assert scalar(c,raw_sql,args)==scalar(c,cqrs_sql,args)
        raw_times,read_times,raw_buf,read_buf=[],[],[],[]
        for _ in range(12):
            rt,rb=query_explain(c,raw_sql,args)
            ct,cb=query_explain(c,cqrs_sql,args)
            raw_times.append(rt);read_times.append(ct)
            raw_buf.append(rb);read_buf.append(cb)
        explain_sql="EXPLAIN (COSTS OFF) "+raw_sql
        plan="\n".join(x[0] for x in c.execute(explain_sql,args))
        assert "events_nov" in plan and "events_oct" not in plan,plan
        # Failure in projector rolls back BOTH cursor and count.
        with c.transaction():
            c.execute(f"""CREATE FUNCTION {schema}.fail_qa() RETURNS trigger
                   LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''qa_projection_abort''; END'""")
            c.execute(f"""CREATE TRIGGER qa_projection_fault BEFORE UPDATE ON {schema}.read_month
                   FOR EACH ROW EXECUTE FUNCTION {schema}.fail_qa()""")
        with c.transaction():
            write_batch(c,schema,d,co,501,503)
        before=scalar(c,f"SELECT sum(pending_time) FROM {schema}.read_month")
        try:
            with c.transaction():
                project(c,schema,d,co)
        except psycopg.Error:pass
        else:raise AssertionError("projector_should_fail")
        assert scalar(c,f"SELECT sum(pending_time) FROM {schema}.read_month")==before
        assert scalar(c,f"SELECT through_seq FROM {schema}.cursor WHERE device=%s",(d,))==500
        with c.transaction():
            c.execute(f"DROP TRIGGER qa_projection_fault ON {schema}.read_month")
        with c.transaction():
            assert project(c,schema,d,co)==3
            assert project(c,schema,d,co)==0
        assert scalar(c,f"SELECT sum(pending_time) FROM {schema}.read_month")==before+3

        result={"status":"PASS","tvs":tvs,"mode":mode,"batch_size":MODES[mode],
            "events":total,"committed_batches":len(durations),
            "transactions_p95_ms":quantile95(durations),
            "transactions_avg_ms":round(statistics.mean(durations)*1000,3),
            "write_seconds":round(elapsed,3),"events_per_second":round(total/elapsed,1),
            "write_wal_bytes":wal,"projection_seconds":round(projection_seconds,3),
            "raw_query_p95_ms":round(sorted(raw_times)[-1],4),
            "cqrs_query_p95_ms":round(sorted(read_times)[-1],4),
            "raw_query_hit_blocks_avg":round(statistics.mean(raw_buf),2),
            "cqrs_query_hit_blocks_avg":round(statistics.mean(read_buf),2),
            "tenant_isolation":"PASS","duplicate_replay":"PASS",
            "projector_atomic_rollback":"PASS","partition_pruning":"PASS",**s}
        print("V2_BATCH_BENCHMARK_RESULT="+json.dumps(result,separators=(",",":"),sort_keys=True),flush=True)
        return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--tvs",required=True,type=int,choices=[7,12,20,50,100])
    args=p.parse_args()
    results=[benchmark_one(args.tvs,m) for m in MODES]
    assert len(results)==4 and all(x["status"]=="PASS" for x in results)
    print(f"V2_BATCH_MATRIX_{args.tvs}_TV=PASS modes=one,50,100,500 no_deploy=true",flush=True)

if __name__=="__main__":main()
