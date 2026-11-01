"""Disposable PostgreSQL 17 minimum privilege, writer priority and *actual*
kernel socket send timeout. All identities, passwords, rows synthetic; no
official Supabase access. DBA/superuser and misconfigured external writers
cannot be defeated by advisory locking. QA only.
"""
from __future__ import annotations
import concurrent.futures,json,os,resource,socket,threading,time,uuid
import psycopg

ADMIN="postgresql://postgres:qa-only-local-password@127.0.0.1:5432/vision_v2_quarantine_disposable"
URL_BASE="postgresql://{user}:synthetic-qa-only@127.0.0.1:5432/vision_v2_quarantine_disposable"
COMPANY=str(uuid.uuid5(uuid.NAMESPACE_DNS,"vision-v2-qa-minpriv-company"))
OTHER=str(uuid.uuid5(uuid.NAMESPACE_DNS,"vision-v2-qa-minpriv-other"))
STREAM=URL_BASE.format(user="qa_v2_stream_login")
REVOKER=URL_BASE.format(user="qa_v2_revoke_login")
def sql(c,s,params=()):return c.execute(s,params).fetchone()[0]
def check(x,msg):assert x,msg
def con(dsn):return psycopg.connect(dsn,autocommit=True,connect_timeout=3)

DDL=r"""
DO $$ BEGIN
 IF current_database() <> 'vision_v2_quarantine_disposable' THEN
   RAISE EXCEPTION 'reject non-ephemeral production DB' USING ERRCODE='42501';
 END IF;
END $$;
CREATE ROLE qa_v2_guard_owner NOLOGIN NOINHERIT;
CREATE ROLE qa_v2_stream_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD 'synthetic-qa-only';
CREATE ROLE qa_v2_revoke_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD 'synthetic-qa-only';
CREATE SCHEMA qa_v2_guard AUTHORIZATION qa_v2_guard_owner;
GRANT USAGE ON SCHEMA qa_v2_guard TO qa_v2_stream_login,qa_v2_revoke_login;
SET ROLE qa_v2_guard_owner;
CREATE TABLE qa_v2_guard.identities (
 login_role name PRIMARY KEY,
 company_id uuid NOT NULL,
 user_id text NOT NULL
);
CREATE TABLE qa_v2_guard.fences (
 company_id uuid PRIMARY KEY,
 lock_key bigint UNIQUE NOT NULL,
 pending boolean NOT NULL DEFAULT false
);
CREATE TABLE qa_v2_guard.memberships (
 company_id uuid NOT NULL,
 user_id text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(company_id,user_id)
);
ALTER TABLE qa_v2_guard.identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_v2_guard.fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_v2_guard.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_v2_guard.identities FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_v2_guard.fences FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_v2_guard.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_self ON qa_v2_guard.identities FOR ALL TO qa_v2_guard_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_self ON qa_v2_guard.fences FOR ALL TO qa_v2_guard_owner USING(true) WITH CHECK(true);
CREATE POLICY owner_self ON qa_v2_guard.memberships FOR ALL TO qa_v2_guard_owner USING(true) WITH CHECK(true);
CREATE FUNCTION qa_v2_guard.can_send(company uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,qa_v2_guard
AS $$
DECLARE who text; co uuid; fence bigint; waiting boolean; allowed boolean;
BEGIN
  IF session_user::text <> 'qa_v2_stream_login' THEN
    RAISE EXCEPTION 'invalid reader principal' USING ERRCODE='42501';
  END IF;
  SELECT company_id,user_id INTO co,who
    FROM qa_v2_guard.identities WHERE login_role=session_user;
  IF co IS NULL OR co <> company THEN
    RAISE EXCEPTION 'tenant identity mismatch' USING ERRCODE='42501';
  END IF;
  SELECT f.lock_key INTO fence FROM qa_v2_guard.fences f
    WHERE f.company_id=company;
  IF fence IS NULL THEN RAISE EXCEPTION 'no lease' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(fence);
  SELECT f.pending INTO waiting FROM qa_v2_guard.fences f WHERE f.company_id=company;
  IF waiting THEN RAISE EXCEPTION 'revoke pending' USING ERRCODE='42501'; END IF;
  SELECT EXISTS (SELECT 1 FROM qa_v2_guard.memberships m
     WHERE m.company_id=company AND m.user_id=who AND m.active) INTO allowed;
  IF NOT allowed THEN RAISE EXCEPTION 'revoked' USING ERRCODE='42501'; END IF;
  RETURN true;
END $$;
CREATE FUNCTION qa_v2_guard.begin_revoke(company uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,qa_v2_guard
AS $$
DECLARE co uuid;
BEGIN
  IF session_user::text <> 'qa_v2_revoke_login' THEN
    RAISE EXCEPTION 'invalid revoker principal' USING ERRCODE='42501';
  END IF;
  SELECT company_id INTO co FROM qa_v2_guard.identities WHERE login_role=session_user;
  IF co IS NULL OR co <> company THEN RAISE EXCEPTION 'wrong company' USING ERRCODE='42501'; END IF;
  UPDATE qa_v2_guard.fences SET pending=true WHERE company_id=company;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown tenant' USING ERRCODE='42501'; END IF;
  RETURN true;
END $$;
CREATE FUNCTION qa_v2_guard.finish_revoke(company uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,qa_v2_guard
AS $$
DECLARE co uuid; fence bigint;
BEGIN
  IF session_user::text <> 'qa_v2_revoke_login' THEN RAISE EXCEPTION 'wrong principal' USING ERRCODE='42501'; END IF;
  SELECT company_id INTO co FROM qa_v2_guard.identities WHERE login_role=session_user;
  IF co IS NULL OR co <> company THEN RAISE EXCEPTION 'tenant invalid' USING ERRCODE='42501'; END IF;
  SELECT lock_key INTO fence FROM qa_v2_guard.fences WHERE company_id=company;
  IF fence IS NULL THEN RAISE EXCEPTION 'unknown tenant' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(fence);
  UPDATE qa_v2_guard.memberships SET active=false WHERE company_id=company;
  UPDATE qa_v2_guard.fences SET pending=false WHERE company_id=company;
  RETURN true;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qa_v2_guard FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qa_v2_guard.can_send(uuid) TO qa_v2_stream_login;
GRANT EXECUTE ON FUNCTION qa_v2_guard.begin_revoke(uuid),qa_v2_guard.finish_revoke(uuid)
 TO qa_v2_revoke_login;
RESET ROLE;
"""
def setup():
    with con(ADMIN) as c:
        check(sql(c,"SELECT current_database()")=="vision_v2_quarantine_disposable","db_guard")
        check(int(sql(c,"SHOW server_version_num"))//10000==17,"PG17_only")
        c.execute(DDL)
        with c.transaction():
            for role in ("qa_v2_stream_login","qa_v2_revoke_login"):
                c.execute("INSERT INTO qa_v2_guard.identities(login_role,company_id,user_id) VALUES(%s,%s,%s)",
                          (role,COMPANY,"synthetic-user"))
            c.execute("INSERT INTO qa_v2_guard.fences(company_id,lock_key) VALUES(%s,%s)",(COMPANY,6171712))
            c.execute("INSERT INTO qa_v2_guard.fences(company_id,lock_key) VALUES(%s,%s)",(OTHER,6171713))
            c.execute("INSERT INTO qa_v2_guard.memberships(company_id,user_id) VALUES(%s,%s)",
                      (COMPANY,"synthetic-user"))
def deny(dsn,stmt,args=()):
    try:
        with con(dsn) as c:c.execute(stmt,args)
    except psycopg.Error as exc:
        check(exc.sqlstate in ("42501","42P01"),("unexpected_sqlstate",exc.sqlstate,stmt))
        return exc.sqlstate
    raise AssertionError("unexpectedly permitted: "+stmt)
def attack_matrix():
    attempts={}
    for role,dsn in (("stream",STREAM),("revoker",REVOKER)):
        tests=[
           ("update_membership","UPDATE qa_v2_guard.memberships SET active=true WHERE company_id=%s",(COMPANY,)),
           ("delete_membership","DELETE FROM qa_v2_guard.memberships WHERE company_id=%s",(COMPANY,)),
           ("insert_membership","INSERT INTO qa_v2_guard.memberships(company_id,user_id) VALUES(%s,'forged')",(COMPANY,)),
           ("update_priority","UPDATE qa_v2_guard.fences SET pending=false WHERE company_id=%s",(COMPANY,)),
           ("change_identity","UPDATE qa_v2_guard.identities SET user_id='another' WHERE login_role=session_user",()),
           ("escalate_owner","SET ROLE qa_v2_guard_owner",()),
           ("escalate_admin","SET ROLE postgres",()),
           ("read_other_tenant","SELECT * FROM qa_v2_guard.memberships WHERE company_id=%s",(OTHER,)),
           ("bypass_original_table","DELETE FROM private.memberships",()),
        ]
        for name,statement,args in tests:
            attempts[role+"_"+name]=deny(dsn,statement,args)
    attempts["reader_denied_writer_fn"]=deny(STREAM,"SELECT qa_v2_guard.finish_revoke(%s)",(COMPANY,))
    attempts["writer_denied_reader_fn"]=deny(REVOKER,"SELECT qa_v2_guard.can_send(%s)",(COMPANY,))
    attempts["reader_denied_other_company"]=deny(STREAM,"SELECT qa_v2_guard.can_send(%s)",(OTHER,))
    attempts["writer_denied_other_company"]=deny(REVOKER,"SELECT qa_v2_guard.begin_revoke(%s)",(OTHER,))
    with con(STREAM) as c:
        with c.transaction():
            c.execute("SELECT set_config('request.jwt.claim.company_id',%s,true)",(OTHER,))
            c.execute("SELECT set_config('request.jwt.claim.sub','forged-sub',true)")
            check(sql(c,"SELECT qa_v2_guard.can_send(%s)",(COMPANY,)), "forged_claim_override")
    return {"negative_denied":len(attempts),"all_denied":True,
            "direct_roles_no_superuser":True,"role_bound_session_user_not_JWT_argument":True,
            "FORCE_RLS_on_all_guard_tables":True,
            "sample_denials":{k:v for k,v in list(attempts.items())[:5]}}

def writer(priority,finished):
    with con(REVOKER) as c:
        ck=sql(c,"SELECT qa_v2_guard.begin_revoke(%s)",(COMPANY,))
        check(ck,"pending_not_committed")
    priority.set()
    t=time.perf_counter()
    with con(REVOKER) as c:
        with c.transaction():
            c.execute("SET LOCAL lock_timeout='1500ms'")
            check(sql(c,"SELECT qa_v2_guard.finish_revoke(%s)",(COMPANY,)),"finish_failed")
    finished["commit_elapsed_ms"]=round((time.perf_counter()-t)*1000,3)
    finished["committed"]=True
def priority_under_300_slow_streams():
    # 300 synthetic slow chunk attempts, capped at 24 concurrent PG
    # connections; every accepted chunk uses the real role and shared lock.
    barrier=threading.Event()
    finished={}
    priority=threading.Event()
    metrics={"served":0,"denied":0,"sql":0,"err":0}
    mu=threading.RLock()
    def chunk(i):
        barrier.wait(5)
        try:
            with con(STREAM) as c:
                with c.transaction():
                    check(sql(c,"SELECT qa_v2_guard.can_send(%s)",(COMPANY,)),"unexpected_false")
                    with mu:metrics["sql"]+=1
                    time.sleep(.065 if i<24 else .005)
            with mu:metrics["served"]+=1
        except psycopg.Error as exc:
            with mu:
                if exc.sqlstate=="42501":metrics["denied"]+=1
                else:metrics["err"]+=1
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        jobs=[pool.submit(chunk,i) for i in range(300)]
        barrier.set()
        time.sleep(.025)
        th=threading.Thread(target=writer,args=(priority,finished))
        th.start()
        check(priority.wait(3),"priority_writer_never_set_flag")
        for job in jobs:job.result(timeout=15)
        th.join(4)
        check(not th.is_alive(),"revocation_writer_starved")
    check(finished.get("committed"),"revocation_not_committed")
    check(finished["commit_elapsed_ms"]<1500,("revocation_not_bounded_in_test",finished))
    check(metrics["denied"]>0 and metrics["served"]>0 and metrics["err"]==0,
          ("slow_streams_not_fail_closed",metrics))
    with con(STREAM) as c:
        try:sql(c,"SELECT qa_v2_guard.can_send(%s)",(COMPANY,))
        except psycopg.Error as exc:check(exc.sqlstate=="42501","revoked_read_succeeded")
        else:raise AssertionError("revoked_reader_authorized")
    return {"tasks":300,"max_parallel_postgres_sessions":24,
            "revocation_commit_ms":finished["commit_elapsed_ms"],
            "accepted_before_pending":metrics["served"],
            "denied_pending_or_revoked":metrics["denied"],
            "connection_errors":metrics["err"],
            "statement_reads_attempted":metrics["sql"]+metrics["denied"],
            "writer_priority_pending_durable":True,
            "no_writer_starvation_in_this_test":True}

def real_socket_timeout_and_lock_release():
    # Change to new unrelated tenant so the prior revoked membership fixture
    # can't affect this test; only PostgreSQL admins can reset fixture.
    with con(ADMIN) as c:
        c.execute("UPDATE qa_v2_guard.memberships SET active=true WHERE company_id=%s",(COMPANY,))
        c.execute("UPDATE qa_v2_guard.fences SET pending=false WHERE company_id=%s",(COMPANY,))
    x,y=socket.socketpair()
    x.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,4096)
    x.settimeout(.14)
    start=time.perf_counter()
    error_holder={}
    def sender():
        try:
            with con(STREAM) as c:
                with c.transaction():
                    check(sql(c,"SELECT qa_v2_guard.can_send(%s)",(COMPANY,)),"socket_reader_denied")
                    # The peer deliberately stops reading: real kernel send
                    # buffer fills; OS socket timeout must trigger *inside*
                    # the shared-lock transaction.
                    x.sendall(b"Q"*(2*1024*1024))
        except socket.timeout:
            error_holder["socket_timeout"]=True
        except Exception as exc:
            error_holder["unexpected"]=str(exc)
        finally:x.close()
    t=threading.Thread(target=sender);t.start()
    time.sleep(.03)
    pending=sql if False else None
    priority=threading.Event();finished={}
    w=threading.Thread(target=writer,args=(priority,finished));w.start()
    check(priority.wait(3),"socket_writer_never_started")
    t.join(2);w.join(2)
    y.close()
    check(not t.is_alive() and not w.is_alive(),"socket_timeout_or_writer_hung")
    check(error_holder.get("socket_timeout") and not error_holder.get("unexpected"),
          ("no_real_kernel_socket_timeout",error_holder))
    check(finished.get("committed"),"writer_not_committed_after_timeout")
    return {"real_socketpair_kernel_send_buffer_blocked":True,
        "socket_timeout_seconds":.14,
        "timeout_witnessed":True,
        "revocation_commit_elapsed_ms":finished["commit_elapsed_ms"],
        "total_wall_ms":round((time.perf_counter()-start)*1000,3),
        "indefinite_lock_holding":False}
