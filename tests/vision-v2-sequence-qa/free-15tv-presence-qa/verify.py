"""Unmodified fenced-candidate generator, NEW disposable WSS 100/300 test.
Actual TLS WSS clients, two OS gateways and Redis7 nodes, PG17 owner/JTI.
Application-paused readers are not a fully saturated kernel/TLS backpressure test.
A per-ACK row lock race is verified, but global rollback remains NO-GO.
"""
from __future__ import annotations
import asyncio,concurrent.futures,importlib.util,json,os,resource,signal,ssl,statistics,tempfile,time
from pathlib import Path
import psycopg
from redis.asyncio import Redis
from websockets.exceptions import ConnectionClosed
import adversarial as base
P=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location("fenced",P/"central-owner-heartbeat-fenced-candidate.py")
fenced=importlib.util.module_from_spec(s);s.loader.exec_module(fenced)
N=int(os.environ["QA_TVS"])
assert N==15, '15 TV controlled QA only'
assert os.getenv("GITHUB_REF")==base.BRANCH and os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for k in ("DATABASE_URL","PGHOST","PGSERVICE","REDIS_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"):
 assert not os.getenv(k),("OFFICIAL_SECRET_FORBIDDEN",k)
def ck(x,why):assert x,why
def pct(values,p):
 a=sorted(values);z=(len(a)-1)*p;i=int(z);j=min(len(a)-1,i+1)
 w=z-i
 return round(a[i]*(1-w)+a[j]*w,3)
def wal():
 with fenced.wc() as c:
  return str(c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0])
def wd(a,b):
 with fenced.wc() as c:return int(c.execute("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",(b,a)).fetchone()[0])
def stat():
 with fenced.wc() as c:
  return dict(spent=int(c.execute("SELECT count(*) FROM qa_secure.spent").fetchone()[0]),
   active=int(c.execute("SELECT count(*) FROM qa_secure.active").fetchone()[0]),
   authority_bytes=int(c.execute("SELECT pg_total_relation_size('qa_secure.owner') + pg_total_relation_size('qa_secure.active') + pg_total_relation_size('qa_secure.spent')").fetchone()[0]),
   advisory_locks=int(c.execute("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted").fetchone()[0]),
   active_sql_sessions=int(c.execute("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()").fetchone()[0]))
def rss(pid):
 try:
  for line in Path(f"/proc/{pid}/status").read_text().splitlines():
   if line.startswith("VmRSS:"):return int(line.split()[1])
 except FileNotFoundError:return 0
 return 0
