"""PG17 disposable test: two OS subprocesses, each serves proxy+origin HTTP.

No hidden retries, real SIGKILL only against self-spawned process, read-only
metrics from separate process pools, all SQL state is synthetic PG17.
"""
from __future__ import annotations
import concurrent.futures,gzip,hashlib,http.client,json,os,resource,signal,socket,subprocess,sys,threading,time
from collections import Counter
from pathlib import Path
from urllib import request,error
import psycopg

N=300
POOL=int(os.environ["QA_POOL"]);CHUNK=int(os.environ["QA_CHUNK"])
assert POOL in (8,12,20) and CHUNK in (65536,262144)
assert os.getenv("QA_STREAM_GUARD_GROUP","1")=="1"
assert os.getenv("GITHUB_REF")=="refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031"
for key in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE"):
    assert not os.getenv(key),("official_endpoint_refused",key)
KW=dict(host="127.0.0.1",port=5432,dbname="vision_v2_quarantine_disposable",
        user="postgres",password="qa-only-local-password",connect_timeout=3)
LOCK_USER=63918941;LOCK_GATE=63918942
def check(pred,label):assert pred,label
def con():return psycopg.connect(**KW)
def pct(values,p):
    z=sorted(values);v=(len(z)-1)*p;lo=int(v);hi=min(lo+1,len(z)-1)
    return round(z[lo]*(hi-v)+z[hi]*(v-lo),3)
def prepare():
    with con() as db:
        check(170000<=int(db.execute("SHOW server_version_num").fetchone()[0])<180000,"not_postgres17")
        db.execute("CREATE ROLE qa_mproc_reader NOLOGIN")
        db.execute("CREATE TABLE qa_mproc_membership(tenant text PRIMARY KEY,allowed boolean NOT NULL)")
        db.execute("INSERT INTO qa_mproc_membership VALUES('synthetic',true)")
        db.execute("ALTER TABLE qa_mproc_membership ENABLE ROW LEVEL SECURITY")
        db.execute("ALTER TABLE qa_mproc_membership FORCE ROW LEVEL SECURITY")
        db.execute("CREATE POLICY member ON qa_mproc_membership FOR SELECT TO qa_mproc_reader USING(tenant=current_setting('qa.tenant',true) AND allowed)")
        db.execute("GRANT USAGE ON SCHEMA public TO qa_mproc_reader")
        db.execute("GRANT SELECT ON qa_mproc_membership TO qa_mproc_reader")
        db.execute("CREATE TABLE qa_mproc_gate(id int PRIMARY KEY,enabled boolean NOT NULL,epoch bigint NOT NULL)")
        db.execute("INSERT INTO qa_mproc_gate VALUES(1,true,1)")
        db.execute("GRANT SELECT ON qa_mproc_gate TO qa_mproc_reader")
        db.execute("REVOKE UPDATE,INSERT,DELETE ON qa_mproc_gate,qa_mproc_membership FROM qa_mproc_reader")
        return db.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
def write_member(allowed):
    with con() as db:
        with db.transaction():
            db.execute("SELECT pg_advisory_xact_lock(%s)",(LOCK_USER,))
            db.execute("UPDATE qa_mproc_membership SET allowed=%s WHERE tenant='synthetic'",(allowed,))
def write_gate(enabled):
    with con() as db:
        with db.transaction():
            db.execute("SELECT pg_advisory_xact_lock(%s)",(LOCK_GATE,))
            db.execute("UPDATE qa_mproc_gate SET enabled=%s,epoch=epoch+1 WHERE id=1",(enabled,))
            return db.execute("SELECT epoch FROM qa_mproc_gate WHERE id=1").fetchone()[0]
def current_gate():
    with con() as db:return db.execute("SELECT enabled,epoch FROM qa_mproc_gate WHERE id=1").fetchone()
