"""Vision V2 disposable PostgreSQL17 QA: real reused SQL connections, AES-GCM
at rest, pathname-free sealed memfd reads and limited commercial revision
materialization. All data/keys synthetic. NO production access or deployment.

Security boundary: transaction-scoped advisory lock spans the app socket
write only. Buffer delivery after commit cannot be reversed. Cooperative
writer protocol still required. memfd seals operate only on Linux QA runners.
"""
from __future__ import annotations
import contextlib,fcntl,hashlib,importlib.util,json,os,queue,resource,stat
import threading,time,zlib,socket,traceback,multiprocessing as mp
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("vision2_fenced_base",ROOT.parent/"integrated-commercial-fence-qa"/"qa.py")
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
v,driver,disk,z=qa.v,qa.driver,qa.disk,qa.z
c=qa.c
ADMISSIONS=qa.ADMISSIONS
PG_POOL=qa.PG_POOL
guarded_publish=qa.guarded_publish
txguard=qa.txguard
CHUNK=qa.CHUNK
MFD_ALLOW_SEALING=getattr(os,"MFD_ALLOW_SEALING",2)
SEALS=fcntl.F_SEAL_WRITE|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_SEAL
FRAME=65536
MAGIC=b"V2AESG1"
class RealPool:
    def __init__(self,size):
        self.capacity=size
        self.q=queue.LifoQueue(maxsize=size)
        self.guard=threading.RLock()
        self.created=0;self.borrows=0;self.reuses=0;self.broken=0
        self.peak=0;self.active=0;self.timeouts=0
        for _ in range(size):self.q.put(self._open())
    def _open(self):
        c=v.con()
        with self.guard:self.created+=1
        return c
    @contextlib.contextmanager
    def borrow(self):
        try:c=self.q.get(timeout=4)
        except queue.Empty:
            with self.guard:self.timeouts+=1
            raise TimeoutError("pg_pool_exhaustion_fail_closed")
        with self.guard:
            self.borrows+=1
            self.reuses+=1 if self.borrows>self.capacity else 0
            self.active+=1;self.peak=max(self.peak,self.active)
        try:
            if c.closed:raise ConnectionError("closed_pool_connection")
            yield c
        finally:
            with self.guard:self.active-=1
            # SET LOCAL ROLE/claims are bounded by completed SQL transaction.
            if c.closed:
                with self.guard:self.broken+=1
                try:c=self._open()
                except Exception:c=None
            if c is not None:self.q.put(c)
    def close(self):
        while True:
            try:c=self.q.get_nowait()
            except queue.Empty:break
            c.close()
    def stats(self):
        with self.guard:return dict(capacity=self.capacity,created=self.created,
            borrows=self.borrows,reuses=self.reuses,broken=self.broken,
            peak=self.peak,timeouts=self.timeouts,active=self.active)

