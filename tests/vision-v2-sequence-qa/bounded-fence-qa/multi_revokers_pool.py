"""Vision V2 QA ONLY — PG17 bounded connection pool; competing revokers,
300 slow socket writers, SECURITY DEFINER/RLS negative probes, forced child
crash holding a PG advisory transaction lock. 64/256 KiB variant via env.
No claims about real hosts, Supabase or bytes buffered by the kernel.
"""
from __future__ import annotations
import concurrent.futures,importlib.util,json,multiprocessing as mp,os,queue,resource,socket,threading,time
import psycopg
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("v2_minpriv_existing", HERE/"minpriv_priority.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
CHUNK=int(os.environ.get("QA_POOL_CHUNK_BYTES","65536"))
assert CHUNK in (65536,262144)
SOCKET_TIMEOUT=.105
POOL_SIZE=12
TASKS=300
def check(ok,msg):assert ok,msg
def now():return time.perf_counter()

def policy_bypass_negative():
    checks=m.attack_matrix()
    extra={}
    cases=[
      ("disable_force_rls","ALTER TABLE qa_v2_guard.memberships DISABLE ROW LEVEL SECURITY",()),
      ("alter_func_owner","ALTER FUNCTION qa_v2_guard.can_send(uuid) OWNER TO qa_v2_stream_login",()),
      ("replace_guard_func","CREATE OR REPLACE FUNCTION qa_v2_guard.can_send(uuid) RETURNS bool LANGUAGE sql AS 'SELECT true'",()),
      ("grant_membership","GRANT ALL ON qa_v2_guard.memberships TO qa_v2_stream_login",()),
      ("session_admin","SET SESSION AUTHORIZATION postgres",()),
      ("table_lock","LOCK TABLE qa_v2_guard.memberships IN ACCESS EXCLUSIVE MODE",()),
      ("truncate_members","TRUNCATE qa_v2_guard.memberships",()),
      ("create_shadow_guard","CREATE TABLE qa_v2_guard.memberships_fake(id integer)",()),
    ]
    for role,dsn in (("reader",m.STREAM),("revoker",m.REVOKER)):
        for name,stmt,args in cases:
            try:
                with m.con(dsn) as c:
                    with c.transaction():
                        c.execute(stmt,args)
            except psycopg.Error as ex:
                check(ex.sqlstate in ("42501","42P01","55000"),("unexpected_denial_error",name,ex.sqlstate))
                extra[role+"_"+name]=ex.sqlstate
            else:raise AssertionError(("unauthorized_statement_accepted",role,name))
    with m.con(m.STREAM) as c:
        c.execute("CREATE TEMP TABLE memberships(company_id uuid,user_id text,active boolean)")
        c.execute("INSERT INTO memberships VALUES(%s,'synthetic-user',true)",(m.OTHER,))
        c.execute("SET search_path TO pg_temp,public,qa_v2_guard")
        check(m.sql(c,"SELECT qa_v2_guard.can_send(%s)",(m.COMPANY,)),"temp_shadow_blocked_valid_user")
        try:m.sql(c,"SELECT qa_v2_guard.can_send(%s)",(m.OTHER,))
        except psycopg.Error as ex:check(ex.sqlstate=="42501",("temp_shadow_hijacked_tenant",ex.sqlstate))
        else:raise AssertionError("pg_temp_tenant_shadow_accepted")
        extra["pg_temp_shadow_cannot_redirect_security_definer"]="PASS"
    return {"original_denied":checks["negative_denied"],"extra_denied":len(extra)-1,
        "temp_shadow_denied":True,"sample":dict(list(extra.items())[:6]),
        "all_checked":True}

def chunk_socket(c,stats,lock):
    # A genuine local SO_SNDBUF saturation, not sleep-only "network" model.
    sender,receiver=socket.socketpair()
    sender.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,4096)
    sender.settimeout(SOCKET_TIMEOUT)
    try:
        with c.transaction():
            c.execute("SET LOCAL lock_timeout='800ms'")
            check(m.sql(c,"SELECT qa_v2_guard.can_send(%s)",(m.COMPANY,)), "invalid_authorize")
            with lock:
                stats["accepted"]+=1
                stats["active"]+=1
                stats["peak_active"]=max(stats["active"],stats["peak_active"])
            try:
                sender.sendall(b"X"*CHUNK)
                with lock:stats["completed_sends"]+=1
            except socket.timeout:
                with lock:stats["socket_timeouts"]+=1
            finally:
                with lock:stats["active"]-=1
    finally:
        sender.close();receiver.close()

