"""Local-only independent PG17 auth-witness proof for WSS JTI.
Main PG17 + Redis7 states are erased; witness is a separate PG17 container
and remains durable. If witness is erased too, replay MUST be reproduced.
This is logical QA independence only (same CI runner), never production GO.
"""
from __future__ import annotations
import asyncio,json,os,ssl,sys,tempfile,time
from pathlib import Path
import psycopg
from redis.asyncio import Redis
import adversarial as base

assert os.environ.get("GITHUB_REF")==base.BRANCH
assert os.environ.get("QA_STREAM_GUARD_GROUP")=="1"
for k in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.environ.get(k),("official credentials forbidden",k)
CID=os.environ["QA_WITNESS_CONTAINER"]
assert len(CID)>=12 and all(x in "0123456789abcdef" for x in CID.lower())
WITNESS="postgresql://postgres:qa-only-witness-password@127.0.0.1:5433/vision_v2_witness_disposable?connect_timeout=2"
def wc():
 return psycopg.connect(WITNESS,autocommit=True)
def check_db():
 with wc() as c:
  assert c.execute("SELECT current_database()").fetchone()[0]=="vision_v2_witness_disposable"
  assert int(c.execute("SHOW server_version_num").fetchone()[0])//10000==17
  c.execute("CREATE SCHEMA qa_witness")
  c.execute("CREATE SEQUENCE qa_witness.auth_fence_seq")
  c.execute("""CREATE TABLE qa_witness.auth_ledger(
    jti text PRIMARY KEY,tenant text NOT NULL,device text NOT NULL,
    fence bigint NOT NULL DEFAULT nextval('qa_witness.auth_fence_seq'),
    consumed_at timestamptz NOT NULL DEFAULT clock_timestamp())""")
  return c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0]
def witness_stats(start):
 with wc() as c:
  return dict(rows=c.execute("SELECT count(*) FROM qa_witness.auth_ledger").fetchone()[0],
   fence_last=c.execute("SELECT last_value FROM qa_witness.auth_fence_seq").fetchone()[0],
   WAL_delta_bytes=int(c.execute("SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),%s)",(start,)).fetchone()[0]),
   size_bytes=int(c.execute("SELECT pg_total_relation_size('qa_witness.auth_ledger')").fetchone()[0]))
def clear_business_pg():
 with psycopg.connect(base.DSN,autocommit=True) as c:
  c.execute("TRUNCATE qa_wss.status, qa_wss.commands")
  return c.execute("SELECT count(*) FROM qa_wss.status").fetchone()[0]
async def reset_redis(redis):
 await redis.flushdb()
 await redis.hset("qa:owners",mapping={"tv-0000":"company-A","tv-0001":"company-B"})
