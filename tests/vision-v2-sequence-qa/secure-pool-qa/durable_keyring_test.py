"""Disposable PG17 durable receipt recovery QA at actual injected process-crash
boundaries: first/second file rename and after manifest before SQL commit.
Synthetic test wrap key in source -- never real KMS or production data.
"""
from __future__ import annotations
import hashlib,fcntl,json,multiprocessing as mp,os,resource,tempfile,time
from pathlib import Path
from cryptography.exceptions import InvalidTag
import durable_keyring as d
def ck(b,msg):assert b,msg
def forced(root,where):
    d.resume(root,crash_at=where)
    os._exit(97)
def single(stage):
    start=time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="vision-v2-durable-rot-") as t:
        root=Path(t)/"only_disposable_keyring"
        original=d.prepare(root)
        gen0,old=d.active(root)
        ck(gen0==0 and len(old)==4,"original_gen_not_committed")
        fd=d.pin_old_descriptor(old["company-a-report"])
        # Prepared durable SQL receipt MUST commit before the first rename.
        prep=d.start_rotation(root,1)
        ck(prep["prepared_receipt"],"missing_pg_prepared_receipt")
        child=mp.Process(target=forced,args=(root,stage));child.start();child.join(25)
        if child.is_alive():child.terminate();child.join(2)
        expected={"rename_1":94,"rename_2":95,"manifest_before_SQL_commit":96}[stage]
        ck(child.exitcode==expected,("wrong_crash_phase",child.exitcode,expected))
        before=d.read_manifest(root)
        ck(before in (0,1),("partial_manifest",before))
        if before==0:
            a,seen=d.active(root)
            ck(a==0 and {n:hashlib.sha256(data).hexdigest() for n,data in seen.items()}==original,
               "uncommitted_generation_leaked")
        else:
            try:d.active(root)
            except PermissionError as e:
                ck("receipt_not_committed" in str(e),"unexpected_fail_closed")
            else:raise AssertionError("manifest_swapped_without_SQL_receipt_exposed")
        pending=d.resume(root)
        ck(len(pending)==1 and pending[0]["generation"]==1,"replay_missing")
        latest,new,empty=d.recover(root)
        ck(latest==1 and empty==[] and all(new[n]==old[n] for n in d.DOCS),
           "not_exact_original_bytes_on_recovery")
        with d.conn() as db:
            state=db.execute("SELECT state FROM qa_v2_durable_rotation WHERE generation=1").fetchone()[0]
            db_size=db.execute("SELECT pg_database_size(current_database())").fetchone()[0]
            wal=db.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
            rows=db.execute("SELECT count(*) FROM qa_v2_durable_rotation").fetchone()[0]
        ck(state=="COMMITTED" and rows==2,"receipt_not_durably_completed")
        ck(d.resume(root)==[],"replay_not_idempotent")
        removed=d.gc_old(root,fd,old["company-a-report"])
        ck(len(removed)==len(d.DOCS),"old_generation_gc_wrong")
        ck(os.pread(fd,len(old["company-a-report"]),0)==old["company-a-report"],
           "sealed_old_descriptor_invalid")
        os.close(fd)
        ck((root/"gen-001").exists() and not (root/"gen-000").exists(),
           "active_generation_deleted_during_gc")
        # Test tamper of active manifest authentication: fail closed.
        path=root/"active.json";blob=path.read_bytes()
        path.write_bytes(blob[:-2]+b"  ")
        try:d.active(root)
        except Exception:pass
        else:raise AssertionError("tampered_generation_manifest_accepted")
        path.write_bytes(blob)
        _,revalidated=d.active(root)
        ck(revalidated==new,"manifest_restore_not_exact")
        bytes_on_disk=sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
        return {"stage":stage,"crash_code":expected,"pointer_before_recovery":before,
            "replayed_from_PREPARED":True,"post_manifest_pre_SQL_denied":before==1,
            "durable_pg_receipt_rows":rows,"key_generation_after":latest,
            "exact_SHA_verified_files":len(new),"old_pinned_sealed_fd_survived_GC":True,
            "gc_removed_old_AES_files":len(removed),"manifest_HMAC_tamper_denied":True,
            "db_bytes":db_size,"wal_end_lsn":str(wal),
            "disk_bytes":bytes_on_disk,"parent_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "seconds":round(time.perf_counter()-start,3)}
def main():
    mode=os.environ.get("QA_CRASH_PHASE","rename_1")
    ck(mode in ("rename_1","rename_2","manifest_before_SQL_commit"),"unknown_crash_phase")
    output=single(mode)
    print("QA_DURABLE_KEY_RECEIPT_SUMMARY_JSON="+json.dumps(output,sort_keys=True),flush=True)
    print("QA_DURABLE_KEY_RECEIPT_PASS=true",flush=True)
if __name__=="__main__":main()
