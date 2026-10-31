"""Vision V2 remote independent Docker-store recovery QA; all data synthetic."""
import concurrent.futures
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import unittest

import psycopg
import remote_protocol as rp
from server import ingest,hash_token,Reject

class ExternalStoreQATests(unittest.TestCase):
    counter=0
    @classmethod
    def setUpClass(cls):
        with psycopg.connect(rp.DSN) as db:
            assert db.execute("SELECT current_database()").fetchone()[0]=="vision_v2_quarantine_disposable"

    def setUp(self):
        ExternalStoreQATests.counter+=1
        num=ExternalStoreQATests.counter
        self.device=f"device-{num:03d}"
        self.stream=f"stream-{num:03d}"
        self.token=f"qa-test-token-{num:03d}-abcdefghijklmnopqrstuvwxyz"
        self.originals=None
        self.temp=tempfile.TemporaryDirectory(prefix="v2-remote-restore-")
        self.addCleanup(self.temp.cleanup)
        rp.control("normal")
        with psycopg.connect(rp.DSN) as db:
            db.execute("""INSERT INTO v2_quarantine_qa.devices
                (company_id,device_id,stream_id,token_sha256)
                VALUES('qa-company',%s,%s,%s)""",
                (self.device,self.stream,hash_token(self.token)))
        self.seed()
        self.originals=self.snapshot()
        self.addCleanup(lambda:rp.control("normal"))

    def event(self,i,media="media-test"):
        return {"sequence":i,"event_id":f"proof-{i:08d}",
                "media_id":media,"boot_id":"qa-boot-0001",
                "mono_ms":i*15000,"seconds":15,"completed":True}

    def seed(self):
        for a,b in [(1,50),(51,64)]:
            events=[self.event(i) for i in range(a,b+1)]
            result=ingest({"device_id":self.device,"stream_id":self.stream,
                           "events":events},self.token)
            assert result["ack"]==b

    def snapshot(self):
        with psycopg.connect(rp.DSN) as db:
            a=db.execute("SELECT watermark FROM v2_quarantine_qa.devices WHERE device_id=%s",
                         (self.device,)).fetchone()[0]
            c=db.execute("""SELECT count(*),COALESCE(sum(sequence),0) FROM
                v2_quarantine_qa.receipts WHERE device_id=%s""",(self.device,)).fetchone()
            return (a,*c)

    def assert_intact(self):
        self.assertEqual(self.snapshot(),self.originals)
        self.assertEqual(self.originals,(64,64,2080))
        with psycopg.connect(rp.DSN) as db:
            self.assertEqual(db.execute("""SELECT count(*) FROM v2_quarantine_qa.receipts
                WHERE device_id=%s AND (billable OR event_played_at IS NOT NULL)""",
                (self.device,)).fetchone()[0],0)

    def manifest(self,first=1):
        with psycopg.connect(rp.DSN) as db:
            return db.execute("""SELECT company_id,device_id,stream_id,
                   seq_first,seq_last,event_count,blob_basename,blob_sha256,
                   plain_sha256,key_id FROM v2_replay_qa.segment_manifests
                   WHERE device_id=%s AND seq_first=%s""",
                   (self.device,first)).fetchone()

    def archive(self):
        return (rp.export_remote_segment(self.device,1,32),
                rp.export_remote_segment(self.device,33,64))

    def replay(self,seqs,token=None,device=None,stream=None):
        return rp.replay_remote_only({
            "device_id":device or self.device,
            "stream_id":stream or self.stream,
            "events":[self.event(i) for i in seqs]},token or self.token)

    def reject(self,expected_code,fn,status=503):
        with self.assertRaises(Reject) as caught:fn()
        self.assertEqual(caught.exception.status,status)
        self.assertEqual(caught.exception.code,expected_code)

    def test_verified_remote_receipt_and_restore_hash(self):
        first,second=self.archive()
        self.assertEqual(first["encrypted_bytes"]>0,True)
        manifest=self.manifest(1)
        self.assertEqual(manifest[7],first["cipher_sha256"])
        self.assertEqual(manifest[8],first["plain_sha256"])
        path=Path(self.temp.name)/"restored.sqlite"
        self.assertEqual(rp.restore_remote(manifest,path),32)
        with sqlite3.connect(path) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0],"ok")
            self.assertEqual(db.execute("SELECT count(*) FROM restored_proofs").fetchone()[0],32)
        self.assert_intact()
        print("V2_REMOTE_DURABLE_RESTORE_PASS store=separate_docker readback_sha256=true restored=32",flush=True)

    def test_remote_replay_two_segments_without_original_select(self):
        self.archive()
        payload=self.replay([32,33])
        self.assertEqual(payload,{"ack":64,"accepted":0,"duplicates":2,
                                  "billable":0,"archive_remote_verified":True})
        self.assert_intact()

    def test_store_unavailable_before_upload_no_manifest(self):
        rp.control("offline")
        with self.assertRaises(rp.StorageOffline):
            rp.export_remote_segment(self.device,1,32)
        rp.control("normal")
        self.assertIsNone(self.manifest())
        self.assert_intact()

    def test_storage_full_simulated_no_visible_file_and_no_manifest(self):
        rp.control("write_full")
        with self.assertRaises(rp.StorageOffline):
            rp.export_remote_segment(self.device,1,32)
        rp.control("normal")
        self.assertIsNone(self.manifest())
        filename=f"{self.device}-{self.stream}-000001-000032.v2qa"
        self.assertEqual(rp.get(filename)[0],404)
        self.assert_intact()

    def test_lost_durable_response_orphan_recovered_idempotently(self):
        rp.control("ack_lost")
        with self.assertRaises(rp.StorageOffline):
            rp.export_remote_segment(self.device,1,32)
        self.assertIsNone(self.manifest())
        name=f"{self.device}-{self.stream}-000001-000032.v2qa"
        self.assertEqual(rp.get(name)[0],200)
        rp.control("normal")
        archived=rp.export_remote_segment(self.device,1,32)
        self.assertEqual(self.manifest()[7],archived["cipher_sha256"])
        self.assertEqual(self.replay([1])["ack"],64)
        self.assert_intact()
        print("V2_REMOTE_ORPHAN_RECOVERY_PASS stored_without_manifest_then_revalidated=true",flush=True)

    def test_forged_durable_receipt_rejected_then_recovered(self):
        rp.control("bad_receipt")
        with self.assertRaisesRegex(ValueError,"untrusted_durable_receipt"):
            rp.export_remote_segment(self.device,1,32)
        self.assertIsNone(self.manifest())
        rp.control("normal")
        rp.export_remote_segment(self.device,1,32)
        self.assertEqual(self.replay([1])["duplicates"],1)
        self.assert_intact()

    def test_remote_offline_after_archive_blocks_replay_and_restore(self):
        self.archive()
        rp.control("offline")
        self.reject("remote_unverified_no_ack",lambda:self.replay([1]))
        with self.assertRaises(rp.StorageOffline):
            rp.restore_remote(self.manifest(1),Path(self.temp.name)/"bad.sqlite")
        self.assert_intact()
        rp.control("normal")
        self.assertEqual(self.replay([1])["ack"],64)
        self.assertEqual(rp.restore_remote(self.manifest(1),
                          Path(self.temp.name)/"good.sqlite"),32)
        print("V2_REMOTE_OFFLINE_RECOVERY_PASS no_new_ack=true",flush=True)

    def test_corrupted_remote_read_is_rejected_without_ack(self):
        self.archive()
        rp.control("corrupt_read")
        self.reject("remote_unverified_no_ack",lambda:self.replay([1]))
        self.assert_intact()
        rp.control("normal")
        self.assertEqual(self.replay([1])["duplicates"],1)

    def test_wrong_aes_key_rejected(self):
        self.archive()
        correct=rp.AES_KEY
        try:
            rp.AES_KEY=bytes(x^0xAA for x in correct)
            self.reject("remote_unverified_no_ack",lambda:self.replay([1]))
        finally:rp.AES_KEY=correct
        self.assertEqual(self.replay([1])["ack"],64)
        self.assert_intact()

    def test_mixed_segments_second_file_offline_no_partial_reply(self):
        self.archive()
        rp.control("corrupt_read")
        self.reject("remote_unverified_no_ack",lambda:self.replay([32,33]))
        rp.control("normal")
        self.assertEqual(self.replay([32,33])["duplicates"],2)
        self.assert_intact()

    def test_concurrent_eight_remote_replays_no_ack_increment(self):
        self.archive()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda _:self.replay(list(range(1,33))),range(8)))
        self.assertEqual(len(results),8)
        self.assertTrue(all(r["ack"]==64 and r["duplicates"]==32 and
                            r["accepted"]==0 for r in results))
        self.assert_intact()
        print("V2_REMOTE_CONCURRENCY_PASS workers=8 replays=256 new_ack=0",flush=True)

    def test_pg_manifest_commit_failure_creates_verified_orphan_no_ack(self):
        with psycopg.connect(rp.DSN) as db:
            db.execute("""CREATE OR REPLACE FUNCTION v2_replay_qa.fail_manifest_remote()
                 RETURNS trigger LANGUAGE plpgsql AS $
                 BEGIN RAISE EXCEPTION 'qa_manifest_failed'; END $""")
        with psycopg.connect(rp.DSN) as db:
            db.execute("""CREATE TRIGGER qa_remote_manifest_fault
                BEFORE INSERT ON v2_replay_qa.segment_manifests
                FOR EACH ROW EXECUTE FUNCTION v2_replay_qa.fail_manifest_remote()""")
        try:
            with self.assertRaises(psycopg.Error):
                rp.export_remote_segment(self.device,1,32)
            self.assertIsNone(self.manifest())
            self.assertEqual(rp.get(f"{self.device}-{self.stream}-000001-000032.v2qa")[0],200)
            self.assert_intact()
        finally:
            with psycopg.connect(rp.DSN) as db:
                db.execute("DROP TRIGGER qa_remote_manifest_fault ON v2_replay_qa.segment_manifests")
        rp.export_remote_segment(self.device,1,32)
        self.assertEqual(self.replay([1])["ack"],64)

    def test_new_event_not_already_confirmed_is_rejected(self):
        self.archive()
        self.reject("unconfirmed_sequence_no_ack",lambda:self.replay([65]),status=409)
        self.assert_intact()

    def test_changed_payload_does_not_validate_remote_archive(self):
        self.archive()
        changed=self.event(1,"other-media")
        payload={"device_id":self.device,"stream_id":self.stream,"events":[changed]}
        self.reject("replay_payload_conflict",
                    lambda:rp.replay_remote_only(payload,self.token),status=409)
        self.assert_intact()

    def test_cross_device_token_rejected_before_archive_read(self):
        self.archive()
        self.reject("unauthorized",lambda:self.replay([1],token="wrong-token-qa-0123456789"),status=401)
        self.assert_intact()

    def test_restart_independent_storage_container_preserves_objects(self):
        self.archive()
        result=subprocess.run(["docker","restart","vision-v2-qa-store"],
                              capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr)
        ready=False
        for _ in range(35):
            try:
                status,data=rp.request("GET","/health")
                if status==200:ready=True;break
            except Exception:pass
            time.sleep(.2)
        self.assertTrue(ready,"store container did not restart")
        self.assertEqual(self.replay([1,33])["duplicates"],2)
        self.assert_intact()
        print("V2_REMOTE_CONTAINER_RESTART_PASS volume_persisted=true",flush=True)

    def test_no_delete_api_object_remains(self):
        self.archive()
        name=self.manifest(1)[6]
        status,data=rp.request("DELETE","/objects/"+name)
        self.assertIn(status,(404,405,501))
        self.assertEqual(rp.get(name)[0],200)
        self.assert_intact()

if __name__=="__main__":
    unittest.main(verbosity=2)
