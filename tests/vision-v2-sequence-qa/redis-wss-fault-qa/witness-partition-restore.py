"""Adversarial WSS auth witness: real pg_dump/pg_restore, localhost TCP path
SIGKILL, two uncoordinated PG17 authorities, Redis ownership divergence.
Explicit FAIL when full rollback or split authority admits JWT twice.
Everything lives inside disposable GH runner localhost and Docker services.
"""
from __future__ import annotations
import asyncio,importlib.util,json,os,signal,ssl,subprocess,sys,tempfile,time
from pathlib import Path
import psycopg
from redis.asyncio import Redis
import adversarial as base

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("witness_fixture",ROOT/"independent-pg17-witness.py")
w=importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
BRANCH=base.BRANCH
assert os.getenv("GITHUB_REF")==BRANCH and os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for key in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(key),("production credential refused",key)
CID=os.environ["QA_WITNESS_CONTAINER"]
assert len(CID)>=12 and all(c in "0123456789abcdef" for c in CID.lower())
SHADOW_DSN=("postgresql://postgres:qa-only-shadow-password@127.0.0.1:5435/"
            "vision_v2_witness_shadow_disposable?connect_timeout=2")
def check(x,label):
 assert x,label
def dockrun(args,stdin=None):
 p=subprocess.run(["docker",*args],input=stdin,stdout=subprocess.PIPE,
                  stderr=subprocess.PIPE,timeout=30,check=True)
 return p.stdout
def snapshot_empty_witness():
 result=dockrun(["exec",CID,"pg_dump","-U","postgres","-d",
          "vision_v2_witness_disposable","-Fc","-n","qa_witness"])
 check(len(result)>1024,("pg_dump empty",len(result)))
 return result
def restore_witness_real(dump):
 dockrun(["exec","-i",CID,"pg_restore","-U","postgres","-d",
      "vision_v2_witness_disposable","--clean","--if-exists","--no-owner",
      "--exit-on-error"],stdin=dump)
def rows(dsn):
 with psycopg.connect(dsn,autocommit=True) as c:
  return int(c.execute("SELECT count(*) FROM qa_witness.auth_ledger").fetchone()[0])
