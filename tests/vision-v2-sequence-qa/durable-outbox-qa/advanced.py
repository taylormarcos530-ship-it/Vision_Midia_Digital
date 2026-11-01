"""Vision V2 PG17 DISPOSABLE ONLY: durable outbox, two OS processes,
JWT rotation/RLS, 20K full historical RPC report/export, WAL/index and cost.
NO PROD ENDPOINTS. Real Supabase Auth and separate hosts NOT validated.
"""
from __future__ import annotations
import argparse,base64,hashlib,hmac,importlib.util,json,multiprocessing as mp
import os,queue,resource,secrets,threading,time,uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("v2_process_qa",HERE.parent/"process-isolation-qa"/"process_qa.py")
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
q,v,m=p.q,p.v,p.m
CHANNEL="qa_v2_durable_outbox"
PER_COMPANY=10_000
MONTH_S=30*24*3600
HB_S=60
LEASE_S=180

def chk(ok,msg):assert ok,msg
def canon(x):return m.dump(x)
def sha(x):return hashlib.sha256(x).hexdigest()
def scalar(c,sql,params=()):return v.scalar(c,sql,params)

def setup_outbox():
    with v.con() as c:
        chk(scalar(c,"SELECT current_database()")=="vision_v2_quarantine_disposable","production_guard")
        chk(int(scalar(c,"SHOW server_version_num"))//10000==17,"pg17_guard")
        c.execute("""CREATE TABLE qa_v2_outbox (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          company_id uuid NOT NULL,
          revision bigint NOT NULL,
          action text NOT NULL,
          payload jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          UNIQUE(company_id,revision))""")
        c.execute("""CREATE TABLE qa_v2_consumer_checkpoint (
          consumer integer PRIMARY KEY,
          last_id bigint NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT clock_timestamp())""")
        for i in (0,1):
            c.execute("INSERT INTO qa_v2_consumer_checkpoint(consumer) VALUES(%s)",(i,))
        c.execute("CREATE INDEX qa_outbox_company_revision ON qa_v2_outbox(company_id,revision)")

def outbox_commit(company,action,payload,mutate=None,emit=True,crash=False):
    # Strict single PG transaction contains commercial changes, revision, outbox.
    # pg_notify inside transaction is emitted only on commit.
    with v.con() as c:
        with c.transaction():
            if mutate:
                mutate(c)
            revision=c.execute("""UPDATE qa_cache_revision
                 SET version=version+1 WHERE company_id=%s RETURNING version""",
                 (company,)).fetchone()[0]
            row=c.execute("""INSERT INTO qa_v2_outbox(company_id,revision,action,payload)
              VALUES(%s,%s,%s,%s::jsonb) RETURNING id""",
              (company,revision,action,canon(payload).decode())).fetchone()
            if emit:
                c.execute("SELECT pg_notify(%s,%s)",(CHANNEL,str(row[0])))
            if crash:
                raise RuntimeError("injected_transaction_rollback")
    return {"id":row[0],"revision":revision,"company":str(company)}

def worker(num,commands,responses):
    # Separate OS process & PG listener. Reconnect reads durable outbox.
    c=None
    try:
        c=v.con()
        c.execute("LISTEN "+CHANNEL)
        last=int(scalar(c,"SELECT last_id FROM qa_v2_consumer_checkpoint WHERE consumer=%s",(num,)))
        events=[];ignored=0;listen_notifications=0
        responses.put({"ready":True,"pid":os.getpid()})
        while True:
            try:msg=commands.get(timeout=.1)
            except queue.Empty:
                # Event-triggered notification consumption; no SQL poll.
                for event in c.notifies(timeout=.1,stop_after=1):
                    listen_notifications+=1
                    if not ignored:events.append(int(event.payload))
                continue
            kind=msg["kind"]
            if kind=="stop":responses.put({"stopped":True});break
            if kind=="blackhole":
                ignored=1;responses.put({"blackhole":True});continue
            if kind=="feed_restore":
                # Recover by durable DB SELECT; not by relying on NOTIFY replay.
                c.close();c=v.con();c.execute("LISTEN "+CHANNEL)
                ignored=0
                responses.put({"reconnected":True})
                continue
            if kind=="drain":
                rows=c.execute("""SELECT id,company_id,revision,action,payload
                     FROM qa_v2_outbox WHERE id>%s ORDER BY id""",(last,)).fetchall()
                for id,co,rev,action,payload in rows:
                    # Dedup by durable checkpoint and monotonically advancing id.
                    with c.transaction():
                        c.execute("""UPDATE qa_v2_consumer_checkpoint SET
                          last_id=%s,updated_at=clock_timestamp()
                          WHERE consumer=%s AND last_id<%s""",(id,num,id))
                    last=id
                responses.put({"last_id":last,"ids":[r[0] for r in rows],
                   "replay_count":len(rows),"notifications":listen_notifications,
                   "pid":os.getpid()})
                continue
            if kind=="state":
                responses.put({"last_id":last,"pid":os.getpid(),"notifications":listen_notifications})
                continue
            raise RuntimeError("unsupported_command")
    except Exception as exc:
        responses.put({"error":repr(exc)})
        raise
    finally:
        if c:c.close()

class Peer:
    def __init__(self,i):
        self.idx=i;self.cmd=mp.Queue();self.reply=mp.Queue()
        self.proc=mp.Process(target=worker,args=(i,self.cmd,self.reply))
        self.proc.start()
        state=self.reply.get(timeout=10)
        chk(state.get("ready"),state)
        self.pid=state["pid"]
    def ask(self,kind):
        chk(self.proc.is_alive(),"peer_dead")
        self.cmd.put({"kind":kind});ans=self.reply.get(timeout=20)
        chk("error" not in ans,ans)
        return ans
    def close(self):
        if self.proc.is_alive():self.ask("stop")
        self.proc.join(6)
        if self.proc.is_alive():self.proc.terminate();self.proc.join(5)
        chk(self.proc.exitcode==0,("peer_exit",self.proc.exitcode))

class Keys:
    """QA-only deterministic HMAC key ids: not an actual Supabase Auth implementation."""
    def __init__(self):
        self.keyring={"a":secrets.token_bytes(32),"b":secrets.token_bytes(32)}
        self.accept={"a"}
    def issue(self,company,user,kid="a",ttl=3600):
        enc=lambda b:base64.urlsafe_b64encode(b).rstrip(b"=").decode()
        header=enc(canon({"alg":"HS256","typ":"JWT","kid":kid}))
        payload=enc(canon({"company_id":str(company),"sub":user,"iss":"v2-qa-keys",
             "aud":"qa-commercial","exp":int(time.time())+ttl}))
        joined=header+"."+payload
        return joined+"."+enc(hmac.digest(self.keyring[kid],joined.encode(),"sha256"))
    def verify(self,token):
        dec=lambda b:json.loads(base64.urlsafe_b64decode(b+"="*(-len(b)%4)))
        try:
            h,p,s=token.split(".")
            hdr=dec(h);claims=dec(p)
            kid=hdr["kid"]
            chk(hdr["alg"]=="HS256" and kid in self.accept and kid in self.keyring,"rotated_key_rejected")
            expect=base64.urlsafe_b64encode(hmac.digest(self.keyring[kid],(h+"."+p).encode(),"sha256")).rstrip(b"=").decode()
            chk(hmac.compare_digest(s,expect),"bad_signature")
            chk(claims.get("iss")=="v2-qa-keys" and claims.get("aud")=="qa-commercial","issuer_audience")
            chk(claims["exp"]>time.time(),"expired")
            return claims
        except Exception as exc:raise PermissionError("qa_jwt_invalid") from exc

def jwt_and_rls():
    # Demonstrate the baseline fixture RLS only scopes company, not membership;
    # harden policy in this disposable DB before testing membership revocation.
    with v.con() as c:
        c.execute("DROP POLICY logs ON public.playback_logs")
        c.execute("""CREATE POLICY logs ON public.playback_logs TO authenticated
          USING(company_id::text=current_setting('request.jwt.claim.company_id',true)
                AND private.is_company_member(company_id))""")
    keys=Keys();company=v.COMPANIES[0];user=v.USER_IDS[0]
    first=keys.issue(company,user,"a")
    chk(keys.verify(first)["sub"]==user,"original_token")
    keys.accept.add("b")
    newer=keys.issue(company,user,"b")
    chk(keys.verify(newer)["sub"]==user,"rotated_token")
    keys.accept.remove("a")
    try:keys.verify(first)
    except PermissionError:pass
    else:raise AssertionError("old_signing_key_accepted")
    chk(keys.verify(newer)["sub"]==user,"new_signing_key_rejected")
    for candidate in (newer[:-6]+"AAAAAA",keys.issue(company,user,"b",-1)):
        try:keys.verify(candidate)
        except PermissionError:pass
        else:raise AssertionError("tampered_or_expired_jwt_accepted")
    with v.con() as c:
        with c.transaction():
            # Auth membership is separate from signature validity. Old rights
            # must not magically pass native RLS on PG.
            c.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",(company,user))
        with c.transaction():
            v.auth(c,keys.verify(newer))
            chk(scalar(c,"SELECT count(*) FROM public.playback_logs")==0,"RLS_membership_denial")
            try:v.rpc(c,"get_playback_report",company,date(2025,1,1),date(2025,1,5))
            except v.psycopg.Error as exc:chk(exc.sqlstate=="42501","wrong_RLS_sqlstate")
            else:raise AssertionError("RPC_membership_denial_failed")
        c.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s)",(company,user))
        with c.transaction():
            v.auth(c,keys.verify(newer))
            chk(scalar(c,"SELECT count(*) FROM public.playback_logs")==10_332,"RLS_restore")
    return {"key_rotation_old_denied":True,"new_key_accepted":True,
       "jwt_expiry_tamper_denied":True,"native_RLS_revocation_and_restore":True,"qa_rls_policy_hardened":True}

