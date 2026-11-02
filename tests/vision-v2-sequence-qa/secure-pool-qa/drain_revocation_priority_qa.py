"""Independent PG17 test: revocation bypasses a bounded proxy-route drain.

Only synthetic DB and membership; one controlled old-active counter models a
stalled request (NOT a real in-flight TCP connection). HTTP 401 and SHA-256
are checked on an actual socket/SealedHandler. Real TCP midstream is covered
separately by faults.py and multiprocess_socket_fence_qa.py.
"""
import gzip,hashlib,importlib.util,json,os,resource,threading,time
from pathlib import Path
from urllib import error,request
spec=importlib.util.spec_from_file_location("v2_drain",Path(__file__).parent/"drain_300.py")
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
assert os.environ.get("QA_STREAM_GUARD_GROUP","1")=="1"
assert os.environ.get("GITHUB_REF")=="refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031"
def ck(v,msg):assert v,msg
def main():
    started=time.perf_counter()
    d.drv.q.init_db();d.drv.p.expanded_history();d.drv.a.setup_outbox();d.drv.deep.rls_audit()
    d.z.create_tables()
    co,uid=d.v.COMPANIES[0],d.v.USER_IDS[0]
    key=d.drv.a.Keys()
    initial=d.qa.guarded_publish(co,"PRIORITY BASELINE",notify=False)
    srv=d.qa.SealedServer(0,key);srv.startup();srv.make_cache()
    ck(srv.replay()==[initial["id"]],"durable_outbox_replay")
    listener=threading.Thread(target=srv.serve_forever,daemon=True);listener.start()
    url="http://127.0.0.1:"+str(srv.server_address[1])+"/0"
    token=key.issue(co,uid,"a")
    try:
        rq=request.Request(url,headers={"X-QA-JWT":token,"Accept-Encoding":"gzip"})
        with request.urlopen(rq,timeout=15) as resp:
            payload=gzip.decompress(resp.read())
            ck(hashlib.sha256(payload).hexdigest()==resp.headers["X-QA-SHA256"],"sha_original")
            ck(len(json.loads(payload)["original_full_report"]["export"])==10000,"not_original_10k")
        # No network listener is started for this proxy: the single active
        # slot deliberately represents a stuck previously admitted request.
        rollspec=importlib.util.spec_from_file_location("drain_route",
                      d.ROOT/"rolling-cutover-outbox-qa"/"qa.py")
        roll=importlib.util.module_from_spec(rollspec);rollspec.loader.exec_module(roll)
        proxy=roll.old.Router(46811)
        proxy.active_by_port={46811:1};proxy.drain_old_max=0
        proxy.drain_timeouts=0;proxy.drain_switches=0;proxy.route_gate_until=0
        result={}
        def drain():
            result["drain"]=d.drain_switch(proxy,46812,timeout_s=.42)
        th=threading.Thread(target=drain,daemon=True);th.start()
        until=time.monotonic()+3
        while time.monotonic()<until:
            with proxy.lock:
                switched=proxy.upstream==46812 and proxy.drain_switches==1
            if switched:break
            time.sleep(.002)
        ck(switched and th.is_alive(),"drain_barrier_not_held")
        st=time.perf_counter()
        d.qa.qa.guarded_revoke(co,uid)
        result["revocation_commit_ms"]=round((time.perf_counter()-st)*1000,3)
        result["revocation_committed_during_drain"]=th.is_alive()
        ck(result["revocation_committed_during_drain"],
           "revocation_blocked_by_proxy_drain")
        try:
            with request.urlopen(rq,timeout=15) as forbidden:
                raise AssertionError(("revoked_jwt_accepted",forbidden.status))
        except error.HTTPError as e:
            ck(e.code==401 and not e.read(),"revoked_user_not_401_no_body")
        with proxy.lock:proxy.active_by_port[46811]=0
        th.join(3);ck(not th.is_alive(),"bounded_drain_deadlock")
        proxy.server_close()
        with d.v.con() as db:
            with db.transaction():
                db.execute("SELECT pg_advisory_xact_lock(%s)",(d.qa.qa.lockkey(co),))
                db.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(co,uid))
        with request.urlopen(rq,timeout=15) as resp:
            raw=gzip.decompress(resp.read())
            ck(hashlib.sha256(raw).hexdigest()==resp.headers["X-QA-SHA256"],
               "post_restore_integrity")
        with d.v.con() as db:
            size=db.execute("SELECT pg_database_size(current_database())").fetchone()[0]
            idx=db.execute("SELECT pg_indexes_size('public.playback_logs')").fetchone()[0]
        output={"result":"PASS","revocation_commit_ms":result["revocation_commit_ms"],
            "commit_while_route_drain_active":result["revocation_committed_during_drain"],
            "route_drain":result["drain"],"revoked_http_401_single_attempt":True,
            "restored_http_200_integrity":True,"original_10000_sha":True,
            "active_counter_is_synthetic_not_real_socket":True,
            "db_bytes":size,"index_bytes":idx,
            "RSS_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "seconds":round(time.perf_counter()-started,3),
            "no_prod":True,"production_GO":False}
        print("QA_DRAIN_REVOCATION_PRIORITY_JSON="+json.dumps(output,sort_keys=True),flush=True)
        print("QA_DRAIN_REVOCATION_PRIORITY_PASS=true",flush=True)
    finally:
        srv.shutdown();srv.server_close();listener.join(3);srv.cleanup()
if __name__=="__main__":main()
