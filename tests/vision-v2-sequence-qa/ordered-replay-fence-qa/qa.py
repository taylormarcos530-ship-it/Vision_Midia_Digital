"""Synthetic Vision V2 PG17 ordered durable outbox replay; commercial cache
invalidation; real refused PG TCP connect during HTTP stream; advisory shared
stream fence vs authoritative per-chunk PostgreSQL membership checks.
NO production / no real Supabase, no claim of zero-window revocation.
"""
from __future__ import annotations
import importlib.util,hashlib,multiprocessing as mp,os,resource,threading,time,json,uuid
from concurrent.futures import ThreadPoolExecutor
from http.client import IncompleteRead
from pathlib import Path
from urllib import request,error

BASE=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("vision_v2_cutover",BASE/"rolling-cutover-outbox-qa"/"qa.py")
z=importlib.util.module_from_spec(spec);spec.loader.exec_module(z)
v,a,deep,p,q=z.v,z.a,z.deep,z.p,z.q
LOCK_ID=93740233
def check(ok,msg):assert ok,msg
def row(c,sql,params=()):return c.execute(sql,params).fetchone()
def create_tables():
    with v.con() as c:
        check(row(c,"SELECT current_database()")[0]=="vision_v2_quarantine_disposable","db_guard")
        check(int(row(c,"SHOW server_version_num")[0])//10000==17,"pg17_guard")
        c.execute("""CREATE TABLE qa_ordered_campaign(company_id uuid PRIMARY KEY,
          revision bigint NOT NULL DEFAULT 0,name text NOT NULL)""")
        c.execute("""CREATE TABLE qa_ordered_events(
           id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
           company_id uuid NOT NULL,revision bigint NOT NULL,
           action text NOT NULL,payload jsonb NOT NULL,
           UNIQUE(company_id,revision))""")
        c.execute("""CREATE TABLE qa_ordered_cursor(
           consumer int PRIMARY KEY,last_id bigint NOT NULL DEFAULT 0)""")
        c.execute("""CREATE TABLE qa_ordered_processed(
           consumer int NOT NULL,id bigint NOT NULL,
           company_id uuid NOT NULL,revision bigint NOT NULL,
           PRIMARY KEY (consumer,id))""")
        for company in v.COMPANIES:
            c.execute("INSERT INTO qa_ordered_campaign(company_id,name) VALUES(%s,%s)",
              (company,"PREVIOUS CAMPAIGN"))
        for i in (0,1):
            c.execute("INSERT INTO qa_ordered_cursor(consumer) VALUES(%s)",(i,))
def publish(company,title,notify=True,abort=False):
    # For global ID ordering, serialize before allocating the PG identity id.
    # This is synthetic and has throughput/lock-contention costs to benchmark.
    with v.con() as c:
        with c.transaction():
            c.execute("SELECT pg_advisory_xact_lock(%s)",(LOCK_ID,))
            rev=row(c,"""UPDATE qa_ordered_campaign SET revision=revision+1,name=%s
              WHERE company_id=%s RETURNING revision""",(title,company))[0]
            event=row(c,"""INSERT INTO qa_ordered_events(company_id,revision,action,payload)
                 VALUES(%s,%s,'campaign',%s::jsonb) RETURNING id""",
                 (company,rev,json.dumps({"name":title})))[0]
            if notify:
                c.execute("SELECT pg_notify('qa_ordered_events',%s)",(str(event),))
            if abort:raise RuntimeError("injected_precommit_rollback")
    return {"id":event,"company":str(company),"revision":rev,"name":title}
def consumer_loop(consumer,pipe):
    # Two independent PROCESS instances persist their offsets in PostgreSQL.
    # A kill between committed checkpoints cannot duplicate durable effects.
    cache={}
    reads=0
    with v.con() as c:
        last=row(c,"SELECT last_id FROM qa_ordered_cursor WHERE consumer=%s",(consumer,))[0]
        rows=c.execute("""SELECT e.company_id,e.revision,e.payload
               FROM qa_ordered_processed p JOIN qa_ordered_events e ON p.id=e.id
               WHERE p.consumer=%s ORDER BY p.id""",(consumer,)).fetchall()
        for co,rev,payload in rows:
            cache[str(co)]={"revision":rev,"name":payload["name"]}
        c.execute("LISTEN qa_ordered_events")
    pipe.send({"ready":True,"pid":os.getpid(),"last_id":last})
    while True:
        cmd=pipe.recv()
        op=cmd["op"]
        if op=="stop":pipe.send({"stopped":True});break
        if op=="sync":
            seen=[]
            with v.con() as c:
                records=c.execute("""SELECT id,company_id,revision,payload FROM qa_ordered_events
                  WHERE id>%s ORDER BY id""",(last,)).fetchall()
                reads+=1
                for eid,co,rev,payload in records:
                    with c.transaction():
                        c.execute("INSERT INTO qa_ordered_processed(consumer,id,company_id,revision) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                              (consumer,eid,co,rev))
                        c.execute("UPDATE qa_ordered_cursor SET last_id=%s WHERE consumer=%s AND last_id<%s",
                            (eid,consumer,eid))
                    last=eid
                    cache[str(co)]={"revision":rev,"name":payload["name"]}
                    seen.append(eid)
                    if cmd.get("crash_after_first"):
                        os._exit(78)
            pipe.send({"seen":seen,"last_id":last,"queries":reads,"pid":os.getpid()})
        elif op=="get":
            co=uuid.UUID(cmd["company"])
            # Authoritative revision check PER COMMERCIAL HTTP lookup. On a
            # missed notify, fail closed until explicit durable reconciliation.
            with v.con() as c:
                now=row(c,"SELECT revision,name FROM qa_ordered_campaign WHERE company_id=%s",(co,))
            reads+=1
            value=cache.get(str(co))
            if not value or value["revision"]!=now[0]:
                pipe.send({"status":503,"reason":"stale_or_missing_revision",
                           "cached_revision":None if not value else value["revision"],
                           "authoritative_revision":now[0]})
            else:
                pipe.send({"status":200,"revision":now[0],"name":value["name"],
                           "sha256":hashlib.sha256(value["name"].encode()).hexdigest()})
        elif op=="stats":
            pipe.send({"pid":os.getpid(),"last_id":last,"sql_queries":reads,"cache":cache})
        else:raise RuntimeError("unknown_cmd")
def start_consumer(i):
    parent,child=mp.Pipe()
    proc=mp.Process(target=consumer_loop,args=(i,child));proc.start()
    first=parent.recv()
    check(first["ready"],"consumer_not_ready")
    return proc,parent,first
def ask(peer,op,**kwargs):
    proc,pipe,_=peer
    check(proc.is_alive(),"consumer_dead")
    pipe.send({"op":op,**kwargs})
    return pipe.recv()
def shutdown(peer):
    proc,pipe,_=peer
    if proc.is_alive():
        ask(peer,"stop")
    proc.join(5)
    if proc.is_alive():proc.terminate();proc.join(4)
    check(proc.exitcode==0,("bad_consumer_exit",proc.exitcode))
def verify_replay():
    create_tables()
    peers=[start_consumer(0),start_consumer(1)]
    try:
        check(peers[0][2]["pid"]!=peers[1][2]["pid"],"same_process")
        try:publish(v.COMPANIES[0],"ABORTED",abort=True)
        except RuntimeError:pass
        else:raise AssertionError("forced_rollback_not_raised")
        with v.con() as c:
            check(row(c,"SELECT count(*) FROM qa_ordered_events")[0]==0,"aborted_outbox_visible")
            check(row(c,"SELECT revision FROM qa_ordered_campaign WHERE company_id=%s",(v.COMPANIES[0],))[0]==0,
                    "aborted_commercial_mutation_visible")
        # Parallel different-company transactions; global advisory lock guards
        # against sequence allocation finishing out of commit order.
        with ThreadPoolExecutor(max_workers=4) as pool:
            actions=[(v.COMPANIES[0],"CAMPAIGN A1"),(v.COMPANIES[1],"CAMPAIGN B1"),
                    (v.COMPANIES[0],"CAMPAIGN A2"),(v.COMPANIES[1],"CAMPAIGN B2")]
            evs=list(pool.map(lambda x:publish(x[0],x[1]),actions))
        ids=sorted(x["id"] for x in evs)
        check(ids==list(range(1,5)),("not_gap_free_committed_ids",ids))
        for peer in peers:
            check(ask(peer,"get",company=str(v.COMPANIES[0]))["status"]==503,"stale_cache_accepted")
        # First consumer commits only first event then is forcibly terminated.
        try:
            ask(peers[0],"sync",crash_after_first=True)
        except EOFError:pass
        peers[0][0].join(4)
        check(peers[0][0].exitcode==78,("crash_not_forced",peers[0][0].exitcode))
        old_pid=peers[0][2]["pid"]
        peers[0]=start_consumer(0)
        check(peers[0][2]["pid"]!=old_pid,"process_not_restarted")
        rest=ask(peers[0],"sync")
        other=ask(peers[1],"sync")
        check(rest["seen"]==[2,3,4],("ordered_restart_gap",rest))
        check(other["seen"]==[1,2,3,4],("consumer_2_order",other))
        check(ask(peers[0],"sync")["seen"]==[],"duplicate_replay")
        for peer in peers:
            for co in v.COMPANIES:
                got=ask(peer,"get",company=str(co))
                check(got["status"]==200 and got["revision"]==2,"initial_commercial_cache_not_rebuilt")
        # A lost LISTEN notification cannot authorize a stale company.
        change=publish(v.COMPANIES[0],"REVISED ADVERTISING",notify=False)
        check(ask(peers[0],"get",company=str(v.COMPANIES[0]))["status"]==503,"stale_a_served")
        check(ask(peers[1],"get",company=str(v.COMPANIES[0]))["status"]==503,"stale_b_served")
        check(ask(peers[0],"get",company=str(v.COMPANIES[1]))["status"]==200,"unaffected_tenant_blocked")
        for peer in peers:
            replay=ask(peer,"sync")
            check(replay["seen"]==[change["id"]],"missed_event_not_replayed")
            commercial=ask(peer,"get",company=str(v.COMPANIES[0]))
            check(commercial["status"]==200 and commercial["name"]=="REVISED ADVERTISING",
                  "commercial_invalidation_failed")
        with v.con() as c:
            cp=c.execute("SELECT consumer,last_id FROM qa_ordered_cursor ORDER BY consumer").fetchall()
            receipt=c.execute("SELECT consumer,id FROM qa_ordered_processed ORDER BY consumer,id").fetchall()
            check(cp==[(0,5),(1,5)],("checkpoint",cp))
            check(receipt==[(i,j) for i in (0,1) for j in range(1,6)],
                  ("replay_duplicates_or_gaps",receipt))
            wal=row(c,"SELECT pg_current_wal_lsn()")[0]
            storage={"ordered_event_bytes":row(c,"SELECT pg_total_relation_size('qa_ordered_events')")[0],
                     "processed_receipt_bytes":row(c,"SELECT pg_total_relation_size('qa_ordered_processed')")[0],
                     "checkpoint_bytes":row(c,"SELECT pg_total_relation_size('qa_ordered_cursor')")[0],
                     "db_size":row(c,"SELECT pg_database_size(current_database())")[0]}
        return {"status":"PASS","two_distinct_consumer_pids":True,"restart_after_sig_exit":True,
          "parallel_companies_ordered_ids":ids,"crash_resumed_ids":rest["seen"],
          "independent_consumer_ids":other["seen"],"zero_duplicate_durable_receipts":True,
          "post_revocation_cache_fails_closed_even_if_no_notify":True,
          "unaffected_company_stays_available":True,"commerical_payload_version_invalidation_both":True,
          "final_checkpoints":[list(x) for x in cp],"storage":storage,
          "note":"PG advisory xact lock serializes append; throughput and multi-host fencing not production validated"}
    finally:
        for peer in peers:
            if peer[0].is_alive():shutdown(peer)

def advisory_fence():
    """Alternative 1 SQL query/stream, shared PG lock held during send.
    Revocation writer must wait for whole stream; not safe for immediate
    revocation or slow clients. Demonstrate honest negative timeout.
    """
    key=515553221
    held=threading.Event();release=threading.Event();writer_enter=threading.Event()
    events={}
    company=v.COMPANIES[0]
    def reader():
        with v.con() as c:
            with c.transaction():
                v.auth(c,v.decode(v.token(company,v.USER_IDS[0])))
                c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(key,))
                check(row(c,"SELECT private.is_company_member(%s)",(company,))[0],
                    "auth_not_valid_before_fence")
                events["reader_authorizations"]=1
                held.set()
                check(release.wait(8),"stream_fence_never_released")
    def writer():
        check(held.wait(5),"reader_never_locked")
        with v.con() as c:
            with c.transaction():
                writer_enter.set()
                c.execute("SELECT pg_advisory_xact_lock(%s)",(key,))
                c.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",
                          (company,v.USER_IDS[0]))
        events["revocation_committed"]=True
    reader_t=threading.Thread(target=reader);writer_t=threading.Thread(target=writer)
    reader_t.start();writer_t.start()
    check(writer_enter.wait(5),"writer_not_attempted")
    time.sleep(.15)
    check(not events.get("revocation_committed"),"writer_bypassed_fence")
    # Prove writer can fail due to slow stream with bounded lock_timeout.
    with v.con() as c:
        with c.transaction():
            c.execute("SET LOCAL lock_timeout='100ms'")
            try:c.execute("SELECT pg_advisory_xact_lock(%s)",(key,))
            except v.psycopg.Error as ex:check(ex.sqlstate=="55P03",("wrong_lock_timeout",ex.sqlstate))
            else:raise AssertionError("lock_timeout_not_triggered")
    release.set()
    reader_t.join(6);writer_t.join(6)
    check(not reader_t.is_alive() and not writer_t.is_alive(),"fenced_threads_stuck")
    check(events.get("revocation_committed"),"revocation_not_committed")
    with v.con() as c:
        check(not row(c,"SELECT EXISTS(SELECT 1 FROM private.memberships WHERE company_id=%s AND user_id=%s)",
                 (company,v.USER_IDS[0]))[0],"fenced_revocation_not_persisted")
        c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s)",(company,v.USER_IDS[0]))
    return {"status":"PASS","one_authorization_SQL_per_stream":True,
        "shared_PG_transaction_lock_blocks_exclusive_revocation_commit":True,
        "slow_reader_can_make_revocation_timeout":True,
        "writer_wait_seconds_at_least":.15,
        "production_candidate_safe_for_immediate_revocation":False}

