"""Vision V2 synthetic QA only, PG17 disposable.
Bounded-memory commercial full-report serialization: pre-build gzip once per
company revision from canonical original SQL JSON bytes into a disk-backed file;
each HTTP GET streams the prebuilt compressed artifact, with synthetic JWT/RLS
membership checks per block and authoritative DB commercial revision admission.

No production endpoint is used. This is an optimization of QA report serving,
NOT an approved auth-to-socket fence or a deployment candidate.
"""
from __future__ import annotations
import hashlib,importlib.util,json,multiprocessing as mp,os,resource,socket
import tempfile,threading,time,zlib
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib import request,error

BASE=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location("v2_commercial_driver",BASE/"bounded-fence-qa"/"commercial_cutover.py")
driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
c,z,v,deep=driver.c,driver.z,driver.v,driver.deep
CHUNK=int(os.environ.get("QA_COMMERCIAL_CHUNK","65536"))
ADMISSIONS=int(os.environ.get("QA_COMMERCIAL_ADMISSIONS","12"))
assert CHUNK in (65536,262144)
assert ADMISSIONS in (8,12,20)

class BoundedCommercialServer(c.HTTP):
    def __init__(self,index,keys):
        super().__init__(index,keys)
        self.RequestHandlerClass=BoundedHandler
        self.tempfiles=tempfile.TemporaryDirectory(prefix="vision-v2-synth-report-")
        self.root=Path(self.tempfiles.name)
        self.base_paths={}
        self.versions={}
        self.build_seconds=[]
        self.disk_peak=0
        self.active_streams=0
        self.peak_active_streams=0
        self.reader_bytes_max=0
        self.prewarm_bytes=0
    def make_cache(self):
        # Original unmodified PostgreSQL SQL RPC. Check export rows ONCE per
        # company at warmup; never parse the 2.8MB JSON on each HTTP request.
        for company in v.COMPANIES:
            payload=deep.report_full(company)["payload"]
            canonical=json.loads(payload)
            c.ck(len(canonical["export"])==10000,"not_original_full_export")
            del canonical
            raw_path=self.root/("raw-"+str(company)+".json")
            with open(raw_path,"wb") as dest:
                encoded=payload.encode("utf-8")
                for start in range(0,len(encoded),262144):
                    dest.write(memoryview(encoded)[start:start+262144])
                self.prewarm_bytes+=len(encoded)
            del payload,encoded
            self.base_paths[str(company)]=raw_path
            self.report_builds+=1
    def build_revision(self,company,revision,campaign):
        t0=time.perf_counter()
        company=str(company)
        ident=(company,int(revision))
        meta=(",").join([
            '"campaign":'+json.dumps(campaign,ensure_ascii=True,separators=(",",":")),
            '"revision":'+str(int(revision)),
            '"original_full_report":'
        ])
        prefix=("{"+meta).encode()
        suffix=b"}"
        target=self.root/("ready-"+company+"-"+str(revision)+".gz")
        temp=self.root/("staging-"+company+"-"+str(revision)+".gz.tmp")
        sha=hashlib.sha256();raw_count=0
        compressor=zlib.compressobj(level=3,method=zlib.DEFLATED,wbits=31)
        with open(temp,"wb") as out:
            def write_source(buf):
                nonlocal raw_count
                sha.update(buf);raw_count+=len(buf)
                packed=compressor.compress(buf)
                if packed:out.write(packed)
            write_source(prefix)
            with open(self.base_paths[company],"rb") as source:
                while True:
                    piece=source.read(65536)
                    if not piece:break
                    write_source(piece)
            write_source(suffix)
            out.write(compressor.flush())
            out.flush();os.fsync(out.fileno())
        os.replace(temp,target)
        obj={"revision":int(revision),"campaign":campaign,"filepath":str(target),
             "length":os.stat(target).st_size,"hash":sha.hexdigest(),
             "uncompressed":raw_count}
        # Version asset is fully durable BEFORE it becomes visible to GET.
        with self.mu:
            self.versions[company]=obj
            self.build_seconds.append(round(time.perf_counter()-t0,4))
            self.disk_peak=max(self.disk_peak,sum(x["length"] for x in self.versions.values())+self.prewarm_bytes)
        return obj
    def startup(self):
        super().startup()
    def replay(self,crash_at=None):
        ids=super().replay(crash_at=crash_at)
        # The base updates the durable cursor; derived gzip is reconstructible
        # from original SQL JSON and revised commercial event, not trusted for
        # auth. A missing materialization must respond 503 until built.
        if ids:
            with self.mu:
                entries=[(co,item.copy()) for co,item in self.cache.items()
                    if not co.startswith("base:")]
            for co,item in entries:self.build_revision(co,item["revision"],item["campaign"])
        return ids
    def cleanup(self):
        self.tempfiles.cleanup()

