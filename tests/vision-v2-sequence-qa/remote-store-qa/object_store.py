"""Disposable independent-process object-storage simulator for Vision V2 QA.

Python HTTP server runs in its own Docker container with a separately mounted
storage directory; the GitHub runner and PostgreSQL use ONLY HTTP to access it.
No external network, real S3, production keys, credentials or deletion API.
"""
import hashlib
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import tempfile
import threading
import urllib.parse

DATA = Path(os.environ.get("QA_STORE_DIR", "/data"))
AUTH = os.environ["QA_STORE_TOKEN"]
ADMIN = os.environ["QA_STORE_ADMIN_TOKEN"]
SIGN_KEY = bytes.fromhex(os.environ["QA_STORE_RECEIPT_KEY_HEX"])
NAMES = re.compile(r"^[a-z0-9_-]{5,100}\.v2qa$")
MAX_BYTES = 4*1024*1024
state = {"mode": "normal", "puts": 0}
guard = threading.Lock()
DATA.mkdir(parents=True, exist_ok=True)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def response_receipt(name,raw):
    body={"name":name,"sha256":digest(raw),"bytes":len(raw),"durable":True}
    message=f"{name}\n{body['sha256']}\n{len(raw)}".encode()
    body["mac"]=hmac.new(SIGN_KEY,message,hashlib.sha256).hexdigest()
    return body

class Server(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def json(self,status,value):
        raw=json.dumps(value,sort_keys=True,separators=(",",":")).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(raw)))
        self.send_header("Cache-Control","no-store")
        self.end_headers()
        self.wfile.write(raw)
    def raw(self,status,value):
        self.send_response(status)
        self.send_header("Content-Type","application/octet-stream")
        self.send_header("Content-Length",str(len(value)))
        self.send_header("Cache-Control","no-store")
        self.end_headers()
        self.wfile.write(value)
    def authorized(self,secret):
        supplied=self.headers.get("Authorization","")
        return hmac.compare_digest(supplied,f"Bearer {secret}")
    def obj(self):
        if not self.path.startswith("/objects/"): return None
        name=self.path[len("/objects/"):]
        if not NAMES.fullmatch(name):return None
        return name
    def do_GET(self):
        if self.path=="/health":
            return self.json(200,{"service":"vision-v2-qa","independent_container":True})
        if not self.authorized(AUTH):return self.json(401,{"error":"unauthorized"})
        name=self.obj()
        if name is None:return self.json(404,{"error":"not_found"})
        with guard:
            if state["mode"]=="offline":
                return self.json(503,{"error":"simulated_network_unavailable"})
            p=DATA/name
            if not p.is_file() or p.is_symlink():
                return self.json(404,{"error":"not_found"})
            content=p.read_bytes()
            if state['mode']=='corrupt_read':
                content=content[:-1]+bytes([content[-1]^1])
            self.raw(200,content)
    def do_PUT(self):
        if not self.authorized(AUTH):return self.json(401,{"error":"unauthorized"})
        name=self.obj()
        if name is None:return self.json(404,{"error":"not_found"})
        try:size=int(self.headers.get("Content-Length","-1"))
        except ValueError:return self.json(400,{"error":"invalid_length"})
        if not 0<size<=MAX_BYTES:return self.json(413,{"error":"size"})
        raw=self.rfile.read(size)
        if len(raw)!=size:return self.json(400,{"error":"truncated_upload"})
        with guard:
            mode=state["mode"]
            if mode=="offline":
                return self.json(503,{"error":"simulated_network_unavailable"})
            path=DATA/name
            if path.is_file():
                if path.read_bytes()!=raw:return self.json(409,{"error":"object_immutable"})
                return self.json(200,response_receipt(name,raw))
            fd,tmp=tempfile.mkstemp(prefix=".inflight-",dir=str(DATA))
            try:
                with os.fdopen(fd,"wb") as f:
                    f.write(raw[:max(1,len(raw)//2)])
                    if mode=="write_full":
                        return self.json(507,{"error":"synthetic_storage_full"})
                    f.write(raw[max(1,len(raw)//2):])
                    f.flush();os.fsync(f.fileno())
                os.replace(tmp,path)
                directory=os.open(str(DATA),os.O_RDONLY)
                try:os.fsync(directory)
                finally:os.close(directory)
                state["puts"]+=1
                if mode=="ack_lost":
                    return self.json(503,{"error":"synthetic_response_lost_after_durable_write"})
                receipt=response_receipt(name,raw)
                if mode=="bad_receipt":receipt["mac"]="0"*64
                self.json(201,receipt)
            finally:
                if os.path.exists(tmp):os.unlink(tmp)
    def do_POST(self):
        if self.path!="/_qa/control":return self.json(404,{"error":"not_found"})
        if not self.authorized(ADMIN):return self.json(401,{"error":"unauthorized"})
        try:
            length=int(self.headers.get("Content-Length","-1"))
            if length<=0 or length>512:return self.json(400,{"error":"invalid_length"})
            req=json.loads(self.rfile.read(length))
        except (ValueError,json.JSONDecodeError):
            return self.json(400,{"error":"invalid_json"})
        if set(req)!={"mode"} or req["mode"] not in {"normal","offline","ack_lost","write_full","corrupt_read","bad_receipt"}:
            return self.json(400,{"error":"invalid_mode"})
        with guard:state["mode"]=req["mode"]
        return self.json(200,{"mode":req["mode"]})
    # No DELETE route, no object rewrite and no listing of all stored objects.

if __name__=="__main__":
    ThreadingHTTPServer(("0.0.0.0",8080),Server).serve_forever()