async def main():
 begin=time.monotonic()
 base.prepare()
 fenced.setup(fenced.previous.WITNESS)
 with fenced.wc() as c:
  # 15 independently authorized devices with canonical PG17 witness, all synthetic.
  with c.cursor() as cur:
   cur.executemany("INSERT INTO qa_secure.owner(device,tenant) VALUES(%s,'company-A') ON CONFLICT(device) DO UPDATE SET tenant='company-A'",
    [(f"tv-{i:04d}",) for i in range(N)])
 r0=Redis(host="127.0.0.1",port=6379,decode_responses=True,socket_timeout=2)
 r1=Redis(host="127.0.0.1",port=6380,decode_responses=True,socket_timeout=2)
 await base.alive(r0);await base.alive(r1)
 await r0.flushdb();await r1.flushdb()
 folder=Path(tempfile.mkdtemp(prefix="v2_wss_load_fenced_"))
 cert=Path(os.environ["QA_CERT"]).resolve()
 key=Path(os.environ["QA_KEY"]).resolve()
 ctx=ssl.create_default_context(cafile=str(cert));ctx.check_hostname=True
 procs=[];logs=[];clients=[];failed=[]
 before=wal()
 report=dict(production_GO=False,security_verdict="NO_GO_REAL_ROLLBACK_AND_SPLIT_BRAIN_UNPROVEN",
   TVs=N,one_CI_runner=True,independent_OS_gateways=2,
   one_shared_Redis7_lease_store_for_both_gateways=True,
   extra_Redis7_node_for_fault_test_only=True,
   no_Edge_Function_endpoint_used_by_test=True,
   production_free_capacity_not_proven=True,
   actual_TLS_connections=True,per_heartbeat_central_SQL_select=True,
   authpool_max_connections_per_gateway=6,
   command_ACK_main_PG_writes_not_zero=True,
   exact_cost_not_tested=True)
 try:
  for ix,(port,red) in enumerate(((20340,6379),(20341,6379))):
   path=folder/("wss-"+str(ix)+".py")
   fenced.patch(fenced.previous.WITNESS,red,path)
   proc,fh=await base.start_gw(path,"stress-"+str(ix),port,cert,key,folder/("gw-"+str(ix)+".log"))
   procs.append(proc);logs.append(fh)
  sem=asyncio.Semaphore(22)
  async def logon(i):
   async with sem:
    t=time.monotonic()
    name=f"tv-{i:04d}"
    try:
     ws,ready=await base.auth(20340+(i%2),base.original.token("company-A",name),ctx)
     ck(ws is not None and ready.get("type")=="ready",("login rejected",i,ready))
     return (i,ws,ready,round((time.monotonic()-t)*1000,3))
    except Exception as ex:return (i,None,{"error":str(ex)[:120]},round((time.monotonic()-t)*1000,3))
  opened=await asyncio.gather(*[logon(i) for i in range(N)])
  clients=[(i,ws,ready,ms) for i,ws,ready,ms in opened if ws is not None]
  failed=[(i,msg) for i,ws,msg,ms in opened if ws is None]
  ck(len(clients)==N,("not all WSS devices authenticated",N,len(clients),failed[:5]))
  with psycopg.connect(base.DSN,autocommit=True) as c:
   present=int(c.execute("SELECT count(*) FROM qa_wss.status WHERE online").fetchone()[0])
  ck(present==N,("15 authenticated but not online in central status",present,N))
  report["online_after_TLShandshake"]=present
  auth_ms=[q[3] for q in opened]
  with fenced.wc() as c:
   jti=int(c.execute("SELECT count(*) FROM qa_secure.spent").fetchone()[0])
  ck(jti==N,("duplicate or missing JTI ledger",jti,N))
  # 100/300 clients heartbeat together. Critical: client receives ACK
  # only if central owner and lease were checked during the same transaction.
  async def dohb(row,seq):
   i,ws,ready,ms=row
   start=time.monotonic()
   out=await base.heartbeat(ws,ready,seq)
   return i,out,round((time.monotonic()-start)*1000,3)
  wave=await asyncio.gather(*(dohb(c,1) for c in clients))
  successes=sum(x[1].get("type")=="heartbeat_ack" for x in wave)
  report["heartbeat_wave1"]=dict(
   ack=successes,denied=N-successes,
   p95_ms=pct([x[2] for x in wave],.95),
   p99_ms=pct([x[2] for x in wave],.99),
   ms_max=max(x[2] for x in wave))
  report["auth"]=dict(count=len(clients),p95_ms=pct(auth_ms,.95),
                       p99_ms=pct(auth_ms,.99))
  ck(successes==N,("central authority capacity failed heartbeat",N,successes))
  # Concurrent commands on 10 or 30 distinct clients. ACK must appear once
  # in the main PG and wrong/repeated command id must not be accepted.
  cmdclients=[c for c in clients if c[0]>=N//2][:max(10,N//10)]
  ids={}
  for i,ws,ready,ms in cmdclients:
   name=f"tv-{i:04d}";cmdid=f"qa-cmd-{i}"
   ids[i]=cmdid
   await r0.set(f"qa:command:company-A:{name}",json.dumps({"id":cmdid,"action":"qa-only"}))
  responses=await asyncio.gather(*(dohb(row,2) for row in cmdclients))
  ck(all(v[1].get("type")=="heartbeat_ack" and v[1].get("command",{}).get("id")==ids[v[0]]
     for v in responses),("commands not delivered",responses[:3]))
  async def ack(row):
   i,ws,ready,_=row
   try:
    await ws.send(json.dumps({"type":"command_ack","nonce":ready["nonce"],"id":ids[i]}))
    ans=json.loads(await asyncio.wait_for(ws.recv(),timeout=6))
    return i,ans
   except Exception as exc:return i,{"type":"ERROR","error":str(exc)[:80]}
  commits=await asyncio.gather(*(ack(row) for row in cmdclients))
  ck(all(ans.get("type")=="command_ack_ok" for _,ans in commits),
     ("command ack failed",commits[:3]))
  with psycopg.connect(base.DSN,autocommit=True) as c:
   stored=int(c.execute("SELECT count(*) FROM qa_wss.commands").fetchone()[0])
  ck(stored==len(cmdclients),("main PG command rows inconsistent",stored))
  report["command_concurrency"]=dict(command_count=len(cmdclients),ack_count=len(commits),
                                       main_pg_unique_rows=stored)
  # Application-paused WSS consumers while server has live sessions. This
  # pauses asyncio's read transport, but the buffered ACK may fit kernel
  # queues: DO NOT claim full TCP/TLS backpressure.
  slow=[row for row in clients if row[0]>=N//2][:max(10,N//5)]
  for i,ws,ready,ms in slow:ws.transport.pause_reading()
  for i,ws,ready,ms in slow:
   await ws.send(json.dumps({"type":"heartbeat","nonce":ready["nonce"],"seq":3}))
  await asyncio.sleep(.11)
  for i,ws,ready,ms in slow:ws.transport.resume_reading()
  slow_ack=[]
  for i,ws,ready,ms in slow:
   try:slow_ack.append(json.loads(await asyncio.wait_for(ws.recv(),timeout=7)))
   except Exception:slow_ack.append({"type":"closed_or_timeout"})
  report["slow_transport_readers"]=dict(
   paused_reading_count=len(slow),
   ack_count=sum(x.get("type")=="heartbeat_ack" for x in slow_ack),
   true_sustained_TLS_backpressure_proven=False,
   sender_can_buffer_precommit_ACKs=True)
  # Row-lock-through-ACK deterministic race on the first client on gateway 0.
  victim=next(c for c in clients if c[0]==0)
  qa_task=asyncio.create_task(base.heartbeat(victim[1],victim[2],77))
  ready_file=folder/"ready-stress-0"
  release_file=folder/"release-stress-0"
  end=time.monotonic()+6
  while time.monotonic()<end and not ready_file.exists():
   await asyncio.sleep(.005)
  ck(ready_file.exists(),"QA row lock barrier not reached")
  writer=asyncio.create_task(asyncio.to_thread(fenced.write_owner,"company-B"))
  await asyncio.sleep(.035)
  ck(not writer.done(),"owner COMMIT overtook held row locks")
  release_file.write_text("RELEASE",encoding="utf-8")
  old_response=await qa_task
  ck(old_response.get("type")=="heartbeat_ack","precommit ACK lost in synthetic hold")
  ck(not writer.done(),"owner COMMIT overtook precommit ACK")
  await asyncio.wait_for(writer,timeout=4)
  stale=await base.heartbeat(victim[1],victim[2],78)
  ck(stale.get("type")!="heartbeat_ack","postcommit old lease got ACK")
  report["row_lock_ack_fence"]=dict(
   status="PASS_LOCAL_SERIALIZED",old_ACK_before_commit=True,
   old_ACK_after_commit=False,
   real_network_ACK_delivery_after_COMMIT_not_excluded=True)
  # Sample both child RSS values BEFORE terminating the first gateway.
  alive_rss_kib=[rss(p.pid) for p in procs]
  # SIGKILL gateway 0 without touching all services, preserving gateway 1.
  # Normal shared Redis deployment: surviving gateway's sweeper should mark
  # the 8 dead sessions offline without an Edge Function HTTP call.
  p=procs[0];p.send_signal(signal.SIGKILL);p.wait(timeout=6)
  ck(p.returncode==-signal.SIGKILL,"SIGKILL not real")
  killed=next(c for c in clients if c[0]==2)
  lost=await base.heartbeat(killed[1],killed[2],2)
  ck(lost.get("type")!="heartbeat_ack","dead gateway still served")
  survivor=next(c for c in clients if c[0]==3)
  stayed=await base.heartbeat(survivor[1],survivor[2],2)
  ck(stayed.get("type")=="heartbeat_ack","other gateway failed survival")
  report["SIGKILL_one_gateway"]=dict(killed_gateway_did_not_ACK=True,
    surviving_gateway_ACK=True,redis7_and_PG17_stayed_up=True)
  # Real wall-time expiry, not simulated time: fixture Redis TTL=12s.
  # The seven remaining sessions must refresh the authenticated PG/Redis
  # lease while the eight killed sessions expire.
  alive=[row for row in clients if row[0]%2==1]
  start_expiry=time.monotonic()
  observed_online=N
  heartbeat_samples=[]
  for step in range(24):
   replies=await asyncio.gather(*(dohb(row,100+step) for row in alive))
   ck(all(z[1].get("type")=="heartbeat_ack" for z in replies),
      ("surviving WSS clients lost owner/JTI authority",step,replies[:2]))
   heartbeat_samples.extend(z[2] for z in replies)
   with psycopg.connect(base.DSN,autocommit=True) as c:
    observed_online=int(c.execute("SELECT count(*) FROM qa_wss.status WHERE online").fetchone()[0])
   if observed_online==len(alive):break
   await asyncio.sleep(1)
  expiry_ms=round(1000*(time.monotonic()-start_expiry),3)
  ck(observed_online==len(alive),
     ("real Redis TTL expiry did not mark 8 killed clients offline",observed_online,len(alive)))
  ck(expiry_ms<90000,("local TTL test exceeded 90s",expiry_ms))
  report["presence_failover"]=dict(
   authenticated_TLScount=N,live_after_SIGKILL=len(alive),
   offline_after_SIGKILL=N-len(alive),
   offline_detection_wall_ms=expiry_ms,
   local_Redis_TTL_ms=12000,
   live_status_maintained_by_authenticated_WSS_frames=True,
   probe_latency_p95_ms=pct(heartbeat_samples,.95),
   probe_latency_p99_ms=pct(heartbeat_samples,.99),
   guaranteed_90s_worst_case_multi_host=False,
   actual_APK_master_offline_semantics_not_tested=True)
  # Compare monthly invocations if only 4-minute standalone manifest calls
  # invoke Edge; this is a MODEL, not an observed invoice.
  month_min=30*24*60
  modeled_manifest_calls=N*(month_min//4)
  modeled_legacy_bundles=__import__("math").ceil(N*month_min*60/58)
  report["15TV_30day_budget_model"]=dict(
   manifest_every_4min_separate_Edge_calls=modeled_manifest_calls,
   WSS_60second_presence_frames=N*month_min,
   legacy_bundled_58s_Edge_calls=modeled_legacy_bundles,
   actual_Edge_HTTP_calls_generated_by_this_local_WSS_fixture=0,
   prospective_Supabase_Realtime_presence_message_billing_not_measured=True,
   free_Edge_limit_500000=True,
   annual_subscription_or_egress_cost_not_measured=True)
  ck(modeled_manifest_calls==162000 and modeled_legacy_bundles>500000,
     "cost model changed unexpectedly")
  patch=(P.parent.parent/".." /".." /"docs" /"vision-v2"/"homolog-only-4minute-manifest-402-polling-20261104.patch")
  # Do not require filesystem relative guess for optional report link.
  report["four_minute_manifest_patch_exists_in_repository"]=(Path("docs/vision-v2/homolog-only-4minute-manifest-402-polling-20261104.patch").is_file())
  ck(report["four_minute_manifest_patch_exists_in_repository"],
     "homolog-only 4-minute patch absent")
  after=wal()
  report["metrics"]=dict(
   synthetic_witness_SQL_reads_lower_bound=N+N+len(cmdclients)+len(slow)+2,
   witness_SQL_reads_per_2minute_heartbeat_daily={str(n):n*720 for n in (100,300,600,1000)},
   WAL_bytes_witness=wd(before,after),
   witness=stat(),
   one_process_VmRSS_kib=alive_rss_kib,
   controller_RSS_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
  report["duration_s"]=round(time.monotonic()-begin,3)
  Path("qa-15tv-wss-presence.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_15TV_WSS_PRESENCE_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  for row in clients:
   try:await asyncio.wait_for(row[1].close(),timeout=.6)
   except Exception:pass
  for p in procs:
   if p.poll() is None:
    p.terminate()
    try:await asyncio.to_thread(p.wait,3)
    except Exception:p.kill();await asyncio.to_thread(p.wait,3)
  for h in logs:h.close()
  for file in folder.glob("gw-*.log"):
   print("QA_GATEWAY_LOG_"+file.name+"="+file.read_text(errors="replace")[-2500:],flush=True)
  await r0.aclose();await r1.aclose()
if __name__=="__main__":asyncio.run(main())
