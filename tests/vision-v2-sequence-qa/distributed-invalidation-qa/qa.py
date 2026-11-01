"""Isolated two-replica revision/revocation QA. PG17 synthetic only, no production.
LISTEN/NOTIFY invalidation is event driven: zero per-request ACL/epoch polling.
Fail closed when feed drops; restart reloads persistent revision and ACL once.
This is NOT a production authorization system or a distributed SLA guarantee.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import importlib.util
import json
import resource
import threading
import time
import uuid
from pathlib import Path

HERE=Path(__file__).resolve().parent
SRC=HERE.parent/"result-cache-matrix-qa"/"benchmark.py"
spec=importlib.util.spec_from_file_location("vision_v2_matrix_qa",SRC)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
v,p,prior=m.v,m.p,m.prior
CHANNEL="vision_v2_qa_events"
QUOTAS=(110_000,512_000,2_000_000)

class Replica(m.CacheAPI):
    def __init__(self,archive,baseline,quota):
        super().__init__(archive,baseline,quota)
        self.feed_live=False
        self.revoked=set()
        self.seen=set()
    def auth_guard(self,claim,company):
        # Executed with self.mx before cache read and before ACK.
        if not self.feed_live:
            raise OSError("revocation_feed_unavailable")
        if (company,claim["sub"]) in self.revoked:
            raise PermissionError("membership_revoked")

class Feed:
    def __init__(self,api):
        self.api=api
        self.stop_event=threading.Event()
        self.ready=threading.Event()
        self.error=None
        self.thread=None
        self.snapshot_reads=0
        self.notices=0
    def start(self):
        self.stop_event.clear()
        self.ready.clear()
        self.error=None
        self.thread=threading.Thread(target=self.run,daemon=True)
        self.thread.start()
        assert self.ready.wait(8),"notification_feed_not_ready"
        if self.error:
            raise RuntimeError("feed_failed") from self.error
        with self.api.mx:
            assert self.api.feed_live
    def run(self):
        try:
            # Dedicated connection per HTTP replica; no SQL polling loop.
            with v.con() as c:
                c.execute("LISTEN "+CHANNEL)
                versions=c.execute("SELECT company_id,version FROM qa_cache_revision").fetchall()
                acl=c.execute("SELECT company_id,user_id,allowed FROM qa_user_acl").fetchall()
                self.snapshot_reads+=2
                with self.api.mx:
                    self.api.revision={str(k):int(ver) for k,ver in versions}
                    self.api.revoked={(str(co),user) for co,user,allowed in acl if not allowed}
                    self.api.cache.clear()
                    self.api.archive.clear()
                    self.api.feed_live=True
                self.ready.set()
                while not self.stop_event.is_set():
                    # Socket wait, NOT a periodic SQL query.
                    for note in c.notifies(timeout=.25,stop_after=1):
                        payload=json.loads(note.payload)
                        company=payload["company"]
                        version=int(payload["version"])
                        with self.api.mx:
                            previous=self.api.revision[company]
                            if version>=previous:
                                self.api.revision[company]=version
                                if "user" in payload:
                                    key=(company,payload["user"])
                                    if payload["allowed"]:self.api.revoked.discard(key)
                                    else:self.api.revoked.add(key)
                                self.api.cache.clear(company)
                            self.api.seen.add(payload["event"])
                        self.notices+=1
        except Exception as exc:
            self.error=exc
        finally:
            with self.api.mx:self.api.feed_live=False
            self.ready.set()
    def close(self):
        with self.api.mx:self.api.feed_live=False
        self.stop_event.set()
        if self.thread:self.thread.join(4)
        assert not self.thread or not self.thread.is_alive(),"feed_not_stopped"

def publish(company,kind,user=None,allowed=None):
    event=uuid.uuid4().hex
    with v.con() as c:
        with c.transaction():
            row=c.execute("UPDATE qa_cache_revision SET version=version+1 WHERE company_id=%s RETURNING version",(company,)).fetchone()
            assert row
            payload={"company":str(company),"version":row[0],"event":event,"kind":kind}
            if user is not None:
                assert isinstance(allowed,bool)
                row=c.execute("UPDATE qa_user_acl SET allowed=%s WHERE company_id=%s AND user_id=%s RETURNING user_id",(allowed,company,user)).fetchone()
                assert row is not None
                payload.update({"user":user,"allowed":allowed})
            c.execute("SELECT pg_notify(%s,%s)",(CHANNEL,m.dump(payload).decode()))
    return event,int(payload["version"])

def await_events(feeds,event,timeout=5):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if all(event in feed.api.seen for feed in feeds):return
        time.sleep(.01) # local in-process acknowledgment check, no SQL
    raise AssertionError("event_not_seen_by_all_replicas")

def assert_good(api,idx,baseline,label,version=None):
    company=uuid.UUID(baseline[idx]["case"]["company"])
    user=v.USER_IDS[v.COMPANIES.index(company)]
    code,body,_=m.post("http://127.0.0.1:"+str(api.server_address[1]),idx,v.token(company,user),label)
    assert code==200,(label,code,body)
    assert body["sha256"]==m.sha(m.dump(baseline[idx]["result"]))
    if version is not None:assert body["revision"]==version,(label,body)
    return body

def assert_bad(api,idx,token,label,status):
    url="http://127.0.0.1:"+str(api.server_address[1])
    before=api.snapshot()["approved"]
    code,obj,_=m.post(url,idx,token,label)
    assert code==status,(label,code,obj)
    assert api.snapshot()["approved"]==before,"negative_request_was_acked"
    assert (m.v.COMPANIES[0].__str__(),label) not in api.acked
    return code

def init_db():
    p.setup()
    p.install_on_demand_rpc()
    with v.con() as c:
        c.execute("""CREATE TABLE qa_cache_revision (
           company_id uuid PRIMARY KEY, version bigint NOT NULL DEFAULT 1 CHECK(version>0))""")
        c.execute("""CREATE TABLE qa_user_acl (
           company_id uuid NOT NULL, user_id text NOT NULL, allowed boolean NOT NULL,
           PRIMARY KEY(company_id,user_id))""")
        for company,user in zip(v.COMPANIES,v.USER_IDS):
            c.execute("INSERT INTO qa_cache_revision(company_id) VALUES(%s)",(company,))
            c.execute("INSERT INTO qa_user_acl(company_id,user_id,allowed) VALUES(%s,%s,true)",(company,user))
        assert v.scalar(c,"SELECT count(*) FROM public.playback_logs")==664
        assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None

def preflight(apis,feeds,store,baseline,quota):
    a,b=v.COMPANIES
    token_a=v.token(a,v.USER_IDS[0])
    token_b=v.token(b,v.USER_IDS[1])
    for i,api in enumerate(apis):
        assert_good(api,0,baseline,"prefill-A-"+str(i),1)
        assert_good(api,24,baseline,"prefill-B-"+str(i),1)
        assert_bad(api,0,token_b,"cross-"+str(i),401)
        assert_bad(api,0,v.token(a,v.USER_IDS[0],ttl=-1),"expired-"+str(i),401)
        assert_bad(api,0,token_a[:-6]+"AAAAAA","tampered-"+str(i),401)
    with v.con() as c:
        with c.transaction():
            v.auth(c,v.decode(token_a))
            assert v.scalar(c,"SELECT count(*) FROM public.playback_logs WHERE company_id=%s",(b,))==0
            assert v.scalar(c,"SELECT count(*) FROM qa_rpc.daily WHERE company_id=%s",(b,))==0
            try:v.rpc(c,"get_playback_report",b,v.DAYS[0],v.DAYS[2])
            except m.psycopg.Error as exc: assert exc.sqlstate=="42501"
            else:raise AssertionError("source_rpc_membership_bypass")
    ev,rev=publish(a,"revision")
    assert rev==2
    await_events(feeds,ev)
    for i,api in enumerate(apis):
        assert_good(api,0,baseline,"revision-A-"+str(i),2)
        assert_good(api,24,baseline,"revision-B-"+str(i),1)
    ev,rev=publish(a,"revoke",v.USER_IDS[0],False)
    assert rev==3
    await_events(feeds,ev)
    for i,api in enumerate(apis):
        assert_bad(api,0,token_a,"revoked-"+str(i),401)
        assert_good(api,24,baseline,"B-still-allowed-"+str(i),1)
    ev,rev=publish(a,"restore",v.USER_IDS[0],True)
    assert rev==4
    await_events(feeds,ev)
    for i,api in enumerate(apis):
        assert_good(api,0,baseline,"access-restored-"+str(i),4)
    # Simulate a dead listener. This instance must fail closed even with a hit.
    feeds[1].close()
    assert_bad(apis[1],0,token_a,"listener-down",503)
    ev,rev=publish(a,"revoked_while_replica_offline",v.USER_IDS[0],False)
    assert rev==5
    await_events([feeds[0]],ev)
    assert_bad(apis[0],0,token_a,"live-revoked",401)
    assert_bad(apis[1],0,token_a,"offline-no-read",503)
    # Restart reads DB snapshot once, catches missed notification, still denies.
    feeds[1].start()
    with apis[1].mx:
        assert apis[1].revision[str(a)]==5
    assert_bad(apis[1],0,token_a,"reconnect-still-revoked",401)
    ev,rev=publish(a,"recovered",v.USER_IDS[0],True)
    assert rev==6
    await_events(feeds,ev)
    for i,api in enumerate(apis):assert_good(api,0,baseline,"recovered-"+str(i),6)
    # Real archive outage: forced MISS, no ACK, recovery from same ciphertext.
    target=next(x for x in apis[0].archive.manifest["segments"]
                if x["descriptor"]["company"]==str(a) and x["descriptor"]["local_day"]==baseline[0]["case"]["start"])
    name=target["file"]
    for api in apis:
        api.cache.clear(str(a));api.archive.clear(str(a))
    with store.lock:store.offline.add(name)
    try:
        assert_bad(apis[0],0,token_a,"blob-offline",503)
    finally:
        with store.lock:store.offline.clear()
    assert_good(apis[0],0,baseline,"blob-recovered",6)
    # TTL of a small canonical full JSON cache entry on both replicas.
    for i,api in enumerate(apis):
        api.cache.clear(str(a))
        api.cache.ttl=.05
        assert_good(api,0,baseline,"ttl-first-"+str(i),6)
        hit=api.cache.snapshot()["hits"]
        assert_good(api,0,baseline,"ttl-hit-"+str(i),6)
        assert api.cache.snapshot()["hits"]>hit
        time.sleep(.075)
        expired=api.cache.snapshot()["expired"]
        assert_good(api,0,baseline,"ttl-expired-"+str(i),6)
        assert api.cache.snapshot()["expired"]>expired
        api.cache.ttl=m.CACHE_TTL
    return {"result":"PASS","two_replicas_revisions":True,"two_replicas_revocation":True,
      "sql_source_RLS":True,"jwt_denials":True,"no_ack_on_revocation_or_outage":True,
      "feed_down_fail_closed":True,"missed_notify_reconnected_from_db":True,
      "archive_503_and_recovery":True,"TTL_hit_expiry":True}

def waves(apis,store,baseline,quota):
    phases=[]
    for n in (100,300):
        for phase in ("cold","warm"):
            if phase=="cold":
                for api in apis:api.cache.clear()
            for api in apis:api.archive.clear()
            with store.lock: start_gets=store.requests
            before=[api.snapshot() for api in apis]
            t0=time.perf_counter()
            def job(i):
                idx=i%len(baseline)
                co=uuid.UUID(baseline[idx]["case"]["company"])
                sub=v.USER_IDS[v.COMPANIES.index(co)]
                api=apis[i%2]
                code,data,ms=m.post("http://127.0.0.1:"+str(api.server_address[1]),
                    idx,v.token(co,sub),"distributed-"+str(quota)+"-"+str(n)+"-"+phase+"-"+str(i))
                assert code==200,(i,code,data)
                assert data["sha256"]==m.sha(m.dump(baseline[idx]["result"]))
                expected=6 if co==v.COMPANIES[0] else 1
                assert data["revision"]==expected
                return ms
            with ThreadPoolExecutor(max_workers=n) as pool:
                lat=list(pool.map(job,range(n)))
            assert len(lat)==n
            with store.lock:get_delta=store.requests-start_gets
            after=[api.snapshot() for api in apis]
            assert all(s["queue_timeout"]==0 for s in after)
            assert all(s["max_inflight"]<=m.PG_PERMITS for s in after)
            for api in apis:
                rs=api.cache.snapshot()
                ss=api.archive.stats()
                assert all(k<=quota for k in rs["current_per_tenant_bytes"].values())
                assert all(k<=quota for k in ss["per_tenant_cached_bytes"].values())
            row={"quota":quota,"clients":n,"phase":phase,"result":"PASS",
                 "p95_http_ms":m.pctl(lat,.95),"p99_http_ms":m.pctl(lat,.99),
                 "wall_sec":round(time.perf_counter()-t0,3),
                 "archive_gets":get_delta,
                 "sql_misses":sum(y["db_misses"]-x["db_misses"] for x,y in zip(before,after)),
                 "max_queue":max(x["max_waiters"] for x in after),
                 "max_active_sql_per_replica":max(x["max_inflight"] for x in after),
                 "queue_timeouts":sum(x["queue_timeout"] for x in after)}
            print("QA_DISTRIBUTED_PHASE_JSON="+m.dump(row).decode(),flush=True)
            phases.append(row)
    return phases

def revoke_during_load(apis,feeds,baseline,quota):
    """Exercise revoke while 100/300 requests are already concurrent.
    Earlier authorizations may complete; after both listeners acknowledge
    revocation, every NEW request must deny with no ACK. No strong instant
    revocation SLA is inferred from this QA.
    """
    company=v.COMPANIES[0]
    user=v.USER_IDS[0]
    outcomes=[]
    for n in (100,300):
        ev,allow_rev=publish(company,"race_allow",user,True)
        await_events(feeds,ev)
        for api in apis:
            api.cache.clear(str(company))
            api.archive.clear(str(company))
        token=v.token(company,user)
        with ThreadPoolExecutor(max_workers=n) as pool:
            def worker(i):
                api=apis[i%2]
                idx=i%24
                reqid="revoke-race-"+str(quota)+"-"+str(n)+"-"+str(i)
                code,body,ms=m.post("http://127.0.0.1:"+str(api.server_address[1]),
                                    idx,token,reqid)
                if code==200:
                    assert body["sha256"]==m.sha(m.dump(baseline[idx]["result"]))
                else:
                    assert code in (401,503),(code,body)
                    assert (str(company),reqid) not in api.acked
                return code,ms
            futures=[pool.submit(worker,i) for i in range(n)]
            time.sleep(.04)
            ev,deny_rev=publish(company,"race_revoke",user,False)
            await_events(feeds,ev)
            codes=[f.result()[0] for f in futures]
        assert len(codes)==n
        for k,api in enumerate(apis):
            assert_bad(api,0,token,"revoke-race-post-"+str(quota)+"-"+str(n)+"-"+str(k),401)
        counts={str(code):codes.count(code) for code in (200,401,503)}
        info={"quota":quota,"clients":n,"result":"PASS","previous_revision":allow_rev,
              "revoked_revision":deny_rev,"http_codes":counts,
              "new_requests_denied_after_notification":True}
        print("QA_DISTRIBUTED_REVOKE_RACE_JSON="+m.dump(info).decode(),flush=True)
        outcomes.append(info)
    ev,version=publish(company,"race_restore",user,True)
    await_events(feeds,ev)
    for i,api in enumerate(apis):
        assert_good(api,0,baseline,"race-restored-"+str(quota)+"-"+str(i),version)
    return outcomes

def run(archive_dir,key_dir):
    manifest=json.loads((archive_dir/"manifest.json").read_bytes())
    data=(archive_dir/"rpc-baseline.json").read_bytes()
    assert m.sha(data)==manifest["rpc_baseline_sha256"]
    baseline=json.loads(data)
    assert len(baseline)==48
    key=(key_dir/"synthetic-qa-key").read_bytes()
    assert len(key)==32
    init_db()
    store=p.Store(archive_dir)
    st=threading.Thread(target=store.serve_forever,daemon=True);st.start()
    results=[]
    try:
        for quota in QUOTAS:
            with v.con() as c:
                with c.transaction():
                    c.execute("UPDATE qa_cache_revision SET version=1")
                    c.execute("UPDATE qa_user_acl SET allowed=true")
            apis=[];feeds=[];workers=[]
            for _ in range(2):
                archive=prior.BoundedCache("http://127.0.0.1:"+str(store.server_address[1]),
                    manifest,key,quota=quota,ttl=m.CACHE_TTL)
                api=Replica(archive,baseline,quota)
                worker=threading.Thread(target=api.serve_forever,daemon=True)
                worker.start()
                apis.append(api);workers.append(worker)
            try:
                for api in apis:
                    feed=Feed(api);feed.start();feeds.append(feed)
                checks=preflight(apis,feeds,store,baseline,quota)
                phases=waves(apis,store,baseline,quota)
                revoke_races=revoke_during_load(apis,feeds,baseline,quota)
                results.append({"quota":quota,"checks":checks,"phases":phases,"revoke_races":revoke_races,
                  "feeds":{"db_snapshot_reads":sum(f.snapshot_reads for f in feeds),
                           "notifications":sum(f.notices for f in feeds),
                           "per_request_revision_sql":0,
                           "polling_sql":0},
                  "replicas":[{"service":a.snapshot(),"result_cache":a.cache.snapshot(),
                               "archive_cache":a.archive.stats()} for a in apis]})
            finally:
                for feed in feeds:feed.close()
                for api,worker in zip(apis,workers):
                    api.shutdown();api.server_close();worker.join(4)
        with v.con() as c:
            assert v.scalar(c,"SELECT count(*) FROM public.playback_logs")==664
            assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
            indexes={"history":int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')")),
                     "daily":int(v.scalar(c,"SELECT pg_indexes_size('qa_rpc.daily')"))}
            bytes_db=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
        summary={"result":"PASS","postgres17_disposable":True,"source_event_rows_retained":664,
          "original_RPC_json_export_verified":True,"event_channel":"LISTEN_NOTIFY",
          "quarantined_two_replicas":True,"quotas":results,"index_bytes":indexes,
          "db_bytes":bytes_db,"archive_gets_total":store.requests,
          "peak_process_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
          "production_go":False,"no_prod_access":True}
        print("QA_DISTRIBUTED_SUMMARY_JSON="+m.dump(summary).decode(),flush=True)
        print("QA_DISTRIBUTED_TWO_REPLICA_PASS=true",flush=True)
    finally:
        store.shutdown();store.server_close();st.join(4)

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--archive",type=Path,required=True)
    parser.add_argument("--key-dir",type=Path,required=True)
    opts=parser.parse_args()
    run(opts.archive,opts.key_dir)
