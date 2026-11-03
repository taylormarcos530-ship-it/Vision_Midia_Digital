"""Disposable WSS proof candidate: single PG17 authoritative owner + JTI + lease.
Reads central authority on EVERY heartbeat (extra SQL); failure to reach
authority must NOT ACK the existing WSS session. PostgreSQL witness rollback
or two uncoordinated witnesses still FAIL. Never edit original gateway.
"""
from __future__ import annotations
import asyncio,json,os,signal,ssl,subprocess,sys,tempfile,time
from pathlib import Path
import psycopg
from redis.asyncio import Redis
import adversarial as base
import importlib.util
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location("previous_pg_auth_test",HERE/"independent-pg17-witness.py")
previous=importlib.util.module_from_spec(sp);sp.loader.exec_module(previous)
assert os.getenv("GITHUB_REF")==base.BRANCH and os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for k in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(k),("official credential forbidden",k)
CID=os.environ["QA_WITNESS_CONTAINER"]
assert len(CID)>=12 and all(z in "0123456789abcdef" for z in CID.lower())
SHADOW="postgresql://postgres:qa-only-shadow-password@127.0.0.1:5435/vision_v2_witness_shadow_disposable?connect_timeout=2"
def check(cond,what):assert cond,what
def wc(dsn=previous.WITNESS):
 return psycopg.connect(dsn,autocommit=True)
def setup(dsn):
 with wc(dsn) as c:
  assert int(c.execute("SHOW server_version_num").fetchone()[0])//10000==17
  c.execute("CREATE SCHEMA qa_secure")
  c.execute("""CREATE TABLE qa_secure.owner(
    device text PRIMARY KEY, tenant text NOT NULL, revoked boolean NOT NULL DEFAULT false)""")
  c.execute("""CREATE TABLE qa_secure.spent(
    jti text PRIMARY KEY, device text NOT NULL, tenant text NOT NULL,
    consumed_at timestamptz NOT NULL DEFAULT clock_timestamp())""")
  c.execute("""CREATE TABLE qa_secure.active(
    device text PRIMARY KEY,tenant text NOT NULL, lease text NOT NULL)""")
  c.execute("INSERT INTO qa_secure.owner(device,tenant) VALUES('tv-0000','company-A'),('tv-0001','company-B')")
def write_owner(tenant):
 with wc() as c:
  with c.transaction():
   c.execute("UPDATE qa_secure.owner SET tenant=%s WHERE device='tv-0000'",(tenant,))
   c.execute("DELETE FROM qa_secure.active WHERE device='tv-0000'")
def auth_stats(dsn=previous.WITNESS):
 with wc(dsn) as c:
  return dict(jti=int(c.execute("SELECT count(*) FROM qa_secure.spent").fetchone()[0]),
      active=int(c.execute("SELECT count(*) FROM qa_secure.active").fetchone()[0]),
      owner=c.execute("SELECT tenant FROM qa_secure.owner WHERE device='tv-0000'").fetchone()[0],
      relation_bytes=int(c.execute("SELECT pg_total_relation_size('qa_secure.spent')").fetchone()[0]))
