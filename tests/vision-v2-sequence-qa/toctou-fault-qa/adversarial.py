"""Independent NEGATIVE/positive controls for long-held PG17 advisory gate.
Expected security FAIL: bounded writer times out with gate still OPEN.
No production interfaces. Real raw TCP backpressure, FIN/RST/halfopen and SIGKILL.
Do not mistake exit code 0 (faithful defect reproduction) for safety PASS.
"""
from __future__ import annotations
import concurrent.futures,importlib.util,json,os,signal,socket,struct,time
from pathlib import Path
from urllib import error
import psycopg
from psycopg.errors import LockNotAvailable

parent=Path(__file__).resolve().parent.parent/"toctou-continuous-qa"/"positive.py"
spec=importlib.util.spec_from_file_location("isolated_positive_fixture",parent)
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
assert os.environ.get("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.environ.get("QA_STREAM_GUARD_GROUP")=="1"
for k in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
    assert not os.getenv(k),(k,"forbidden production environment")
def wait_metric(child,name,greater=0,seconds=5):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        v=child.cmd("stats")["metrics"].get(name,0)
        if v>greater:return v
        time.sleep(.008)
    raise AssertionError(("metric timeout",name,greater))
def wait_writer(seconds=4):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        if p.blocked_writer():return
        time.sleep(.008)
    raise AssertionError("writer never waited on real PG advisory lock")
def try_close(timeout_ms):
    start=time.monotonic()
    try:
        with p.con() as c:
            with c.transaction():
                c.execute("SET LOCAL lock_timeout=%s",(str(timeout_ms)+"ms",))
                c.execute("SELECT pg_advisory_xact_lock(%s)",(p.LOCK_GATE,))
                c.execute("UPDATE qa_mproc_gate SET enabled=false,epoch=epoch+1 WHERE id=1")
        return dict(committed=True,elapsed_ms=(time.monotonic()-start)*1000)
    except LockNotAvailable:
        return dict(committed=False,timeout=True,elapsed_ms=(time.monotonic()-start)*1000)
def reset_gate():
    epoch=p.write_gate(True)
    p.check(p.gate()==(True,epoch),"gate not reopened")
def abrupt_client(port):
    s=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,1024)
    s.settimeout(2)
    s.connect(("127.0.0.1",port))
    s.sendall(b"GET /slow_client HTTP/1.1\r\nHost: 127.0.0.1\r\nX-QA-Token: valid-test-token\r\nConnection: close\r\n\r\n")
    # Read headers once to confirm actual HTTP transmission, then STOP
    # reading application data. The server sends 128x compressed report.
    first=s.recv(1024)
    p.check(b"HTTP/1.1 200" in first,("no initial HTTP response",first[:80]))
    return s,len(first)
def abort_sock(s):
    try:s.setsockopt(socket.SOL_SOCKET,socket.SO_LINGER,struct.pack("ii",1,0))
    except OSError:pass
    s.close()