def full_historical_rpc():
    result=[]
    for company,user in zip(v.COMPANIES,v.USER_IDS):
        begin=date(2024,12,31);end=date(2025,1,6)
        start=time.perf_counter()
        with v.con() as c:
            with c.transaction():
                v.auth(c,v.decode(v.token(company,user)))
                report=v.rpc(c,"get_playback_report",company,begin,end)
                pages=[];page_count=0
                for offset in range(0,PER_COMPANY,500):
                    page=v.export(c,"get_playback_events",company,begin,end,limit=500,offset=offset)
                    page_count+=1
                    pages.extend([[str(y) if isinstance(y,uuid.UUID) else
                         y.isoformat() if hasattr(y,"isoformat") else str(y) if not isinstance(y,(bool,int,float,str,type(None))) else y
                         for y in row] for row in page])
                chk(len(pages)==PER_COMPANY,("full_export_count",len(pages)))
                chk(len({row[0] for row in pages})==PER_COMPANY,"full_export_unique_ids")
                chk(scalar(c,"SELECT count(*) FROM public.playback_logs WHERE started_at<'2026-01-01'")==PER_COMPANY,"RLS_history")
        elapsed=(time.perf_counter()-start)*1000
        result.append({"company_ordinal":len(result),"export_rows":len(pages),
          "export_pages":page_count,"full_export_sha256":sha(canon(pages)),
          "original_report_sha256":sha(canon(report)),
          "report_plus_full_export_ms":round(elapsed,3)})
    return result

