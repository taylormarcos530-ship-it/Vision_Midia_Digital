"""Vision V2 synthetic-only PG17 AES sealed cache security, real reused pool,
crash-before-atomic-rename, no-follow descriptor and revocation mid-HTTP QA."""
import fcntl,hashlib,importlib.util,json,multiprocessing as mp,os,resource,stat
import threading,time
from pathlib import Path
from http.client import IncompleteRead
from urllib import request,error

SPEC=importlib.util.spec_from_file_location("qa_secure_pool",Path(__file__).parent/"qa.py")
qa=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(qa)
qa.configure()
v,driver=qa.v,qa.driver
def ck(b,msg):assert b,msg
def get(srv,keys,status,campaign=None):
    url="http://127.0.0.1:"+str(srv.server_address[1])+"/0"
    co,uid=v.COMPANIES[0],v.USER_IDS[0]
    req=request.Request(url,headers={"X-QA-JWT":keys.issue(co,uid,"a"),"Accept-Encoding":"gzip"})
    try:
        with request.urlopen(req,timeout=20) as response:
            blob=response.read()
            raw=__import__("gzip").decompress(blob)
            j=json.loads(raw)
            ck(hashlib.sha256(raw).hexdigest()==response.headers["X-QA-SHA256"],"bad_http_SHA")
            ck(len(j["original_full_report"]["export"])==10000,"not_full_original_report")
            if campaign is not None:ck(j["campaign"]==campaign,"wrong_campaign")
            ck(response.status==status,"wrong_status")
            return len(blob)
    except error.HTTPError as e:
        ck(e.code==status,("unexpected_HTTP_status",e.code,status))
        e.read();return 0

def hard_crash_writer(keys):
    # Separate disposable process and encrypted ephemeral source; no contact
    # with production. Force-kill AFTER AES staging fsync, BEFORE atomic rename.
    srv=qa.SealedServer(1,keys)
    srv.startup();srv.make_cache()
    def die(src,dst):os._exit(94)
    os.replace=die
    srv.replay()
    os._exit(95)

def race(srv,keys,kind):
    co,uid=v.COMPANIES[0],v.USER_IDS[0]
    srv.pause_before_first_write=True
    srv.entered.clear();srv.release.clear()
    srv.after_first.clear();srv.next_allow.clear()
    url="http://127.0.0.1:"+str(srv.server_address[1])+"/0"
    token=keys.issue(co,uid,"a")
    resp=request.urlopen(request.Request(url,headers={"X-QA-JWT":token,"Accept-Encoding":"gzip"}),timeout=20)
    result={}
    try:
        ck(srv.entered.wait(5),"no_inflight_protected_write")
        def writer():
            started=time.perf_counter()
            if kind=="revoke":qa.qa.guarded_revoke(co,uid)
            else:result["event"]=qa.guarded_publish(co,"UPDATED MID HTTP",notify=False)
            result["committed"]=True
            result["duration_ms"]=round((time.perf_counter()-started)*1000,2)
        t=threading.Thread(target=writer);t.start()
        time.sleep(.03)
        ck(not result.get("committed"),"exclusive_commit_bypassed_shared_socket_lock")
        srv.release.set()
        first=resp.read(qa.CHUNK)
        ck(len(first)==qa.CHUNK,("first_chunk_truncated",len(first)))
        ck(srv.after_first.wait(5),"post_first_gate_not_reached")
        t.join(4)
        ck(result.get("committed") and not t.is_alive(),"revoker_or_writer_starvation")
        n=srv.payload_bytes
        srv.next_allow.set()
        try:
            rest=resp.read()
            raise AssertionError(("obsolete_body_continued",kind,len(rest)))
        except IncompleteRead as e:
            ck(len(e.partial)==0,("server_sent_new_bytes_after_commit",kind,len(e.partial)))
        ck(srv.payload_bytes==n,("late_app_socket_write",kind))
        return {"kind":kind,"old_first_chunk":len(first),"writer_ms":result["duration_ms"],
                "new_application_bytes_after_commit":0}
    finally:
        resp.close();srv.pause_before_first_write=False;srv.release.set();srv.next_allow.set()
        if kind=="revoke":
            with v.con() as db:
                with db.transaction():
                    db.execute("SELECT pg_advisory_xact_lock(%s)",(qa.qa.lockkey(co),))
                    db.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(co,uid))
