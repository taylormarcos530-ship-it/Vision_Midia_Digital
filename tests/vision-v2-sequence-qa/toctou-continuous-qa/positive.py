"""Isolated POSITIVE PG17 gate-continuity candidate, not production security approval.
Two independent OS worker processes and 100/300 real HTTP GETs. The historical
FAIL reproducer is deliberately retained in its original path, untouched.
"""
from __future__ import annotations
import concurrent.futures,gzip,hashlib,json,os,resource,signal,subprocess,sys,threading,time
from pathlib import Path
from urllib import request,error
import psycopg

BRANCH="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.environ.get("GITHUB_REF")==BRANCH,"test branch required"
assert os.environ.get("QA_STREAM_GUARD_GROUP")=="1","one-block guard required"
for k in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
    assert not os.environ.get(k),("official_credentials_forbidden",k)
N=int(os.environ["QA_TVS"]);POOL=int(os.environ["QA_POOL"]);CHUNK=int(os.environ["QA_CHUNK"])
assert N in (100,300) and POOL in (8,12) and CHUNK in (65536,262144)
KW=dict(host="127.0.0.1",port=5432,dbname="vision_v2_quarantine_disposable",
        user="postgres",password="qa-only-local-password",connect_timeout=3)
LOCK_GATE=63918942
def check(value,label):
    assert value,label
def con():
    return psycopg.connect(**KW)
def pct(xs,p):
    xs=sorted(xs);pos=(len(xs)-1)*p;lo=int(pos);hi=min(lo+1,len(xs)-1)
    return round(xs[lo]*(hi-pos)+xs[hi]*(pos-lo),3)
def setup():
    with con() as c:
        check(170000<=int(c.execute("SHOW server_version_num").fetchone()[0])<180000,"PG17 required")
        c.execute("CREATE ROLE qa_mproc_reader NOLOGIN")
        c.execute("CREATE TABLE qa_mproc_membership(tenant text PRIMARY KEY,allowed boolean NOT NULL)")
        c.execute("INSERT INTO qa_mproc_membership VALUES('synthetic',true)")
        c.execute("ALTER TABLE qa_mproc_membership ENABLE ROW LEVEL SECURITY")
        c.execute("ALTER TABLE qa_mproc_membership FORCE ROW LEVEL SECURITY")
        c.execute("CREATE POLICY member ON qa_mproc_membership FOR SELECT TO qa_mproc_reader USING(tenant=current_setting('qa.tenant',true) AND allowed)")
        c.execute("GRANT USAGE ON SCHEMA public TO qa_mproc_reader")
        c.execute("GRANT SELECT ON qa_mproc_membership TO qa_mproc_reader")
        c.execute("CREATE TABLE qa_mproc_gate(id int PRIMARY KEY,enabled boolean NOT NULL,epoch bigint NOT NULL)")
        c.execute("INSERT INTO qa_mproc_gate VALUES(1,true,1)")
        c.execute("GRANT SELECT ON qa_mproc_gate TO qa_mproc_reader")
        c.execute("REVOKE UPDATE,INSERT,DELETE ON qa_mproc_gate,qa_mproc_membership FROM qa_mproc_reader")
    with con() as c:
        with c.transaction():
            c.execute("SET LOCAL ROLE qa_mproc_reader")
            c.execute("SELECT set_config('qa.tenant','alien',true)")
            check(c.execute("SELECT count(*) FROM qa_mproc_membership").fetchone()[0]==0,"RLS cross tenant")
            c.execute("SELECT set_config('qa.tenant','synthetic',true)")
            check(c.execute("SELECT count(*) FROM qa_mproc_membership").fetchone()[0]==1,"RLS own tenant")
def write_gate(allowed):
    with con() as c:
        with c.transaction():
            c.execute("SELECT pg_advisory_xact_lock(%s)",(LOCK_GATE,))
            c.execute("UPDATE qa_mproc_gate SET enabled=%s, epoch=epoch+1 WHERE id=1",(allowed,))
            return c.execute("SELECT epoch FROM qa_mproc_gate WHERE id=1").fetchone()[0]