def negative_rls():
    with con() as db:
        flags=db.execute("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='qa_mproc_membership'::regclass").fetchone()
        check(flags==(True,True),"RLS_not_FORCED")
        role=db.execute("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='qa_mproc_reader'").fetchone()
        check(role==(False,False),"reader_bypassrls")
        with db.transaction():
            db.execute("SET LOCAL ROLE qa_mproc_reader")
            db.execute("SELECT set_config('qa.tenant','other',true)")
            check(db.execute("SELECT tenant FROM qa_mproc_membership").fetchall()==[],"cross_tenant_data_exposed")
            db.execute("SELECT set_config('qa.tenant','synthetic',true)")
            check(len(db.execute("SELECT tenant FROM qa_mproc_membership").fetchall())==1,"allowed_tenant_hidden")
    denied=False
    try:
        with con() as db:
            with db.transaction():
                db.execute("SET LOCAL ROLE qa_mproc_reader")
                db.execute("SELECT set_config('qa.tenant','synthetic',true)")
                db.execute("SET LOCAL row_security=off")
                db.execute("SELECT tenant FROM qa_mproc_membership").fetchall()
    except psycopg.Error:denied=True
    check(denied,"RLS_disabled_successfully")
    denied=False
    try:
        with con() as db:
            with db.transaction():
                db.execute("SET LOCAL ROLE qa_mproc_reader")
                db.execute("UPDATE qa_mproc_membership SET allowed=false")
    except psycopg.Error:denied=True
    check(denied,"reader_updated_membership")
    return True

