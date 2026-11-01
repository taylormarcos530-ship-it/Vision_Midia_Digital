"""Disposable PG17 integrated commercial gzip + bounded transaction fences.
Independent experimental fixture, not production implementation. A writer MUST
cooperate with matching exclusive lock. Stream protects app write calls, NOT
kernel-delivered bytes after commit. Original RPC and outbox unchanged.
"""
from __future__ import annotations
import hashlib,importlib.util,json,os,resource,socket,stat,tempfile
import time,threading,zlib,traceback
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from urllib import request,error

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
spec=importlib.util.spec_from_file_location("v2_disk_qa",ROOT/"commercial-streaming-qa"/"qa.py")
disk=importlib.util.module_from_spec(spec);spec.loader.exec_module(disk)
driver=disk.driver
c,z,v=driver.c,driver.z,driver.v
CHUNK=int(os.environ.get("QA_COMMERCIAL_CHUNK","65536"))
ADMISSIONS=int(os.environ.get("QA_COMMERCIAL_ADMISSIONS","12"))
PG_POOL=int(os.environ.get("QA_PG_POOL_SIZE","12"))
assert CHUNK in (65536,262144) and ADMISSIONS in (8,12,20) and PG_POOL in (8,12,20)
LOCK_BASE=76520044100
def lockkey(company):
    return LOCK_BASE+list(v.COMPANIES).index(company)
def check(x,msg):assert x,msg
def txguard(db,claims,company,revision=None):
    # Must execute WITHIN the transaction that encloses socket write/flush.
    db.execute("SET LOCAL lock_timeout = '1100ms'")
    db.execute("SELECT pg_advisory_xact_lock_shared(%s)",(lockkey(company),))
    v.auth(db,claims)
    check_member=db.execute("SELECT private.is_company_member(%s)",(company,)).fetchone()[0]
    if not check_member:raise PermissionError("revoked_membership")
    if revision is not None:
        row=db.execute("SELECT revision FROM qa_ordered_campaign WHERE company_id=%s",(company,)).fetchone()
        if not row or row[0]!=revision:raise PermissionError("revised_during_stream")
    return True

