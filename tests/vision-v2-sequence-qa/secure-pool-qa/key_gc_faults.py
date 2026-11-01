"""Disposable PG17 AES key rotation and dead-worker orphan cleanup negative QA.
Actual crypto authenticated frame decrypt/re-encrypt, no production credentials.
"""
from __future__ import annotations
import fcntl,gzip,hashlib,importlib.util,json,multiprocessing as mp,os,resource,stat,tempfile,threading,time
from pathlib import Path
from urllib import request,error
from cryptography.exceptions import InvalidTag
SPEC=importlib.util.spec_from_file_location("qa_rotation_gc",Path(__file__).parent/"rotation_gc.py")
mod=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(mod)
qa=mod.qa
v,drv,z=qa.v,qa.driver,qa.z
def ck(ok,label):assert ok,label
def get(srv,keys,status,campaign=None):
    company,user=v.COMPANIES[0],v.USER_IDS[0]
    url="http://127.0.0.1:"+str(srv.server_address[1])+"/0"
    req=request.Request(url,headers={"X-QA-JWT":keys.issue(company,user,"a"),"Accept-Encoding":"gzip"})
    try:
        with request.urlopen(req,timeout=18) as resp:
            ck(resp.status==status,("status",resp.status,status))
            compressed=resp.read();raw=gzip.decompress(compressed)
            doc=json.loads(raw)
            ck(len(doc["original_full_report"]["export"])==10000,"original_full_report_missing")
            ck(hashlib.sha256(raw).hexdigest()==resp.headers["X-QA-SHA256"],"report_sha_invalid")
            if campaign:ck(doc["campaign"]==campaign,("unexpected_campaign",doc["campaign"]))
            return len(compressed)
    except error.HTTPError as exc:
        ck(exc.code==status,("fail_closed_http",exc.code,status))
        exc.read();return 0

def child_orphan(keys,pipe):
    srv=mod.RotatingServer(1,keys)
    srv.startup();srv.make_cache()
    pipe.send(str(srv.root))
    # Hard exit when a complete encrypted staging file was fsynced.
    os.replace=lambda src,dst:os._exit(94)
    srv.replay()
    os._exit(95)

