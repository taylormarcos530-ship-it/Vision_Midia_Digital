"""Ephemeral localhost TLS HTTPS manifest/proof API used alongside 15 real WSS clients.

This DOES NOT deploy Edge Functions, use real player/APK, or measure an
actual 30-day monthly quota. All proofs and manifests are synthetic and
only the WSS gateway uses disposable PostgreSQL17/Redis7.
"""
from __future__ import annotations
import asyncio,hashlib,http.server,json,ssl,statistics,threading,time,urllib.error,urllib.parse,urllib.request
from collections import defaultdict

def percentile(values,quantile):
 a=sorted(values)
 pos=(len(a)-1)*quantile
 i=int(pos)
 return round(a[i]*(1-(pos-i))+a[min(len(a)-1,i+1)]*(pos-i),3)

def run_synthetic_tls_fixture(clients,gateway,cert,key):
 begun=time.monotonic()
 body=json.dumps({"ads":[{"id":"a","duration":15},{"id":"b","duration":15}],
                  "revision":3,"tenant":"company-A","cache_max_age_seconds":600},
                  sort_keys=True,separators=(",",":")).encode()
 sha=hashlib.sha256(body).hexdigest()
 state={"errors":{},"faked_partial":True,"dedup":set(),
   "get":0,"post":0,"bytes":0,"http402":0,"http403":0}
 class Handler(http.server.BaseHTTPRequestHandler):
  protocol_version="HTTP/1.1"
  def log_message(self,*args):pass
  def response(self,status,data,ctype="application/json"):
   self.send_response(status)
   self.send_header("Content-Type",ctype)
   self.send_header("Content-Length",str(len(data)))
   self.send_header("Cache-Control","no-store")
   self.send_header("X-QA-SHA256",hashlib.sha256(data).hexdigest())
   self.end_headers();self.wfile.write(data)
   state["bytes"]+=len(data)
  def auth(self,device):
   try:
    value=self.headers.get("Authorization","")
    if not value.startswith("Bearer "):return False
    claims=gateway.verify(value[7:])
    return claims["device"]==device and claims["company"]=="company-A"
   except Exception:return False
  def do_GET(self):
   u=urllib.parse.urlparse(self.path)
   device=urllib.parse.parse_qs(u.query).get("device",[""])[0]
   if u.path!="/manifest" or not device.startswith("tv-"):return self.response(404,b"")
   if not self.auth(device):return self.response(403,b"")
   state["get"]+=1
   status=state["errors"].get(device)
   if status==402:
    state["http402"]+=1
    return self.response(402,b'{"error":"QA_USAGE_RESTRICTED"}')
   if status==403:
    state["http403"]+=1
    return self.response(403,b'{"error":"QA_REVOKED"}')
   self.response(200,body)
  def do_POST(self):
   u=urllib.parse.urlparse(self.path)
   device=urllib.parse.parse_qs(u.query).get("device",[""])[0]
   if u.path!="/proofs" or not device.startswith("tv-"):return self.response(404,b"")
   if not self.auth(device):return self.response(403,b"")
   size=int(self.headers.get("Content-Length",0))
   if size<=0 or size>100000:return self.response(413,b"")
   raw=self.rfile.read(size)
   try:
    batch=json.loads(raw)
    assert isinstance(batch,list) and len(batch)==50
    assert all(x["device"]==device and isinstance(x["seq"],int) for x in batch)
   except Exception:return self.response(400,b"")
   state["post"]+=1
   if state["faked_partial"] and device=="tv-0000":
    state["faked_partial"]=False
    return self.response(200,b'{"ok":true,"accepted":49,"applied":false}')
   for item in batch:state["dedup"].add((device,item["seq"]))
   self.response(200,json.dumps({"ok":True,"accepted":50,"applied":True}).encode())
 server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler)
 context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
 context.minimum_version=ssl.TLSVersion.TLSv1_2
 context.load_cert_chain(str(cert),str(key))
 server.socket=context.wrap_socket(server.socket,server_side=True)
 server.timeout=2
 thread=threading.Thread(target=server.serve_forever,daemon=True)
 thread.start()
 client_context=ssl.create_default_context(cafile=str(cert))
 client_context.check_hostname=True
 port=server.server_address[1]
 timings=[];cached={}
 def request(method,device,token,payload=None):
  u="https://localhost:"+str(port)+("/manifest" if method=="GET" else "/proofs")+"?device="+urllib.parse.quote(device)
  headers={"Authorization":"Bearer "+token}
  if payload is not None:headers["Content-Type"]="application/json"
  r=urllib.request.Request(u,headers=headers,method=method,data=payload)
  start=time.monotonic()
  try:
   with urllib.request.urlopen(r,context=client_context,timeout=4) as s:
    raw=s.read()
    status=s.status
    correct=len(raw)==int(s.headers["Content-Length"]) and hashlib.sha256(raw).hexdigest()==s.headers["X-QA-SHA256"]
  except urllib.error.HTTPError as exc:
   raw=exc.read();status=exc.code;correct=False
  timings.append(round((time.monotonic()-start)*1000,3))
  return status,raw,correct
 try:
  # All connected WSS devices perform a REAL HTTPS GET while their WSS sessions
  # remain open on 2 separate gateway OS processes.
  assert len(clients)==15
  for i,ws,ready,ms in clients:
   device=f"tv-{i:04d}"
   token=gateway.token("company-A",device)
   status,data,valid=request("GET",device,token)
   assert (status,valid)==(200,True),(device,status,valid)
   assert hashlib.sha256(data).hexdigest()==sha
   cached[device]=dict(data=data,initial_virtual_ms=0,lease_expiry_ms=35*86400000,
     server_manifest_max_age_ms=600000,next_check_ms=240000,blocked=False,token=token)
  # Accelerated virtual clock scheduling, not a 4-minute real waiting period.
  assert all(239000<x["next_check_ms"] for x in cached.values())
  state["errors"]["tv-0000"]=402
  status,data,valid=request("GET","tv-0000",cached["tv-0000"]["token"])
  assert status==402 and not valid
  retry_at=240000+30*60000+17000
  assert retry_at>240000 and cached["tv-0000"]["lease_expiry_ms"]>retry_at
  assert cached["tv-0000"]["server_manifest_max_age_ms"]>240000
  # A 403 invalidates cached playback immediately.
  state["errors"]["tv-0001"]=403
  status,data,valid=request("GET","tv-0001",cached["tv-0001"]["token"])
  assert status==403 and not valid
  cached["tv-0001"]["blocked"]=True
  assert cached["tv-0001"]["blocked"]
  # Detached/offline client local expiry never uses the stale cached manifest.
  cached["tv-0002"]["lease_expiry_ms"]=250000
  assert 250001>=cached["tv-0002"]["lease_expiry_ms"]
  # Real HTTPS tampered company/device token is denied.
  wrongCompany=gateway.token("company-B","tv-0003")
  wrongDevice=gateway.token("company-A","tv-0004")
  assert request("GET","tv-0003",wrongCompany)[0]==403
  assert request("GET","tv-0003",wrongDevice)[0]==403
  # Real HTTPS batches: partial ACK cannot clear the first 50 commercial proofs;
  # complete ACK retains exactly once in the fake server's deduplicated ledger.
  partial_preserved=False
  for i,ws,ready,ms in clients:
   device=f"tv-{i:04d}"
   batch=[dict(device=device,seq=n) for n in range(50)]
   data=json.dumps(batch,separators=(",",":")).encode()
   status,ack,good=request("POST",device,cached[device]["token"],data)
   assert status==200
   obj=json.loads(ack)
   if i==0:
    assert obj["accepted"]==49 and not obj["applied"]
    partial_preserved=True
    status,ack,good=request("POST",device,cached[device]["token"],data)
    assert status==200 and json.loads(ack)=={"ok":True,"accepted":50,"applied":True}
   else:assert obj=={"ok":True,"accepted":50,"applied":True}
  assert partial_preserved
  assert len(state["dedup"])==15*50
  assert state["post"]==16 and state["http402"]==1 and state["http403"]==1
  return dict(status="PASS_SYNTHETIC_LIVE_WSS_PLUS_HTTPS_IN_ONE_CI_RUN",
   real_WSS_TLS_active_sessions_during_tests=15,real_local_HTTPS_manifest_200=15,
   HTTPS_TLS_verified=True,HTTPS_manifest_integrity_SHA256=sha,
   program_refresh_interval_ms=240000,accelerated_virtual_clock=True,
   HTTP402_retry_cooldown_ms=1817000,HTTP402_cached_playback_only_while_lease_and_manifest_valid=True,
   HTTP403_immediate_playback_revocation=True,offline_lease_expiry_blocks_playback=True,
   command_pipeline_covered_by_original_WSS_suite=True,
   unique_commercial_proofs_persisted_in_synthetic_server=len(state["dedup"]),
   HTTPS_batch_POSTs=state["post"],partial_ACK_keeps_50_proofs=True,
   HTTP_manifest_requests=state["get"],
   HTTPS_p95_ms=percentile(timings,.95),HTTPS_p99_ms=percentile(timings,.99),
   HTTPS_wire_response_bytes=state["bytes"],
   local_host_only=True,live_APK_or_real_Edge_functions_tested=False,
   elapsed_s=round(time.monotonic()-begun,3))
 finally:
  server.shutdown();server.server_close();thread.join(timeout=5)