def write_member(allowed):
    with con() as c:
        with c.transaction():
            c.execute("SELECT pg_advisory_xact_lock(%s)",(63918941,))
            c.execute("UPDATE qa_mproc_membership SET allowed=%s WHERE tenant='synthetic'",(allowed,))
def gate():
    with con() as c:return c.execute("SELECT enabled,epoch FROM qa_mproc_gate WHERE id=1").fetchone()
def blocked_writer():
    with con() as c:
        return c.execute("""SELECT count(*) FROM pg_locks
            WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted""").fetchone()[0]>0
class Child:
    def __init__(self,identity):
        env=dict(os.environ)
        env.update(QA_WORKER_ID=str(identity),QA_PROCESS_POOL=str(POOL//2),QA_CHUNK=str(CHUNK),
                   QA_STREAM_GUARD_GROUP="1",QA_WORKER_WALL_SKEW_SEC=str(-86400 if identity==0 else 86400))
        self.proc=subprocess.Popen([sys.executable,"-u",str(Path(__file__).with_name("worker.py"))],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            encoding="utf-8",bufsize=1,env=env)
        line=self.proc.stdout.readline()
        check(bool(line),("worker init",identity,self.proc.poll()))
        self.info=json.loads(line)
        check(self.info["type"]=="READY","worker READY")
    def cmd(self,name,**args):
        check(self.proc.poll() is None,"worker exited")
        self.proc.stdin.write(json.dumps(dict(cmd=name,**args))+"\n");self.proc.stdin.flush()
        line=self.proc.stdout.readline()
        check(bool(line),"worker response missing")
        r=json.loads(line);check(r["type"] in ("ACK","STATS"),"invalid worker response")
        return r
    def stop(self):
        if self.proc.poll() is None:
            try:self.cmd("stop")
            except Exception:pass
            try:self.proc.wait(timeout=7)
            except subprocess.TimeoutExpired:
                self.proc.send_signal(signal.SIGKILL);self.proc.wait(timeout=6)
        for f in (self.proc.stdin,self.proc.stdout,self.proc.stderr):
            try:f.close()
            except OSError:pass
def get(port,path="/normal",token="valid-test-token"):
    st=time.perf_counter()
    req=request.Request("http://127.0.0.1:"+str(port)+path,
         headers={"X-QA-Token":token,"Accept-Encoding":"gzip"})
    try:
        with request.urlopen(req,timeout=14) as response:
            body=response.read();status=response.status;h=response.headers
    except error.HTTPError as exc:
        body=exc.read();status=exc.code;h=exc.headers
    cause=h.get("X-QA-Cause")
    if status==200:
        obj=json.loads(gzip.decompress(body))
        check(len(obj["original_full_report"]["export"])==10000,"original report altered")
        check(hashlib.sha256(gzip.decompress(body)).hexdigest()==h["X-QA-SHA256"],"SHA original report changed")
    else:check(body==b"","failure included payload")
    return dict(status=status,cause=cause,body_bytes=len(body),ms=(time.perf_counter()-st)*1000)
def expect(port,status,path="/normal",token="valid-test-token"):
    x=get(port,path,token)
    check(x["status"]==status,("unexpected response",status,x))
    return x
def main():
    start=time.monotonic();setup()
    workers=[]
    try:
        workers=[Child(0),Child(1)]
        check(workers[0].proc.pid!=workers[1].proc.pid,"workers share process")
        ports=[x.info["proxy"] for x in workers]
        check(all(x.cmd("stats")["proxy_pool"]["capacity"]+x.cmd("stats")["origin_pool"]["capacity"]==POOL//2 for x in workers),"pool limit")
        # Baseline uses actual sockets, SHA verified and source report untouched.
        with concurrent.futures.ThreadPoolExecutor(max_workers=36) as pool:
            normal=list(pool.map(lambda i:get(ports[i%2]),range(N)))
        check(all(x["status"]==200 for x in normal),("normal wave failure",N))
        check(all(x["body_bytes"]==workers[0].info["report_gzip_bytes"] for x in normal),"gzip damaged")
        expect(ports[0],401,token="wrong-token")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            raced_future=pool.submit(get,ports[0],"/pause_after_gate")
            deadline=time.monotonic()+7
            while time.monotonic()<deadline:
                ready=workers[0].cmd("stats")["metrics"].get("gate_toctou_ready",0)
                if ready:break
                time.sleep(.01)
            check(ready and not raced_future.done(),"no post-gate pause")
            # Writer starts while GET owns its shared advisory transaction lock.
            close_future=pool.submit(write_gate,False)
            deadline=time.monotonic()+7
            waited=False
            while time.monotonic()<deadline:
                if blocked_writer():waited=True;break
                check(not close_future.done(),"close committed during guard pause")
                time.sleep(.01)
            check(waited,"closing writer did not wait on PostgreSQL advisory lock")
            check(not close_future.done() and gate()[0] is True,"gate closed before guard release")
            # Change actual origin route on another worker WHILE close is blocked.
            workers[0].cmd("switch",port=workers[1].info["origin"])
            workers[0].cmd("resume-admission")
            raced=raced_future.result(timeout=14)
            check(raced["status"]==200 and raced["body_bytes"]>0,"pre-commit request failed")
            epoch=close_future.result(timeout=12)
        check(gate()==(False,epoch),"gate closing commit lost")
        for port in ports:expect(port,503)
        check(workers[1].cmd("stats")["metrics"].get("origin_gets",0)>0,"new origin not actually used")
        reopened=write_gate(True)
        check(reopened>epoch,"nonmonotone epoch")
        for port in ports:expect(port,200)
        write_member(False)
        for port in ports:expect(port,401)
        write_member(True)
        for port in ports:expect(port,200)
        snaps=[x.cmd("stats") for x in workers]
        check(all(x["proxy_pool"]["active"]==x["origin_pool"]["active"]==0 for x in snaps),"pool leak")
        with con() as c:
            db_bytes=c.execute("SELECT pg_database_size(current_database())").fetchone()[0]
            wal=c.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
        data=dict(test_status="PASS_LOCAL_CANDIDATE",security_verdict="LOCAL_GATE_TEST_ONLY_PRODUCTION_NO_GO",
             original_TOCTOU_FAIL_reproducer_untouched=True,production_GO=False,
             TVs=N,pool_total=POOL,chunk_bytes=CHUNK,processes=2,
             baseline_GETs_complete=N,verified_original_report_SHA256=workers[0].info["report_sha"],
             post_gate_pause_with_shared_xact_lock=True,exclusive_close_observed_waiting=True,
             route_changed_while_writer_blocked=True,pre_commit_HTTP200=raced["status"]==200,
             after_COMMIT_HTTP503_from_both_processes=True,
             tenant_RLS_checked=True,revocation_401_from_both_processes=True,
             P95_normal_ms=pct([x["ms"] for x in normal],.95),
             P99_normal_ms=pct([x["ms"] for x in normal],.99),
             baseline_payload_egress=sum(x["body_bytes"] for x in normal),
             WAL_end_lsn=str(wal),db_bytes=db_bytes,
             worker_rss_kib=[x["linux_proc_memory"]["VmRSS_KiB"] for x in snaps],
             SQL_guard_calls=sum(x["sql_guard_count"] for x in snaps),
             elapsed_seconds=round(time.monotonic()-start,3),
             known_risks=["revocation writer blocked by slow reader; no bound proven",
               "two processes are on one runner, not independent hosts",
               "TCP delivery can occur after HTTP application write",
               "Redis HA, failover, rollback and real APK authentication not tested"])
        Path("qa-v2-toctou-continuous-result.json").write_text(json.dumps(data,indent=2,sort_keys=True))
        print("QA_CONTINUOUS_GATE_JSON="+json.dumps(data,sort_keys=True),flush=True)
    finally:
        for worker in workers:worker.stop()
if __name__=="__main__":main()
