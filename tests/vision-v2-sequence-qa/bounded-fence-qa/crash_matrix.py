"""Disposable PG17 durable outbox crash matrix at every checkpoint boundary:
abort before writer commit, crash producer immediately after commit/no NOTIFY,
consumer crash after fetched read, inside receipt transaction, after receipt
commit but before acknowledgment, and replay after full process restart.
No assumption that IDENTITY values are consecutive.
"""
from __future__ import annotations
import importlib.util,json,multiprocessing as mp,os,resource,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("v2_old_ordered",ROOT/"ordered-replay-fence-qa"/"qa.py")
z=importlib.util.module_from_spec(spec);spec.loader.exec_module(z)
v,q,p,a,deep=z.v,z.q,z.p,z.a,z.deep
def check(ok,m):assert ok,m
def producer_commit_die(company,title):
    z.publish(company,title,notify=False)
    os._exit(81)
def consumer_stage_crash(consumer,mode):
    with v.con() as c:
        last=c.execute("SELECT last_id FROM qa_ordered_cursor WHERE consumer=%s",(consumer,)).fetchone()[0]
        item=c.execute("SELECT id,company_id,revision FROM qa_ordered_events WHERE id>%s ORDER BY id LIMIT 1",(last,)).fetchone()
        check(item is not None,"no_event_to_replay")
        eid,co,revision=item
        if mode=="after_read_before_receipt":os._exit(82)
        with c.transaction():
            c.execute("""INSERT INTO qa_ordered_processed(consumer,id,company_id,revision)
                VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING""",(consumer,eid,co,revision))
            if mode=="after_receipt_before_checkpoint_commit":
                # Backend transaction aborts upon process death; no partial durable
                # receipt or cursor may survive.
                os._exit(83)
            c.execute("UPDATE qa_ordered_cursor SET last_id=%s WHERE consumer=%s",
                      (eid,consumer))
        if mode=="after_checkpoint_commit_before_ack":
            os._exit(84)
        os._exit(85)
def publisher_process(company,label,start,output):
    check(start.wait(8),"publisher_barrier_timeout")
    result=[]
    for i in range(4):
        result.append(z.publish(company,label+"-"+str(i),notify=False))
        time.sleep(.022)
    output.put({"pid":os.getpid(),"ids":[x["id"] for x in result]})
def multi_process_publish_consume():
    # Two real *publisher OS processes*, two independent consumers already
    # alive, SQL polling overlap with physical commits; all in one QA runner.
    import queue
    consumers=[z.start_consumer(0),z.start_consumer(1)]
    gate=mp.Event();output=mp.Queue()
    procs=[mp.Process(target=publisher_process,args=(v.COMPANIES[i],
       "PROC"+str(i),gate,output)) for i in (0,1)]
    try:
        for proc in procs:proc.start()
        gate.set()
        observed=[[],[]]
        overlap=[0,0]
        for k in range(18):
            for j,peer in enumerate(consumers):
                ids=z.ask(peer,"sync")["seen"]
                observed[j]+=ids
                if ids:overlap[j]+=1
            time.sleep(.018)
        for proc in procs:
            proc.join(8)
            check(proc.exitcode==0,("publisher_process_failure",proc.exitcode))
        outputs=[output.get(timeout=2) for _ in procs]
        ids=sorted(x for entry in outputs for x in entry["ids"])
        check(len(ids)==8 and len(set(ids))==8,"missing_multi_process_commits")
        for i,peer in enumerate(consumers):
            observed[i]+=z.ask(peer,"sync")["seen"]
            check(observed[i]==ids,("multi_process_consumer_order",observed[i],ids))
            check(overlap[i]>0,("consumer_never_replayed_during_writes",overlap))
        with v.con() as c:
            receipts=c.execute("""SELECT consumer,id FROM qa_ordered_processed
                 WHERE consumer IN (0,1) AND id >= %s ORDER BY consumer,id""",
                 (ids[0],)).fetchall()
            check(receipts==[(j,eid) for j in (0,1) for eid in ids],
                  "missing_or_duplicate_multi_process_receipts")
        return {"status":"PASS","publisher_pids":[z["pid"] for z in outputs],
             "real_different_publisher_processes":len(set(z["pid"] for z in outputs))==2,
             "independent_consumer_processes":2,
             "committed_events":ids,
             "concurrent_replay_batch_counts":overlap,
             "identical_complete_event_order_on_consumers":True}
    finally:
        for peer in consumers:
            if peer[0].is_alive():z.shutdown(peer)
        for proc in procs:
            if proc.is_alive():proc.terminate();proc.join(3)

