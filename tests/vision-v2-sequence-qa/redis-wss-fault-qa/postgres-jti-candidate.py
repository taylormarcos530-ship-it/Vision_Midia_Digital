"""A limited candidate FIX for *proven* duplicate JTI across Redis authorities.

Single disposable PostgreSQL17 unique JTI ledger fences authentication only.
No PostgreSQL writes per heartbeat; DB+Redis simultaneous rollback remains FAIL.
This is NOT the actual production WSS gateway or a deployable change.
"""
from __future__ import annotations
import asyncio,json,os,ssl,sys,tempfile,time
from pathlib import Path
import psycopg
from redis.asyncio import Redis
import adversarial as base

BRANCH=base.BRANCH
assert os.environ.get("GITHUB_REF")==BRANCH
assert os.environ.get("QA_STREAM_GUARD_GROUP")=="1"
def rowcount():
    with psycopg.connect(base.DSN,autocommit=True) as c:
        return c.execute("SELECT count(*) FROM qa_wss.global_auth_jti").fetchone()[0]
def writer(sql):
    with psycopg.connect(base.DSN,autocommit=True) as c:c.execute(sql)
async def main():
    begun=time.monotonic()
    base.prepare()
    writer("""CREATE TABLE qa_wss.global_auth_jti (
      jti text PRIMARY KEY,
      tenant text NOT NULL,
      device text NOT NULL,
      consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )""")
    a=Redis(host="127.0.0.1",port=6379,decode_responses=True,
        socket_connect_timeout=1,socket_timeout=1)
    b=Redis(host="127.0.0.1",port=6380,decode_responses=True,
        socket_connect_timeout=1,socket_timeout=1)
    await base.alive(a);await base.alive(b)
    await a.flushdb();await b.flushdb()
    for client in (a,b):
        await client.hset("qa:owners",mapping={"tv-0000":"company-A"})
    root=Path(tempfile.mkdtemp(prefix="vision_v2_pg_authority_"))
    source=(base.ROOT/"gateway.py").read_text()
    source=source.replace("refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031",BRANCH)
    target="   lease=secrets.token_hex(18)"
    base.check(source.count(target)==1,"gateway hook changed")
    code="""   # Candidate QA only: one durable shared SQL conflict per NEW JWT.
   # Do not issue a 'ready' token before this transaction commits.
   async with self.pool.connection() as c:
    cur=await c.execute(
      'INSERT INTO qa_wss.global_auth_jti(jti,tenant,device) VALUES(%s,%s,%s) '
      'ON CONFLICT DO NOTHING RETURNING jti',
      (claims['jti'],tenant,device))
    if not await cur.fetchone():raise PermissionError('JTI_GLOBAL_REPLAY')
"""
    source=source.replace(target,code+target)
    # Keep two deliberately divergent Redis nodes; same one durable SQL ledger.
    locations=[]
    for idx,(port,redis_port) in enumerate(((20030,6379),(20031,6380))):
        path=root/("candidate-"+str(idx)+".py")
        path.write_text(source.replace("port=6379","port="+str(redis_port)))
        locations.append((path,port))
    cert=Path(os.environ["QA_CERT"]).resolve()
    key=Path(os.environ["QA_KEY"]).resolve()
    ctx=ssl.create_default_context(cafile=str(cert));ctx.check_hostname=True
    procs=[];logs=[];active=[]
    report=dict(production_GO=False,PG17_ledger_candidates_only=True,
        Redis_authorities_independent=True,SQL_write_per_new_login=1,
        SQL_write_per_heartbeat=0,
        issuer_and_RLS_real=False,
        required_independent_rollback_proof_missing=True)
    try:
        for idx,(src,port) in enumerate(locations):
            p,f=await base.start_gw(src,"pg-jti-"+str(idx),port,cert,key,
                root/("candidate-"+str(idx)+".log"))
            procs.append(p);logs.append(f)
        # Concurrent same JWT across two Redis independent nodes; only one
        # authorization can successfully INSERT the shared unique PG JTI.
        t=base.original.token("company-A","tv-0000")
        attempts=await asyncio.gather(base.auth(20030,t,ctx),base.auth(20031,t,ctx))
        accepted=[(i,ws,rep) for i,(ws,rep) in enumerate(attempts) if ws is not None]
        denied=[rep for ws,rep in attempts if ws is None]
        base.check(len(accepted)==1 and len(denied)==1,
            ("global replay not prevented",attempts))
        base.check(denied[0].get("error")=="JTI_GLOBAL_REPLAY",
            ("wrong denial",denied))
        active.append(accepted[0][1])
        first=await base.heartbeat(accepted[0][1],accepted[0][2],1)
        base.check(first.get("type")=="heartbeat_ack","candidate heartbeat failed")
        base.check(rowcount()==1,"unique JTI table incorrect")
        for idx in range(2,10):
            resp=await base.heartbeat(accepted[0][1],accepted[0][2],idx)
            base.check(resp.get("type")=="heartbeat_ack","candidate heartbeat failed")
        base.check(rowcount()==1,"heartbeat changed SQL JTI ledger")
        report["cross_Redis_replay_candidate"]=dict(
            status="PASS_SHARED_PG17_LEDGER_LOCAL",
            exactly_one_of_two_concurrent_auths_accepted=True,
            rejected_code=denied[0]["error"],
            PG17_rows_after_heartbeats=1)
        # Reset Redis only, re-establish synthetic owners: used JTI persists.
        for client in (a,b):
            await client.flushdb()
            await client.hset("qa:owners",mapping={"tv-0000":"company-A"})
        replay,denial=await base.auth(20030,t,ctx)
        base.check(replay is None and denial.get("error")=="JTI_GLOBAL_REPLAY",
             ("Redis-only rollback bypassed shared SQL ledger",denial))
        report["Redis_only_rollback"]=dict(status="PASS_SHARED_PG17_LEDGER_LOCAL",
             reused_JTI_rejected_after_volatile_state_loss=True)
        # A real missing DB ledger fails closed, never authorizes on Redis.
        writer("ALTER TABLE qa_wss.global_auth_jti RENAME TO global_auth_jti_paused")
        try:
            failed,reply=await base.auth(20031,base.original.token("company-A","tv-0000"),ctx)
            base.check(failed is None and reply.get("type")=="error",
                 ("PG authority outage allowed JWT",reply))
        finally:
            writer("ALTER TABLE qa_wss.global_auth_jti_paused RENAME TO global_auth_jti")
        report["authority_table_unavailable"]=dict(status="PASS_FAIL_CLOSED_QA",
             authentication_rejected_without_SQL_authority=True)
        # Adversarial NEGATIVE: if BOTH PG unique ledger AND Redis state are
        # rolled back together, same previously used JTI gets accepted.
        with psycopg.connect(base.DSN,autocommit=True) as c:
            c.execute("DELETE FROM qa_wss.global_auth_jti WHERE jti=%s",(base.jti(t),))
        for client in (a,b):
            await client.flushdb()
            await client.hset("qa:owners",mapping={"tv-0000":"company-A"})
        again,ready=await base.auth(20031,t,ctx)
        base.check(again is not None and ready.get("type")=="ready",
             ("joint rollback negative proof did not reproduce",ready))
        active.append(again)
        report["joint_SQL_Redis_rollback"]=dict(status="SECURITY_FAIL_REPRODUCED",
             same_JTI_accepted_after_both_authorities_rolled_back=True,
             independent_nonrollback_witness_present=False)
        report["security_verdict"]="NO_GO_JOINT_ROLLBACK_AND_REAL_IDENTITY_UNPROVEN"
        report["total_seconds"]=round(time.monotonic()-begun,3)
        Path("qa-v2-pg-auth-jti-candidate.json").write_text(json.dumps(report,indent=2,sort_keys=True))
        print("QA_PG_JTI_CANDIDATE_JSON="+json.dumps(report,sort_keys=True),flush=True)
    finally:
        for ws in active:
            try:await asyncio.wait_for(ws.close(),timeout=2)
            except Exception:pass
        for proc in procs:
            if proc.poll() is None:
                proc.terminate()
                try:await asyncio.to_thread(proc.wait,3)
                except Exception:
                    proc.kill();await asyncio.to_thread(proc.wait,3)
        for f in logs:f.close()
        for path in root.glob("candidate-*.log"):
            print("GATEWAY_LOG_"+path.name+"="+path.read_text(errors="replace")[-2800:],flush=True)
        await a.aclose();await b.aclose()
if __name__=="__main__":
    asyncio.run(main())
