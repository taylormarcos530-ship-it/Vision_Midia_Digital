"""Independent adversarial PG17 QA. Synthetic only; no production connections.

Uses pre-existing separate HTTP/PG transport and commercial runners, but adds
independent output invariants and a real PostgreSQL+TCP postcommit-buffer proof.
Every scenario runs in a freshly recreated, hard-coded LOCAL disposable DB.
"""
from __future__ import annotations
import http.client,json,os,resource,socket,subprocess,sys,threading,time
from pathlib import Path
import psycopg

ROOT=Path(__file__).resolve().parent.parent
SECURE=ROOT/"secure-pool-qa"
DB="vision_v2_quarantine_disposable"
POOL=int(os.environ.get("QA_POOL","12"))
CHUNK=int(os.environ.get("QA_CHUNK","262144"))
ROUNDS=int(os.environ.get("QA_ROUNDS","1"))
assert POOL in (8,12,20) and CHUNK in (65536,262144) and ROUNDS in (1,2,3)
assert os.environ.get("GITHUB_REF")=="refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031"
for name in ("SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","DATABASE_URL","PGHOST","PGSERVICE"):
    assert not os.environ.get(name),("non_quarantine_environment",name)

def pg(db=DB,**kw):
    return psycopg.connect(host="127.0.0.1",port=5432,dbname=db,user="postgres",
                           password="qa-only-local-password",connect_timeout=3,**kw)
def clean_db():
    with pg("postgres",autocommit=True) as c:
        ver=int(c.execute("SELECT current_setting('server_version_num')").fetchone()[0])
        assert 170000<=ver<180000,("not_pg17",ver)
        c.execute('DROP DATABASE IF EXISTS "vision_v2_quarantine_disposable" WITH (FORCE)')
        c.execute('CREATE DATABASE "vision_v2_quarantine_disposable"')
def run(file,prefix,options):
    env={**os.environ,**options,"PYTHONUNBUFFERED":"1"}
    start=time.monotonic()
    p=subprocess.run([sys.executable,"-u",str(SECURE/file)],env=env,capture_output=True,
                     text=True,timeout=240,check=False)
    found=[line.partition(prefix+"=")[2] for line in p.stdout.splitlines() if prefix+"=" in line]
    if p.returncode or len(found)!=1:
        print("QA_CHILD_FAIL="+json.dumps({"file":file,"returncode":p.returncode,
             "stdout_tail":p.stdout[-7000:],"stderr_tail":p.stderr[-7000:]}),flush=True)
        raise AssertionError(("suite_failed",file,p.returncode,len(found)))
    return json.loads(found[0]),round(time.monotonic()-start,3)
def transport_checks(x):
    assert x["status"]=="PASS" and x["clients"]==300 and x["pool"]==POOL
    assert x["chunk_bytes"]==CHUNK and x["complete_HTTP_200"]==300
    assert x["HTTP_GET_attempts_local"]==309
    assert x["real_revocation_midstream"]["new_application_written_bytes_after_commit"]==0
    assert x["real_revocation_midstream"]["new_request_401_attempts"]==1
    assert x["multiprocess_epoch"]["post_deadline_old_admissions"]==0
    assert x["multiprocess_epoch"]["old_ticket_denied_processes"]==2
    assert x["multiprocess_epoch"]["physical_stream_close_under_420ms_proven"] is False
    modes=x["failures_without_retry"]
    for path in ("/headers-only","/partial-fin","/partial-rst","/halfopen"):
        assert modes[path]["attempts"]==1 and modes[path]["retried"] is False,path
    assert modes["401"]["attempts"]==1 and modes["401"]["body_bytes"]==0
    assert modes["503"]["attempts"]==2 and modes["503"]["complete_SHA_200"]
    assert x["P99_ms"]>=x["P95_ms"] and x["SQL_full_statements_measured"] is False
