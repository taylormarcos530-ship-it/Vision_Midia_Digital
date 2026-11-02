"""QA only: deterministic PG17 commercial/revoke locks for 2-block streaming."""
import gzip,hashlib,importlib.util,json,os,resource,threading,time
from http.client import IncompleteRead
from urllib import request
from pathlib import Path
spec=importlib.util.spec_from_file_location("qa_group",Path(__file__).parent/"qa.py")
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa);qa.configure()
v,d=qa.v,qa.driver
assert qa.STREAM_GROUP==2 and os.environ.get("QA_STREAM_GUARD_GROUP")=="2"
assert os.environ.get("GITHUB_REF")=="refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031"
def ck(p,msg):assert p,msg
def get(srv,keys):
    co,uid=v.COMPANIES[0],v.USER_IDS[0]
    rq=request.Request("http://127.0.0.1:"+str(srv.server_address[1])+"/0",
        headers={"X-QA-JWT":keys.issue(co,uid,"a"),"Accept-Encoding":"gzip"})
    with request.urlopen(rq,timeout=25) as resp:
        data=resp.read();raw=gzip.decompress(data)
        ck(hashlib.sha256(raw).hexdigest()==resp.headers["X-QA-SHA256"],"SHA")
        ck(len(json.loads(raw)["original_full_report"]["export"])==10000,"report_original")
        return json.loads(raw)["campaign"]
def race(srv,keys,kind):
    co,uid=v.COMPANIES[0],v.USER_IDS[0]
    srv.pause_before_first_write=True
    srv.entered.clear();srv.release.clear();srv.after_first.clear();srv.next_allow.clear()
    rq=request.Request("http://127.0.0.1:"+str(srv.server_address[1])+"/0",
       headers={"X-QA-JWT":keys.issue(co,uid,"a"),"Accept-Encoding":"gzip"})
    resp=request.urlopen(rq,timeout=25);rec={};thread=None
    try:
        ck(srv.entered.wait(6),"shared_fence_not_entered")
        def writer():
            st=time.perf_counter()
            if kind=="revoke":qa.qa.guarded_revoke(co,uid)
            else:qa.guarded_publish(co,"BATCH UPDATED",notify=False)
            rec["committed"]=True;rec["writer_ms"]=(time.perf_counter()-st)*1000
        thread=threading.Thread(target=writer,daemon=True);thread.start()
        time.sleep(.03);ck(not rec.get("committed"),"exclusive_bypassed_shared_lock")
        srv.release.set()
        first=resp.read(qa.CHUNK);ck(len(first)==qa.CHUNK,"first_chunk_missing")
        ck(srv.after_first.wait(6),"bounded_batch_did_not_exit")
        thread.join(8);ck(rec.get("committed") and not thread.is_alive(),"unbounded_writer_latency")
        bytes_at_commit=srv.payload_bytes;srv.next_allow.set()
        whole=first;complete=False
        try:
            whole+=resp.read();complete=True
            raw=gzip.decompress(whole)
            ck(hashlib.sha256(raw).hexdigest()==resp.headers["X-QA-SHA256"],"bad_200_sha")
        except IncompleteRead as ex:
            whole+=ex.partial
            ck(len(whole)<int(resp.headers["Content-Length"]),"bad_incomplete_flag")
        ck(srv.payload_bytes==bytes_at_commit,"application_wrote_after_commit")
        return {"kind":kind,"complete_precommit_stream":complete,
            "writer_ms":round(rec["writer_ms"],3),"new_application_bytes_after_commit":0,
            "received_precommit_body_bytes":len(whole),"result":"PASS"}
    finally:
        srv.release.set();srv.next_allow.set()
        resp.close();srv.pause_before_first_write=False
        if thread:thread.join(2)
        if kind=="revoke":
            with v.con() as db:
                with db.transaction():
                    db.execute("SELECT pg_advisory_xact_lock(%s)",(qa.qa.lockkey(co),))
                    db.execute("""INSERT INTO private.memberships(company_id,user_id)
                         VALUES(%s,%s) ON CONFLICT DO NOTHING""",(co,uid))
def main():
    st=time.perf_counter()
    d.q.init_db();d.p.expanded_history();d.a.setup_outbox();d.deep.rls_audit()
    qa.z.create_tables();keys=d.a.Keys();co=v.COMPANIES[0]
    ev=qa.guarded_publish(co,"BATCH BASELINE",notify=False)
    srv=qa.SealedServer(0,keys)
    srv.startup();srv.make_cache();ck(srv.replay()==[ev["id"]],"outbox_replay")
    t=threading.Thread(target=srv.serve_forever,daemon=True);t.start()
    try:
        ck(get(srv,keys)=="BATCH BASELINE","initial")
        a=race(srv,keys,"commercial")
        ck(get(srv,keys)=="BATCH UPDATED","revised_sha")
        b=race(srv,keys,"revoke")
        ck(get(srv,keys)=="BATCH UPDATED","revoked_then_restored")
        ck(srv.max_guard_group<=2 and srv.max_guard_group>=1,"unbounded_group")
        pm=srv.pool_metrics();ck(pm["timeouts"]==0,"pool_timeout")
        result={"result":"PASS","races":[a,b],"max_blocks":srv.max_guard_group,
          "group_transactions":srv.guard_groups,"per_chunk_sql_guards":srv.sql_chunks,
          "pool":pm,"RSS_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
          "elapsed_s":round(time.perf_counter()-st,3),"production_GO":False}
        print("QA_BATCHED_REVOKE_JSON="+json.dumps(result,sort_keys=True),flush=True)
        print("QA_BATCHED_REVOKE_PASS=true",flush=True)
    finally:
        srv.shutdown();srv.server_close();t.join(3);srv.cleanup()
if __name__=="__main__":main()
