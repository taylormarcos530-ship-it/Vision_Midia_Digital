"""Destructive QA on disposable PG17 + PRIVATE synthetic tempfiles.
Tests fail-closed corrupt/permission/symlink assets; fsync-before-rename
failure, hard process crash and replay, same-stream guarded commercial mutation
and revocation. No claim kernel delivery can be retracted after commit.
"""
from __future__ import annotations
import gzip,hashlib,importlib.util,json,multiprocessing as mp,os,resource,socket
import threading,time,stat
from http.client import IncompleteRead
from pathlib import Path
from urllib import request,error

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("vision2_integrated",HERE/"qa.py")
v2=importlib.util.module_from_spec(spec);spec.loader.exec_module(v2)
v2.configure()
v,c,z,driver=v2.v,v2.c,v2.z,v2.driver
def ck(x,m):assert x,m
def wait(f,seconds=10):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if f():return
        time.sleep(.01)
    raise AssertionError("QA_wait_timeout")

def read(peer,keys,tenant=0,code=200,name=None):
    url="http://127.0.0.1:"+str(peer.server_address[1])
    return driver.fetch_url(url,keys,tenant,code,name)

def hard_crash_build(keys):
    # Separate child reconstructs from durable outbox then simulates a crash
    # after gzip fsync, BEFORE atomic publication of a compressed revision.
    srv=v2.FencedServer(1,keys)
    srv.startup();srv.make_cache()
    import os
    os.replace=lambda a,b:os._exit(94)
    srv.replay()
    os._exit(95)

def race(peer,keys,action):
    company,user=v.COMPANIES[0],v.USER_IDS[0]
    token=keys.issue(company,user,"a")
    peer.pause_before_first_write=True
    peer.entered.clear();peer.release.clear()
    peer.after_first.clear();peer.next_allow.clear()
    url="http://127.0.0.1:"+str(peer.server_address[1])+"/0"
    req=request.Request(url,headers={"X-QA-JWT":token,"Accept-Encoding":"gzip"})
    resp=request.urlopen(req,timeout=30)
    output={}
    try:
        wait(peer.entered.is_set)
        def update():
            started=time.monotonic()
            if action=="revoke":
                output["committed"]=v2.guarded_revoke(company,user)
            else:
                output["event"]=v2.guarded_publish(company,"CHANGED MID HTTP",notify=False)
                output["committed"]=time.monotonic()
            output["elapsed_ms"]=round((time.monotonic()-started)*1000,3)
        t=threading.Thread(target=update);t.start()
        time.sleep(.035)
        ck("committed" not in output,("commit_did_not_wait_for_protected_block",action,output))
        peer.release.set()
        first=resp.read(v2.CHUNK)
        ck(len(first)==v2.CHUNK,("first_chunk_failed",action,len(first)))
        wait(peer.after_first.is_set)
        t.join(3)
        ck(not t.is_alive() and "committed" in output,("exclusive_commit_starved",action))
        written=peer.payload_bytes
        peer.next_allow.set()
        try:
            following=resp.read()
            raise AssertionError(("unexpected_full_stream_after_revoke_or_change",action,len(following)))
        except IncompleteRead as e:
            ck(len(e.partial)==0,("bytes_sent_after_exclusive_commit",action,len(e.partial)))
        ck(peer.payload_bytes==written,("application_write_after_commit",action,written,peer.payload_bytes))
        return {"action":action,"first_write_bytes":len(first),
            "additional_app_bytes_after_commit":0,
            "exclusive_writer_elapsed_ms":output["elapsed_ms"],
            "http_truncated_after_committed_change":True}
    finally:
        peer.pause_before_first_write=False
        peer.release.set();peer.next_allow.set()
        resp.close()
        if action=="revoke":
            with v.con() as db:
                with db.transaction():
                    db.execute("SELECT pg_advisory_xact_lock(%s)",(v2.lockkey(company),))
                    db.execute("INSERT INTO private.memberships(company_id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING",(company,user))

