"""Separate disposable HTTPS and WSS TLS OS processes sharing QA JWT and Raft."""
from __future__ import annotations
import asyncio,hashlib,http.server,json,os,ssl,sys,threading,urllib.parse
from http import HTTPStatus
from pathlib import Path
import identity
def context():
 ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
 ctx.minimum_version=ssl.TLSVersion.TLSv1_2
 ctx.load_cert_chain(os.environ["QA_TLS_CERT"],os.environ["QA_TLS_KEY"])
 return ctx
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version="HTTP/1.1"
 partial=True;received=set();posts=0;lock=threading.RLock()
 def log_message(self,*args):pass
 def respond(self,status,data=b""):
  self.send_response(status)
  self.send_header("Content-Length",str(len(data)))
  self.send_header("X-QA-SHA256",hashlib.sha256(data).hexdigest())
  self.send_header("Cache-Control","no-store")
  self.end_headers();self.wfile.write(data)
 def authorization(self,scope,device):
  header=self.headers.get("Authorization","")
  token=header[7:] if header.startswith("Bearer ") else ""
  return identity.authenticate(token,scope,device)
 def target(self):
  parsed=urllib.parse.urlsplit(self.path)
  query=urllib.parse.parse_qs(parsed.query)
  device=query.get("device",[""])[0]
  if len(query)!=1:return parsed.path,None
  return parsed.path,device
 def do_GET(self):
  path,device=self.target()
  if path not in ("/manifest","/metrics") or not device:return self.respond(404)
  if not self.authorization("manifest:read",device):return self.respond(401)
  if path=="/metrics":
   with self.lock: report={"posts":self.posts,"proofs":len(self.received)}
   return self.respond(200,json.dumps(report).encode())
  error=identity.raft.get("error/"+device)
  if error=="402":return self.respond(402,b'{"error":"QA_BILLING_RESTRICTION"}')
  content=json.dumps({"device":device,"tenant":"company-A",
   "programming":["synthetic-ad-1","synthetic-ad-2"],
   "cache_max_age_seconds":600},sort_keys=True).encode()
  return self.respond(200,content)
 def do_POST(self):
  path,device=self.target()
  if path!="/proofs" or not device:return self.respond(404)
  if not self.authorization("proofs:write",device):return self.respond(401)
  size=int(self.headers.get("Content-Length","0"))
  if size<=0 or size>100000:return self.respond(413)
  try:
   batch=json.loads(self.rfile.read(size))
   assert len(batch)==50 and all(x["device"]==device and isinstance(x["seq"],int) for x in batch)
  except Exception:return self.respond(400)
  with self.lock:
   Handler.posts+=1
   if device=="tv-0000" and Handler.partial:
    Handler.partial=False
    return self.respond(200,b'{"ok":true,"accepted":49,"applied":false}')
   for x in batch:Handler.received.add((device,x["seq"]))
  return self.respond(200,b'{"ok":true,"accepted":50,"applied":true}')
def serve_https():
 server=http.server.ThreadingHTTPServer(("127.0.0.1",20446),Handler)
 server.socket=context().wrap_socket(server.socket,server_side=True)
 print("QA_SHARED_JWT_HTTPS_READY=1",flush=True)
 server.serve_forever(poll_interval=.1)
async def serve_wss():
 from websockets.asyncio.server import serve
 def pre(conn,request):
  raw=request.headers.get("Authorization","")
  token=raw[7:] if raw.startswith("Bearer ") else ""
  if identity.authenticate(token,"wss:presence") is None:
   return conn.respond(HTTPStatus.UNAUTHORIZED,"UNAUTHENTICATED")
 async def handler(ws):
  header=ws.request.headers.get("Authorization","")
  token=header[7:] if header.startswith("Bearer ") else ""
  body=identity.authenticate(token,"wss:presence")
  if not body:
   await ws.close(1008,"UNAUTHENTICATED");return
  await ws.send(json.dumps({"type":"ready","device":body["device"]}))
  async for payload in ws:
   if not identity.authenticate(token,"wss:presence",body["device"]):
    await ws.close(1008,"JWT_ROTATED_OR_REVOKED");return
   try:msg=json.loads(payload)
   except Exception:
    await ws.close(1008,"BAD_JSON");return
   if msg.get("type")=="heartbeat":
    seq=msg.get("seq",0)
    if not isinstance(seq,int) or seq<0:
     await ws.close(1008,"BAD_SEQ");return
    await ws.send(json.dumps({"type":"heartbeat_ack","seq":seq,
     "device":body["device"],
     "command":{"id":"qa-cmd-"+body["device"]} if seq==3 else None}))
   elif msg.get("type")=="command_ack" and msg.get("id")=="qa-cmd-"+body["device"]:
    await ws.send(json.dumps({"type":"command_ack_ok","id":msg["id"]}))
   else:
    await ws.close(1008,"INVALID_COMMAND");return
 async with serve(handler,"127.0.0.1",20445,ssl=context(),
  process_request=pre,ping_interval=None,ping_timeout=None):
  print("QA_SHARED_JWT_WSS_READY=1",flush=True)
  await asyncio.Future()
if __name__=="__main__":
 if len(sys.argv)!=2:raise ValueError("qa server mode required")
 if sys.argv[1]=="https":serve_https()
 elif sys.argv[1]=="wss":asyncio.run(serve_wss())
 else:raise ValueError("no other server modes")