class BoundedHandler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        srv=self.server
        sent_headers=False
        try:
            tenant=int(self.path.split("?")[0].strip("/"))
            company=v.COMPANIES[tenant];key=str(company)
            token=self.headers.get("X-QA-JWT","")
            srv.authorize(company,token)
            with v.con() as db:
                current=c.sql(db,"SELECT revision FROM qa_ordered_campaign WHERE company_id=%s",(company,))
            with srv.mu:
                srv.sql_admission+=1
                snapshot=srv.cache.get(key)
                payload=srv.versions.get(key)
            if not snapshot or not payload or (snapshot["revision"]!=current or payload["revision"]!=current):
                with srv.mu:srv.stale+=1
                self.send_error(503,"commercial_revision_stale_until_replay")
                return
            self.send_response(200);sent_headers=True
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Encoding","gzip")
            self.send_header("Content-Length",str(payload["length"]))
            self.send_header("X-QA-SHA256",payload["hash"])
            self.send_header("X-QA-Report-Rows","10000")
            self.end_headers()
            self.connection.settimeout(5)
            with srv.mu:
                srv.active_streams+=1
                srv.peak_active_streams=max(srv.peak_active_streams,srv.active_streams)
            try:
                with open(payload["filepath"],"rb",buffering=CHUNK) as file:
                    while True:
                        piece=file.read(CHUNK)
                        if not piece:break
                        srv.authorize(company,token)
                        with srv.mu:srv.reader_bytes_max=max(srv.reader_bytes_max,len(piece))
                        self.wfile.write(piece);self.wfile.flush()
                        with srv.mu:srv.payload_bytes+=len(piece)
                with srv.mu:srv.sent+=1
            finally:
                with srv.mu:srv.active_streams-=1
        except PermissionError:
            with srv.mu:srv.denied+=1
            if not sent_headers:
                self.send_response(401);self.send_header("Content-Length","0");self.end_headers()
            else:
                with srv.mu:srv.failed+=1
                self.close_connection=True
                try:self.connection.shutdown(socket.SHUT_WR)
                except OSError:pass
        except (BrokenPipeError,ConnectionResetError,TimeoutError):
            with srv.mu:srv.failed+=1
        except Exception:
            with srv.mu:srv.failed+=1
            if not sent_headers:
                try:self.send_error(503,"synthetic_qa_server_error")
                except OSError:pass
            else:
                self.close_connection=True
                try:self.connection.shutdown(socket.SHUT_WR)
                except OSError:pass

def worker(index,keys,pipe):
    service=BoundedCommercialServer(index,keys)
    service.startup()
    service.make_cache()
    for co,item in list(service.cache.items()):
        if not co.startswith("base:"):
            service.build_revision(co,item["revision"],item["campaign"])
    thread=threading.Thread(target=service.serve_forever,daemon=True);thread.start()
    pipe.send({"pid":os.getpid(),"port":service.server_address[1]})
    try:
        while True:
            msg=pipe.recv();op=msg["op"]
            if op=="sync":
                pipe.send({"ids":service.replay(),"cursor":service.last})
            elif op=="get_stats":
                with service.mu:
                    pipe.send({
                        "pid":os.getpid(),"cursor":service.last,
                        "cached":{k:x for k,x in service.cache.items() if not k.startswith("base:")},
                        "sql_background":service.sql_background,
                        "sql_admission":service.sql_admission,
                        "sql_per_block":service.sql_chunks,
                        "sent":service.sent,"denied":service.denied,
                        "failed":service.failed,"stale":service.stale,
                        "payload_bytes":service.payload_bytes,
                        "RSS_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                        "report_builds":service.report_builds,
                        "chunk_bytes":CHUNK,
                        "cached_gzip_bytes":sum(x["length"] for x in service.versions.values()),
                        "disk_peak_bytes":service.disk_peak,
                        "gzip_build_seconds":service.build_seconds,
                        "peak_active_streams":service.peak_active_streams,
                        "max_file_read_bytes":service.reader_bytes_max
                    })
            elif op=="stop":pipe.send(True);break
            else:raise RuntimeError("unsupported_command:"+str(op))
    finally:
        service.shutdown();service.server_close();thread.join(3)
        service.cleanup()

def launch(index,keys):
    parent,child=mp.Pipe()
    proc=mp.Process(target=worker,args=(index,keys));proc.start()
    info=parent.recv()
    return proc,parent,info

def main():
    # The existing full original HTTP+commercial cutover QA driver calls
    # commercial.launch(), ask(), and close(). Only the worker implementation
    # changes; assertions for 300 SHA-256/10k event HTTP responses, 503 on
    # stale revisions, two outbox replays, and rollback remain unchanged.
    driver.c.launch=launch
    previous=driver.threading.BoundedSemaphore
    # Prevent affecting any other tests (this module runs in disposable job).
    driver.main.__globals__["ADMIT_LIMIT_QA"]=ADMISSIONS
    # Driver hardcoded 12: replace via a tiny runtime constructor patch
    # without touching previously passing QA files.
    import inspect
    src=inspect.getsource(driver.main)
    assert "proxy.io_bound=threading.BoundedSemaphore(12)" in src
    replacement=src.replace("proxy.io_bound=threading.BoundedSemaphore(12)",
        "proxy.io_bound=threading.BoundedSemaphore(ADMIT_LIMIT_QA)")
    exec(compile(replacement,"<disposable-qa-admission-overridden>","exec"),
         driver.main.__globals__)
    driver.main.__globals__["main"]()
    print("QA_COMMERCIAL_STREAMING_PASS=true",flush=True)

if __name__=="__main__":main()