def main():
    ts=time.perf_counter()
    driver.q.init_db();driver.p.expanded_history();driver.a.setup_outbox();driver.deep.rls_audit()
    qa.z.create_tables()
    keys=driver.a.Keys()
    co=v.COMPANIES[0]
    event=qa.guarded_publish(co,"BASELINE",notify=False)
    srv=qa.SealedServer(0,keys)
    srv.startup();srv.make_cache()
    ck(srv.replay()==[event["id"]],"missing_initial_cursor")
    listen=threading.Thread(target=srv.serve_forever,daemon=True);listen.start()
    try:
        key=str(co)
        src=Path(srv.base_paths[key])
        archive=Path(srv.versions[key]["filepath"])
        ck(src.read_bytes()[:7]==qa.MAGIC and archive.read_bytes()[:7]==qa.MAGIC,"not_encrypted_at_rest")
        ck(b'"original_full_report"' not in src.read_bytes(),"plaintext_source_on_disk")
        ck(b'"campaign"' not in archive.read_bytes(),"plaintext_commercial_on_disk")
        ck(stat.S_IMODE(src.stat().st_mode)==0o600 and stat.S_IMODE(archive.stat().st_mode)==0o600,"weak_file_mode")
        ck(stat.S_IMODE(srv.root.stat().st_mode)==0o700,"weak_directory_mode")
        sealed=srv.get_verified(co,1)
        ck(sealed is not None,"cannot_verify_memfd")
        sealed_fd=sealed["fd"]
        ck(fcntl.fcntl(sealed_fd,fcntl.F_GET_SEALS)&qa.SEALS==qa.SEALS,"memfd_not_immutable")
        before=os.pread(sealed_fd,12,0)
        try:os.write(sealed_fd,b"bad")
        except OSError:pass
        else:raise AssertionError("sealed_fd_writable")
        ck(before==os.pread(sealed_fd,12,0),"mutated_sealed_fd")
        ck(get(srv,keys,200,"BASELINE")>0,"initial_full_failed")
        # Tamper current AES ciphertext; fail closed before HTTP200.
        with open(archive,"r+b") as f:
            f.seek(100);x=f.read(1);f.seek(100);f.write(bytes([x[0]^0xff]))
        ck(get(srv,keys,503)==0,"ciphertext_tamper_accepted")
        srv.build_revision(co,1,"BASELINE")
        archive=Path(srv.versions[key]["filepath"])
        os.chmod(archive,0o644)
        ck(get(srv,keys,503)==0,"world_readable_ciphertext_accepted")
        os.chmod(archive,0o600)
        ck(get(srv,keys,200,"BASELINE")>0,"mode_restore_failed")
        # Symlink must be rejected through O_NOFOLLOW, not validated/reopened.
        archive.unlink()
        os.symlink(src,archive)
        ck(get(srv,keys,503)==0,"symlink_hijacked_ciphertext")
        srv.build_revision(co,1,"BASELINE")
        ck(get(srv,keys,200,"BASELINE")>0,"symlink_restore_failed")
        # Broken reused SQL connection must fail closed, then replace.
        pooled=srv.pool.q.get_nowait();pooled.close();srv.pool.q.put(pooled)
        ck(get(srv,keys,503)==0,"broken_pool_connection_served")
        ck(get(srv,keys,200,"BASELINE")>0,"pool_failed_to_reconnect")
        # Crash after encrypted fsync, before rename: parent can reconstruct
        # from committed durable outbox in a new process with a different key.
        child=mp.Process(target=hard_crash_writer,args=(keys,));child.start();child.join(36)
        if child.is_alive():child.terminate();child.join(3)
        ck(child.exitcode==94,("crash_not_reached",child.exitcode))
        # Advance commercial revision without notify. Lazy writer must build
        # new encrypted file, retire previous path, keep old pinned fd valid.
        oldarchive=Path(srv.versions[key]["filepath"])
        newevent=qa.guarded_publish(co,"NEW VERSION",notify=False)
        ck(get(srv,keys,200,"NEW VERSION")>0,"lazy_current_revision_unavailable")
        ck(not oldarchive.exists(),"obsolete_ciphertext_not_deleted")
        ck(os.pread(sealed_fd,12,0)==before,"old_pinned_memfd_corrupted_by_retire")
        os.close(sealed_fd)
        # Preserve already visible revision, durable replay can reconcile.
        ck(srv.replay()==[newevent["id"]],"durable_replay_cursor_failed")
        changed=race(srv,keys,"commercial")
        ck(get(srv,keys,200,"UPDATED MID HTTP")>0,"post_commercial_rebuild")
        revoked=race(srv,keys,"revoke")
        ck(get(srv,keys,200,"UPDATED MID HTTP")>0,"membership_recovery")
        stats=srv.pool_metrics()
        ck(stats["created"]==qa.PG_POOL+1 and stats["broken"]==1 and stats["borrows"]>stats["capacity"],
           ("pool_not_actually_reused",stats))
        ck(stats["peak"]<=qa.PG_POOL and stats["reuses"]>0,"pool_bound_failed")
        with v.con() as db:
            result={"database_bytes":db.execute("SELECT pg_database_size(current_database())").fetchone()[0],
                "playback_index_bytes":db.execute("SELECT pg_indexes_size('public.playback_logs')").fetchone()[0]}
        out={"result":"PASS","chunk_bytes":qa.CHUNK,"pool":stats,
            "private_AES_GCM_source_and_archive":True,"sealed_memfd_NO_TOCTOU":True,
            "atomic_fsync_crash_exit":94,"ciphertext_corrupt_denied":True,
            "permission_and_symlink_denied":True,"old_ciphertext_retired":True,
            "old_pinned_memfd_preserved":True,"broken_SQL_pool_fail_closed_repaired":True,
            "inflight_races":[changed,revoked],"encrypted_disk_bytes":srv.disk_encrypted_bytes,
            "worker_RSS_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "storage":result,"elapsed_sec":round(time.perf_counter()-ts,3),
            "no_prod_access":True,"production_GO":False}
        print("QA_SECURE_POOL_FAULTS_JSON="+json.dumps(out,sort_keys=True),flush=True)
        print("QA_SECURE_POOL_FAULTS_PASS=true",flush=True)
    finally:
        srv.shutdown();srv.server_close();listen.join(4);srv.cleanup()
if __name__=="__main__":main()