class FaultHandler(z.AuthoritativeHandler):
    pass
class FaultServer(z.AuthoritativeServer):
    def __init__(self,keys):
        super().__init__(keys)
        self.RequestHandlerClass=FaultHandler

def fault_process(keys,control):
    service=FaultServer(keys)
    thread=threading.Thread(target=service.serve_forever,daemon=True);thread.start()
    check(service.monitor_ready.wait(12),"auth_fault_server_unready")
    control.send({"ready":True,"port":service.server_address[1],"pid":os.getpid()})
    try:
        while True:
            op=control.recv()
            if op=="prewarm":
                service.prewarm()
                control.send(True)
            elif op=="pause_state":control.send(service.paused.is_set())
            elif op=="resume":service.pause.set();control.send(True)
            elif op=="pg_socket_blackhole":
                # A real psycopg TCP connect attempts a deliberately refused
                # localhost socket; PG17 service remains intact elsewhere.
                v.DSN=v.DSN.replace("127.0.0.1:5432","127.0.0.1:1")
                control.send(True)
            elif op=="pg_recover":
                v.DSN=v.DSN.replace("127.0.0.1:1","127.0.0.1:5432")
                control.send(True)
            elif op=="stats":
                with service.mx:
                    control.send({"failed_streams":service.failed_streams,
                        "auth_sql":service.auth_sql,"responses":service.responses,
                        "denied":service.denied,"rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
            elif op=="stop":control.send(True);break
    finally:
        service.shutdown();service.server_close();thread.join(4);service.finish()
def pg_connection_fail_closed():
    keys=a.Keys()
    parent,child=mp.Pipe();proc=mp.Process(target=fault_process,args=(keys,child));proc.start()
    first=parent.recv();check(first.get("ready"),"auth_server_not_ready")
    port=first["port"]
    def cmd(k):
        check(proc.is_alive(),"fault_process_dead")
        parent.send(k);return parent.recv()
    url="http://127.0.0.1:"+str(port)+"/0?pause=1"
    token=keys.issue(v.COMPANIES[0],v.USER_IDS[0],"a")
    hdr={"X-QA-JWT":token,"Accept-Encoding":"gzip"}
    try:
        cmd("prewarm")
        response=request.urlopen(request.Request(url,headers=hdr),timeout=40)
        try:
            initial=response.read(16384)
            check(len(initial)==16384,"stream_not_started")
            check(cmd("pause_state"),"not_paused")
            cmd("pg_socket_blackhole")
            cmd("resume")
            try:
                trailing=response.read()
                raise AssertionError(("PG_failure_leaked_bytes",len(trailing)))
            except IncompleteRead as exc:check(len(exc.partial)==0,("post_DB_failure_data",len(exc.partial)))
        finally:response.close()
        try:
            request.urlopen(request.Request("http://127.0.0.1:"+str(port)+"/0",headers=hdr),timeout=12)
        except error.HTTPError as exc:check(exc.code==503,"fail_closed_503_expected")
        else:raise AssertionError("pg_unavailable_served_200")
        cmd("pg_recover")
        with request.urlopen(request.Request("http://127.0.0.1:"+str(port)+"/0",headers=hdr),timeout=20) as good:
            check(good.status==200 and len(good.read())>100000,"PG_recovery_failed")
        stats=cmd("stats")
        check(stats["failed_streams"]>=1,"missing_failure_accounting")
        return {"status":"PASS","real_psycopg_refused_TCP_on_local_port_1":True,
            "full_PG17_service_was_not_stopped":True,
            "partial_HTTP_200_truncated":True,"bytes_after_connection_failure":0,
            "new_connections_return_503":True,"recovery_returns_HTTP_200":True,"stats":stats}
    finally:
        if proc.is_alive():cmd("stop")
        proc.join(6)
        if proc.is_alive():proc.terminate();proc.join(4)
        check(proc.exitcode==0,"fault_process_exit")

def main():
    began=time.perf_counter()
    q.init_db();p.expanded_history();a.setup_outbox()
    security=deep.rls_audit()
    with v.con() as c:
        wal0=row(c,"SELECT pg_current_wal_lsn()")[0]
    replay=verify_replay()
    auth_alt=advisory_fence()
    net=pg_connection_fail_closed()
    with v.con() as c:
        result={"result":"PASS","pg17_disposable":True,"synthetic_rls_tables":security["table_count"],
             "replay":replay,"stream_lock_alternative":auth_alt,"connection_failure":net,
             "database_bytes":row(c,"SELECT pg_database_size(current_database())")[0],
             "history_index_bytes":row(c,"SELECT pg_indexes_size('public.playback_logs')")[0],
             "wal_after_fixture_bytes":int(row(c,"SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(wal0,))[0]),
             "full_commercial_HTTP_100_300_in_separate_CI_job":True,
             "remote_AES_manifest_in_separate_CI_job":True,
             "no_production_access":True,"production_GO":False,
             "RSS_parent_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
             "elapsed_s":round(time.perf_counter()-began,3)}
    print("QA_ORDERED_FENCE_SUMMARY_JSON="+json.dumps(result,sort_keys=True,default=str),flush=True)
    print("QA_ORDERED_FENCE_PASS=true",flush=True)
if __name__=="__main__":main()