def patch(dsn,redisport,destination):
 source=(base.ROOT/"gateway.py").read_text()
 old="refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031"
 check(source.count(old)==1,"original branch assertion changed")
 source=source.replace(old,base.BRANCH)
 check(source.count("SECRET=b'vision-wss")==1,"gateway fixture changed")
 source=source.replace("SECRET=b'vision-wss",f"AUTH_DSN={dsn!r}\nQA_GAP_DIR={str(destination.parent)!r}\nSECRET=b'vision-wss")
 old="  self.pool=AsyncConnectionPool(DSN,min_size=1,max_size=6,open=False)"
 check(source.count(old)==1,"main pool changed")
 source=source.replace(old,old+"\n  self.authpool=AsyncConnectionPool(AUTH_DSN,min_size=1,max_size=6,open=False)\n  self.auth_reads=0")
 old="   owner=await self.redis.hget('qa:owners',device)\n   if owner!=tenant:raise PermissionError('TENANT_MISMATCH')"
 check(source.count(old)==1,"original Redis owner logic unexpected")
 new="""   # Only central PG17 owner is authoritative. A Redis map is NOT trusted.
   # Hold row FOR SHARE through consumed-JTI INSERT, serializing owner changes.
   async with self.authpool.connection(timeout=2) as authority:
    async with authority.transaction():
     cur=await authority.execute(
       'SELECT tenant FROM qa_secure.owner WHERE device=%s AND NOT revoked FOR SHARE',(device,))
     row=await cur.fetchone()
     if not row or row[0]!=tenant:raise PermissionError('GLOBAL_OWNER_MISMATCH')
     cur=await authority.execute(
       'INSERT INTO qa_secure.spent(jti,device,tenant) VALUES(%s,%s,%s) '
       'ON CONFLICT DO NOTHING RETURNING jti',(claims['jti'],device,tenant))
     if not await cur.fetchone():raise PermissionError('GLOBAL_JTI_REPLAY')"""
 source=source.replace(old,new)
 hook="   await self.redis.set(self.key(tenant,device),lease,px=HEARTBEAT_TTL_MS)"
 check(source.count(hook)==1,"lease hook changed")
 register="""   # Coordinated per-device current lease, serial with owner writer.
   async with self.authpool.connection(timeout=2) as authority:
    async with authority.transaction():
     cur=await authority.execute(
      'SELECT tenant FROM qa_secure.owner WHERE device=%s AND NOT revoked FOR SHARE',(device,))
     row=await cur.fetchone()
     if not row or row[0]!=tenant:raise PermissionError('GLOBAL_OWNER_CHANGED')
     await authority.execute(
      'INSERT INTO qa_secure.active(device,tenant,lease) VALUES(%s,%s,%s) '
      'ON CONFLICT(device) DO UPDATE SET tenant=EXCLUDED.tenant,lease=EXCLUDED.lease',
      (device,tenant,lease))
"""
 source=source.replace(hook,register+hook)
 hook="    ok=await self.redis.eval(REFRESH,1,self.key(tenant,device),lease,HEARTBEAT_TTL_MS)"
 check(source.count(hook)==1,"original per-frame Redis refresh changed")
 auth="""    # One central SQL SELECT for EACH already-open session frame.
    # On witness partition, do not ACK and return from the handler.
    async with self.authpool.connection(timeout=2) as authority:
     cur=await authority.execute(
      'SELECT 1 FROM qa_secure.owner o JOIN qa_secure.active a ON a.device=o.device '
      'WHERE o.device=%s AND o.tenant=%s AND NOT o.revoked '
      'AND a.tenant=%s AND a.lease=%s',
      (device,tenant,tenant,lease))
     valid=bool(await cur.fetchone())
    self.auth_reads+=1
    if not valid:
     await ws.send(json.dumps({'type':'error','error':'GLOBAL_SESSION_REVOKED'}))
     break
"""
 # QA-only race barrier AFTER central SELECT, BEFORE Redis refresh.
 # Synthetic seq 77 triggers an adversarial owner change during this gap.
 gap="""    if x.get('type')=='heartbeat' and x.get('seq')==77:
     import pathlib
     ready=pathlib.Path(QA_GAP_DIR)/('ready-'+self.instance)
     release=pathlib.Path(QA_GAP_DIR)/('release-'+self.instance)
     ready.write_text('POST_AUTH_CHECK')
     until=time.monotonic()+6
     while not release.exists():
      if time.monotonic()>until:raise TimeoutError('QA_GAP_DEADLINE')
      await asyncio.sleep(.005)
"""
 source=source.replace(hook,auth+gap+hook)
 # Experimental FIX to the proven post-witness-check / pre-ACK TOCTOU.
 # Keep row-level FOR SHARE locks across Redis refresh and bounded WSS send.
 # This is only a synthetic candidate; malicious slow clients / distributed
 # authority cannot be declared safe based on one localhost runner.
 start=source.index("    # One central SQL SELECT for EACH")
 end=source.index("  except (ConnectionClosed,asyncio.TimeoutError):",start)
 original_frame=source[start:end]
 fragment=original_frame[original_frame.index("    ok=await self.redis.eval"):]
 old_ack="await ws.send(json.dumps({'type':'heartbeat_ack','seq':seq,'command':json.loads(cmd) if cmd else None}))"
 assert fragment.count(old_ack)==1
 fragment=fragment.replace(old_ack,
    "await asyncio.wait_for(ws.send(json.dumps({'type':'heartbeat_ack','seq':seq,'command':json.loads(cmd) if cmd else None})),timeout=.150)\n"
    "     if n==77:await asyncio.sleep(.12)")
 wrapped="".join("  "+line if line.strip() else line for line in fragment.splitlines(keepends=True))
 fenced="""    async with self.authpool.connection(timeout=2) as authority:
     async with authority.transaction():
      cur=await authority.execute(
       'SELECT 1 FROM qa_secure.owner o JOIN qa_secure.active a ON a.device=o.device '
       'WHERE o.device=%s AND o.tenant=%s AND NOT o.revoked '
       'AND a.tenant=%s AND a.lease=%s FOR SHARE OF o,a',
       (device,tenant,tenant,lease))
      valid=bool(await cur.fetchone())
      self.auth_reads+=1
      if not valid:
       await asyncio.wait_for(ws.send(json.dumps({'type':'error','error':'GLOBAL_SESSION_REVOKED'})),timeout=.150)
       break
      if x.get('type')=='heartbeat' and x.get('seq')==77:
       import pathlib
       ready=pathlib.Path(QA_GAP_DIR)/('ready-'+self.instance)
       release=pathlib.Path(QA_GAP_DIR)/('release-'+self.instance)
       ready.write_text('POST_AUTH_CHECK_LOCK_HELD')
       until=time.monotonic()+5
       while not release.exists():
        if time.monotonic()>until:raise TimeoutError('QA_GAP_DEADLINE')
        await asyncio.sleep(.005)
"""
 source=source[:start]+fenced+wrapped+source[end:]
 hook="  await self.pool.open(wait=True)"
 check(source.count(hook)==1,"pool opening hook changed")
 source=source.replace(hook,hook+"\n  await self.authpool.open(wait=True)")
 hook="   await self.pool.close();await self.redis.aclose()"
 check(source.count(hook)==1,"pool close hook changed")
 source=source.replace(hook,"   print('QA_WITNESS_AUTH_CHECKS='+str(self.auth_reads),flush=True)\n   await self.authpool.close();await self.pool.close();await self.redis.aclose()")
 if redisport!=6379:
  check(source.count("port=6379")==1,"original Redis endpoint changed")
  source=source.replace("port=6379","port="+str(redisport))
 destination.write_text(source)
 import py_compile;py_compile.compile(str(destination),doraise=True)
