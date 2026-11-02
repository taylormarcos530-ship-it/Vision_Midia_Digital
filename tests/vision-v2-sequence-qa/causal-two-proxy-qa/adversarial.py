"""Independent adversarial PG17 review of causal.py (synthetic only).

Checks policy FORCE RLS, role privilege failures, physically separate SQL
pools with limited aggregate capacity, actual TCP reset and half-open,
delay relative to monotonic clock, and coordinated two-proxy gate+revocation
while a previously admitted HTTP 200 body is midstream. No client retries.
No real services, no deployment, no Supabase, no real player/TV/report.
"""
from __future__ import annotations
import importlib.util,json,os,resource,threading,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import psycopg
spec=importlib.util.spec_from_file_location("causal_fixture_qa",Path(__file__).parent.parent/"causal-two-proxy-qa"/"causal.py")
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
assert c.POOL in (8,12,20) and c.CHUNK in (65536,262144)
def ck(ok,msg):assert ok,msg
def policy_negative_proof():
    with c.pg() as db:
        policy=db.execute("""SELECT relrowsecurity,relforcerowsecurity
            FROM pg_class WHERE oid='qa_causal_membership'::regclass""").fetchone()
        role=db.execute("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname='qa_causal_reader'").fetchone()
    ck(policy==(True,True),("FORCE_RLS_not_installed",policy))
    ck(role==(False,False),("reader_role_bypasses_policy",role))
    with c.pg() as db:
        with db.transaction():
            db.execute("SET LOCAL ROLE qa_causal_reader")
            ck(db.execute("SELECT current_user").fetchone()[0]=="qa_causal_reader","role_not_applied")
            db.execute("SELECT set_config('qa.tenant','wrong-tenant',true)")
            ck(db.execute("SELECT tenant FROM qa_causal_membership").fetchall()==[],"cross_tenant_visible")
            db.execute("SELECT set_config('qa.tenant','synthetic-tenant',true)")
            ck(len(db.execute("SELECT tenant FROM qa_causal_membership").fetchall())==1,"valid_tenant_denied")
    rls_off_blocked=False
    try:
        with c.pg() as db:
            with db.transaction():
                db.execute("SET LOCAL ROLE qa_causal_reader")
                db.execute("SELECT set_config('qa.tenant','synthetic-tenant',true)")
                db.execute("SET LOCAL row_security=off")
                db.execute("SELECT tenant FROM qa_causal_membership").fetchall()
    except psycopg.Error:
        rls_off_blocked=True
    ck(rls_off_blocked,"RLS_off_selected_protected_data")
    dml_blocked=False
    try:
        with c.pg() as db:
            with db.transaction():
                db.execute("SET LOCAL ROLE qa_causal_reader")
                db.execute("UPDATE qa_causal_membership SET permitted=false")
    except psycopg.Error:
        dml_blocked=True
    ck(dml_blocked,"reader_has_DML_privilege")
    with c.pg() as db:
        ck(db.execute("SELECT permitted FROM qa_causal_membership WHERE tenant='synthetic-tenant'").fetchone()[0],"reader_modified_membership")
    return {"FORCE_RLS":True,"NO_BYPASSRLS":True,"wrong_tenant_zero_rows":True,
            "row_security_off_blocked":True,"role_DML_denied":True}
def timing_barriers():
    # Deliberate wall-clock offsets; do NOT change runner system clock.
    # Only monotonic deadlines make scheduling lag non-extendable.
    results=[]
    for offset in (-86400000,86400000):
        wall_simulated_ms=int(time.time()*1000)+offset
        start=time.monotonic()
        cutoff=start+.025
        time.sleep(.055)
        passed=time.monotonic()
        ck(passed>cutoff and passed-start>=.025,"missed_monotonic_deadline")
        results.append({"wall_clock_offset_ms":offset,
          "simulated_wall_clock_ms":wall_simulated_ms,
          "deadline_exceeded_ms":round((passed-cutoff)*1000,3),
          "expired_request_rejected":True})
    return results
def start_servers():
    upstream,thread=c.start(c.Upstream)
    upstream.first_block=threading.Event()
    upstream.release_block=threading.Event()
    proxies=[c.start(c.Proxy),c.start(c.Proxy)]
    for i,(server,_) in enumerate(proxies):
        server.upstream="http://127.0.0.1:"+str(upstream.server_address[1])
        server.sql_pool=c.PROXY_SQL[i]
    return upstream,thread,proxies