def main():
    t0=time.perf_counter()
    drv.q.init_db();drv.p.expanded_history();drv.a.setup_outbox();drv.deep.rls_audit()
    z.create_tables()
    keys=drv.a.Keys()
    company,user=v.COMPANIES[0],v.USER_IDS[0]
    first=qa.guarded_publish(company,"SYNTHETIC FIRST",notify=False)
    # Force crashed child BEFORE starting HTTP threads in parent, avoiding
    # inherited active postgres connection/thread pooling in a forked child.
    parent,child_pipe=mp.Pipe()
    child=mp.Process(target=child_orphan,args=(keys,child_pipe));child.start()
    ck(parent.poll(45),"orphan_child_not_started")
    abandoned_root=Path(parent.recv())
    child.join(45)
    if child.is_alive():child.terminate();child.join(3)
    ck(child.exitcode==94,("not_forced_staging_crash",child.exitcode))
    ck(any(p.name.startswith("stage-") for p in abandoned_root.iterdir()),
       "no_real_fsynced_stage_left_by_crashed_process")
    dead_clean=mod.cleanup_dead_process_root(abandoned_root,child.exitcode)
    ck(len(dead_clean)>=3 and not abandoned_root.exists(),"dead_worker_orphans_not_deleted")
    srv=mod.RotatingServer(0,keys)
    srv.startup();srv.make_cache()
    ck(srv.replay()==[first["id"]],"first_outbox_missing")
    server_thread=threading.Thread(target=srv.serve_forever,daemon=True);server_thread.start()
    try:
        old_key=srv.data_key
        initial=get(srv,keys,200,"SYNTHETIC FIRST")
        ck(initial>0,"initial_full_gzip")
        key=str(company);current=srv.versions[key];old_archive=Path(current["filepath"])
        pinned=srv.get_verified(company,current["revision"])
        ck(pinned is not None,"no_verified_pinned_memfd")
        pin_fd=pinned["fd"]
        pin_bytes=os.pread(pin_fd,current["length"],0)
        ck(hashlib.sha256(pin_bytes).hexdigest()==current["compressed_sha"],
           "pinned_gzip_sha_mismatch")
        # Abort during prepublication: no key change, no committed archive
        # alteration, and all temp files removed.
        try:srv.rotate_data_key(fail_before_publish=True)
        except OSError as exc:ck("injected_key_rotation_before" in str(exc),"wrong_rotation_fault")
        else:raise AssertionError("fault_injection_not_hit")
        ck(srv.data_key==old_key and get(srv,keys,200,"SYNTHETIC FIRST")>0,
           "failed_rotation_leaked_new_key")
        ck(srv.cleanup_orphan_stages()==[],"failed_rotation_left_stages")
        rotated=srv.rotate_data_key()
        ck(rotated["rotated_files"]==len(srv.base_paths)+len(srv.versions),
           "not_all_AES_source_archive_rotated")
        ck(srv.data_key!=old_key and get(srv,keys,200,"SYNTHETIC FIRST")>0,
           "new_AES_key_cannot_decrypt")
        try:
            next(qa.AEADFrames(old_key,"source",key).decrypt(srv.base_paths[key]))
            raise AssertionError("old_AES_key_still_decrypts_new_ciphertext")
        except InvalidTag:pass
        ck(os.pread(pin_fd,current["length"],0)==pin_bytes,
           "inflight_sealed_fd_changed_during_key_rotation")
        ck(fcntl.fcntl(pin_fd,fcntl.F_GET_SEALS)&qa.SEALS==qa.SEALS,
           "memfd_lost_seals")
        # Inflight file bytes changed AFTER verification: pinned gzip must
        # remain intact; NEXT HTTP GET must fail-closed on AES ciphertext SHA.
        archive=Path(srv.versions[key]["filepath"])
        with open(archive,"r+b") as file:
            file.seek(80);byte=file.read(1);file.seek(80)
            file.write(bytes([byte[0]^0x8e]))
        ck(os.pread(pin_fd,len(pin_bytes),0)==pin_bytes,
           "concurrent_archive_corrupted_pinned_stream")
        ck(get(srv,keys,503)==0,"post_verify_ciphertext_mutation_passed")
        srv.build_revision(company,current["revision"],"SYNTHETIC FIRST")
        ck(get(srv,keys,200,"SYNTHETIC FIRST")>0,"corrupt_archive_unrepairable")
        # Never remove a user/unrelated file (different basename).
        sentinel=Path(srv.root)/"unrelated_private_file"
        sentinel.write_text("preserve")
        abandoned_stage=Path(srv.root)/"stage-99-2.aes.tmp"
        abandoned_stage.write_bytes(b"synthetic_staging")
        abandoned_rotate=Path(srv.root)/"source-99.aes.rotate.tmp"
        abandoned_rotate.write_bytes(b"old_partial_key_rotation")
        with tempfile.TemporaryDirectory(prefix="vision-v2-external-sentinel-") as outside:
            other=Path(outside)/"must_survive";other.write_text("keep")
            linked=Path(srv.root)/"stage-998-8.aes.tmp"
            os.symlink(other,linked)
            deleted=srv.cleanup_orphan_stages()
            ck(len(deleted)==3 and not abandoned_stage.exists() and not abandoned_rotate.exists(),
               ("stages_not_reaped",deleted))
            ck(other.read_text()=="keep" and not linked.exists(),"orphan_symlink_target_affected")
        ck(sentinel.read_text()=="preserve","non_orphan_was_deleted")
        ck(srv.cleanup_orphan_stages()==[],"orphan_cleanup_not_idempotent")
        # Committed revision, no NOTIFY: old archive retired; new one in AES.
        prior=Path(srv.versions[key]["filepath"])
        second=qa.guarded_publish(company,"SYNTHETIC SECOND",notify=False)
        ck(get(srv,keys,200,"SYNTHETIC SECOND")>0,"current_revision_no_notify")
        ck(not prior.exists(),"old_archive_not_reaped_after_replacement")
        ck(os.pread(pin_fd,len(pin_bytes),0)==pin_bytes,
           "pinned_old_sealed_fd_was_invalidated")
        os.close(pin_fd)
        ck(srv.replay()==[second["id"]],"replay_disordered_after_crypto_rotation")
        # The same JWT membership RLS gate must fail-closed during revoke.
        qa.qa.guarded_revoke(company,user)
        ck(get(srv,keys,401)==0,"revoked_user_received_body")
        with v.con() as db:
            with db.transaction():
                db.execute("SELECT pg_advisory_xact_lock(%s)",(qa.qa.lockkey(company),))
                db.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(company,user))
        ck(get(srv,keys,200,"SYNTHETIC SECOND")>0,"post_revocation_restore")
        # Verify broken pooled connection (fail closed, replace, recover)
        old=srv.pool.q.get_nowait();old.close();srv.pool.q.put(old)
        ck(get(srv,keys,503)==0,"closed_postgres_connection_not_denied")
        ck(get(srv,keys,200,"SYNTHETIC SECOND")>0,"pooled_connection_not_repaired")
        pool=srv.pool.stats()
        ck(pool["created"]==qa.PG_POOL+1 and pool["broken"]==1 and pool["active"]==0,
           ("pool_repair_incomplete",pool))
        with v.con() as db:
            dbsize=db.execute("SELECT pg_database_size(current_database())").fetchone()[0]
            index=db.execute("SELECT pg_indexes_size('public.playback_logs')").fetchone()[0]
        result={"status":"PASS","pool":pool,
            "AES_GCM_key_rotated":True,"old_key_rejected":True,
            "old_inflight_sealed_memfd_retained":True,
            "corrupt_after_check_denied_new_request":True,
            "dead_process_exitcode":94,"dead_process_removed_entries":len(dead_clean),
            "safe_orphan_stage_removed":len(deleted),
            "foreign_symlink_target_preserved":True,
            "unrelated_file_preserved":True,"rotation_fail_before_publish_atomic":True,
            "old_commercial_revision_archive_deleted":True,
            "revoked_JWT_RLS_denied":True,
            "confirmed_current_with_no_notify":True,
            "encrypted_disk_bytes":srv.disk_encrypted_bytes,
            "database_bytes":dbsize,"index_bytes":index,
            "rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "elapsed_s":round(time.perf_counter()-t0,3),
            "no_production":True,"production_go":False}
        print("QA_KEY_ROTATION_GC_SUMMARY_JSON="+json.dumps(result,sort_keys=True),flush=True)
        print("QA_KEY_ROTATION_GC_PASS=true",flush=True)
    finally:
        srv.shutdown();srv.server_close();server_thread.join(3);srv.cleanup()
if __name__=="__main__":main()
