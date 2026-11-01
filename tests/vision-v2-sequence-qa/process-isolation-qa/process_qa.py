"""Two REAL OS-process HTTP replicas and silent LISTEN blackout, PG17 disposable only.
No production env, no Supabase credentials. Synthetic source, original GitHub RPC.
Heartbeat query is global (one producer), never per request. QA short lease != production SLA.
"""
from __future__ import annotations
import argparse, json, os, threading, time, uuid, math, resource, multiprocessing as mp
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from urllib import request
import importlib.util

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("v2_distributed",HERE.parent/"distributed-invalidation-qa"/"qa.py")
q=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(q)
v,m,p,prior=q.v,q.m,q.p,q.prior
HEARTBEAT_PERIOD=.45
LEASE_SECONDS=1.8
SOURCE_ROWS=664
EXTRA_ROWS=20_000
QUOTAS=(110_000,512_000,2_000_000)
def now():return time.monotonic()
def obj(x):return m.dump(x).decode()
def check(vv,msg):assert vv,msg

class LeaseReplica(q.Replica):
    def __init__(self,archive,baseline,quota):
        super().__init__(archive,baseline,quota)
        self.heartbeat_at=0.0
        self.heartbeat_count=0
        self.storage_refresh=0
    def auth_guard(self,claim,company):
        # Even a warm cache hit cannot bypass a silently dead LISTEN feed.
        if now()-self.heartbeat_at>LEASE_SECONDS:
            raise OSError("silent_feed_lease_expired")
        super().auth_guard(claim,company)
    def refresh_files(self,archive_dir):
        new_manifest=json.loads((archive_dir/"manifest.json").read_bytes())
        reference=json.loads((archive_dir/"rpc-baseline.json").read_bytes())
        check(len(reference)==48,"reference_size")
        check(m.sha((archive_dir/"rpc-baseline.json").read_bytes())==new_manifest["rpc_baseline_sha256"],"manifest_reference_hash")
        with self.mx:
            self.baseline=reference
            self.archive.manifest=new_manifest
            self.archive.clear()
            self.cache.clear()
            self.storage_refresh+=1

class LeaseFeed(q.Feed):
    def __init__(self,api,archive_dir):
        super().__init__(api)
        self.archive_dir=archive_dir
        self.blackhole=False
    def run(self):
        try:
            with v.con() as c:
                c.execute("LISTEN "+q.CHANNEL)
                versions=c.execute("SELECT company_id,version FROM qa_cache_revision").fetchall()
                acl=c.execute("SELECT company_id,user_id,allowed FROM qa_user_acl").fetchall()
                self.snapshot_reads+=2
                self.api.refresh_files(self.archive_dir)
                with self.api.mx:
                    self.api.revision={str(k):int(ver) for k,ver in versions}
                    self.api.revoked={(str(co),user) for co,user,allowed in acl if not allowed}
                    self.api.feed_live=True
                    self.api.heartbeat_at=now()
                self.ready.set()
                while not self.stop_event.is_set():
                    for note in c.notifies(timeout=.15,stop_after=1):
                        if self.blackhole:continue
                        event=json.loads(note.payload)
                        if event.get("kind")=="heartbeat":
                            with self.api.mx:
                                self.api.heartbeat_at=now()
                                self.api.heartbeat_count+=1
                            continue
                        company=event["company"]
                        version=int(event["version"])
                        if event.get("kind")=="campaign":
                            # Rebuild full JSON references and crypto manifest on revision.
                            self.api.refresh_files(self.archive_dir)
                        with self.api.mx:
                            if version>=self.api.revision[company]:
                                self.api.revision[company]=version
                                if "user" in event:
                                    key=(company,event["user"])
                                    if event["allowed"]:self.api.revoked.discard(key)
                                    else:self.api.revoked.add(key)
                                self.api.cache.clear(company)
                            self.api.seen.add(event["event"])
                        self.notices+=1
        except Exception as exc:self.error=exc
        finally:
            with self.api.mx:self.api.feed_live=False
            self.ready.set()