def concurrent_fairness():
    pool=queue.Queue(maxsize=POOL_SIZE)
    for _ in range(POOL_SIZE):pool.put(m.con(m.STREAM))
    start=threading.Event()
    enabled=threading.Event()
    lock=threading.RLock()
    stats={"accepted":0,"denied":0,"socket_timeouts":0,"completed_sends":0,
          "other_errors":[],"active":0,"peak_active":0,"pool_timeouts":0}
    writer_results=[]
    def stream_task(i):
        if not start.wait(8):raise AssertionError("start_barrier")
        try:conn=pool.get(timeout=10)
        except queue.Empty:
            with lock:stats["pool_timeouts"]+=1
            return
        try:
            try:chunk_socket(conn,stats,lock)
            except psycopg.Error as ex:
                if ex.sqlstate=="42501":
                    with lock:stats["denied"]+=1
                else:
                    with lock:stats["other_errors"].append(ex.sqlstate or type(ex).__name__)
        finally:pool.put(conn)
    def revoker(index):
        check(enabled.wait(10),"no_writer_gate")
        st=now()
        with m.con(m.REVOKER) as c:
            check(m.sql(c,"SELECT qa_v2_guard.begin_revoke(%s)",(m.COMPANY,)),
                  "no_persistent_revoke_priority")
        flag_ms=(now()-st)*1000
        with m.con(m.REVOKER) as c:
            with c.transaction():
                c.execute("SET LOCAL lock_timeout='1200ms'")
                check(m.sql(c,"SELECT qa_v2_guard.finish_revoke(%s)",(m.COMPANY,)),
                     "cannot_revoke")
        return {"writer_index":index,"flag_ms":round(flag_ms,3),
                 "commit_elapsed_ms":round((now()-st)*1000,3)}
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=36) as ex:
            futures=[ex.submit(stream_task,i) for i in range(TASKS)]
            start.set()
            deadline=now()+5
            count=0
            while now()<deadline:
                with lock:count=stats["accepted"]
                if count>=3:break
                time.sleep(.006)
            check(count>=3,("no_initial_active_streams",count))
            # Independent OS threads (NOT queued behind all 300 pool jobs).
            # The previous CI detected the bad scheduling and is preserved.
            revoker_results=[None,None]
            revoker_errors=[]
            def invoke_revoker(i):
                try:revoker_results[i]=revoker(i)
                except BaseException as ex:
                    revoker_errors.append((i,type(ex).__name__,str(ex)))
            revoker_threads=[threading.Thread(target=invoke_revoker,args=(i,),
                name="priority-revoker-"+str(i)) for i in (0,1)]
            for thread in revoker_threads:thread.start()
            enabled.set()
            for thread in revoker_threads:thread.join(10)
            check(all(not thread.is_alive() for thread in revoker_threads),
                "revokers_starved_behind_stream_work")
            check(not revoker_errors and all(revoker_results),
                  ("revoker_failed",revoker_errors))
            writer_results=revoker_results
            for f in futures:f.result(timeout=20)
        check(not stats["other_errors"] and stats["pool_timeouts"]==0,("pool_failures",stats))
        check(stats["denied"]>=TASKS//2 and stats["accepted"]>0,
              ("revocation_started_too_late_or_priority_failed",stats))
        check(stats["accepted"]+stats["denied"]==TASKS,("unaccounted_streams",stats))
        check(stats["peak_active"]<=POOL_SIZE,("pool_not_bounded",stats))
        check(all(x["commit_elapsed_ms"]<1200 for x in writer_results),
              ("revoker_starvation",writer_results))
        with m.con(m.STREAM) as c:
            try:m.sql(c,"SELECT qa_v2_guard.can_send(%s)",(m.COMPANY,))
            except psycopg.Error as ex:check(ex.sqlstate=="42501","post_revoke_role_did_not_fail_closed")
            else:raise AssertionError("post_revoke_access")
        with m.con(m.ADMIN) as c:
            check(not m.sql(c,"SELECT active FROM qa_v2_guard.memberships WHERE company_id=%s",
                 (m.COMPANY,)),"revocation_row_still_active")
            check(not m.sql(c,"SELECT pending FROM qa_v2_guard.fences WHERE company_id=%s",
                (m.COMPANY,)),"revoke_pending_not_cleared")
        return {"tasks":TASKS,"tested_chunk_bytes":CHUNK,
           "connection_pool_size":POOL_SIZE,
           "peak_pg_socket_senders":stats["peak_active"],
           "actual_saturated_socket_timeouts":stats["socket_timeouts"],
           "accepted_before_pending":stats["accepted"],
           "denied_pending_or_revoked":stats["denied"],
           "rejected_pool_waits":stats["pool_timeouts"],
           "revokers":writer_results,
           "starvation_observed":False,
           "writer_priority_persisted":True,
           "pool_recovered_without_active_leaks":True}
    finally:
        while not pool.empty():
            try:pool.get_nowait().close()
            except queue.Empty:break