async def main():
 began=time.monotonic()
 base.prepare()
 start_lsn=check_db()
 r0=Redis(host="127.0.0.1",port=6379,decode_responses=True,socket_timeout=1)
 r1=Redis(host="127.0.0.1",port=6380,decode_responses=True,socket_timeout=1)
 await base.alive(r0);await base.alive(r1)
 for r in (r0,r1):await reset_redis(r)
 folder=Path(tempfile.mkdtemp(prefix="vision_v2_witness_qa_"))
 source=(base.ROOT/"gateway.py").read_text()
 base.check("refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031" in source,"upstream guard unexpected")
 source=source.replace("refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031",base.BRANCH)
 base.check("SECRET=b'vision-wss" in source,"upstream JWT fixture changed")
 source=source.replace("SECRET=b'vision-wss",f"WITNESS_DSN={WITNESS!r}\nSECRET=b'vision-wss")
 hook="   lease=secrets.token_hex(18)"
 base.check(source.count(hook)==1,"gateway login hook missing")
 insert="""   # QA-only globally serialized JTI authority in SEPARATE PG17 cluster.
   # A single unique INSERT transaction must commit before auth READY.
   async with await psycopg.AsyncConnection.connect(WITNESS_DSN) as witness:
    cursor=await witness.execute(
      'INSERT INTO qa_witness.auth_ledger(jti,tenant,device) VALUES(%s,%s,%s) '
      'ON CONFLICT DO NOTHING RETURNING fence',
      (claims['jti'],tenant,device))
    if not await cursor.fetchone():raise PermissionError('WITNESS_JTI_REPLAY')
"""
 source=source.replace(hook,insert+hook)
 paths=[]
 for i,(port,redis_port) in enumerate(((20040,6379),(20041,6380))):
  p=folder/("witness-gateway-"+str(i)+".py")
  p.write_text(source.replace("port=6379","port="+str(redis_port)))
  paths.append((p,port))
 cert=Path(os.environ["QA_CERT"]).resolve()
 key=Path(os.environ["QA_KEY"]).resolve()
 ctx=ssl.create_default_context(cafile=str(cert))
 ctx.check_hostname=True
 procs=[];logs=[];active=[];witness_down=False
 report=dict(production_GO=False,one_global_witness_PG17=True,
    business_PG17_separate=True,two_Redis7_authorities=True,
    one_CI_runner_not_distinct_hosts=True,SQL_per_heartbeat_for_witness=0,
    real_redis_sentinel_or_pg_HA_not_tested=True)
 try:
  for i,(path,port) in enumerate(paths):
   p,f=await base.start_gw(path,"qa-witness-"+str(i),port,cert,key,folder/("gw-"+str(i)+".log"))
   procs.append(p);logs.append(f)
  token=base.original.token("company-A","tv-0000")
  replies=await asyncio.gather(base.auth(20040,token,ctx),base.auth(20041,token,ctx))
  accepted=[(i,s,ans) for i,(s,ans) in enumerate(replies) if s is not None]
  denied=[ans for s,ans in replies if s is None]
  base.check(len(accepted)==1 and len(denied)==1,("two Redis accepted same JWT",replies))
  base.check(denied[0].get("error")=="WITNESS_JTI_REPLAY",("unexpected reject",denied))
  accepted_socket=accepted[0][1];ready=accepted[0][2];active.append(accepted_socket)
  h=await base.heartbeat(accepted_socket,ready,1)
  base.check(h.get("type")=="heartbeat_ack","valid session heartbeat rejected")
  for n in range(2,6):
   h=await base.heartbeat(accepted_socket,ready,n)
   base.check(h.get("type")=="heartbeat_ack","session lost in baseline")
  st0=witness_stats(start_lsn)
  base.check(st0["rows"]==1,"heartbeat writes created extra witnesses")
  report["dual_Redis_different_processes"]=dict(
     status="PASS_SINGLE_PG_WITNESS_LOCAL",
     exactly_one_of_two_auths_accepted=True,
     other_rejected="WITNESS_JTI_REPLAY",
     PG_witness_rows_after_five_heartbeats=st0["rows"])
  # Logical rollback of the BUSINESS PG and BOTH Redis authorities, while
  # separately hosted witness DB is not rolled back.
  cleared=clear_business_pg()
  for r in (r0,r1):await reset_redis(r)
  base.check(cleared==0,"main PG status not cleared")
  replay,fail=await base.auth(20040,token,ctx)
  base.check(replay is None and fail.get("error")=="WITNESS_JTI_REPLAY",
      ("witness failed after main state rollback",fail))
  old=await base.heartbeat(accepted_socket,ready,6)
  base.check(old.get("type")!="heartbeat_ack","old lease resurrected after Redis reset")
  report["business_PG_and_two_Redis_rollback"]=dict(
    status="PASS_WHILE_WITNESS_PRESERVED",
    logical_main_pg_reset=True,both_redis_flushdb=True,
    previously_spent_JTI_still_denied=True,stale_session_ack=False)
  # Simulate a real, separate witness PG17 container outage. Without
  # authority, the WSS candidate MUST decline new logins, then recover.
  await asyncio.to_thread(base.docker,"stop") if False else None
  import subprocess
  def witness_docker(cmd):
   return subprocess.run(["docker",cmd,CID],check=True,timeout=35,
       capture_output=True,text=True).stdout.strip()
  await asyncio.to_thread(witness_docker,"stop")
  witness_down=True
  unavailable,err=await base.auth(20041,base.original.token("company-A","tv-0000"),ctx)
  base.check(unavailable is None and err.get("type")=="error",
       ("witness outage granted login",err))
  await asyncio.to_thread(witness_docker,"start")
  witness_down=False
  deadline=time.monotonic()+13
  while time.monotonic()<deadline:
   try:
    with wc() as c:
     if c.execute("SELECT 1").fetchone()[0]==1:break
   except Exception:await asyncio.sleep(.12)
  else:raise AssertionError("witness failed to restart")
  again,err=await base.auth(20041,token,ctx)
  base.check(again is None and err.get("error")=="WITNESS_JTI_REPLAY",
      ("spent token lost during witness stop/start",err))
  report["witness_PG17_real_stop_start"]=dict(
     status="PASS_FAIL_CLOSED_AND_PRESERVED_LEDGER",
     fresh_login_denied_during_down=True,previous_JTI_replay_denied_after_restart=True)
  # Strong NEGATIVE: when the witness itself rolls back its JTI record
  # together with both Redis and business PG, the old token IS accepted.
  # No hardware-rooted/non-rollbackable authority was tested.
  with wc() as c:
   c.execute("DELETE FROM qa_witness.auth_ledger WHERE jti=%s",(base.jti(token),))
  clear_business_pg()
  for r in (r0,r1):await reset_redis(r)
  reused,ok=await base.auth(20040,token,ctx)
  base.check(reused is not None and ok.get("type")=="ready",
       ("full rollback negative was not reproduced",ok))
  active.append(reused)
  report["ALL_three_state_domains_rolled_back"]=dict(
    status="SECURITY_FAIL_REPRODUCED",
    same_old_JTI_accepted_after_witness_record_deleted=True,
    independent_monotonic_nonrollback_proof=False)
  report["witness_pg_metrics"]=witness_stats(start_lsn)
  report["security_verdict"]="NO_GO_NO_INDEPENDENT_ROLLBACK_PROOF"
  report["elapsed_seconds"]=round(time.monotonic()-began,3)
  Path("qa-v2-independent-witness.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_INDEPENDENT_WITNESS_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  if witness_down:
   try:
    import subprocess
    await asyncio.to_thread(subprocess.run,["docker","start",CID],check=True,timeout=35,
        capture_output=True,text=True)
   except Exception:pass
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
  for file in folder.glob("gw-*.log"):
   print("QA_GATEWAY_"+file.name+"="+file.read_text(errors="replace")[-2400:],flush=True)
  await r0.aclose();await r1.aclose()
if __name__=="__main__":asyncio.run(main())