def serve(idx,base,archive_dir,key,quota,cmd,reply):
    archive_dir=Path(archive_dir)
    api=None;feed=None;worker=None
    try:
        manifest=json.loads((archive_dir/"manifest.json").read_bytes())
        baseline=json.loads((archive_dir/"rpc-baseline.json").read_bytes())
        archive=prior.BoundedCache(base,manifest,key,quota=quota,ttl=m.CACHE_TTL)
        api=LeaseReplica(archive,baseline,quota)
        worker=threading.Thread(target=api.serve_forever,daemon=True);worker.start()
        feed=LeaseFeed(api,archive_dir);feed.start()
        reply.put({"ready":True,"port":api.server_address[1],"pid":os.getpid()})
        while True:
            kind=cmd.get()
            if kind=="stop":
                reply.put({"stopped":True});break
            if kind=="blackhole":
                feed.blackhole=True
                reply.put({"blackhole":True})
            elif kind=="reconnect":
                feed.close()
                feed=LeaseFeed(api,archive_dir);feed.start()
                reply.put({"reconnected":True,"snapshot_reads":feed.snapshot_reads})
            elif kind=="state":
                with api.mx:
                    info={"pid":os.getpid(),"ready":api.feed_live,
                          "heartbeat_age_s":round(now()-api.heartbeat_at,3),
                          "heartbeats":api.heartbeat_count,
                          "revisions":dict(api.revision),
                          "denied_users":len(api.revoked),
                          "seen":list(api.seen),
                          "refresh_count":api.storage_refresh}
                info.update({"service":api.snapshot(),"result_cache":api.cache.snapshot(),
                             "segment_cache":api.archive.stats(),
                             "rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
                reply.put(info)
            elif kind=="clear":
                api.cache.clear();api.archive.clear()
                reply.put({"cleared":True})
            else:raise RuntimeError("invalid_control_command")
    except Exception as exc:
        reply.put({"error":repr(exc)})
        raise
    finally:
        if feed:feed.close()
        if api:
            api.shutdown();api.server_close()
        if worker:worker.join(3)

class Controller:
    def __init__(self,index,base,archive_dir,key,quota):
        self.cmd=mp.Queue();self.reply=mp.Queue()
        self.process=mp.Process(target=serve,args=(index,base,str(archive_dir),key,quota,self.cmd,self.reply))
        self.process.start()
        data=self.reply.get(timeout=15)
        check(data.get("ready"),data)
        self.port=data["port"];self.pid=data["pid"]
    def ask(self,cmd):
        check(self.process.is_alive(),"replica_crashed")
        self.cmd.put(cmd)
        data=self.reply.get(timeout=12)
        check("error" not in data,data)
        return data
    def close(self):
        if self.process.is_alive():
            try:self.ask("stop")
            finally:self.process.join(6)
        if self.process.is_alive():
            self.process.terminate();self.process.join(3)
        check(self.process.exitcode==0,("replica_exit",self.process.exitcode))
    def post(self,case_id,token,request_id):
        return m.post("http://127.0.0.1:"+str(self.port),case_id,token,request_id)

def heartbeat_loop(stop,counters):
    while not stop.is_set():
        try:
            with v.con() as c:
                c.execute("SELECT pg_notify(%s,%s)",(q.CHANNEL,obj({"kind":"heartbeat"})))
                counters["heartbeat_sql"]+=1
        except Exception as exc:
            counters["failures"]+=1
            counters["last_error"]=str(exc)
        stop.wait(HEARTBEAT_PERIOD)

def states(replicas):return [x.ask("state") for x in replicas]
def event_seen(replicas,event,timeout=6):
    deadline=now()+timeout
    while now()<deadline:
        if all(event in s["seen"] for s in states(replicas)):return
        time.sleep(.05)  # Local process-control IPC; zero SQL polls.
    raise AssertionError("missed_replica_event:"+event)

def verify(replicas,baseline,idx,rev,label):
    co=uuid.UUID(baseline[idx]["case"]["company"])
    token=v.token(co,v.USER_IDS[v.COMPANIES.index(co)])
    expected=m.sha(m.dump(baseline[idx]["result"]))
    for i,client in enumerate(replicas):
        code,data,ms=client.post(idx,token,label+"-"+str(i))
        check(code==200 and data["sha256"]==expected and data["revision"]==rev,
              ("parity_revision_failed",i,code,data,expected,rev))
def deny(replicas,idx,token,expected,label):
    for i,client in enumerate(replicas):
        before=client.ask("state")["service"]["approved"]
        code,data,ms=client.post(idx,token,label+"-"+str(i))
        after=client.ask("state")["service"]["approved"]
        check(code==expected and before==after,("unexpected_denial_or_ack",code,data,before,after))

def expanded_history():
    # 20,000 older synthetic rows. None are deleted; RPC 2026 windows untouched.
    # Only original event table grows; historical CQRS backfill is out of scope.
    with v.con() as c:
        c.execute("""INSERT INTO public.playback_logs
          (id,client_event_id,company_id,device_id,campaign_id,playlist_id,media_id,
           device_name,campaign_name,playlist_name,media_name,
           started_at,ended_at,duration_seconds,completed)
          SELECT md5(s.company_id::text || ':' || gs.n::text)::uuid,
            'qa-history-' || s.company_id::text || '-' || gs.n::text,
            s.company_id,s.device_id,s.campaign_id,s.playlist_id,s.media_id,
            s.device_name,s.campaign_name,s.playlist_name,s.media_name,
            TIMESTAMPTZ '2025-01-01 00:00:00+00' + gs.n*INTERVAL '30 seconds',
            NULL,15.0,true
          FROM (SELECT DISTINCT ON (company_id) * FROM public.playback_logs
                ORDER BY company_id,started_at,id) s
          CROSS JOIN generate_series(1,%s) gs(n)""",(EXTRA_ROWS//2,))
        check(v.scalar(c,"SELECT count(*) FROM public.playback_logs")==SOURCE_ROWS+EXTRA_ROWS,
              "historical_count")
        indexes_before={"events":int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')")),
                        "daily":int(v.scalar(c,"SELECT pg_indexes_size('qa_rpc.daily')"))}
        database_bytes=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
        plan=c.execute("""EXPLAIN (FORMAT JSON)
            SELECT count(*) FROM public.playback_logs
            WHERE company_id=%s AND started_at>=TIMESTAMPTZ '2026-10-30'
            AND started_at<TIMESTAMPTZ '2026-11-05'""",(v.COMPANIES[0],)).fetchone()[0]
    return {"total_synthetic_events":SOURCE_ROWS+EXTRA_ROWS,
            "older_source_events":EXTRA_ROWS,"indexes_bytes":indexes_before,
            "db_bytes":database_bytes,"planner":plan[0]["Plan"]["Node Type"]}

def mutate_campaign_and_archive(archive_dir,key,baseline):
    """Replace synthetic historical snapshots and crypto proofs after database commit.
    QA uses stop-the-world mutation before notifying both independent processes.
    Atomic file replace avoids half-written blobs but is NOT a production outbox.
    """
    company=str(v.COMPANIES[0])
    with v.con() as c:
        with c.transaction():
            c.execute("UPDATE public.campaigns SET name='Campanha QA revisão B' WHERE company_id=%s",(v.COMPANIES[0],))
            row=c.execute("""UPDATE public.playback_logs SET campaign_name='Campanha QA revisão B'
                 WHERE company_id=%s AND campaign_id IS NOT NULL
                 AND started_at >= TIMESTAMPTZ '2026-10-30'
                 RETURNING id""",(v.COMPANIES[0],)).fetchall()
            check(len(row)>0,"campaign_source_not_updated")
    manifest=json.loads((archive_dir/"manifest.json").read_bytes())
    changed=0
    for segment in manifest["segments"]:
        if segment["descriptor"]["company"]!=company:continue
        filepath=archive_dir/segment["file"]
        rows=p.decrypt(key,segment,filepath.read_bytes())
        count=0
        for row in rows:
            if row[4] is not None:
                row[8]="Campanha QA revisão B";count+=1
        changed+=count
        plain,blob=p.encrypt(key,segment["descriptor"],rows)
        newpath=filepath.with_suffix(".qa.tmp");newpath.write_bytes(blob)
        os.replace(newpath,filepath)
        segment.update({"cipher_sha256":p.sha(blob),"plain_sha256":p.sha(plain),
                         "encrypted_bytes":len(blob),"plaintext_bytes":len(plain)})
    check(changed>0,"encrypted_campaign_not_updated")
    new_reference=[{"case":x["case"],"result":p.query_original(x["case"])} for x in baseline]
    previous=m.sha(m.dump(baseline[0]["result"]))
    after=m.sha(m.dump(new_reference[0]["result"]))
    check(after!=previous,("commercial_json_unchanged",previous))
    # B must not change when only A is updated.
    check(m.sha(m.dump(new_reference[24]["result"]))==m.sha(m.dump(baseline[24]["result"])),"cross_tenant_leak")
    reference_bytes=p.canon(new_reference)
    manifest["rpc_baseline_sha256"]=p.sha(reference_bytes)
    temp=archive_dir/"rpc-baseline.qa.tmp";temp.write_bytes(reference_bytes)
    os.replace(temp,archive_dir/"rpc-baseline.json")
    temp=archive_dir/"manifest.qa.tmp";temp.write_bytes(p.canon(manifest))
    os.replace(temp,archive_dir/"manifest.json")
    ev,rev=q.publish(v.COMPANIES[0],"campaign")
    return new_reference,ev,rev,{"updated_source_snapshots":len(row),
         "updated_archive_snapshots":changed,"original_json_sha":previous,
         "revised_json_sha":after,"other_company_unchanged":True}

def rounds(replicas,store,baseline,quota,revision_a):
    results=[]
    for n in (100,300):
        for phase in ("cold","warm"):
            if phase=="cold":
                for r in replicas:r.ask("clear")
            before=states(replicas)
            with store.lock:prev_gets=store.requests
            start=now()
            def job(i):
                idx=i%48
                company=uuid.UUID(baseline[idx]["case"]["company"])
                client=replicas[i%2]
                token=v.token(company,v.USER_IDS[v.COMPANIES.index(company)])
                code,data,ms=client.post(idx,token,"p-"+str(quota)+"-"+str(n)+"-"+phase+"-"+str(i))
                check(code==200,("http",code,data,idx))
                check(data["sha256"]==m.sha(m.dump(baseline[idx]["result"])),"json_export_parity")
                check(data["revision"]==(revision_a if company==v.COMPANIES[0] else 1),"version")
                return ms
            with ThreadPoolExecutor(max_workers=n) as pool:ms=list(pool.map(job,range(n)))
            after=states(replicas)
            with store.lock:gets=store.requests-prev_gets
            check(all(a["service"]["queue_timeout"]==0 for a in after),"queue_timeout")
            check(all(a["service"]["max_inflight"]<=12 for a in after),"sql_bound")
            check(all(all(vv<=quota for vv in a["result_cache"]["current_per_tenant_bytes"].values()) for a in after),"result_quota")
            check(all(all(vv<=quota for vv in a["segment_cache"]["per_tenant_cached_bytes"].values()) for a in after),"archive_quota")
            info={"quota":quota,"clients":n,"phase":phase,"result":"PASS",
                  "p95_ms":m.pctl(ms,.95),"p99_ms":m.pctl(ms,.99),
                  "wall_sec":round(now()-start,3),"archive_gets":gets,
                  "sql_misses":sum(a["service"]["db_misses"]-b["service"]["db_misses"] for a,b in zip(after,before)),
                  "max_sql_active":max(a["service"]["max_inflight"] for a in after),
                  "max_queue":max(a["service"]["max_waiters"] for a in after),
                  "peak_result_cache_bytes":sum(a["result_cache"]["peak_total_bytes"] for a in after),
                  "peak_archive_cache_bytes":sum(a["segment_cache"]["max_cache_bytes"] for a in after)}
            print("QA_PROCESS_PHASE_JSON="+obj(info),flush=True)
            results.append(info)
    return results

def run(archive_dir,key_dir):
    archive_dir=Path(archive_dir)
    key=(Path(key_dir)/"synthetic-qa-key").read_bytes()
    manifest=json.loads((archive_dir/"manifest.json").read_bytes())
    original=json.loads((archive_dir/"rpc-baseline.json").read_bytes())
    check(len(original)==48 and p.sha(p.canon(original))==manifest["rpc_baseline_sha256"],"qa_source_integrity")
    q.init_db()
    history=expanded_history()
    store=p.Store(archive_dir);thread=threading.Thread(target=store.serve_forever,daemon=True);thread.start()
    pulse_stop=threading.Event();pulse_count={"heartbeat_sql":0,"failures":0}
    pulse=threading.Thread(target=heartbeat_loop,args=(pulse_stop,pulse_count),daemon=True);pulse.start()
    cohort=[]
    try:
        for quota in QUOTAS:
            with v.con() as c:
                with c.transaction():
                    c.execute("UPDATE qa_cache_revision SET version=1")
                    c.execute("UPDATE qa_user_acl SET allowed=true")
            # Reseed archive at each quota from baseline stored before the first change:
            # once altered, subsequent quotas verify same content with fresh revision.
            reference=json.loads((archive_dir/"rpc-baseline.json").read_bytes())
            client_url="http://127.0.0.1:"+str(store.server_address[1])
            peers=[Controller(i,client_url,archive_dir,key,quota) for i in range(2)]
            try:
                check(len({r.pid for r in peers})==2,"not_distinct_os_processes")
                time.sleep(.6)
                verify(peers,reference,0,1,"first-a")
                verify(peers,reference,24,1,"first-b")
                # Actually mutate commercial source+crypto exactly once in first cohort.
                if quota==QUOTAS[0]:
                    reference,ev,revision,changed=mutate_campaign_and_archive(archive_dir,key,reference)
                    event_seen(peers,ev)
                    check(revision==2,"revision2")
                    verify(peers,reference,0,2,"changed-a")
                    verify(peers,reference,24,1,"untouched-b")
                else:
                    changed={"reused_changed_commercial_fixture":True}
                    revision=1
                a=v.COMPANIES[0];token=v.token(a,v.USER_IDS[0])
                # Real JWT/RLS synthetics, check direct original membership too.
                deny(peers,0,v.token(v.COMPANIES[1],v.USER_IDS[1]),401,"cross-tenant")
                deny(peers,0,v.token(a,v.USER_IDS[0],ttl=-1),401,"expired-token")
                with v.con() as c:
                    with c.transaction():
                        v.auth(c,v.decode(token))
                        check(v.scalar(c,"SELECT count(*) FROM public.playback_logs WHERE company_id=%s",(v.COMPANIES[1],))==0,"RLS_broken")
                        try:v.rpc(c,"get_playback_report",v.COMPANIES[1],v.DAYS[0],v.DAYS[2])
                        except m.psycopg.Error as exc:check(exc.sqlstate=="42501","wrong_sqlstate")
                        else:raise AssertionError("original_rpc_membership_bypass")
                # Silent half-open LISTEN: socket remains alive; packets are discarded.
                peers[1].ask("blackhole")
                time.sleep(LEASE_SECONDS+.45)
                deny([peers[1]],0,token,503,"silent-feed-fail-closed")
                ev,revision=q.publish(a,"revoke_offline",v.USER_IDS[0],False)
                event_seen([peers[0]],ev)
                deny([peers[0]],0,token,401,"live-revoked")
                deny([peers[1]],0,token,503,"stale-unsafe")
                peers[1].ask("reconnect")
                deny(peers,0,token,401,"recovered-revoked")
                ev,revision=q.publish(a,"restore",v.USER_IDS[0],True)
                event_seen(peers,ev)
                verify(peers,reference,0,revision,"restored-a")
                # Archive outage: no ACK after forced cache miss.
                for peer in peers:peer.ask("clear")
                target=next(z for z in manifest["segments"] if z["descriptor"]["company"]==str(a)
                            and z["descriptor"]["local_day"]==reference[0]["case"]["start"])
                with store.lock:store.offline.add(target["file"])
                try:deny([peers[0]],0,token,503,"external-object-down")
                finally:
                    with store.lock:store.offline.clear()
                verify([peers[0]],reference,0,revision,"external-object-recovered")
                phases=rounds(peers,store,reference,quota,revision)
                end=states(peers)
                cohort.append({"quota":quota,"commercial_change":changed,"phases":phases,
                  "replicas":[{"pid":x["pid"],"rss_kib":x["rss_kib"],
                    "service":x["service"],"result_peak":x["result_cache"]["peak_total_bytes"],
                    "archive_peak":x["segment_cache"]["max_cache_bytes"],
                    "heartbeats":x["heartbeats"],"storage_refresh":x["refresh_count"]}
                     for x in end],
                  "checks":{"distinct_pids":True,"silent_half_open_fail_closed":True,
                    "reconnect_read_durable_revocation":True,
                    "jwt_rls_synthetic":True,"original_rpc_parity":True,
                    "changed_commercial_json":True,"missing_archive_recovery":True,
                    "no_per_request_acl_or_revision_sql":True}})
            finally:
                for peer in peers:peer.close()
        with v.con() as c:
            total=v.scalar(c,"SELECT count(*) FROM public.playback_logs")
            check(total==SOURCE_ROWS+EXTRA_ROWS,"source_rows_changed")
            check(v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None,"permanent_copy")
            db=int(v.scalar(c,"SELECT pg_database_size(current_database())"))
            idx={"source":int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')")),
                 "daily":int(v.scalar(c,"SELECT pg_indexes_size('qa_rpc.daily')"))}
        summary={"result":"PASS","two_distinct_os_pids":True,"pg17_disposable":True,
                 "source_rows_preserved":total,"extra_old_events":EXTRA_ROWS,
                 "no_second_permanent_event_table":True,
                 "history_metrics":history,"db_bytes":db,"indexes_bytes":idx,
                 "archive_gets_total":store.requests,
                 "heartbeat_sql_total":pulse_count,
                 "no_per_request_poll":True,"quotas":cohort,
                 "cost_model":"GETs and bytes only; no Supabase production price assumed",
                 "go_production":False}
        print("QA_PROCESS_SUMMARY_JSON="+obj(summary),flush=True)
        print("QA_PROCESS_PG17_PASS=true",flush=True)
    finally:
        pulse_stop.set();pulse.join(4)
        store.shutdown();store.server_close();thread.join(4)

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--archive",type=Path,required=True)
    ap.add_argument("--key-dir",type=Path,required=True)
    x=ap.parse_args();run(x.archive,x.key_dir)