class FencedServer(disk.BoundedCommercialServer):
    def __init__(self,index,keys):
        super().__init__(index,keys)
        self.RequestHandlerClass=FencedHandler
        self.sql_slots=threading.BoundedSemaphore(PG_POOL)
        self.fence_reads=0
        self.fence_locks=0
        self.revision_checks=0
        self.permission_rejects=0
        self.corrupt_rejects=0
        self.peak_streams=0
        self.guard_mu=threading.RLock()
        self.inject_fail_before_rename=False
        self.pause_before_first_write=False
        self.entered=threading.Event();self.release=threading.Event()
        self.after_first=threading.Event();self.next_allow=threading.Event()
    def build_revision(self,company,revision,campaign):
        start=time.perf_counter()
        company=str(company)
        meta=b'{"campaign":'+json.dumps(campaign,ensure_ascii=True,separators=(",",":")).encode()+b',"revision":'+str(int(revision)).encode()+b',"original_full_report":'
        target=self.root/("ready-"+company+"-"+str(int(revision))+".gz")
        stage=self.root/("staging-"+company+"-"+str(int(revision))+".tmp")
        sha=hashlib.sha256();source_bytes=0
        comp=zlib.compressobj(level=3,method=zlib.DEFLATED,wbits=31)
        # O_EXCL and restrictive permissions before writing plaintext-derived gzip.
        fd=os.open(stage,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:
            with os.fdopen(fd,"wb") as out:
                def put(buf):
                    nonlocal source_bytes
                    sha.update(buf);source_bytes+=len(buf)
                    encoded=comp.compress(buf)
                    if encoded:out.write(encoded)
                put(meta)
                with open(self.base_paths[company],"rb") as original:
                    while True:
                        part=original.read(65536)
                        if not part:break
                        put(part)
                put(b"}")
                out.write(comp.flush())
                out.flush();os.fsync(out.fileno())
            if self.inject_fail_before_rename:
                self.inject_fail_before_rename=False
                raise OSError("injected_after_fsync_before_atomic_rename")
            os.replace(stage,target)
            wire_sha=hashlib.sha256()
            with open(target,"rb") as file:
                for data in iter(lambda:file.read(65536),b""):
                    wire_sha.update(data)
            ready={"revision":int(revision),"campaign":campaign,"filepath":str(target),
                   "length":target.stat().st_size,"hash":sha.hexdigest(),
                   "compressed_sha":wire_sha.hexdigest(),"uncompressed":source_bytes}
            with self.mu:
                self.versions[company]=ready
                self.build_seconds.append(round(time.perf_counter()-start,4))
                self.disk_peak=max(self.disk_peak,
                    sum(x["length"] for x in self.versions.values())+self.prewarm_bytes)
            return ready
        finally:
            if stage.exists():stage.unlink()
    def make_cache(self):
        super().make_cache()
        # Original raw report bytes are kept in a private fixture directory.
        os.chmod(self.root,0o700)
        for path in self.base_paths.values():os.chmod(path,0o600)
    def get_verified(self,company,revision):
        # Fail before HTTP 200, never serve a truncated, tampered, or symlinked
        # compressed report; do not merely trust a file's cached stat.
        with self.mu:item=self.versions.get(str(company))
        if not item or item["revision"]!=revision:return None
        path=Path(item["filepath"])
        st=path.lstat()
        if not stat.S_ISREG(st.st_mode) or st.st_mode&0o077:
            with self.mu:self.permission_rejects+=1
            return None
        if st.st_size!=item["length"]:
            with self.mu:self.corrupt_rejects+=1
            return None
        digest=hashlib.sha256()
        with open(path,"rb") as source:
            for block in iter(lambda:source.read(65536),b""):digest.update(block)
        if digest.hexdigest()!=item["compressed_sha"]:
            with self.mu:self.corrupt_rejects+=1
            return None
        return item
    def extra_stats(self):
        return {"fence_reads":self.fence_reads,"fence_locks":self.fence_locks,
                "revision_checks":self.revision_checks,
                "permission_rejects":self.permission_rejects,
                "corrupt_rejects":self.corrupt_rejects,
                "peak_streams":self.peak_streams}

class FencedHandler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        srv=self.server
        headers=False
        try:
            tenant=int(self.path.split("?")[0].strip("/"))
            company=v.COMPANIES[tenant];key=str(company)
            token=self.headers.get("X-QA-JWT","")
            claims=srv.keys.verify(token)
            if claims.get("company_id")!=key:raise PermissionError("cross_tenant")
            with srv.sql_slots:
              with v.con() as db:
                with db.transaction():
                    rev=db.execute("SELECT revision FROM qa_ordered_campaign WHERE company_id=%s",(company,)).fetchone()
                    if not rev:raise PermissionError("unknown_company")
                    txguard(db,claims,company,rev[0])
                    srv.fence_reads+=1;srv.fence_locks+=1;srv.revision_checks+=1;srv.sql_chunks+=1
            with srv.mu:existing=srv.cache.get(key)
            if not existing or existing["revision"]!=rev[0]:
                srv.stale+=1
                if srv.stale<=3:print("QA_FENCED_STALE="+repr((existing,rev)),flush=True)
                self.send_error(503,"stale_until_replay");return
            # If disk corrupted or artifact not yet materialized: 503, NEVER
            # return the previous commercial revision.
            try:ready=srv.get_verified(company,rev[0])
            except (OSError,ValueError):ready=None
            if not ready:
                srv.stale+=1
                if srv.stale<=3:print("QA_FENCED_BAD_ASSET="+repr((ready,srv.versions.get(key))),flush=True)
                self.send_error(503,"incomplete_corrupt_or_insecure_asset");return
            self.send_response(200);headers=True
            self.send_header("Content-Type","application/json")
            self.send_header("Content-Encoding","gzip")
            self.send_header("Content-Length",str(ready["length"]))
            self.send_header("X-QA-SHA256",ready["hash"])
            self.end_headers()
            self.connection.settimeout(.6)
            with srv.guard_mu:
                srv.active_streams+=1
                srv.peak_streams=max(srv.peak_streams,srv.active_streams)
            try:
                with open(ready["filepath"],"rb",buffering=CHUNK) as file:
                    while True:
                        data=file.read(CHUNK)
                        if not data:break
                        with srv.sql_slots:
                          with v.con() as db:
                            with db.transaction():
                                txguard(db,claims,company,rev[0])
                                with srv.guard_mu:
                                    srv.fence_reads+=1;srv.fence_locks+=1
                                    srv.revision_checks+=1;srv.sql_chunks+=1
                                if srv.pause_before_first_write and not srv.entered.is_set():
                                    srv.entered.set()
                                    if not srv.release.wait(.24):
                                        raise PermissionError("bounded_prewrite_pause_timeout")
                                self.wfile.write(data);self.wfile.flush()
                                with srv.guard_mu:
                                    srv.payload_bytes+=len(data)
                                    srv.reader_bytes_max=max(srv.reader_bytes_max,len(data))
                        if srv.pause_before_first_write and not srv.after_first.is_set():
                            srv.after_first.set()
                            if not srv.next_allow.wait(5):raise PermissionError('post_first_gate_timeout')
                with srv.guard_mu:srv.sent+=1
            finally:
                with srv.guard_mu:srv.active_streams-=1
        except PermissionError as ex:
            with srv.guard_mu:
                srv.denied+=1
                if srv.denied<=3:print("QA_FENCED_DENIED="+repr(ex),flush=True)
            if not headers:
                self.send_response(401);self.send_header("Content-Length","0");self.end_headers()
            else:
                with srv.guard_mu:srv.failed+=1
                self.close_connection=True
                try:self.connection.shutdown(socket.SHUT_WR)
                except OSError:pass
        except (socket.timeout,BrokenPipeError,ConnectionResetError):
            with srv.guard_mu:srv.failed+=1
        except Exception as ex:
            with srv.guard_mu:
                srv.failed+=1
                if srv.failed<=4:
                    print("QA_FENCED_EXCEPTION="+repr(ex),flush=True)
                    traceback.print_exc()
            if not headers:
                try:self.send_error(503,"fail_closed_pg_or_io")
                except OSError:pass
            else:
                self.close_connection=True
                try:self.connection.shutdown(socket.SHUT_WR)
                except OSError:pass

def guarded_publish(company,name,notify=False,abort=False):
    # One cooperating transaction covers commercial mutation + outbox commit.
    # The global outbox ID lock remains intact, avoiding ID commit inversion.
    with v.con() as db:
        with db.transaction():
            db.execute("SELECT pg_advisory_xact_lock(%s)",(z.LOCK_ID,))
            db.execute("SELECT pg_advisory_xact_lock(%s)",(lockkey(company),))
            rev=db.execute("UPDATE qa_ordered_campaign SET revision=revision+1,name=%s WHERE company_id=%s RETURNING revision",(name,company)).fetchone()[0]
            event=db.execute("""INSERT INTO qa_ordered_events(company_id,revision,action,payload)
                VALUES(%s,%s,'campaign',%s::jsonb) RETURNING id""",
                (company,rev,json.dumps({"name":name}))).fetchone()[0]
            if notify:db.execute("SELECT pg_notify('qa_ordered_events',%s)",(str(event),))
            if abort:raise RuntimeError("injected_before_commit")
    return {"id":event,"company":str(company),"revision":rev,"name":name}
def guarded_revoke(company,user):
    with v.con() as db:
        with db.transaction():
            db.execute("SET LOCAL lock_timeout='1300ms'")
            db.execute("SELECT pg_advisory_xact_lock(%s)",(lockkey(company),))
            db.execute("DELETE FROM private.memberships WHERE company_id=%s AND user_id=%s",(company,user))
    return time.monotonic()

def configure():
    disk.BoundedCommercialServer=FencedServer
    disk.BoundedHandler=FencedHandler
    driver.c.launch=disk.launch
    z.publish=guarded_publish

if __name__=="__main__":
    configure()
    driver.main()
    print("QA_INTEGRATED_FENCE_COMMERCIAL_PASS=true",flush=True)
