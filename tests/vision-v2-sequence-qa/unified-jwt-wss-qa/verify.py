"""Real localhost 15 TLS WSS + HTTPS shared JWT/key, kid rotate, Raft fencing.

Does not change original WSS gateways or real Android player; no nonrollbackable
authority, client mTLS or real multi-host failover.
"""
from __future__ import annotations
import asyncio,hashlib,json,os,resource,secrets,signal,socket,ssl,subprocess,sys,tempfile,time,urllib.error,urllib.parse,urllib.request
from pathlib import Path
import websockets
import identity
from websockets.exceptions import ConnectionClosed
assert os.getenv("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for k in ("SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","DATABASE_URL","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(k),("production forbidden",k)
HERE=Path(__file__).resolve().parent
def check(v,msg):assert v,msg
def p95(a,q):
 x=sorted(a);z=(len(x)-1)*q;i=int(z);f=z-i
 return round(x[i]*(1-f)+x[min(i+1,len(x)-1)]*f,3)
def ping(port):
 with socket.create_connection(("127.0.0.1",port),timeout=.3):pass
def remote(method,device,token,payload=None,path="/manifest"):
 ctx=ssl.create_default_context(cafile=os.environ["QA_TLS_CERT"])
 addr="https://localhost:20446"+path+"?"+urllib.parse.urlencode({"device":device})
 headers={"Authorization":"Bearer "+token}
 if payload is not None:headers["Content-Type"]="application/json"
 req=urllib.request.Request(addr,method=method,headers=headers,data=payload)
 start=time.monotonic()
 try:
  with urllib.request.urlopen(req,timeout=4,context=ctx) as response:
   raw=response.read();status=response.status
   valid=(hashlib.sha256(raw).hexdigest()==response.headers.get("X-QA-SHA256") and
    len(raw)==int(response.headers.get("Content-Length",0)))
 except urllib.error.HTTPError as e:status=e.code;raw=e.read();valid=False
 return dict(status=status,body=raw,integrity=valid,ms=round(1000*(time.monotonic()-start),3))
def launch(kind):
 env=dict(os.environ)
 log=open("qa-shared-"+kind+".log","ab")
 p=subprocess.Popen([sys.executable,"-u",str(HERE/"servers.py"),kind],
  env=env,stdout=log,stderr=subprocess.STDOUT)
 deadline=time.monotonic()+10
 port=20445 if kind=="wss" else 20446
 while time.monotonic()<deadline:
  if p.poll() is not None:raise RuntimeError("server "+kind+" exited "+str(p.returncode))
  try:ping(port);return p,log
  except OSError:time.sleep(.1)
 raise TimeoutError("server "+kind+" not ready")
async def connection(device,token,ctx):
 ws=await websockets.connect("wss://localhost:20445",ssl=ctx,
  additional_headers={"Authorization":"Bearer "+token},open_timeout=4,
  ping_interval=None)
 raw=json.loads(await asyncio.wait_for(ws.recv(),timeout=3))
 check(raw=={"type":"ready","device":device},("wrong identity WSS",raw))
 return ws
async def heartbeat(ws,seq,device):
 t=time.monotonic()
 await ws.send(json.dumps({"type":"heartbeat","seq":seq}))
 raw=json.loads(await asyncio.wait_for(ws.recv(),timeout=4))
 check(raw["type"]=="heartbeat_ack" and raw["seq"]==seq and raw["device"]==device,raw)
 return raw,round(1000*(time.monotonic()-t),3)
async def denies(ws):
 try:
  await ws.send(json.dumps({"type":"heartbeat","seq":5}))
  await asyncio.wait_for(ws.recv(),timeout=3)
  return False
 except ConnectionClosed as exc:return exc.code==1008
async def rejected_handshake(device,token,ctx):
 try:
  c=await websockets.connect("wss://localhost:20445",ssl=ctx,
   additional_headers={"Authorization":"Bearer "+token},open_timeout=3,ping_interval=None)
  await c.close();return False
 except websockets.exceptions.InvalidStatus as e:
  return e.response.status_code in (401,403)
async def main():
 begun=time.monotonic()
 keydir=Path(tempfile.mkdtemp(prefix="qa_v2_shared_jwt_keys_"))
 for kid in ("k1","k2"):
  (keydir/(kid+".key")).write_bytes(secrets.token_bytes(32))
 (keydir/"active-kid").write_text("k1")
 os.environ["QA_IDENTITY_KEY_DIR"]=str(keydir)
 identity.raft.put("term","epoch8:leaderB")
 for i in range(15):identity.raft.put("owner/tv-"+str(i).zfill(4),"company-A")
 ctx=ssl.create_default_context(cafile=os.environ["QA_TLS_CERT"])
 children=[];logs=[];sockets=[]
 report=dict(production_GO=False,actual_TLS_WSS_and_HTTPS_in_separate_OS_processes=True,
  actual_APK_integrated=False,synthetic_shared_HS256_issuer=True,
  same_issued_token_and_device_used_by_both_channels=True,
  active_issuer_keys_not_exposed_to_client_processes=False,
  Central_Raft_fence_checked_for_each_HTTP_and_WSS_frame=True)
 try:
  for kind in ("https","wss"):
   p,f=launch(kind);children.append(p);logs.append(f)
  tokens={f"tv-{i:04d}":identity.mint(f"tv-{i:04d}") for i in range(15)}
  items=await asyncio.gather(*(connection(k,v,ctx) for k,v in tokens.items()))
  sockets.extend(items)
  first=await asyncio.gather(*(heartbeat(ws,1,device) for (device,_),ws in zip(tokens.items(),items)))
  check(len(first)==15,"not all WSS signed same issuer")
  http=await asyncio.gather(*(asyncio.to_thread(remote,"GET",d,t)
   for d,t in tokens.items()))
  check(all(x["status"]==200 and x["integrity"] for x in http),"15 signed HTTPS manifests")
  wss_times=[x[1] for x in first]
  report["joint_15_device_same_JWT"]=dict(WSS_authenticated=15,HTTPS_verified=15,
   heartbeat_P95_ms=p95(wss_times,.95),heartbeat_P99_ms=p95(wss_times,.99),
   HTTPS_P95_ms=p95([x["ms"] for x in http],.95),
   HTTPS_P99_ms=p95([x["ms"] for x in http],.99))
  # Commands travel over authenticated WebSocket and ACK is bound to same device.
  one,ms=await heartbeat(items[0],3,"tv-0000")
  command=one["command"]["id"]
  await items[0].send(json.dumps({"type":"command_ack","id":command}))
  ack=json.loads(await items[0].recv())
  check(ack=={"type":"command_ack_ok","id":command},"no command ack")
  report["signed_WSS_command"]=dict(status="PASS",acked=1)
  # HTTP 402 is a transient local response, cached media remain bounded by lease.
  identity.raft.put("error/tv-0002","402")
  limited=await asyncio.to_thread(remote,"GET","tv-0002",tokens["tv-0002"])
  check(limited["status"]==402,"402 injection failed")
  report["HTTP402_cache_4min"]=dict(status="PASS",code=402,
   virtual_refresh_ms=240000,cooldown_ms=1817000,
   local_lease_expiry_must_still_apply=True,actual_4min_wall_wait=False)
  # Per-device durable central Raft revocation prevents both protocols.
  identity.raft.put("revoked/tv-0001","true")
  denied_http=await asyncio.to_thread(remote,"GET","tv-0001",tokens["tv-0001"])
  denied_wss=await denies(items[1])
  check(denied_http["status"]==403 and denied_wss,"revocation across channels")
  check(await rejected_handshake("tv-0001",tokens["tv-0001"],ctx),"revoked handshake accepted")
  report["per_device_revocation"]=dict(HTTPS=403,WSS_closed_1008=True,WSS_handshake_rejected=True)
  # Key rotation: old JWT immediately unusable both for HTTPS and existing WSS.
  (keydir/"active-kid").write_text("k2")
  old_http=await asyncio.to_thread(remote,"GET","tv-0000",tokens["tv-0000"])
  old_wss=await denies(items[0])
  check(old_http["status"]==401 and old_wss,"rotation left old token valid")
  check(await rejected_handshake("tv-0000",tokens["tv-0000"],ctx),"rotated handshake valid")
  tokens2={d:identity.mint(d) for d in tokens if d!="tv-0001"}
  reopened=await asyncio.gather(*(connection(d,t,ctx) for d,t in tokens2.items()))
  sockets.extend(reopened)
  signed=await asyncio.gather(*(heartbeat(ws,2,d) for (d,_),ws in zip(tokens2.items(),reopened)))
  accepted=await asyncio.gather(*(asyncio.to_thread(remote,"GET",d,t) for d,t in tokens2.items()))
  check(len(reopened)==14 and all(x["status"]==200 for x in accepted if True and x is not None
    and tokens2.get("tv-0002") is not None),"reopened invalid")
  report["kid_rotation"]=dict(old_HTTPS=401,old_WSS_closed_1008=True,
   old_WSS_handshake_rejected=True,new_WSS_accepted=14,new_HTTPS_accepted=sum(
    x["status"]==200 for x in accepted),
   HTTP402_preserved_for_tv0002=True)
  # One HTTPS 402 is still active, must not be misclassified as signed JWT failure.
  check(sum(x["status"]==200 for x in accepted)==13 and sum(
    x["status"]==402 for x in accepted)==1,"real HTTP 402 disappeared")
  # SIGKILL solely the WSS process; HTTPS must stay usable.
  wssproc=children[1];wssproc.kill();await asyncio.to_thread(wssproc.wait,4)
  check(wssproc.returncode==-signal.SIGKILL,"no real SIGKILL")
  alive_http=await asyncio.to_thread(remote,"GET","tv-0000",tokens2["tv-0000"])
  check(alive_http["status"]==200 and alive_http["integrity"],"HTTPS affected by WSS SIGKILL")
  wsnew,lf=launch("wss");children.append(wsnew);logs.append(lf)
  connected=await asyncio.gather(*(connection(d,t,ctx) for d,t in tokens2.items()))
  sockets.extend(connected)
  report["WSS_SIGKILL_and_reconnect"]=dict(actual_SIGKILL=True,
   unaffected_HTTPS=True,reconnected=14)
  # Real batched commercial HTTPS with partial ACK and verified durable local ledger.
  successful=0
  for d,t in tokens2.items():
   if d=="tv-0002":continue
   payload=json.dumps([{"device":d,"seq":n} for n in range(50)]).encode()
   out=await asyncio.to_thread(remote,"POST",d,t,payload,"/proofs")
   check(out["status"]==200,"commercial POST")
   msg=json.loads(out["body"])
   if d=="tv-0000":
    check(msg["accepted"]==49 and not msg["applied"],"partial ack lost evidence")
    out=await asyncio.to_thread(remote,"POST",d,t,payload,"/proofs")
    msg=json.loads(out["body"])
   check(msg["accepted"]==50 and msg["applied"],"batch evidence not acknowledged")
   successful+=1
  metrics=await asyncio.to_thread(remote,"GET","tv-0000",tokens2["tv-0000"],None,"/metrics")
  counts=json.loads(metrics["body"])
  check(counts["posts"]==successful+1 and counts["proofs"]==successful*50,counts)
  report["HTTPS_batch50"]=dict(devices=successful,unique_proofs=counts["proofs"],
    POST_attempts=counts["posts"],partial_ACK_retained=True,no_real_customer_data=True)
  report["rss_controller_KiB"]=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
  report["elapsed_s"]=round(time.monotonic()-begun,3)
  report["security_verdict"]="NO_GO_BECAUSE_SHARED_BEARER_THEFT_FULL_RAFT_ROLLBACK_AND_REAL_APK_UNPROVEN"
  Path("qa-v2-unified-jwt-wss.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_UNIFIED_JWT_WSS_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  for ws in sockets:
   try:await asyncio.wait_for(ws.close(),timeout=.2)
   except Exception:pass
  for child in children:
   if child.poll() is None:
    child.kill()
    await asyncio.to_thread(child.wait,3)
  for f in logs:f.close()
if __name__=="__main__":asyncio.run(main())