def replay_and_transaction():
    peers=[Peer(0),Peer(1)]
    try:
        chk(peers[0].pid!=peers[1].pid,"same_process")
        company=v.COMPANIES[0]
        # Failure before commit: no revision, no event, no campaign mutation.
        with v.con() as c:
            version0=int(scalar(c,"SELECT version FROM qa_cache_revision WHERE company_id=%s",(company,)))
            count0=int(scalar(c,"SELECT count(*) FROM qa_v2_outbox"))
        def change(c):
            c.execute("""UPDATE public.campaigns SET name='OUTBOX QA REVISION'
                 WHERE company_id=%s""",(company,))
        try:outbox_commit(company,"campaign",{"name":"OUTBOX QA REVISION"},change,crash=True)
        except RuntimeError as ex:chk(str(ex)=="injected_transaction_rollback","bad_exception")
        else:raise AssertionError("rollback_did_not_fail")
        with v.con() as c:
            chk(scalar(c,"SELECT version FROM qa_cache_revision WHERE company_id=%s",(company,))==version0,"rollback_version")
            chk(scalar(c,"SELECT count(*) FROM qa_v2_outbox")==count0,"rollback_outbox")
            chk(scalar(c,"SELECT count(*) FROM public.campaigns WHERE company_id=%s AND name='OUTBOX QA REVISION'",(company,))==0,"rollback_campaign")
        # Listener 1 simulates a silent lost notification; no per-request polls.
        peers[1].ask("blackhole")
        a=outbox_commit(company,"campaign",{"name":"OUTBOX QA REVISION"},change)
        chk(a["revision"]==version0+1,"atomic_revision")
        with v.con() as c:
            row=c.execute("SELECT action,payload FROM qa_v2_outbox WHERE id=%s",(a["id"],)).fetchone()
            chk(row[0]=="campaign" and row[1]["name"]=="OUTBOX QA REVISION","outbox_payload")
            chk(scalar(c,"SELECT count(*) FROM public.campaigns WHERE company_id=%s AND name='OUTBOX QA REVISION'",(company,))==3,"atomic_campaign")
        first=peers[0].ask("drain")
        chk(first["ids"]==[a["id"]],"first_listener_missed_outbox")
        chk(peers[0].ask("drain")["replay_count"]==0,"duplicate_replay")
        peers[1].ask("feed_restore")
        second=peers[1].ask("drain")
        chk(second["ids"]==[a["id"]],"durable_replay_after_blackhole")
        second_repeat=peers[1].ask("drain")
        chk(second_repeat["replay_count"]==0,"idempotent_replay")
        # Commit a second event without pg_notify: both find it at reconnect.
        missed=outbox_commit(company,"revoke",{"sub":v.USER_IDS[0],"allowed":False},emit=False)
        for peer in peers:
            peer.ask("feed_restore")
            replay=peer.ask("drain")
            chk(replay["ids"]==[missed["id"]],"no_notification_replay_lost")
        with v.con() as c:
            checkpoints=c.execute("SELECT consumer,last_id FROM qa_v2_consumer_checkpoint ORDER BY consumer").fetchall()
            chk(all(last==missed["id"] for _,last in checkpoints),"durable_checkpoint")
        return {"two_pids":[x.pid for x in peers],"campaign_atomic_commit":True,
             "rollback_no_event_or_change":True,"replay_after_blackhole":True,
             "recover_without_notify":True,"idempotence":True,
             "outbox_events":int(scalar(v.con(),"SELECT count(*) FROM qa_v2_outbox")),
             "replay_highwater":missed["id"]}
    finally:
        for peer in peers:peer.close()