def main():
    initial=time.perf_counter()
    wal0=c.fixture()
    policy=policy_negative_proof()
    clocks=timing_barriers()
    upstream,ut,proxies=start_servers()
    try:
        ps=[p.stats() for p in c.ALL_SQL_POOLS]
        ck(len(ps)==3 and ps[0]["name"]=="origin" and ps[1]["name"]=="proxy_0" and ps[2]["name"]=="proxy_1","pools_share_identity")
        ck(sum(x["created"] for x in ps)==c.POOL,"pg_connection_budget_broken")
        ck(len({pid for x in ps for pid in x["backend_pids"]})==c.POOL,"connection_shared_across_proxy")
        with ThreadPoolExecutor(max_workers=60) as pool:
            responses=list(pool.map(lambda i:c.get(proxies[i%2][0],"/normal"),range(c.N)))
        ck(len(responses)==300 and all(x["status"]==200 for x in responses),"300_good_responses")
        # Real loopback sockets: RST before headers, and partial 200 then
        # no further bytes until socket read deadline (half-open).
        for node,_ in proxies:
            c.expect(node,"/reset",503,"upstream_reset")
            c.expect(node,"/halfopen",503,"upstream_timeout")
        # Deterministic simultaneous gate-close and user revocation, WHILE
        # an admitted HTTP 200 has already written one protected chunk.
        with ThreadPoolExecutor(max_workers=1) as workers:
            old=workers.submit(c.get,proxies[0][0],"/hold")
            ck(upstream.first_block.wait(8),"stream_not_at_first_chunk")
            gate=threading.Barrier(3);results={}
            def mutation(kind):
                gate.wait(timeout=5)
                started=time.perf_counter()
                if kind=="gate":c.update_gate(False)
                else:c.update_member(False)
                results[kind]=round((time.perf_counter()-started)*1000,3)
            a=threading.Thread(target=mutation,args=("gate",),daemon=True)
            b=threading.Thread(target=mutation,args=("revoke",),daemon=True)
            a.start();b.start();gate.wait(timeout=5)
            a.join(5);b.join(5)
            ck(not a.is_alive() and not b.is_alive() and len(results)==2,
               "concurrent_cutover_revocation_did_not_commit")
            bytes_at_commit=c.MET.snapshot().get("upstream_body_written",0)
            # Both route instances must observe shared PG gate before
            # consulting the upstream membership policy.
            for node,_ in proxies:c.expect(node,"/normal",503,"proxy_gate")
            c.update_gate(True)
            for node,_ in proxies:c.expect(node,"/normal",401,"revoked_401")
            upstream.release_block.set()
            interrupted=old.result(timeout=10)
            ck(interrupted["status"]==503 and interrupted["cause"]=="upstream_incomplete",
               ("obsolete_200_incorrectly_completed",interrupted))
            ck(c.MET.snapshot().get("upstream_body_written",0)==bytes_at_commit,
               "new_application_writes_after_revoke_commit")
        c.update_member(True)
        for node,_ in proxies:c.expect(node,"/normal",200,"ok")
        # Every logical get() is exactly one physical GET; no retry even
        # with network failures, 401, 200 truncate, or wall-clock jumps.
        ledger=c.LEDGER
        ck(len(ledger)==311,("expected_311_explicit_attempts",len(ledger)))
        ck([x["ledger_id"] for x in ledger]==list(range(1,312)),"ledger_not_contiguous")
        ck(all(x["attempt"]==1 and not x["retried"] for x in ledger),"retry_detected")
        snapshot=c.MET.snapshot()
        ck(snapshot.get("proxy_attempts")==len(ledger),"GET_count_wrong")
        ck(snapshot.get("upstream_attempts")==len(ledger)-snapshot.get("proxy_gate",0)-snapshot.get("proxy_local",0),"upstream_GET_wrong")
        ck(snapshot.get("upstream_reset")==2 and snapshot.get("upstream_timeout")==2 and snapshot.get("upstream_incomplete")==1,
           ("exception_classification_wrong",snapshot))
        ck(snapshot.get("aborted_after_revoke")==1,"revocation_authorization_not_checked_per_chunk")
        ck(snapshot.get("upstream_body_written",0)>0,"no_real_socket_bytes_written")
        ck(sum(x["upstream_discarded_bytes"] for x in ledger)==snapshot.get("discarded_upstream_partial_bytes",0),"incomplete_byte_ledger")
        # Two real half-open sockets each emitted 7000 bytes before timing
        # out. The revoked midstream 200 wrote one full CHUNK. All three
        # discarded partials must be in their own GET ledger records.
        ck(snapshot.get("discarded_upstream_partial_bytes",0)==c.CHUNK+14000,
           ("halfopen_or_revoke_partial_bytes_lost",snapshot.get("discarded_upstream_partial_bytes",0),c.CHUNK))
        ck(sum(x["upstream_discarded_bytes"]==7000 for x in ledger if x["cause"]=="upstream_timeout")==2,
           "per_request_halfopen_bytes_not_recorded")
        ck(all(x["body_bytes"]==0 for x in ledger if x["status"]!=200),"incomplete_200_accepted")
        ck(all(x["body_bytes"]==len(c.WIRE) for x in ledger if x["status"]==200),"complete_200_miscounted")
        ck(all(x["upstream_discarded_bytes"]==0 for x in ledger if x["status"]==200),"complete_body_misclassified")
        ck(len({x["proxy"] for x in responses})==2,"not_both_proxy_instances")
        capacities=[p.stats() for p in c.ALL_SQL_POOLS]
        ck(all(z["peak"]<=z["created"] and z["active"]==0 for z in capacities),"pool_leak_or_capacity")
        with c.pg() as conn:
            db_bytes,index_bytes,wal=conn.execute("""SELECT
             pg_database_size(current_database()),
             pg_indexes_size('qa_causal_membership'),
             pg_wal_lsn_diff(pg_current_wal_lsn(),%s)""",(wal0,)).fetchone()
        payload={"result":"PASS","pool_total":c.POOL,"chunk_bytes":c.CHUNK,
         "SQL_pools":capacities,"FORCE_RLS_adversarial":policy,
         "late_clock_with_wall_skew":clocks,
         "two_proxy_simultaneous_gate_revoke_commit_ms":results,
         "actual_TCP_RST_probes":2,"actual_TCP_halfopen_probes":2,
         "app_bytes_after_revocation_commit":0,
         "GET_count":len(ledger),"GET_normal_complete":300,
         "GET_all_recorded_once":True,"HTTP_errors_no_body":True,
         "GET_attempts_by_cause":dict(sorted(__import__("collections").Counter(x["cause"] for x in ledger).items())),
         "GET_body_bytes":sum(x["body_bytes"] for x in ledger),
         "GET_partial_upstream_discarded_bytes":sum(x["upstream_discarded_bytes"] for x in ledger),
         "upstream_body_written_bytes":snapshot.get("upstream_body_written",0),
         "SQL_guards_instrumented":snapshot.get("proxy_gate_sql",0)+snapshot.get("membership_guards",0),
         "WAL_after_fixture_bytes":int(wal),"database_bytes":db_bytes,
         "membership_index_bytes":index_bytes,
         "RSS_Python_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
         "P95_normal_ms":c.pct([x["duration_ms"] for x in responses],.95),
         "P99_normal_ms":c.pct([x["duration_ms"] for x in responses],.99),
         "all_SQL_statements_measured":False,
         "actual_two_remote_hosts":False,"physical_420ms_limit_proven":False,
         "costs_R_measured":False,"prod_used":False,"production_GO":False,
         "elapsed_seconds":round(time.perf_counter()-initial,3)}
        Path("qa-independent-ledger.json").write_text(json.dumps({"summary":payload,"attempts":ledger},sort_keys=True))
        print("QA_INDEPENDENT_NEGATIVE_SUMMARY_JSON="+json.dumps(payload,sort_keys=True),flush=True)
        print("QA_INDEPENDENT_NEGATIVE_PASS=true",flush=True)
    finally:
        upstream.release_block.set()
        for server,t in proxies+[(upstream,ut)]:
            server.shutdown();server.server_close();t.join(4)
        for p in c.ALL_SQL_POOLS:p.close()
if __name__=="__main__":main()