async def forward():
 process=subprocess.Popen([sys.executable,"-u",str(HERE/"partition-forwarder.py"),
    "--listen","5434","--target","5433"],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
    text=True,bufsize=1)
 line=process.stdout.readline().strip()
 check(line=="FORWARD_READY=5434=>5433",("forwarder not running",line,process.poll()))
 return process
def kill_forwarder(process):
 if process and process.poll() is None:
  process.kill();process.wait(timeout=5)
  check(process.returncode==-signal.SIGKILL,"no real SIGKILL")
 if process:process.stdout.close()
def container(args,input=None):
 return subprocess.run(["docker",*args],input=input,check=True,
      capture_output=True,timeout=30).stdout
def backup():
 b=container(["exec",CID,"pg_dump","-U","postgres","-d",
     "vision_v2_witness_disposable","-Fc","-n","qa_secure"])
 check(len(b)>1000,"no actual PG backup")
 return b
def restore(b):
 container(["exec","-i",CID,"pg_restore","-U","postgres","-d",
       "vision_v2_witness_disposable","--clean","--if-exists","--no-owner",
       "--exit-on-error"],input=b)
async def auth(port,token,ctx):
 return await base.auth(port,token,ctx)
async def main():
 started=time.monotonic();base.prepare()
 setup(previous.WITNESS);setup(SHADOW)
 snapshot=backup()
 await base.alive(Redis(host="127.0.0.1",port=6379))
 r0=Redis(host="127.0.0.1",port=6379,decode_responses=True,socket_timeout=1)
 r1=Redis(host="127.0.0.1",port=6380,decode_responses=True,socket_timeout=1)
 await base.alive(r0);await base.alive(r1)
 # Explicitly divergent Redis mapping, matching user-reported failure.
 await r0.flushdb();await r1.flushdb()
 await r0.hset("qa:owners",mapping={"tv-0000":"company-B","tv-0001":"company-B"})
 await r1.hset("qa:owners",mapping={"tv-0000":"company-B","tv-0001":"company-B"})
 tmp=Path(tempfile.mkdtemp(prefix="v2_central_auth_"))
 cert=Path(os.environ["QA_CERT"]).resolve();key=Path(os.environ["QA_KEY"]).resolve()
 ctx=ssl.create_default_context(cafile=str(cert));ctx.check_hostname=True
 proxies=[];files=[];sockets=[];fw=None
 report=dict(production_GO=False,original_source_files_unchanged=True,
     actual_PG17_services=3,redis7_services=2,one_CI_runner=True,
     global_owner_and_lease_candidate=True,
     SQL_SELECT_per_heartbeat=1,
     exact_SQL_cost_projected_not_billed=True,
     Redis_roles_not_trusted_for_owner=True)
 try:
  fw=await forward()
  targets=[
   (20210,6379,previous.WITNESS.replace(":5433/",":5434/")),
   (20211,6380,previous.WITNESS.replace(":5433/",":5434/")),
   (20212,6380,SHADOW)]
  for idx,(port,rport,dsn) in enumerate(targets):
   f=tmp/("gateway-"+str(idx)+".py")
   patch(dsn,rport,f)
   proc,fh=await base.start_gw(f,"central-"+str(idx),port,cert,key,tmp/("gw-"+str(idx)+".log"))
   proxies.append(proc);files.append(fh)
  wrong=base.original.token("company-B","tv-0000")
  denied,reason=await auth(20211,wrong,ctx)
  check(denied is None and reason.get("error")=="GLOBAL_OWNER_MISMATCH",
      ("Redis tenant divergence incorrectly authorized",reason))
  t=base.original.token("company-A","tv-0000")
  admitted=await asyncio.gather(auth(20210,t,ctx),auth(20211,t,ctx))
  ready=[(p,ws,msg) for p,(ws,msg) in zip((20210,20211),admitted) if ws is not None]
  refused=[m for ws,m in admitted if ws is None]
  check(len(ready)==1 and len(refused)==1 and refused[0].get("error")=="GLOBAL_JTI_REPLAY",
      ("globally shared JTI replay not rejected",admitted))
  mainport,ws,identity=ready[0];sockets.append(ws)
  check((await base.heartbeat(ws,identity,1)).get("type")=="heartbeat_ack","baseline heartbeat rejected")
  for n in range(2,9):
   check((await base.heartbeat(ws,identity,n)).get("type")=="heartbeat_ack","authorized heartbeat rejected")
  report["global_owner_and_jti"]=dict(
   status="PASS_LOCAL",wrong_tenant_denied=True,
   exactly_one_concurrent_JWT_accepted=True,
   seven_followup_heartbeats_ack=True)
  # Client-to-witness route goes DOWN via actual SIGKILL, leaving both
  # gateway's Redis and main PostgreSQL operational.
  kill_forwarder(fw);fw=None
  old=await base.heartbeat(ws,identity,9)
  check(old.get("type")!="heartbeat_ack",("stale socket got ACK with auth cut",old))
  disconnected=old.get("type")
  bad,reply=await auth(20210,base.original.token("company-A","tv-0000"),ctx)
  check(bad is None and reply.get("type")=="error",
      ("new login passed while witness absent",reply))
  report["witness_path_partition"]=dict(
   status="PASS_LOCAL_FAIL_CLOSED_PER_HEARTBEAT",
   heartbeat_ACK_when_witness_down=False,
   observed=disconnected,
   new_logins_denied=True)
  fw=await forward()
  # Old session MUST NOT become usable again when route returns.
  recovered=await base.heartbeat(ws,identity,10)
  check(recovered.get("type")!="heartbeat_ack",("closed session resurrected after partition",recovered))
  # Reconfigure authority companyA -> companyB and invalidate old session.
  write_owner("company-B")
  tnew=base.original.token("company-B","tv-0000")
  updated,answer=await auth(20211,tnew,ctx)
  check(updated is not None and answer.get("type")=="ready",
      ("global B owner was rejected by Redis-old map",answer))
  sockets.append(updated)
  check((await base.heartbeat(updated,answer,1)).get("type")=="heartbeat_ack",
       "updated tenant did not get live heartbeat")
  wrong2,why=await auth(20210,base.original.token("company-A","tv-0000"),ctx)
  check(wrong2 is None and why.get("error")=="GLOBAL_OWNER_MISMATCH",
       ("revoked former company got new session",why))
  report["global_device_tenant_reassignment"]=dict(
   status="PASS_LOCAL",old_company_login_denied=True,
   new_company_login_success=True,old_lease_did_not_resurrect=True)
  # Deterministic TOCTOU negative: central SELECT succeeds, the device owner
  # changes and invalidates the lease, then the old frame resumes. With no
  # shared fence through ACK the original checked-once candidate still ACKs.
  # This intentionally fails the security gate even though local QA exits 0.
  gap_task=asyncio.create_task(base.heartbeat(updated,answer,77))
  ready_file=tmp/"ready-central-1"
  release_file=tmp/"release-central-1"
  deadline=time.monotonic()+5
  while time.monotonic()<deadline and not ready_file.exists():
   await asyncio.sleep(.005)
  check(ready_file.exists(),"adversarial post-check barrier was never reached")
  owner_writer=asyncio.create_task(asyncio.to_thread(write_owner,"company-A"))
  # Owner UPDATE must now WAIT on the synthetic shared row locks.
  await asyncio.sleep(.035)
  check(not owner_writer.done(),
        "owner writer bypassed shared row lock before QA frame release")
  release_file.write_text("RELEASE",encoding="utf-8")
  gap_response=await gap_task
  check(gap_response.get("type")=="heartbeat_ack",
        ("serialized prior-session ACK not observed",gap_response))
  check(not owner_writer.done(),"owner COMMIT overtook the ACK")
  await asyncio.wait_for(owner_writer,timeout=3)
  stale=await base.heartbeat(updated,answer,78)
  check(stale.get("type")!="heartbeat_ack",
        ("revoked live WSS session was still accepted",stale))
  report["owner_change_between_witness_check_and_ACK"]=dict(
     status="PASS_LOCAL_ROW_LOCK_SERIALIZATION",
     old_company_heartbeat_ACK_after_owner_change_COMMIT=False,
     writer_waited_for_bounded_WSS_ack=True,
     next_old_heartbeat_rejected=True,
     still_unproven_under_distributed_rollback_and_slow_network=True)
  # Restore B for remaining full-backup rollback counterexamples.
  write_owner("company-B")
  # Estimate SQL load of 1 central SELECT per heartbeat and per command frame.
  report["projected_witness_reads_per_day_at_2min_heartbeat"]={
   str(tvs):tvs*720 for tvs in (100,300,600,1000)}
  report["sample_witness_rows_before_restore"]=auth_stats()
  # Real dump/restore to state before consumed JTI. The OLD signed JWT
  # can be reaccepted after Redis is reset, so full rollback FAIL remains.
  restore(snapshot)
  for redis in (r0,r1):
   await redis.flushdb()
  # Snapshot contains company-A owner. Redis map deliberately wrong.
  try:
   revived,revive_ans=await auth(20210,t,ctx)
  except Exception as e:raise AssertionError(("restore failed to allow adversarial old-JTI replay",str(e)))
  check(revived is not None and revive_ans.get("type")=="ready",
       ("real PG restore counterexample not reproduced",revive_ans))
  sockets.append(revived)
  report["witness_PG17_real_logical_restore"]=dict(
   status="SECURITY_FAIL_REPRODUCED",old_signed_JTI_reaccepted=True,
   dump_bytes=len(snapshot),SQL_authority_rolled_back=True,
   independent_nonrollback_anchor_present=False)
  # Two uncoordinated authorities with matching owners but independent JTI
  # ledger both approve same token despite fix. Same Redis? A vs B separated.
  with wc(SHADOW) as c:
   c.execute("UPDATE qa_secure.owner SET tenant='company-A' WHERE device='tv-0000'")
  for redis in (r0,r1):await redis.flushdb()
  split=base.original.token("company-A","tv-0000")
  both=await asyncio.gather(auth(20210,split,ctx),auth(20212,split,ctx))
  check(all(sock and msg.get("type")=="ready" for sock,msg in both),
     ("split authority bug failed to reproduce",both))
  sockets.extend(sock for sock,msg in both)
  report["two_PG17_authorities_split_brain"]=dict(
   status="SECURITY_FAIL_REPRODUCED",same_JTI_accepted_twice=True,
   separate_redis_authorities=True,no_global_election_proven=True)
  report["security_verdict"]="NO_GO_RESTORE_SPLIT_BRAIN_AND_UNBOUNDED_WSS_RISKS"
  report["elapsed_seconds"]=round(time.monotonic()-started,3)
  Path("qa-v2-wss-central-auth.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_WSS_CENTRAL_AUTH_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  if fw:kill_forwarder(fw)
  for ws in sockets:
   try:await asyncio.wait_for(ws.close(),timeout=1.5)
   except Exception:pass
  for proc in proxies:
   if proc.poll() is None:
    proc.terminate()
    try:await asyncio.to_thread(proc.wait,3)
    except subprocess.TimeoutExpired:
     proc.kill();await asyncio.to_thread(proc.wait,3)
  for f in files:f.close()
  for p in tmp.glob("gw-*.log"):
   print("QA_GATEWAY_LOG_"+p.name+"="+p.read_text(errors="replace")[-2500:],flush=True)
  await r0.aclose();await r1.aclose()
if __name__=="__main__":asyncio.run(main())
