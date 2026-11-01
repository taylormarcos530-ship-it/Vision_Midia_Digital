"""PG17 disposable AES generation receipt recovery under real TCP refused
and persisted SYNTHETIC wrap key across two different OS processes.
Not a real KMS, distributed coordinator, or production key custody.
"""
from __future__ import annotations
import hashlib,json,multiprocessing as mp,os,resource,socket,stat,tempfile,time
from pathlib import Path
import psycopg
import durable_keyring as d

def require(x,msg):assert x,msg
def read_key(path):
    path=Path(path)
    fd=os.open(path,os.O_RDONLY|os.O_CLOEXEC|os.O_NOFOLLOW)
    try:
        st=os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode)==0o600,
                "key_permission_or_symlink")
        key=os.read(fd,33)
        require(len(key)==32,"bad_synthetic_key_length")
        return key
    finally:os.close(fd)
def child(root,keypath,phase):
    # Restore from a private TEST-ONLY file, not implicit forked MASTER.
    d.MASTER=b"\x00"*32
    d.MASTER=read_key(keypath)
    d.resume(root,crash_at=phase)
    os._exit(99)
def main():
    started=time.perf_counter()
    phase=os.environ.get("QA_PHASE","manifest_before_SQL_commit")
    require(phase in ("rename_1","rename_2","manifest_before_SQL_commit"),"bad_phase")
    with tempfile.TemporaryDirectory(prefix="vision-v2-key-outage-") as directory:
        parent=Path(directory)
        os.chmod(parent,0o700)
        master=parent/"synthetic_master.key"
        fd=os.open(master,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_CLOEXEC,0o600)
        with os.fdopen(fd,"wb") as f:
            f.write(os.urandom(32));f.flush();os.fsync(f.fileno())
        d.fsync_dir(parent)
        d.MASTER=read_key(master)
        root=parent/"encrypted_generations"
        original=d.prepare(root)
        before_gen,old=d.active(root)
        require(before_gen==0,"missing_committed_initial")
        old_fd=d.pin_old_descriptor(old["company-a-report"])
        d.start_rotation(root,1)
        p=mp.Process(target=child,args=(root,master,phase))
        p.start();p.join(18)
        if p.is_alive():p.terminate();p.join(3)
        code={"rename_1":94,"rename_2":95,"manifest_before_SQL_commit":96}[phase]
        require(p.exitcode==code,("wrong_crash_exit",p.exitcode))
        pointed=d.read_manifest(root)
        require(pointed in (0,1),"non_atomic_manifest")
        if pointed==1:
            try:d.active(root)
            except PermissionError as err:require("receipt_not_committed" in str(err),"wrong_prepared_denial")
            else:raise AssertionError("uncommitted_generation_served")
        # Actual OS TCP refused connection: force a PG connection to a
        # reserved-and-closed local TCP port, NOT the official Supabase.
        negative=socket.socket();negative.bind(("127.0.0.1",0))
        refused_port=negative.getsockname()[1];negative.close()
        original_conn=d.conn
        def refused():
            return psycopg.connect(host="127.0.0.1",port=refused_port,dbname="vision_v2_quarantine_disposable",
                user="postgres",password="qa-only-local-password",connect_timeout=1)
        d.conn=refused
        failed=False
        try:
            d.resume(root)
        except (psycopg.OperationalError,ConnectionError,TimeoutError,OSError):failed=True
        finally:d.conn=original_conn
        require(failed,"outage_fail_closed_missing")
        with d.conn() as db:
            state=db.execute("SELECT state FROM qa_v2_durable_rotation WHERE generation=1").fetchone()[0]
        require(state=="PREPARED","receipt_advanced_despite_PG_refusal")
        require(d.read_manifest(root)==pointed,"manifest_changed_despite_refused_connection")
        if pointed==1:
            try:d.active(root)
            except PermissionError:pass
            else:raise AssertionError("served_uncommitted_data_after_PG_failure")
        # Independent second process loads the same private synthetic key;
        # parent deliberately overwrites in-memory copy before child.
        d.MASTER=b"\x00"*32
        def recover_child(root,keypath,q):
            d.MASTER=read_key(keypath)
            out=d.resume(root)
            q.put(out)
        q=mp.Queue()
        p2=mp.Process(target=recover_child,args=(root,master,q))
        p2.start();p2.join(18)
        if p2.is_alive():p2.terminate();p2.join(3)
        require(p2.exitcode==0,("recovery_child_failed",p2.exitcode))
        recovered=q.get(timeout=2)
        require(len(recovered)==1,"no_durable_receipt_replay")
        d.MASTER=read_key(master)
        latest,current,again=d.recover(root)
        require(latest==1 and again==[],"idempotent_recovery_failed")
        require({n:hashlib.sha256(v).hexdigest() for n,v in current.items()}==original,
                "recovered_ciphertext_not_identical")
        removed=d.gc_old(root,old_fd,old["company-a-report"])
        require(len(removed)==4,"old_generation_not_collected")
        require(os.pread(old_fd,len(old["company-a-report"]),0)==old["company-a-report"],
                "pinned_old_fd_invalid")
        os.close(old_fd)
        with d.conn() as db:
            size=db.execute("SELECT pg_database_size(current_database())").fetchone()[0]
            index=db.execute("SELECT pg_indexes_size('qa_v2_durable_rotation')").fetchone()[0]
            wal=db.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
            receipts=db.execute("SELECT count(*) FROM qa_v2_durable_rotation").fetchone()[0]
        result={"status":"PASS","phase":phase,"crash_exit":code,"pointed_before_recovery":pointed,
                "real_TCP_refused_port":refused_port,"PG_outage_denied":failed,
                "PREPARED_receipt_remained_prepared":True,
                "separate_recovery_OS_process":True,"persisted_synthetic_key_mode":"0600",
                "recovery_idempotent":True,"verified_files":4,
                "key_generations":receipts,"reaped_old_AEAD_files":len(removed),
                "encrypted_root_disk_bytes":sum(p.stat().st_size for p in root.rglob("*") if p.is_file()),
                "database_bytes":size,"rotation_index_bytes":index,
                "wal_lsn":str(wal),"RSS_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                "elapsed_ms":round((time.perf_counter()-started)*1000,3),
                "no_official":True,"production_GO":False}
        print("QA_AES_PG_OUTAGE_SUMMARY_JSON="+json.dumps(result,sort_keys=True),flush=True)
        print("QA_AES_PG_OUTAGE_PASS=true",flush=True)
if __name__=="__main__":main()