class AEADFrames:
    """Separate 64KiB authenticating frames; unique random 96-bit nonces.
    Each record stores length, nonce, ciphertext+16B GCM tag.
    Header is not sensitive; company+revision+kind+sequence in AEAD AAD.
    """
    def __init__(self,key,kind,identity):
        self.cipher=AESGCM(key);self.aad=(kind+"/"+identity).encode()
    def encrypt(self,path,chunks):
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_CLOEXEC,0o600)
        sha=hashlib.sha256();plain_sha=hashlib.sha256();total=0
        count=0
        try:
            with os.fdopen(fd,"wb") as out:
                out.write(MAGIC);sha.update(MAGIC)
                buf=bytearray()
                def frame(block):
                    nonlocal count,total
                    nonce=os.urandom(12)
                    ct=self.cipher.encrypt(nonce,block,self.aad+b"/"+str(count).encode())
                    rec=len(ct).to_bytes(4,"big")+nonce+ct
                    out.write(rec);sha.update(rec);plain_sha.update(block)
                    count+=1;total+=len(block)
                for chunk in chunks:
                    if not chunk:continue
                    buf.extend(chunk)
                    while len(buf)>=FRAME:
                        frame(bytes(buf[:FRAME]));del buf[:FRAME]
                if buf:frame(bytes(buf))
                out.flush();os.fsync(out.fileno())
        except BaseException:
            try:os.unlink(path)
            except OSError:pass
            raise
        return dict(encrypted_sha=sha.hexdigest(),plain_sha=plain_sha.hexdigest(),
            plaintext_len=total,encrypted_len=os.stat(path).st_size,frames=count)
    def decrypt(self,path):
        fd=os.open(path,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW)
        try:
            st=os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_mode&0o077 or st.st_nlink!=1:
                raise PermissionError("untrusted_encrypted_file_permissions")
            with os.fdopen(fd,"rb") as f:
                fd=-1
                if f.read(len(MAGIC))!=MAGIC:raise ValueError("bad_AES_magic")
                count=0
                while True:
                    head=f.read(4)
                    if not head:break
                    if len(head)!=4:raise ValueError("truncated_frame")
                    size=int.from_bytes(head,"big")
                    if size<17 or size>FRAME+16:raise ValueError("invalid_frame_len")
                    nonce=f.read(12);ciphertext=f.read(size)
                    if len(nonce)!=12 or len(ciphertext)!=size:raise ValueError("truncated_ciphertext")
                    yield self.cipher.decrypt(nonce,ciphertext,self.aad+b"/"+str(count).encode())
                    count+=1
        finally:
            if fd>=0:os.close(fd)

class SealedFile:
    def __init__(self,fd):self.fd=fd;self.offset=0
    def __enter__(self):return self
    def read(self,size):
        data=os.pread(self.fd,size,self.offset);self.offset+=len(data);return data
    def __exit__(self,*args):os.close(self.fd)