def verify():
    started=time.perf_counter()
    q.init_db();z.create_tables()
    with v.con() as c:
        lsn0=c.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
    try:
        z.publish(v.COMPANIES[0],"ABORT_TEST",abort=True,notify=False)
    except RuntimeError:pass
    else:raise AssertionError("missing_writer_abort")
    with v.con() as c:
        check(c.execute("SELECT count(*) FROM qa_ordered_events").fetchone()[0]==0,
              "aborted_writer_created_event")
    child=mp.Process(target=producer_commit_die,args=(v.COMPANIES[0],"PRODUCER_CRASH_COMMITTED"))
    child.start();child.join(8)
    check(child.exitcode==81,"producer_crash_not_forced")
    with v.con() as c:
        events=c.execute("SELECT id,company_id,revision FROM qa_ordered_events ORDER BY id").fetchall()
    check(len(events)==1 and events[0][0]>1 and events[0][2]==1,
          ("postcommit_outbox_missing",events))
    expected_id=events[0][0]
    phases=[]
    for i,stage in enumerate(("after_read_before_receipt",
              "after_receipt_before_checkpoint_commit",
              "after_checkpoint_commit_before_ack")):
        consumer=10+i
        with v.con() as c:
            c.execute("INSERT INTO qa_ordered_cursor(consumer) VALUES(%s)",(consumer,))
        proc=mp.Process(target=consumer_stage_crash,args=(consumer,stage))
        proc.start();proc.join(8)
        check(proc.exitcode==82+i,("incorrect_crash_phase",stage,proc.exitcode))
        with v.con() as c:
            before=c.execute("SELECT last_id FROM qa_ordered_cursor WHERE consumer=%s",(consumer,)).fetchone()[0]
            receipt=c.execute("SELECT count(*) FROM qa_ordered_processed WHERE consumer=%s",(consumer,)).fetchone()[0]
        if i<2:
            check(before==0 and receipt==0,
                ("uncommitted_stage_survived_crash",stage,before,receipt))
        else:
            check(before==expected_id and receipt==1,
                ("committed_stage_lost_after_ack_failure",stage,before,receipt))
        peer=z.start_consumer(consumer)
        try:
            loaded=z.ask(peer,"sync")
            if i<2:check(loaded["seen"]==[expected_id],"lost_uncommitted_event")
            else:check(loaded["seen"]==[],"duplicate_after_ack_crash")
            check(z.ask(peer,"sync")["seen"]==[],"nonidempotent_restart_replay")
            check(z.ask(peer,"get",company=str(v.COMPANIES[0]))["status"]==200,
                  "recovered_commercial_cache_missing")
        finally:z.shutdown(peer)
        phases.append({"stage":stage,"forced_exit":proc.exitcode,
            "checkpoint_before_restart":before,"durable_receipts_before_restart":receipt,
            "replayed_ids":loaded["seen"],"post_restart_exactly_once":True})
    # Two consumer processes live at the same time, a notification is lost,
    # persisted checkpoint catches up on explicit reconciliation.
    separate=[z.start_consumer(0),z.start_consumer(1)]
    try:
        replay=[z.ask(peer,"sync")["seen"] for peer in separate]
        check(replay==[[expected_id],[expected_id]],"two_consumers_missing_post_commit")
        upd=z.publish(v.COMPANIES[1],"SECOND_TENANT_AFTER_LOST_NOTIFY",notify=False)
        for peer in separate:
            check(z.ask(peer,"get",company=str(v.COMPANIES[1]))["status"]==503,
                  "stale_commercial_cache_accepted")
        updates=[z.ask(peer,"sync")["seen"] for peer in separate]
        check(updates==[[upd["id"]],[upd["id"]]],"lost_notify_event_not_recovered")
    finally:
        for peer in separate:z.shutdown(peer)
    with v.con() as c:
        all_receipts=c.execute("SELECT consumer,id FROM qa_ordered_processed ORDER BY consumer,id").fetchall()
        check(len(all_receipts)==(3+2+2),"durable_exact_receipt_count")
        rows=c.execute("SELECT consumer,count(*),count(DISTINCT id) FROM qa_ordered_processed GROUP BY consumer ORDER BY consumer").fetchall()
        check(all(total==distinct for _,total,distinct in rows),"duplicate_receipts")
        storage={"outbox_bytes":c.execute("SELECT pg_total_relation_size('qa_ordered_events')").fetchone()[0],
                 "checkpoint_bytes":c.execute("SELECT pg_total_relation_size('qa_ordered_cursor')").fetchone()[0],
                 "receipt_bytes":c.execute("SELECT pg_total_relation_size('qa_ordered_processed')").fetchone()[0],
                 "db_bytes":c.execute("SELECT pg_database_size(current_database())").fetchone()[0],
                 "wal_delta_bytes":int(c.execute("SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(lsn0,)).fetchone()[0])}
    multi=multi_process_publish_consume()
    summary={"status":"PASS","real_process_crashes":4,
             "multi_process_publish_consume":multi,
             "transaction_abort_before_commit":True,
             "producer_commit_then_hard_crash_no_NOTIFY":True,
             "nonconsecutive_ID_after_rollback":expected_id>1,
             "stages":phases,"independent_consumers":2,
             "lost_notification_recovered":True,
             "exactly_once_durable_receipts":True,
             "index_and_storage":storage,
             "rss_parent_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
             "elapsed_seconds":round(time.perf_counter()-started,3),
             "no_production_access":True,"production_GO":False}
    print("QA_CRASH_MATRIX_SUMMARY_JSON="+json.dumps(summary,default=str,sort_keys=True),flush=True)
    print("QA_CRASH_MATRIX_PASS=true",flush=True)
if __name__=="__main__":verify()