def shadow_setup():
 with psycopg.connect(SHADOW_DSN,autocommit=True) as c:
  check(c.execute("SELECT current_database()").fetchone()[0]=="vision_v2_witness_shadow_disposable",
        "wrong shadow DB")
  check(int(c.execute("SHOW server_version_num").fetchone()[0])//10000==17,"wrong PG version")
  c.execute("CREATE SCHEMA qa_witness")
  c.execute("CREATE SEQUENCE qa_witness.auth_fence_seq")
  c.execute("""CREATE TABLE qa_witness.auth_ledger(
     jti text PRIMARY KEY, tenant text NOT NULL, device text NOT NULL,
     fence bigint NOT NULL DEFAULT nextval('qa_witness.auth_fence_seq'),
     consumed_at timestamptz NOT NULL DEFAULT clock_timestamp())""")
async def start_forwarder():
 proc=subprocess.Popen([sys.executable,"-u",str(ROOT/"partition-forwarder.py"),
     "--listen","5434","--target","5433"],
     stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
     text=True,bufsize=1)
 line=proc.stdout.readline().strip()
 check(line=="FORWARD_READY=5434=>5433",("forwarder failed",line,proc.poll()))
 return proc
def stop_forwarder(proc):
 if proc.poll() is None:
  proc.send_signal(signal.SIGKILL)
  proc.wait(timeout=5)
  check(proc.returncode==-signal.SIGKILL,"forwarder was not SIGKILLed")
 proc.stdout.close()
def patch_gateway(witness_dsn,redisport,target):
 source=(base.ROOT/"gateway.py").read_text()
 branch_old="refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031"
 check(source.count(branch_old)==1,"unexpected original gateway guard")
 source=source.replace(branch_old,BRANCH)
 code="SECRET=b'vision-wss"
 check(source.count(code)==1,"upstream JWT fixture unexpected")
 source=source.replace(code,f"WITNESS_DSN={witness_dsn!r}\n"+code)
 hook="   lease=secrets.token_hex(18)"
 check(source.count(hook)==1,"gateway auth hook missing")
 insert="""   # Synthetic cross-instance unique JTI inserted before successful READY.
   async with await psycopg.AsyncConnection.connect(WITNESS_DSN) as audit:
    cur=await audit.execute(
     'INSERT INTO qa_witness.auth_ledger(jti,tenant,device) VALUES(%s,%s,%s) '
     'ON CONFLICT DO NOTHING RETURNING fence',
     (claims['jti'],tenant,device))
    if not await cur.fetchone():raise PermissionError('JTI_ALREADY_USED')
"""
 source=source.replace(hook,insert+hook)
 if redisport!=6379:
  check(source.count("port=6379")==1,"original Redis endpoint changed")
  source=source.replace("port=6379","port="+str(redisport))
 target.write_text(source)
 import py_compile;py_compile.compile(str(target),doraise=True)
async def main():
 started=time.monotonic()
 base.prepare();w.check_db();shadow_setup()
 backup=snapshot_empty_witness()
 check(rows(w.WITNESS)==0 and rows(SHADOW_DSN)==0,"snapshot not empty")
 redis0=Redis(host="127.0.0.1",port=6379,decode_responses=True,socket_timeout=1)
 redis1=Redis(host="127.0.0.1",port=6380,decode_responses=True,socket_timeout=1)
 await base.alive(redis0);await base.alive(redis1)
 for client in (redis0,redis1):await w.reset_redis(client)
 tmp=Path(tempfile.mkdtemp(prefix="vision_v2_pg_restore_fault_"))
 witness_via_proxy=w.WITNESS.replace(":5433/",":5434/")
 gate_specs=[
  (20110,6379,witness_via_proxy),
  (20111,6380,witness_via_proxy),
  (20112,6380,SHADOW_DSN)]
 cert=Path(os.environ["QA_CERT"]).resolve()
 key=Path(os.environ["QA_KEY"]).resolve()
 ctx=ssl.create_default_context(cafile=str(cert))
 ctx.check_hostname=True
 proxies=[];popenfiles=[];forward=None;active=[]
 report=dict(production_GO=False,real_pg_dump_restore=True,
             actual_separate_PG17_docker_services=2,
             two_Redis7_instances=True,
             all_on_one_CI_runner=True,
             local_socket_forwarder_partition_not_real_WAN=True,
             real_Supabase_auth_and_device_RLS_not_tested=True)
 try:
  forward=await start_forwarder()
  for i,(port,red,dsn) in enumerate(gate_specs):
   p=tmp/("gw-"+str(i)+".py")
   patch_gateway(dsn,red,p)
   proc,f=await base.start_gw(p,"qa-restore-"+str(i),port,cert,key,
                             tmp/("gw-"+str(i)+".log"))
   proxies.append(proc);popenfiles.append(f)
  token=base.original.token("company-A","tv-0000")
  attempted=await asyncio.gather(base.auth(20110,token,ctx),base.auth(20111,token,ctx))
  admitted=[(i,ws,ans) for i,(ws,ans) in enumerate(attempted) if ws is not None]
  refused=[ans for ws,ans in attempted if ws is None]
  check(len(admitted)==1 and len(refused)==1,("duplicate JWT accepted",attempted))
  check(refused[0].get("error")=="JTI_ALREADY_USED","wrong global rejection")
  ws,reply=admitted[0][1:]
  active.append(ws)
  check((await base.heartbeat(ws,reply,1)).get("type")=="heartbeat_ack","valid heartbeat")
  check(rows(w.WITNESS)==1,"witness ledger did not persist consumed JTI")
  report["single_shared_witness"]=dict(status="PASS_LOCAL_ONE_AUTHORITY",
       exactly_one_JWT_admitted=True,other_rejected="JTI_ALREADY_USED")
  # A genuine OS SIGKILL of the only TCP bridge simulates a client-to-witness
  # partition, while Redis and the existing WSS client remain connected.
  stop_forwarder(forward);forward=None
  t_block=base.original.token("company-A","tv-0000")
  blocked,problem=await base.auth(20110,t_block,ctx)
  check(blocked is None and problem.get("type")=="error",
       ("authority inaccessible but new JWT authorized",problem))
  ongoing=await base.heartbeat(ws,reply,2)
  # This explicitly exposes an auth-witness-only architecture limitation:
  # an existing lease continues when witness is unreachable.
  check(ongoing.get("type")=="heartbeat_ack",
       ("negative: old WSS lease did not remain valid as expected",ongoing))
  report["witness_path_SIGKILL_partition"]=dict(
       new_logins_denied=True,
       old_lease_still_heartbeats=True,
       existing_session_verdict="SECURITY_LIMITATION_NOT_GLOBALLY_FAIL_CLOSED",
       transport_path_cut_without_stopping_PG_container=True)
  forward=await start_forwarder()
  replay,err=await base.auth(20111,token,ctx)
  check(replay is None and err.get("error")=="JTI_ALREADY_USED",
       ("path recovered but witness did not fence replay",err))
  # A token whose Redis nonce was consumed before a failed witness INSERT
  # may remain unusable; avoid silently treating this as successful retry.
  blocked_again,err=await base.auth(20110,t_block,ctx)
  check(blocked_again is None and err.get("error")=="JWT_REPLAY",
       ("failed auth did not consume JTI in Redis as expected",err))
  report["path_recovery"]=dict(
       durable_witness_rejects_old_JTI=True,
       failed_during_partition_token_spent_in_redis=True,
       client_requires_fresh_JWT_after_recovery=True)
  # Rollback business status and both Redis nodes, but retain separate PG
  # witness. The used JWT MUST remain rejected.
  w.clear_business_pg()
  for client in (redis0,redis1):await w.reset_redis(client)
  pre_restore,err=await base.auth(20110,token,ctx)
  check(pre_restore is None and err.get("error")=="JTI_ALREADY_USED",
       ("non-rolled-back witness did not prevent replay",err))
  report["business_PG_and_both_Redis_logical_rollback"]=dict(
       status="PASS_ONLY_WHILE_WITNESS_IS_PRESERVED",
       spent_JTI_denied=True)
  # ACTUAL logical restore of an earlier PostgreSQL archive: pg_dump/pg_restore
  # runs inside PG17 Docker container, restoring table and sequence.
  restore_witness_real(backup)
  check(rows(w.WITNESS)==0,("real restored witness still contains spent JTI",rows(w.WITNESS)))
  w.clear_business_pg()
  for client in (redis0,redis1):await w.reset_redis(client)
  old,old_ready=await base.auth(20110,token,ctx)
  check(old is not None and old_ready.get("type")=="ready",
       ("full logical restore failed to expose replay",old_ready))
  active.append(old)
  report["real_pg_dump_pg_restore_prior_snapshot"]=dict(
       status="SECURITY_FAIL_REPRODUCED",
       restored_archived_bytes=len(backup),
       old_JTI_reaccepted=True,
       witness_table_rows_after_restore=0,
       independently_nonrollbackable_anchor_present=False)
  # Split brain: another independent PG17 witness has NO common JTI ledger.
  # Both Redis are independent. Identical fresh JWT is accepted by both,
  # demonstrating absence of an election/fencing authority.
  for client in (redis0,redis1):await w.reset_redis(client)
  split=base.original.token("company-A","tv-0000")
  double=await asyncio.gather(base.auth(20110,split,ctx),base.auth(20112,split,ctx))
  check(all(ws is not None and msg.get("type")=="ready" for ws,msg in double),
       ("dual-witness split brain negative not reproduced",double))
  active.extend(ws for ws,msg in double)
  check(double[0][1]["session"]!=double[1][1]["session"],"split authorities shared lease")
  report["two_uncoordinated_PG17_witnesses"]=dict(
       status="SECURITY_FAIL_REPRODUCED",
       same_signed_JTI_accepted_by_both=True,
       same_device_two_distinct_leases=True,
       global_leader_election_not_implemented=True)
  # Even a SHARED unique JTI key does not globally validate device ownership
  # when each divergent Redis has a conflicting tenant mapping.
  for client in (redis0,redis1):await client.flushdb()
  await redis0.hset("qa:owners",mapping={"tv-0000":"company-A"})
  await redis1.hset("qa:owners",mapping={"tv-0000":"company-B"})
  a,b=await asyncio.gather(
    base.auth(20110,base.original.token("company-A","tv-0000"),ctx),
    base.auth(20111,base.original.token("company-B","tv-0000"),ctx))
  check(a[0] is not None and b[0] is not None,
       ("cross-tenant ownership divergence counterexample not reproduced",a[1],b[1]))
  active.extend([a[0],b[0]])
  report["Redis_owner_mapping_divergence"]=dict(
       status="SECURITY_FAIL_REPRODUCED",
       same_device_authorized_as_two_companies=True,
       different_valid_JTIs_same_device=True,
       source_of_truth_for_membership_not_fenced=True)
  report["security_verdict"]="FAIL_ROLLBACK_SPLIT_BRAIN_AND_OLD_LEASE"
  report["duration_seconds"]=round(time.monotonic()-started,3)
  Path("qa-v2-witness-partition-restore.json").write_text(json.dumps(report,sort_keys=True,indent=2))
  print("QA_WITNESS_PARTITION_RESTORE_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  if forward is not None:stop_forwarder(forward)
  for ws in active:
   try:await asyncio.wait_for(ws.close(),timeout=2)
   except Exception:pass
  for proc in proxies:
   if proc.poll() is None:
    proc.terminate()
    try:await asyncio.to_thread(proc.wait,3)
    except subprocess.TimeoutExpired:
     proc.kill();await asyncio.to_thread(proc.wait,3)
  for f in popenfiles:f.close()
  for f in tmp.glob("gw-*.log"):
   print("QA_GATEWAY_LOG_"+f.name+"="+f.read_text(errors="replace")[-2400:],flush=True)
  await redis0.aclose();await redis1.aclose()
if __name__=="__main__":asyncio.run(main())