def main():
    p.setup();w=[p.Child(0),p.Child(1)]
    summary=dict(QA_expected_failure="FAIL_REPRODUCED",production_GO=False,
        original_positive_suite_unchanged=True,redis_not_used_in_pg_fault_job=True,
        pool=int(os.environ["QA_POOL"]),chunk=int(os.environ["QA_CHUNK"]),
        single_runner_two_OS_processes=True)
    try:
        a,b=w
        port=a.info["proxy"]
        p.check(a.proc.pid!=b.proc.pid,"worker processes not independent")
        # Fail-closed transport scenarios in the EXISTING isolated proxy.
        for typ,cause in (("/rst","reset"),("/fin","incomplete"),("/halfopen","timeout")):
            for child in w:
                result=p.get(child.info["proxy"],typ)
                p.check(result["status"]==503 and result["cause"]==cause,
                    ("unexpected transport result",typ,result))
        summary["FIN_RST_halfopen"]={"expected_503":6,"observed_503":6}
        # A deterministic post-check pre-response stall means revocation
        # cannot reach COMMIT by an explicit 750ms budget.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            req=pool.submit(p.get,port,"/pause_after_gate")
            wait_metric(a,"gate_toctou_ready")
            writer=pool.submit(try_close,750)
            wait_writer()
            timeout=writer.result(timeout=4)
            p.check(not timeout["committed"] and timeout.get("timeout"),
                ("writer unexpectedly committed",timeout))
            p.check(350<=timeout["elapsed_ms"]<=2700,("lock timeout budget",timeout))
            p.check(p.gate()[0] is True,"gate closed after bounded writer failure")
            a.cmd("resume-admission")
            permitted=req.result(timeout=12)
            p.check(permitted["status"]==200,
                ("request did not remain permitted after failed revocation",permitted))
        summary["stalled_gate_writer"]=dict(
            status="SECURITY_FAIL_BOUNDED_REVOCATION_NOT_COMMITTED",
            writer=timeout,gate_still_open_after_timeout=True,
            old_GET_200_after_failed_close=True)
        # Actual slow TCP receiver: keep an HTTP socket open, and stop read().
        # A 56MB response plus SO_SNDBUF 4K ensures application backpressure.
        slow_baseline=a.cmd("stats")["metrics"].get("slow_client_send_started",0)
        client,nfirst=abrupt_client(port)
        try:
            wait_metric(a,"slow_client_send_started",greater=slow_baseline)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(try_close,750)
                wait_writer()
                slow_timeout=future.result(timeout=4)
            p.check(not slow_timeout["committed"] and slow_timeout.get("timeout"),
                ("slow client did not hold lock",slow_timeout))
            p.check(p.gate()[0] is True,"slow client writer committed while read paused")
        finally:
            abort_sock(client)
        # Socket RST must release the shared xact eventually; cap shutdown.
        slow_closed=try_close(4000)
        p.check(slow_closed["committed"],("RST did not release PG lock",slow_closed))
        for worker in w:p.expect(worker.info["proxy"],503)
        summary["slow_tcp_reader"]=dict(
            status="SECURITY_FAIL_REVOKE_WAIT_EXCEEDS_750MS",
            bytes_received_before_stall=nfirst,writer=slow_timeout,
            RST_released_writer=slow_closed["committed"],gate_closed=not p.gate()[0])
        reset_gate()
        # Kill one real owner process WHILE it holds a shared lock and the
        # other process's exclusive writer waits. Ensure crash releases lock.
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            req=pool.submit(p.get,b.info["proxy"],"/pause_after_gate")
            wait_metric(b,"gate_toctou_ready")
            writer=pool.submit(try_close,4000)
            wait_writer()
            p.check(not writer.done(),"writer did not wait before SIGKILL")
            b.proc.send_signal(signal.SIGKILL)
            b.proc.wait(timeout=7)
            p.check(b.proc.returncode==-signal.SIGKILL,"SIGKILL not real")
            done=writer.result(timeout=7)
            p.check(done["committed"],("SIGKILL did not unlock writer",done))
            response="transport_abort"
            try:
                v=req.result(timeout=8);response=v["status"]
            except (ConnectionResetError,ConnectionAbortedError,
                OSError,TimeoutError) as ex:
                response=type(ex).__name__
            p.check(response!=200,("crashed request accepted as 200",response))
            p.expect(a.info["proxy"],503)
        summary["SIGKILL_during_shared_lock"]=dict(
            status="PASS_CRASH_RELEASES_DB_ADVISORY_LOCK",
            process_killed_pid=b.proc.pid,writer_committed=done["committed"],
            writer_elapsed_ms=round(done["elapsed_ms"],3),
            crashed_client_result=str(response),remaining_proxy_HTTP503=True)
        summary["security_verdict"]="FAIL_NO_GO_BOUNDED_REVOCATION"
        summary["CI_validation_passes_only_if_security_failure_is_reproduced"]=True
        summary["total_seconds"]=round(time.monotonic()-start,3) if (start:=time.monotonic()) else None
        Path("qa-v2-pg-adversarial.json").write_text(json.dumps(summary,indent=2,sort_keys=True))
        print("QA_PG_ADVERSARIAL_JSON="+json.dumps(summary,sort_keys=True),flush=True)
    finally:
        for child in w:child.stop()
if __name__=="__main__":main()