class Child:
    def __init__(self,ident):
        env=os.environ.copy()
        env.update(QA_WORKER_ID=str(ident),QA_PROCESS_POOL=str(POOL//2),QA_CHUNK=str(CHUNK),
                   QA_WORKER_WALL_SKEW_SEC=str(-86400 if ident==0 else 86400),
                   QA_STREAM_GUARD_GROUP="1")
        self.p=subprocess.Popen([sys.executable,"-u",str(Path(__file__).with_name("worker.py"))],
                                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                                text=True,bufsize=1,env=env)
        line=self.p.stdout.readline()
        check(bool(line),("child_startup_failure",ident,self.p.poll()))
        self.info=json.loads(line)
        check(self.info["type"]=="READY" and self.info["worker"]==str(ident),"wrong_child_ready")
        self.ident=ident
        self.pids={self.info["pid"]}
    def command(self,kind,**kw):
        check(self.p.poll() is None,("child_dead",self.ident,kind))
        self.p.stdin.write(json.dumps({"cmd":kind,**kw})+"\n");self.p.stdin.flush()
        line=self.p.stdout.readline()
        check(bool(line),("no_child_response",self.ident,kind,self.p.poll()))
        result=json.loads(line)
        check(result["type"] in ("ACK","STATS"),("unexpected_child_response",result))
        return result
    def kill(self):
        if self.p.poll() is None:self.p.send_signal(signal.SIGKILL)
        self.p.wait(timeout=8)
        check(self.p.returncode in (-signal.SIGKILL,128+signal.SIGKILL),
              ("unexpected_sigkill_status",self.p.returncode))
    def close(self):
        if self.p.poll() is None:
            try:self.command("stop")
            except Exception:pass
            try:self.p.wait(timeout=6)
            except subprocess.TimeoutExpired:self.kill()
        for file in (self.p.stdin,self.p.stdout,self.p.stderr):
            try:file.close()
            except OSError:pass

ledger=[];ledger_mu=threading.Lock()
def get(port,path="/normal",token="valid-test-token",allow_transport_error=False):
    st=time.perf_counter()
    req=request.Request("http://127.0.0.1:"+str(port)+path,
                        headers={"X-QA-Token":token,"Accept-Encoding":"gzip"})
    try:
        with request.urlopen(req,timeout=12) as response:
            body=response.read();status=response.status;headers=response.headers
    except error.HTTPError as ex:
        body=ex.read();status=ex.code;headers=ex.headers
    except (ConnectionResetError,http.client.RemoteDisconnected,http.client.IncompleteRead,
            TimeoutError,socket.timeout,ConnectionError,OSError) as ex:
        if not allow_transport_error:raise
        body=b"";status="transport_abort";headers={}
    cause=headers.get("X-QA-Cause","transport_abort")
    entry=dict(port=port,path=path,status=status,cause=cause,body_bytes=len(body),
               discarded_upstream=int(headers.get("X-QA-Upstream-Discarded","0")),
               duration_ms=round((time.perf_counter()-st)*1000,3),attempts=1,retried=False)
    if status==200:
        raw=gzip.decompress(body)
        check(hashlib.sha256(raw).hexdigest()==headers["X-QA-SHA256"],"HTTP200_SHA_false")
        obj=json.loads(raw)
        check(len(obj["original_full_report"]["export"])==10000,"HTTP200_original_report_partial")
    else:check(not body,("bad_failure_body",entry))
    with ledger_mu:
        entry["ledger_id"]=len(ledger)+1
        ledger.append(entry)
    return entry
def expect(port,path,status,cause=None):
    a=get(port,path)
    check(a["status"]==status and (cause is None or a["cause"]==cause),("unexpected_status",a))
    return a
def await_first(child):
    cutoff=time.monotonic()+6
    while time.monotonic()<cutoff:
        snap=child.command("stats")
        if snap["metrics"].get("written",0)>0:return snap
        time.sleep(.003)
    raise AssertionError("first_chunk_not_written")
def main():
    start=time.perf_counter()
    wal0=prepare();check(negative_rls(),"RLS_negative_failed")
    w=[];signaled=False
    try:
        w=[Child(0),Child(1)]
        check(w[0].info["pid"]!=w[1].info["pid"],"not_distinct_OS_process")
        check([ch.info["wall_skew_seconds"] for ch in w]==[-86400,86400],
              "per_process_clock_skew_not_applied")
        clocks=[ch.command("deadline") for ch in w]
        check(all(x["expired"] and x["overdue_ms"]>=20 for x in clocks),
              ("monotonic_deadline_failed_under_wall_skew",clocks))
        check(w[0].info["report_sha"]==w[1].info["report_sha"],"different_report_hash")
        report_size=w[0].info["report_gzip_bytes"]
        check(report_size>262144,"fixture_too_small")
        for ch in w:
            snap=ch.command("stats")
            check(snap["proxy_pool"]["capacity"]+snap["origin_pool"]["capacity"]==POOL//2,
                  "per_process_SQL_overallocation")
        # Both proxy+origin are separate actual OS processes.
        with concurrent.futures.ThreadPoolExecutor(max_workers=65) as pool:
            wave=list(pool.map(lambda i:get(w[i%2].info["proxy"]),range(N)))
        check(len(wave)==N and all(z["status"]==200 and z["body_bytes"]==report_size for z in wave),
              "300_valid_original_reports")
        # NEGATIVE PROOF: route is still chosen AFTER the PG gate guard
        # transaction exits. Close gate and rebind after the old shared
        # lock is RELEASED but before TCP connect. Expected real 200 is
        # a TOCTOU safety FAILURE, never a promotion criterion.
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            raced_fut=pool.submit(get,w[0].info["proxy"],"/pause_after_gate")
            tlim=time.monotonic()+6
            while time.monotonic()<tlim:
                snap=w[0].command("stats")
                if snap["metrics"].get("gate_toctou_ready",0)>0:break
                time.sleep(.004)
            check(snap["metrics"].get("gate_toctou_ready",0)>0,"TOCTOU_barrier_not_reached")
            check(not raced_fut.done(),"TOCTOU_was_not_actually_paused")
            closed_epoch=write_gate(False)
            check(current_gate()==(False,closed_epoch),"gate_did_not_commit_closed")
            w[0].command("switch",port=w[1].info["origin"])
            w[0].command("resume-admission")
            raced=raced_fut.result(timeout=12)
        check(raced["status"]==200 and raced["cause"]=="ok",
              ("TOCTOU_expected_counterexample_not_reproduced",raced))
        check(current_gate()==(False,closed_epoch),"gate_reopened_without_commit")
        # Restore the test fixture state before other independent probes.
        w[0].command("switch",port=w[0].info["origin"])
        write_gate(True)
        for ch in w:
            port=ch.info["proxy"]
            expect(port,"/rst",503,"reset")
            expect(port,"/halfopen",503,"timeout")
            expect(port,"/fin",503,"incomplete")
        # Existing stale gate cannot be used by either process after PG COMMIT.
        old_epoch=current_gate()[1];epoch=write_gate(False)
        check(epoch>old_epoch,"gate_epoch_not_monotonic")
        for ch in w:expect(ch.info["proxy"],"/normal",503,"gate_closed")
        write_member(False)
        write_gate(True)
        for ch in w:expect(ch.info["proxy"],"/normal",401)
        write_member(True)
        for ch in w:expect(ch.info["proxy"],"/normal",200,"ok")
        # Freeze first old body chunk. Use real PostgreSQL transactions to
        # COMMIT revocation and cutover concurrently, not client clock.
        # The proxy will buffer upstream until complete, never emit truncated 200.
        baseline_written=w[0].command("stats")["metrics"].get("written",0)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as threads:
            future=threads.submit(get,w[0].info["proxy"],"/hold")
            cutoff=time.monotonic()+5
            while time.monotonic()<cutoff:
                m=w[0].command("stats")["metrics"]
                if m.get("written",0)>=baseline_written+CHUNK:break
                time.sleep(.003)
            check(m.get("written",0)>=baseline_written+CHUNK,
                  "old_stream_first_block_not_written")
            check(not future.done(),"hold_request_not_pending")
            barrier=threading.Barrier(3);results={}
            def mutate(kind):
                barrier.wait(timeout=5)
                t=time.perf_counter()
                if kind=="revoke":write_member(False)
                else:
                    results["gate_epoch"]=write_gate(False)
                    w[0].command("switch",port=w[1].info["origin"])
                    w[1].command("switch",port=w[1].info["origin"])
                results[kind+"_ms"]=round((time.perf_counter()-t)*1000,3)
            a=threading.Thread(target=mutate,args=("revoke",),daemon=True)
            b=threading.Thread(target=mutate,args=("switch",),daemon=True)
            a.start();b.start();barrier.wait(timeout=5)
            a.join(8);b.join(8)
            check(not a.is_alive() and not b.is_alive() and "revoke_ms" in results and "switch_ms" in results,
                  "gate_and_revoke_race_not_completed")
            written_before=w[0].command("stats")["metrics"]["written"]
            write_gate(True)
            for ch in w:expect(ch.info["proxy"],"/normal",401)
            w[0].command("release")
            incomplete=future.result(timeout=14)
            check(incomplete["status"]==503 and incomplete["cause"]=="incomplete",
                  ("old_truncated_200_not_failclosed",incomplete))
            written_after=w[0].command("stats")["metrics"]["written"]
            check(written_after==written_before,"new_application_bytes_after_revocation_commit")
        write_member(True)
        for ch in w:expect(ch.info["proxy"],"/normal",200,"ok")
        # Crash the origin0 process during another stream, proxy1 survives.
        # First route proxy1 to origin0, and old origin0 hold event has
        # already been released. SIGKILL on an active HTTP /halfopen uses
        # the in-flight socket, never retrying the returned 503.
        w[1].command("switch",port=w[0].info["origin"])
        baseline_kill_bytes=w[0].command("stats")["metrics"].get("written",0)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            victim=pool.submit(get,w[1].info["proxy"],"/halfopen")
            cut=time.monotonic()+.12
            while time.monotonic()<cut:
                have=w[0].command("stats")["metrics"].get("written",0)-baseline_kill_bytes
                if have>=7000:break
                time.sleep(.002)
            check(have>=7000,("SIGKILL_not_inflight_after_7000_prebuffered",have))
            # Capture BOTH live process counters immediately before SIGKILL:
            # parent baseline cannot query its victim AFTER death.
            prekill_samples=[ch.command("stats") for ch in w]
            check(prekill_samples[0]["proc_pid"]==w[0].info["pid"],"victim_checkpoint_wrong_pid")
            check(prekill_samples[0]["metrics"]["written"]-baseline_kill_bytes>=7000,
                  "prekill_sample_missing_TCP_bytes")
            w[0].kill();signaled=True
            aborted=victim.result(timeout=15)
            check(aborted["status"]==503 and aborted["cause"] in ("reset","timeout","incomplete"),
                  ("sigkill_stream_accepted",aborted))
        # Stale authorization must not survive crashed owner's restart.
        revoked_epoch=write_gate(False)
        write_member(False)
        expect(w[1].info["proxy"],"/normal",503,"gate_closed")
        w[0].close()
        restart=Child(0)
        w[0]=restart
        check(restart.info["pid"]!=w[1].info["pid"],"restart_process_collision")
        expect(restart.info["proxy"],"/normal",503,"gate_closed")
        check(current_gate()==(False,revoked_epoch),"stale_gate_epoch_reversed")
        write_gate(True)
        # A still-stale route to the SIGKILLed origin fails CLOSED with
        # 503, not 401: no reachable upstream exists to evaluate a token.
        stale=get(w[1].info["proxy"],"/normal")
        check(stale["status"]==503 and stale["cause"] in ("reset","timeout"),
              ("unavailable_stale_route_wrongly_accepted",stale))
        # Rebind the surviving proxy to the freshly restarted origin before
        # asserting definitive member revocation 401.
        w[1].command("switch",port=restart.info["origin"])
        for ch in w:expect(ch.info["proxy"],"/normal",401)
        write_member(True)
        for ch in w:expect(ch.info["proxy"],"/normal",200,"ok")
        checks=[ch.command("stats") for ch in w]
        active=sum(s["proxy_pool"]["active"]+s["origin_pool"]["active"] for s in checks)
        check(active==0,"connection_leak_after_SIGKILL_recovery")
        check(len({pid for s in checks for part in ("proxy_pool","origin_pool")
                   for pid in s[part]["pids"]})==POOL,"SQL_pool_PID_isolation_failed")
        check(all(z["attempts"]==1 and not z["retried"] for z in ledger),"client_auto_retry_found")
        check({z["ledger_id"] for z in ledger}==set(range(1,len(ledger)+1)),
              "ledger_not_contiguous")
        check(sum(z["body_bytes"] for z in wave)==N*report_size,"original_egress_incomplete")
        # Exact instrumented counter across each observed process lifetime:
        # old victim (last snapshot), surviving child (final snapshot),
        # restarted victim (final snapshot). All processes on one runner.
        checkpointed_guards=prekill_samples[0]["sql_guard_count"]+checks[0]["sql_guard_count"]+checks[1]["sql_guard_count"]
        check(checkpointed_guards>=sum(x["sql_guard_count"] for x in checks),
              "checkpointed_total_guard_count_regressed")
        check(prekill_samples[0]["proc_pid"]!=checks[0]["proc_pid"],"victim_not_restarted")
        # Compare pre-SIGKILL victim measurement to the recovered process
        # rather than reporting replacement RSS as the original's peak.
        all_lifetimes=[prekill_samples[0],checks[0],checks[1]]
        check(len({v["proc_pid"] for v in all_lifetimes})==3,"missing_process_lifetime")
        with con() as db:
            dbbytes,indexbytes,wal=db.execute("""SELECT
              pg_database_size(current_database()),
              pg_indexes_size('qa_mproc_membership'),
              pg_wal_lsn_diff(pg_current_wal_lsn(),%s)""",(wal0,)).fetchone()
        summary=dict(status="PASS",pool_total=POOL,chunk_bytes=CHUNK,
            clients=N,OS_processes_independent=2,servers_each_process=2,
            GETs_all_attempts=len(ledger),
            GETs_200_complete=sum(z["status"]==200 for z in ledger),
            GETs_401=sum(z["status"]==401 for z in ledger),
            GETs_503=sum(z["status"]==503 for z in ledger),
            GETs_transport_abort=sum(z["status"]=="transport_abort" for z in ledger),
            HTTP_200_verified_SHA256_and_10000=True,
            SHA256=w[0].info["report_sha"],
            gzip_report_bytes=report_size,
            P95_normal_ms=pct([z["duration_ms"] for z in wave],.95),
            P99_normal_ms=pct([z["duration_ms"] for z in wave],.99),
            bytes_client_bodies=sum(z["body_bytes"] for z in ledger),
            bytes_upstream_discarded=sum(z["discarded_upstream"] for z in ledger),
            TOCTOU_gate_closed_but_HTTP200=raced["status"]==200,
            TOCTOU_counterexample_status="FAIL_REPRODUCED",
            TOCTOU_gate_closed_epoch=closed_epoch,
            TOCTOU_cross_process_new_route=True,
            security_verdict="FAIL_NO_GO",
            ived_raw_gets=300,process_SIGKILL_real=signaled,
            restart_correct_authorization=True,
            stale_gate_rejected=True,monotonic_gate_epoch=revoked_epoch,
            independent_worker_wall_skews_seconds=[-86400,86400],
            monotonic_deadline_under_clock_skew=clocks,
            pre_SIGKILL_upstream_application_bytes=have,
            post_SIGKILL_upstream_bytes_in_proxy_ledger=aborted["discarded_upstream"],
            revoke_cutover_race=results,new_writes_after_revoke_commit=0,
            FIN_RST_halfopen_real=True,all_401_and_truncated_200_no_retry=True,
            SQL_guard_calls=checkpointed_guards,
            SQL_guard_calls_living_only=sum(s["sql_guard_count"] for s in checks),
            SQL_guard_calls_victim_pre_SIGKILL=prekill_samples[0]["sql_guard_count"],
            SQL_measurement_limitation="instrumented guards only; final victim 7KB snapshot before SIGKILL; not all SQL statements",
            process_lifetime_checkpoints=[{"pid":v["proc_pid"],
                "worker":v["worker"],"guards":v["sql_guard_count"],
                "RSS_KiB":v["rss_kib"],"bytes_written":v["metrics"].get("written",0),
                "proxy_GETs":v["metrics"].get("proxy_gets",0),
                "upstream_GETs":v["metrics"].get("origin_gets",0)}
                for v in all_lifetimes],
            SQL_pool_pids=[s[part]["pids"] for s in checks for part in ("proxy_pool","origin_pool")],
            WAL_after_fixture_bytes=int(wal),
            db_bytes=dbbytes,index_bytes=indexbytes,
            worker_RSS_KiB=[s["rss_kib"] for s in checks],
            victim_pre_SIGKILL_RSS_KiB=prekill_samples[0]["rss_kib"],
            max_observed_worker_RSS_KiB=max(v["rss_kib"] for v in all_lifetimes),
            controller_RSS_KiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            SQL_all_statements_measured=False,real_two_hosts=False,
            TCP_bytes_prebuffered_not_recallable=True,
            real_supabase_cost_R_measured=False,production_GO=False,
            elapsed_seconds=round(time.perf_counter()-start,3))
        Path("qa-mproc-ledger.json").write_text(json.dumps(dict(summary=summary,attempts=ledger),sort_keys=True))
        print("QA_MP_REAL_PROCESS_JSON="+json.dumps(summary,sort_keys=True),flush=True)
        print("QA_MP_REAL_PROCESS_PASS=true",flush=True)
    finally:
        for ch in w:
            if ch:ch.close()
if __name__=="__main__":main()