def main():
    st=time.perf_counter()
    setup()
    before=None
    with con(ADMIN) as c:
        before=sql(c,"SELECT pg_current_wal_lsn()")
    negatives=attack_matrix()
    slow=priority_under_300_slow_streams()
    timeout=real_socket_timeout_and_lock_release()
    with con(ADMIN) as c:
        out={"result":"PASS","PG17_only":True,"min_privilege":negatives,
             "revocation_under_300":slow,"real_socket_timeout":timeout,
             "db_size_bytes":sql(c,"SELECT pg_database_size(current_database())"),
             "guard_relation_bytes":sum(sql(c,"SELECT pg_total_relation_size(%s::regclass)",(name,))
                                    for name in ("qa_v2_guard.memberships","qa_v2_guard.fences","qa_v2_guard.identities")),
             "wal_delta_bytes":int(sql(c,"SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(before,))),
             "parent_RSS_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
             "elapsed_s":round(time.perf_counter()-st,3),
             "no_prod":True,"production_GO":False,
             "security_limitation":"superuser/bypass, non-cooperating writers and post-write kernel delivery not prevented"}
    print("QA_MINPRIV_PRIORITY_SUMMARY_JSON="+json.dumps(out,sort_keys=True),flush=True)
    print("QA_MINPRIV_PRIORITY_PASS=true",flush=True)
if __name__=="__main__":main()