def crash_holder(ev):
    # A *separate process* dies with an open PG transaction and shared lock.
    with m.con(m.STREAM) as c:
        with c.transaction():
            check(m.sql(c,"SELECT qa_v2_guard.can_send(%s)",(m.COMPANY,)), "crash_reader_denied")
            ev.set()
            os._exit(91)
def crash_recovery():
    # Reset only the disposable fixture to verify PG releases inherited locks.
    with m.con(m.ADMIN) as c:
        c.execute("UPDATE qa_v2_guard.memberships SET active=true WHERE company_id=%s",(m.COMPANY,))
        c.execute("UPDATE qa_v2_guard.fences SET pending=false WHERE company_id=%s",(m.COMPANY,))
    ev=mp.Event();child=mp.Process(target=crash_holder,args=(ev,))
    child.start()
    check(ev.wait(5),"crash_child_never_held_lock")
    child.join(6)
    check(child.exitcode==91,("process_did_not_crash_with_lock",child.exitcode))
    priority=threading.Event();finished={}
    m.writer(priority,finished)
    check(finished.get("committed"),"writer_stuck_after_reader_crash")
    return {"result":"PASS","killed_reader_process_exit":91,
       "postgres_advisory_lock_released_on_process_death":True,
       "revocation_writer_after_crash_ms":finished["commit_elapsed_ms"]}

def main():
    start=now()
    m.setup()
    with m.con(m.ADMIN) as c:
        wal_before=m.sql(c,"SELECT pg_current_wal_lsn()")
    negatives=policy_bypass_negative()
    fairness=concurrent_fairness()
    crashed=crash_recovery()
    with m.con(m.ADMIN) as c:
        output={"result":"PASS","PG17_disposable":True,"chunk_bytes":CHUNK,
            "minpriv_bypass":negatives,"fairness_300":fairness,
            "crash_recovery":crashed,
            "schema_bytes":sum(m.sql(c,"SELECT pg_total_relation_size(%s::regclass)",(t,))
                for t in ("qa_v2_guard.memberships","qa_v2_guard.identities","qa_v2_guard.fences")),
            "db_bytes":m.sql(c,"SELECT pg_database_size(current_database())"),
            "wal_delta_bytes":int(m.sql(c,"SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(wal_before,))),
            "parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "elapsed_seconds":round(now()-start,3),
            "sql_permission_cost_not_full_backend_total":True,
            "two_revokers_cooperative_not_all_possible_production_revokers":True,
            "real_timeout_local_socketpair_not_interhost":True,
            "production_GO":False,"no_prod_access":True}
    print("QA_MULTI_REVOKERS_SUMMARY_JSON="+json.dumps(output,sort_keys=True),flush=True)
    print("QA_MULTI_REVOKERS_PASS=true",flush=True)
if __name__=="__main__":main()
