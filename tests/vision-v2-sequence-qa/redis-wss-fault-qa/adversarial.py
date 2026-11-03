"""Independent Redis 7 / WSS / PG17 adverse-state QA. Local synthetic keys only.
Green CI is intentional reproduction of Redis single-authority FAIL states,
not a claim of distributed security. Never connect an official host/service.
"""
from __future__ import annotations
import asyncio,base64,json,os,signal,ssl,subprocess,sys,tempfile,time
from pathlib import Path
import psycopg
from redis.asyncio import Redis
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

BRANCH="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.environ.get("GITHUB_REF")==BRANCH
assert os.environ.get("QA_STREAM_GUARD_GROUP")=="1"
for key in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
    assert not os.environ.get(key),("live credential forbidden",key)
ROOT=Path(__file__).resolve().parent.parent/"wss-scale-qa"
sys.path.insert(0,str(ROOT))
import gateway as original
CID=os.environ["QA_REDIS_PRIMARY_CONTAINER"]
assert len(CID)>=12 and all(c in "0123456789abcdef" for c in CID.lower()),"Redis Docker container ID required"
DSN=original.DSN
def check(value,name):
    assert value,name
def prepare():
    with psycopg.connect(DSN,autocommit=True) as c:
        check(c.execute("SELECT current_database()").fetchone()[0]=="vision_v2_quarantine_disposable","not disposable db")
        check(int(c.execute("SHOW server_version_num").fetchone()[0])//10000==17,"not PG17")
        c.execute("CREATE SCHEMA qa_wss")
        c.execute("""CREATE TABLE qa_wss.status(
            tenant text NOT NULL,device text NOT NULL,lease text NOT NULL,
            online boolean NOT NULL,changed_at timestamptz NOT NULL,
            PRIMARY KEY(tenant,device))""")
        c.execute("""CREATE TABLE qa_wss.commands(
            tenant text NOT NULL,device text NOT NULL,id text NOT NULL,
            acknowledged_at timestamptz NOT NULL,PRIMARY KEY(tenant,device,id))""")
def jti(t):
    parts=t.split(".")
    return json.loads(base64.urlsafe_b64decode(parts[1]+"="*(-len(parts[1])%4)))["jti"]
def docker(command):
    p=subprocess.run(["docker",command,CID],check=True,stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,text=True,timeout=25)
    return p.stdout.strip()
async def alive(redis,timeout=12):
    till=time.monotonic()+timeout
    while time.monotonic()<till:
        try:
            if await redis.ping():return
        except Exception:pass
        await asyncio.sleep(.12)
    raise AssertionError("Redis failed to become ready")
async def port_ready(port,proc):
    for _ in range(120):
        check(proc.poll() is None,("gateway died",proc.poll()))
        try:
            r,w=await asyncio.open_connection("127.0.0.1",port)
            w.close();await w.wait_closed()
            return
        except OSError:await asyncio.sleep(.1)
    raise AssertionError("WSS gateway failed to start")
async def start_gw(path,name,port,cert,key,log):
    f=open(log,"wb")
    proc=subprocess.Popen([sys.executable,str(path),"--instance",name,
        "--port",str(port),"--cert",str(cert),"--key",str(key),
        "--capacity","250"],stdout=f,stderr=subprocess.STDOUT)
    await port_ready(port,proc)
    return proc,f
async def auth(port,t,ctx):
    ws=await connect("wss://localhost:"+str(port),ssl=ctx,
       ping_interval=None,open_timeout=6,close_timeout=1,max_size=2048)
    await ws.send(json.dumps({"type":"auth","token":t}))
    try:
        response=json.loads(await asyncio.wait_for(ws.recv(),timeout=5))
    except Exception:
        await ws.close();raise
    if response.get("type")!="ready":
        await ws.close()
        return None,response
    return ws,response
async def heartbeat(ws,ready,seq):
    try:
        await ws.send(json.dumps({"type":"heartbeat","nonce":ready["nonce"],"seq":seq}))
        return json.loads(await asyncio.wait_for(ws.recv(),timeout=3))
    except (ConnectionClosed,ConnectionError,OSError,TimeoutError,asyncio.TimeoutError):
        return {"type":"closed_or_timeout"}
async def main():
    started=time.monotonic()
    cert=Path(os.environ["QA_CERT"]).resolve()
    key=Path(os.environ["QA_KEY"]).resolve()
    prepare()
    redis_a=Redis(host="127.0.0.1",port=6379,decode_responses=True,
         socket_connect_timeout=1,socket_timeout=1)
    redis_b=Redis(host="127.0.0.1",port=6380,decode_responses=True,
         socket_connect_timeout=1,socket_timeout=1)
    await alive(redis_a);await alive(redis_b)
    await redis_a.flushdb();await redis_b.flushdb()
    await redis_a.hset("qa:owners",mapping={"tv-0000":"company-A","tv-0001":"company-B"})
    await redis_b.hset("qa:owners",mapping={"tv-0000":"company-A","tv-0001":"company-B"})
    folder=Path(tempfile.mkdtemp(prefix="vision_v2_wss_faults_"))
    source=(ROOT/"gateway.py").read_text()
    check("port=6379" in source,"Redis hardcoded port changed without auditing")
    check("refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031" in source,
         "upstream branch guard changed")
    source=source.replace("refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031",BRANCH)
    p0=folder/"gateway-primary.py"
    p1=folder/"gateway-secondary.py"
    p0.write_text(source)
    p1.write_text(source.replace("port=6379","port=6380"))
    ctx=ssl.create_default_context(cafile=str(cert))
    ctx.check_hostname=True
    procs=[];files=[];ws0=None;ws1=None;ws2=None
    primary_down=False
    summary=dict(production_GO=False,security_verdict="FAIL_EXPECTED_SPLIT_BRAIN_AND_REPLAY_AFTER_ROLLBACK",
        two_independent_OS_gateways=True,two_independent_Redis7_nodes=True,
        PG17_disposable=True,live_APK_integrated=False,
        standalone_distributed_fencing_proven=False)
    try:
        for i,(src,port) in enumerate(((p0,20020),(p1,20021))):
            p,f=await start_gw(src,"fault-gw-"+str(i),port,cert,key,
                 folder/("gateway-"+str(i)+".log"))
            procs.append(p);files.append(f)
        t=original.token("company-A","tv-0000",seconds=180)
        ws0,a0=await auth(20020,t,ctx)
        check(ws0 and a0["type"]=="ready","primary JWT login failed")
        reused,deny=await auth(20020,t,ctx)
        check(reused is None and deny.get("error")=="JWT_REPLAY",("single node replay not rejected",deny))
        cross,cross_reply=await auth(20021,original.token("company-B","tv-0000"),ctx)
        check(cross is None and cross_reply.get("error")=="TENANT_MISMATCH",
             ("tenant cross violation",cross_reply))
        expired,expired_reply=await auth(20020,original.token("company-A","tv-0000",seconds=-10),ctx)
        check(expired is None and expired_reply.get("type")=="error","expired JWT accepted")
        h0=await heartbeat(ws0,a0,1)
        check(h0.get("type")=="heartbeat_ack","primary heartbeat failed")
        # Two independently authoritative Redis primaries, each with its own
        # JTI store. This models a split brain; not a real Redis Sentinel failover.
        ws1,a1=await auth(20021,t,ctx)
        check(ws1 and a1.get("type")=="ready",
              ("split brain counterexample NOT reproduced",a1))
        h1=await heartbeat(ws1,a1,1)
        check(h1.get("type")=="heartbeat_ack","secondary heartbeat failed")
        check(a0["session"]!=a1["session"],"duplicate JWT replaced same lease")
        with psycopg.connect(DSN,autocommit=True) as c:
            status=c.execute("SELECT lease FROM qa_wss.status WHERE tenant='company-A' AND device='tv-0000'").fetchone()
        check(status is not None,"SQL status missing")
        summary["split_brain"]=dict(
            status="SECURITY_FAIL_REPRODUCED",same_JWT_accepted_across_Redis_authorities=True,
            both_sessions_heartbeat_ACK=True,distinct_leases=True,
            SQL_record_contains_only_one_lease=True)
        # Actual primary Redis SERVICE outage; ensure no ACK issued by its gateway.
        await asyncio.to_thread(docker,"stop")
        primary_down=True
        await asyncio.sleep(.3)
        outage=await heartbeat(ws0,a0,2)
        check(outage.get("type")!="heartbeat_ack",("ACK while Redis down",outage))
        summary["primary_Redis_outage"]=dict(
            no_heartbeat_ack_while_down=True,response=outage.get("type"),
            disconnect_enforced=outage.get("type") in ("error","closed_or_timeout"))
        # The separate gateway must still serve from its independent authority.
        h1b=await heartbeat(ws1,a1,2)
        check(h1b.get("type")=="heartbeat_ack","secondary fell over with primary")
        await asyncio.to_thread(docker,"start")
        primary_down=False
        await alive(redis_a)
        # Loss/rollback of Redis volatile state including spent JTI, owners and
        # leases. Re-seed only a publicly configured owner map, NOT used JTI.
        await redis_a.flushdb()
        await redis_a.hset("qa:owners",mapping={"tv-0000":"company-A","tv-0001":"company-B"})
        old=await heartbeat(ws0,a0,3)
        check(old.get("type")!="heartbeat_ack",("stale session accepted after reset",old))
        summary["stale_session_after_reset"]=dict(
            stale_heartbeat_ACK=False,result=old.get("type"))
        ws2,a2=await auth(20020,t,ctx)
        check(ws2 and a2.get("type")=="ready",
             ("rollback JTI-loss counterexample NOT reproduced",a2))
        check(a2["session"]!=a0["session"],"rollback token unexpectedly retained old lease")
        h2=await heartbeat(ws2,a2,1)
        check(h2.get("type")=="heartbeat_ack","replayed token session not live")
        summary["Redis_state_rollback"]=dict(
            status="SECURITY_FAIL_REPRODUCED",
            spent_JTI_reaccepted_after_redis_flush_and_owner_restore=True,
            old_session_heartbeat_rejected=True,
            SQL_used_for_global_JTI_replay_guard=False)
        # Explicitly test that the loser of a single-node lease overwrite fails.
        tnew=original.token("company-A","tv-0000")
        ws3,a3=await auth(20020,tnew,ctx)
        check(ws3 is not None,"new token did not open")
        prev=await heartbeat(ws2,a2,2)
        check(prev.get("type")!="heartbeat_ack",
             ("stale Redis lease sent valid ACK",prev))
        await ws3.close()
        summary["same_Redis_stale_lease"]=dict(
            old_session_denied=True,
            status="PASS_SINGLE_AUTHORITY_ONLY")
        summary["CI_expected_failure_proof_validated"]=True
        summary["duration_seconds"]=round(time.monotonic()-started,3)
        Path("qa-v2-redis-wss-adversarial.json").write_text(json.dumps(summary,indent=2,sort_keys=True))
        print("QA_REDIS_WSS_ADVERSARIAL_JSON="+json.dumps(summary,sort_keys=True),flush=True)
    finally:
        if primary_down:
            try:await asyncio.to_thread(docker,"start")
            except Exception:pass
        for ws in (ws0,ws1,ws2):
            if ws is not None:
                try:await asyncio.wait_for(ws.close(),timeout=2)
                except Exception:pass
        for proc in procs:
            if proc.poll() is None:
                proc.terminate()
                try:await asyncio.to_thread(proc.wait,3)
                except subprocess.TimeoutExpired:
                    proc.kill();await asyncio.to_thread(proc.wait,3)
        for f in files:f.close()
        for item in folder.glob("gateway-*.log"):
            txt=item.read_text(errors="replace")
            print("GATEWAY_LOG_"+item.name+"="+txt[-3500:],flush=True)
        await redis_a.aclose();await redis_b.aclose()
if __name__=="__main__":
    asyncio.run(main())