def commercial_checks(x):
    assert x["result"]=="PASS" and x["no_prod"] and not x["production_GO"]
    count=x["mixed_300"]
    assert sum(count.values())==300 and count["incomplete"]==0
    assert x["admission_preheader_revision_denials"]==0
    assert x["mixed_proxy_fail_closed_503"]==count["503"]
    assert x["inflight_postheader_revision_aborts"]>=count["503"]
    assert x["all_complete_HTTP_SHA256_AND_10K"]
    assert x["post_replay_100_old"]["full_original_report_SHA_pass"]
    assert x["post_replay_100_new"]["full_original_report_SHA_pass"]
    for w in x["worker_stats"]:
        assert w["pool"]["timeouts"]==0 and w["pool"]["capacity"]==POOL
        assert w["revision_preheader_denials"]==0
    assert x["mixed_300_P99_ms"]>=x["mixed_300_P95_ms"]

def prebuffer_proof():
    """Postcommit *receipt* of PREcommit queued bytes is possible, not a leak
    of new application writes. A complete Content-Length 200 must NOT pass.
    This proves an important non-guarantee rather than assuming TCP cancellation.
    """
    clean_db()
    lock=809231117
    with pg() as c:
        c.execute("CREATE TABLE qa_only_buffer_revocation(permitted boolean NOT NULL)")
        c.execute("INSERT INTO qa_only_buffer_revocation VALUES(true)")
        wal0=c.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
    first=threading.Event();continue_after_commit=threading.Event()
    errors=[];counts={"late_app_writes":0,"precommit_body_bytes":0}
    body=b"PRECOMMIT-ONLY-"+b"X"*32768
    full_length=len(body)+8192
    listener=socket.socket();listener.bind(("127.0.0.1",0));listener.listen(1);listener.settimeout(8)
    port=listener.getsockname()[1]
    def writer():
        try:
            s,_=listener.accept()
            with s,pg() as c:
                with c.transaction():
                    c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(lock,))
                    assert c.execute("SELECT permitted FROM qa_only_buffer_revocation").fetchone()[0]
                    headers=("HTTP/1.1 200 OK\r\nContent-Length: "+str(full_length)+
                             "\r\nConnection: close\r\n\r\n").encode()
                    s.sendall(headers+body)
                    counts["precommit_body_bytes"]=len(body)
                first.set()
                assert continue_after_commit.wait(8),"writer_release_timeout"
                with c.transaction():
                    c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(lock,))
                    permitted=c.execute("SELECT permitted FROM qa_only_buffer_revocation").fetchone()[0]
                    if permitted:
                        counts["late_app_writes"]+=1
                        s.sendall(b"UNSAFE-LATE-BLOCK")
        except BaseException as e:
            errors.append(repr(e));first.set()
        finally:
            listener.close()
    thread=threading.Thread(target=writer,daemon=True);thread.start()
    client=socket.create_connection(("127.0.0.1",port),timeout=8);client.settimeout(8)
    try:
        assert first.wait(8) and not errors,("precommit_send_failed",errors)
        tick=time.monotonic()
        with pg() as c:
            with c.transaction():
                c.execute("SELECT pg_advisory_xact_lock(%s)",(lock,))
                c.execute("UPDATE qa_only_buffer_revocation SET permitted=false")
        commit_ms=(time.monotonic()-tick)*1000
        # Reader is intentionally blocked until AFTER revocation COMMIT.
        continue_after_commit.set();thread.join(9)
        assert not thread.is_alive() and not errors,errors
        resp=http.client.HTTPResponse(client);resp.begin()
        assert resp.status==200 and int(resp.getheader("Content-Length"))==full_length
        try:
            resp.read()
            raise AssertionError("invalid_truncated_HTTP200_accepted")
        except http.client.IncompleteRead as err:
            assert err.partial==body,("wrong_buffered_content",len(err.partial))
        assert counts["late_app_writes"]==0
        with pg() as c:
            size,wal=c.execute("SELECT pg_database_size(current_database()),pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(wal0,)).fetchone()
        return {"PASS":True,"bytes_received_after_commit_previously_queued":len(body),
                "new_application_writes_after_commit":0,"truncated_200_rejected":True,
                "revocation_commit_ms":round(commit_ms,3),"database_bytes":size,
                "wal_delta_bytes":int(wal),
                "physical_zero_postcommit_receipt_proven":False}
    finally:
        continue_after_commit.set();client.close();thread.join(2)

def main():
    started=time.monotonic()
    clean_db()
    transport,elapsed=run("multiprocess_socket_fence_qa.py","QA_MULTIPROCESS_SOCKET_SUMMARY_JSON",
        {"QA_N":"300","QA_POOL_SIZE":str(POOL),"QA_CHUNK":str(CHUNK)})
    transport_checks(transport)
    print("QA_ADVERSARIAL_TRANSPORT_PASS=true",flush=True)
    buffer=prebuffer_proof()
    print("QA_ADVERSARIAL_BUFFER_PASS=true",flush=True)
    commercial=[]
    for n in range(ROUNDS):
        clean_db()
        x,sec=run("mixed_300.py","QA_MIXED_300_COMMERCIAL_SUMMARY_JSON",{
          "QA_COMMERCIAL_ADMISSIONS":str(POOL),"QA_PG_POOL_SIZE":str(POOL),
          "QA_COMMERCIAL_CHUNK":str(CHUNK)})
        commercial_checks(x)
        commercial.append({"round":n+1,"response_counts":x["mixed_300"],
          "preheader_admission_denials":x["admission_preheader_revision_denials"],
          "postheader_revocation_aborts":x["inflight_postheader_revision_aborts"],
          "proxy_failclosed_503_causes":x["mixed_proxy_503_causes"],
          "P95_ms":x["mixed_300_P95_ms"],"P99_ms":x["mixed_300_P99_ms"],
          "gzip_egress_bytes":x["mixed_full_200_gzip_bytes"],"db_bytes":x["db_bytes"],
          "index_bytes":x["index_bytes"],"parent_RSS_KiB":x["parent_rss_kib"],
          "worker_RSS_KiB":[w["RSS_kib"] for w in x["worker_stats"]],
          "sql_authorization_guard_calls_instrumented":sum(w["sql_per_block"] for w in x["worker_stats"]),
          "pool_timeouts":sum(w["pool"]["timeouts"] for w in x["worker_stats"]),
          "local_GETs_submitted":300,"seconds":sec})
        print("QA_ADVERSARIAL_COMMERCIAL_ROUND_JSON="+json.dumps(commercial[-1],sort_keys=True),flush=True)
    bytes_per_report=351751
    result={"status":"PASS","pool":POOL,"chunk_bytes":CHUNK,"clients":300,
      "commercial":commercial,"transport":{"full_200":transport["complete_HTTP_200"],
       "local_GETs":transport["HTTP_GET_attempts_local"],
       "P95_ms":transport["P95_ms"],"P99_ms":transport["P99_ms"],
       "gzip_egress_bytes":transport["gzip_egress_bytes"],
       "sql_authorization_guard_calls_lower_bound":transport["SQL_authorization_guard_calls_HEALTHY_lower_bound"],
       "wal_after_fixture_bytes":transport["WAL_after_fixture_bytes"],
       "parent_RSS_KiB":transport["parent_RSS_KiB"],
       "late_scheduler_ms":transport["multiprocess_epoch"]["late_wakeup_over_deadline_ms"]},
      "buffered_precommit_TCP":buffer,
      "30day_gzip_GB_100_ONE_full_report_per_day":round(bytes_per_report*100*30/1e9,6),
      "30day_gzip_GB_300_ONE_full_report_per_day":round(bytes_per_report*300*30/1e9,6),
      "all_SQL_statements_counted":False,"all_process_PG_kernel_RSS_counted":False,
      "real_media_GETs_measured":False,"monetary_provider_costs_measured":False,
      "physical_420ms_deadline_proven":False,"cross_host_real_JWT_KMS_tested":False,
      "no_prod":True,"production_GO":False,
      "elapsed_seconds":round(time.monotonic()-started,3)}
    print("QA_INDEPENDENT_ADVERSARIAL_SUMMARY_JSON="+json.dumps(result,sort_keys=True),flush=True)
    print("QA_INDEPENDENT_ADVERSARIAL_PASS=true",flush=True)

if __name__=="__main__":main()