def main():
    st=time.perf_counter()
    v2.disk.driver.q.init_db()
    v2.disk.driver.p.expanded_history()
    v2.disk.driver.a.setup_outbox()
    v2.deep.rls_audit()
    z.create_tables()
    keys=v2.disk.driver.a.Keys()
    company=v.COMPANIES[0]
    base=v2.guarded_publish(company,"ORIGINAL SYNTHETIC CAMPAIGN",notify=False)
    srv=v2.FencedServer(0,keys)
    srv.startup();srv.make_cache()
    ck(srv.replay()==[base["id"]],"initial_replay_missing")
    service=threading.Thread(target=srv.serve_forever,daemon=True);service.start()
    try:
        ck(stat.S_IMODE(srv.root.stat().st_mode)==0o700,"temp_dir_public")
        ck(all(stat.S_IMODE(p.stat().st_mode)==0o600 for p in srv.base_paths.values()),"raw_files_public")
        original=read(srv,keys,0,200,"ORIGINAL SYNTHETIC CAMPAIGN")
        ck(original["code"]==200,"initial_original_http_failed")
        pending=v2.guarded_publish(company,"NEW DURABLE CAMPAIGN",notify=False)
        ck(read(srv,keys,0,503)["code"]==503,"stale_revision_not_denied")
        srv.inject_fail_before_rename=True
        try:srv.replay()
        except OSError as ex:ck("injected_after_fsync" in str(ex),"wrong_fault")
        else:raise AssertionError("prepublication_fault_not_injected")
        ck(srv.last==pending["id"],"outbox_checkpoint_not_durable")
        ck(read(srv,keys,0,503)["code"]==503,"old_revision_exposed_after_failed_publish")
        latest=srv.cache[str(company)]
        srv.build_revision(company,latest["revision"],latest["campaign"])
        ck(read(srv,keys,0,200,"NEW DURABLE CAMPAIGN")["code"]==200,"materialization_repair_failed")
        path=Path(srv.versions[str(company)]["filepath"])
        ck(stat.S_IMODE(path.stat().st_mode)==0o600,"gzip_asset_permissions")
        # Actual overwrite corruption and full truncated-length detection before status200
        with open(path,"r+b") as f:
            f.seek(64);byte=f.read(1);f.seek(64);f.write(bytes([byte[0]^0xFF]))
        ck(read(srv,keys,0,503)["code"]==503,"tampered_gzip_accepted")
        srv.build_revision(company,latest["revision"],latest["campaign"])
        with open(path,"r+b") as f:f.truncate(200)
        ck(read(srv,keys,0,503)["code"]==503,"truncated_gzip_accepted")
        srv.build_revision(company,latest["revision"],latest["campaign"])
        os.chmod(path,0o644)
        ck(read(srv,keys,0,503)["code"]==503,"world_readable_gzip_accepted")
        os.chmod(path,0o600)
        ck(read(srv,keys,0,200,"NEW DURABLE CAMPAIGN")["code"]==200,"repair_after_bad_permissions")
        # A regular path replaced by a symlink (to private original source) must
        # be rejected by lstat; compressed target is reconstructed afterwards.
        path.unlink();os.symlink(srv.base_paths[str(company)],path)
        ck(read(srv,keys,0,503)["code"]==503,"symlink_asset_accepted")
        srv.build_revision(company,latest["revision"],latest["campaign"])
        ck(read(srv,keys,0,200,"NEW DURABLE CAMPAIGN")["code"]==200,"symlink_repair")
        # OS-process crash after fsync before atomic publication:
        # consumer 1 has NOT read the durable outbox yet.
        child=mp.Process(target=hard_crash_build,args=(keys,));child.start();child.join(12)
        ck(child.exitcode==94,("not_crashed_before_rename",child.exitcode))
        revived=v2.FencedServer(1,keys)
        revived.startup();revived.make_cache()
        # Its cursor was committed in prior crashed process, so the durable
        # receipt reconstructs commercial version from startup(), not replay().
        ck(revived.last==pending["id"],"recovery_cursor_missing")
        for co,item in list(revived.cache.items()):
            if not co.startswith("base:"):
                revived.build_revision(co,item["revision"],item["campaign"])
        ck(revived.get_verified(company,latest["revision"]) is not None,
           "recovered_compressed_revision_invalid")
        revived.cleanup();revived.server_close()
        # Inject exact post-authorization/pre-first-write race where
        # cooperating writer must wait for the shared lock.
        changed=race(srv,keys,"commercial")
        ck(read(srv,keys,0,503)["code"]==503,"midstream_changed_revision_served")
        new_event=v2.guarded_publish(company,"POST RACE RESTORED",notify=False)
        srv.replay()
        ck(read(srv,keys,0,200,"POST RACE RESTORED")["code"]==200,"post_race_replay")
        revoked=race(srv,keys,"revoke")
        ck(read(srv,keys,0,200,"POST RACE RESTORED")["code"]==200,"post_revoke_restore")
        with v.con() as db:
            wal=db.execute("SELECT pg_current_wal_lsn()").fetchone()[0]
            storage={"db_bytes":db.execute("SELECT pg_database_size(current_database())").fetchone()[0],
                "index_bytes":db.execute("SELECT pg_indexes_size('public.playback_logs')").fetchone()[0],
                "wal_end_lsn":str(wal)}
        output={"status":"PASS","chunk_bytes":v2.CHUNK,"pg_pool":v2.PG_POOL,
            "faults":{"after_fsync_before_rename":True,"persistent_cursor_after_failure":True,
             "corrupted_gzip_503":True,"truncated_gzip_503":True,
             "world_readable_503":True,"symlink_503":True,"full_repair_sha_pass":True,
             "crash_exit_after_fsync":94,"crash_replay_from_receipt":True},
             "stream_races":[changed,revoked],
             "disk_bytes":srv.disk_peak,"rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
             "http_payload_bytes":srv.payload_bytes,
             "sql_member_and_revision_checks":srv.sql_chunks,
             "storage":storage,"elapsed_s":round(time.perf_counter()-st,3),
             "none_official":True,"production_GO":False}
        print("QA_INTEGRATED_FAULTS_SUMMARY_JSON="+json.dumps(output,sort_keys=True),flush=True)
        print("QA_INTEGRATED_FAULTS_PASS=true",flush=True)
    finally:
        srv.shutdown();srv.server_close();service.join(4);srv.cleanup()
if __name__=="__main__":main()