class SealedServer(qa.FencedServer):
    def __init__(self,index,keys):
        super().__init__(index,keys)
        self.RequestHandlerClass=SealedHandler
        self.pool=RealPool(qa.PG_POOL)
        self.data_key=AESGCM.generate_key(bit_length=256)
        self.cipher_archive={}
        self.memfds={}
        self.version_guard=threading.RLock()
        self.version_builds=0;self.version_failures=0;self.removed_versions=0
        self.disk_encrypted_bytes=0;self.rev_lazy_rebuilds=0
    def make_cache(self):
        os.chmod(self.root,0o700)
        for company in v.COMPANIES:
            payload=driver.deep.report_full(company)["payload"]
            doc=json.loads(payload)
            qa.check(len(doc["export"])==10000,"original_sql_export_missing")
            raw=payload if isinstance(payload,bytes) else payload.encode()
            del payload,doc
            key=str(company)
            path=self.root/("source-"+key+".aes")
            crypto=AEADFrames(self.data_key,"source",key)
            meta=crypto.encrypt(path,(memoryview(raw)[i:i+FRAME] for i in range(0,len(raw),FRAME)))
            del raw
            self.base_paths[key]=path
            self.prewarm_bytes+=meta["plaintext_len"]
            self.report_builds+=1
    def build_revision(self,company,revision,campaign):
        key=str(company);revision=int(revision)
        start=time.perf_counter()
        identity=key+"/"+str(revision)
        path=self.root/("rev-"+key+"-"+str(revision)+".aes")
        stage=self.root/("stage-"+key+"-"+str(revision)+".aes.tmp")
        source=AEADFrames(self.data_key,"source",key)
        archive=AEADFrames(self.data_key,"archive",identity)
        raw_sha=hashlib.sha256();raw_count=0;gz_sha=hashlib.sha256();wire_len=0
        fd=os.memfd_create("vision-v2-gzip-sealed",os.MFD_CLOEXEC|MFD_ALLOW_SEALING)
        prefix=b'{"campaign":'+json.dumps(campaign,ensure_ascii=True,separators=(",",":")).encode()+b',"revision":'+str(revision).encode()+b',"original_full_report":'
        compress=zlib.compressobj(level=3,wbits=31)
        def compressed():
            nonlocal raw_count,wire_len
            def inp(block):
                nonlocal raw_count
                raw_sha.update(block);raw_count+=len(block)
                return compress.compress(block)
            def emit(chunk):
                nonlocal wire_len
                if chunk:
                    wire_len+=len(chunk);gz_sha.update(chunk)
                    os.write(fd,chunk)
                return chunk
            yield emit(inp(prefix))
            for block in source.decrypt(self.base_paths[key]):
                yield emit(inp(block))
            yield emit(inp(b"}"))
            yield emit(compress.flush())
        try:
            encrypted=archive.encrypt(stage,compressed())
            if self.inject_fail_before_rename:
                self.inject_fail_before_rename=False
                raise OSError("injected_after_fsync_before_atomic_rename")
            os.replace(stage,path)
            dfd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(dfd)
            finally:os.close(dfd)
            fcntl.fcntl(fd,fcntl.F_ADD_SEALS,SEALS)
            qa.check(fcntl.fcntl(fd,fcntl.F_GET_SEALS)&SEALS==SEALS,"memfd_not_sealed")
            ready={"campaign":campaign,"revision":revision,"filepath":str(path),
                   "length":wire_len,"hash":raw_sha.hexdigest(),
                   "compressed_sha":gz_sha.hexdigest(),"memfd":fd,
                   "encrypted_sha":encrypted["encrypted_sha"],
                   "encrypted_len":encrypted["encrypted_len"],
                   "uncompressed":raw_count}
            with self.version_guard:
                with self.mu:
                    old=self.versions.get(key)
                    self.versions[key]=ready
                    self.build_seconds.append(round(time.perf_counter()-start,4))
                    self.version_builds+=1
                # Readers take dup() of sealed descriptor before swap; active
                # HTTP remains pinned to original inode despite path cleanup.
                if old:
                    os.close(old["memfd"])
                    old_path=Path(old["filepath"])
                    if old_path!=path and old_path.exists():
                        old_path.unlink();self.removed_versions+=1
                self.disk_encrypted_bytes=sum(x.stat().st_size for x in self.root.iterdir() if x.is_file())
                self.disk_peak=max(self.disk_peak,self.disk_encrypted_bytes)
            return ready
        except BaseException:
            os.close(fd);self.version_failures+=1
            raise
        finally:
            if stage.exists():stage.unlink()
    def get_verified(self,company,revision):
        with self.version_guard:
            item=self.versions.get(str(company))
            if not item or item["revision"]!=revision:return None
            fd=os.open(item["filepath"],os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
            try:
                st=os.fstat(fd)
                if not stat.S_ISREG(st.st_mode) or st.st_mode&0o077 or st.st_nlink!=1:
                    self.permission_rejects+=1
                    return None
                if st.st_size!=item["encrypted_len"]:
                    self.corrupt_rejects+=1
                    return None
                # Verify the SAME pinned encrypted descriptor, never reopening
                # by pathname between check and protected gzip serving.
                dig=hashlib.sha256();offset=0
                while offset<st.st_size:
                    buf=os.pread(fd,FRAME,offset)
                    if not buf:break
                    dig.update(buf);offset+=len(buf)
                if dig.hexdigest()!=item["encrypted_sha"]:
                    self.corrupt_rejects+=1;return None
                try:dup=os.dup(item["memfd"])
                except OSError:return None
                return {**item,"fd":dup}
            finally:os.close(fd)
    def sealed_reader(self,item):return SealedFile(item["fd"])
    def lazy_reconcile(self,company,revision):
        # Authoritative committed campaign + ordered-outbox event verified.
        # Do not wait for LISTEN; singleflight per process/tenant prevents
        # multiple 2.8MB rebuilds. Cursor still committed by durable replay.
        key=str(company)
        with self.version_guard:
            cur=self.versions.get(key)
            if cur and cur["revision"]==revision:return True
            with v.con() as db:
                row=db.execute("""SELECT c.name,e.id FROM qa_ordered_campaign c
                  JOIN qa_ordered_events e ON e.company_id=c.company_id
                      AND e.revision=c.revision
                  WHERE c.company_id=%s AND c.revision=%s""",(company,revision)).fetchone()
            if not row:return False
            self.build_revision(company,revision,row[0])
            with self.mu:self.cache[key]={"revision":revision,"campaign":row[0],"event":row[1]}
            self.rev_lazy_rebuilds+=1
            return True
    def cleanup(self):
        with self.version_guard:
            for item in self.versions.values():
                if "memfd" in item:os.close(item["memfd"])
            self.pool.close()
            self.data_key=b"\x00"*32
        super().cleanup()
    def pool_metrics(self):
        return dict(self.pool.stats(),lazy_revisions=self.rev_lazy_rebuilds,
            encrypted_disk_bytes=self.disk_encrypted_bytes,
            removed_old_versions=self.removed_versions,
            version_builds=self.version_builds,
            version_failures=self.version_failures)

class SealedHandler(qa.FencedHandler):
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
              with srv.pool.borrow() as db:
                with db.transaction():
                    rev=db.execute("SELECT revision FROM qa_ordered_campaign WHERE company_id=%s",(company,)).fetchone()
                    if not rev:raise PermissionError("unknown_company")
                    txguard(db,claims,company,rev[0])
                    srv.fence_reads+=1;srv.fence_locks+=1;srv.revision_checks+=1;srv.sql_chunks+=1
            with srv.mu:existing=srv.cache.get(key)
            if not existing or existing["revision"]!=rev[0]:
                if srv.lazy_reconcile(company,rev[0]):
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
                with srv.sealed_reader(ready) as file:
                    while True:
                        data=file.read(CHUNK)
                        if not data:break
                        with srv.sql_slots:
                          with srv.pool.borrow() as db:
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
                # Commercial revision changed during admission: stale, not
                # invalid JWT. Both paths fail-closed without any body.
                code=503 if str(ex)=="revised_during_stream" else 401
                self.send_response(code);self.send_header("Content-Length","0");self.end_headers()
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

def worker(index,keys,pipe):
    try:
        return worker_impl(index,keys,pipe)
    except BaseException as exc:
        traceback.print_exc()
        try:pipe.send({"fatal":type(exc).__name__+":"+str(exc)})
        except BaseException:pass
        raise

def worker_impl(index,keys,pipe):
    service=SealedServer(index,keys)
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
                        "max_file_read_bytes":service.reader_bytes_max,
                        "pool":service.pool_metrics()
                    })
            elif op=="stop":pipe.send(True);break
            else:raise RuntimeError("unsupported_command:"+str(op))
    finally:
        service.shutdown();service.server_close();thread.join(3)
        service.cleanup()

def launch(index,keys):
    parent,child=mp.Pipe()
    proc=mp.Process(target=worker,args=(index,keys,child));proc.start()
    if not parent.poll(95):
        alive=proc.is_alive()
        if alive:proc.terminate()
        proc.join(3)
        raise AssertionError("commercial_worker_startup_timeout_95s_pid_"+str(proc.pid)+"_was_alive_"+str(alive))
    info=parent.recv()
    if "fatal" in info:
        proc.join(3)
        raise AssertionError("commercial_worker_startup_failed:"+info["fatal"])
    return proc,parent,info

def configure():
    qa.configure()
    qa.FencedHandler=SealedHandler
    disk.BoundedCommercialServer=SealedServer
    driver.c.launch=launch
def main():
    configure()
    driver.main()
    print("QA_SEALED_POOL_COMMERCIAL_PASS=true",flush=True)
if __name__=="__main__":main()