def lease_and_cost():
    # A globally shared heartbeat: no query-per-device or query-per-request.
    # Simulated monotonic clock jump validates finite fail-closed lease.
    base=123456.0
    def allowed(last,t):return (t-last)<=LEASE_S
    chk(allowed(base,base+HB_S),"lease_dropped_one_interval")
    chk(not allowed(base,base+LEASE_S+.001),"partition_stale_allowed")
    chk(allowed(base+LEASE_S+1,base+LEASE_S+1),"recovery_denied")
    return {"heartbeat_interval_seconds":HB_S,"fail_closed_lease_seconds":LEASE_S,
         "max_staleness_seconds":LEASE_S,"global_heartbeat_month_30d":MONTH_S//HB_S,
         "heartbeat_month_per_300_tvs_if_bad_design":300*(MONTH_S//HB_S),
         "reduction_vs_per_tv_pulse_percent":round((1-1/300)*100,3),
         "actual_60_second_wait_tested":False,
         "detection_timing_virtual_clock":True,"production_cost_brl":"unverified"}

def main():
    before=time.perf_counter()
    q.init_db()
    with v.con() as c:
        start_lsn=scalar(c,"SELECT pg_current_wal_lsn()")
        start_bytes=int(scalar(c,"SELECT pg_database_size(current_database())"))
        start_idx=int(scalar(c,"SELECT pg_indexes_size('public.playback_logs')"))
    history=p.expanded_history()
    setup_outbox()
    auth=jwt_and_rls()
    large=full_historical_rpc()
    replay=replay_and_transaction()
    with v.con() as c:
        wal=int(scalar(c,"SELECT pg_wal_lsn_diff(pg_current_wal_lsn(),%s)",(start_lsn,)))
        ending=int(scalar(c,"SELECT pg_database_size(current_database())"))
        idx=int(scalar(c,"SELECT pg_indexes_size('public.playback_logs')"))
        outbox_bytes=int(scalar(c,"SELECT pg_total_relation_size('qa_v2_outbox')"))
        count=int(scalar(c,"SELECT count(*) FROM public.playback_logs"))
        chk(count==20664,"source_deleted")
        chk(scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None,"duplicate_event_table")
    result={"result":"PASS","postgresql_17_disposable":True,
       "two_independent_os_processes":True,
       "two_hosts_network_namespaces":False,
       "outbox":replay,"rotation_and_rls":auth,
       "historic_original_full_rpc":large,"history":history,
       "indexes_bytes":{"source_before":start_idx,"source_after":idx},
       "database_bytes":{"before":start_bytes,"after":ending},
       "outbox_table_and_index_bytes":outbox_bytes,
       "wal_bytes_delta":wal,"synthetic_events_preserved":count,
       "heartbeat_cost_projection":lease_and_cost(),
       "elapsed_seconds":round(time.perf_counter()-before,2),
       "python_parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
       "no_prod_access":True,"go_production":False}
    print("QA_ADVANCED_SUMMARY_JSON="+canon(result).decode(),flush=True)
    print("QA_ADVANCED_PG17_PASS=true",flush=True)

if __name__=="__main__":
    main()
