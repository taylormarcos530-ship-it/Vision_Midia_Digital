"""Real isolated PG17 + AES256-GCM encrypted-archive-only replay tests.

No test deletes source receipts. Archive replay PG role CANNOT SELECT receipts.
No production servers, credentials, APKs, or TVs are referenced.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import psycopg
from archive_replay import (archive_segment,restore_to_separate_sqlite,
                            start_archive_server,load_verified_segment,
                            replay_only)
from server import DSN,ingest,hash_token

KEY=bytes.fromhex(os.environ["VISION_V2_QA_ARCHIVE_KEY_HEX"])
def event(seq,media=None):
    return {"sequence":seq,"event_id":f"proof-{seq:08d}",
       "media_id":media or "ad-test","boot_id":"boot-qa-0001",
       "mono_ms":seq*15000,"seconds":15,"completed":True}

class ArchiveOnlyReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert len(KEY)==32
        with psycopg.connect(DSN) as db:
            assert db.execute("SELECT current_database()").fetchone()[0]=="vision_v2_quarantine_disposable"
        cls.counter=0
        cls.counter_lock=threading.Lock()
    def setUp(self):
        with self.counter_lock:
            self.__class__.counter+=1
            number=self.counter
        self.device=f"device-{number:03}"
        self.stream=f"stream-{number:03}"
        self.company="company-test"
        self.token=f"qa-token-secret-archive-{number:03}-0123456789"
        self.dir=tempfile.TemporaryDirectory(prefix="vision-v2-archive-only-qa-")
        self.addCleanup(self.dir.cleanup)
        self.root=Path(self.dir.name)
        with psycopg.connect(DSN) as db:
            db.execute("""INSERT INTO v2_quarantine_qa.devices
                 (company_id,device_id,stream_id,token_sha256)
                 VALUES(%s,%s,%s,%s)""",
                 (self.company,self.device,self.stream,hash_token(self.token)))
        self.seed()
        self.server,self.thread=start_archive_server(self.root,KEY)
        self.addCleanup(self.stop_server)
        self.url=f"http://127.0.0.1:{self.server.server_address[1]}/qa/archive-replay"

    def stop_server(self):
        self.server.shutdown();self.server.server_close();self.thread.join(3)
    def seed(self):
        a=ingest({"device_id":self.device,"stream_id":self.stream,
                  "events":[event(i) for i in range(1,51)]},self.token)
        b=ingest({"device_id":self.device,"stream_id":self.stream,
                  "events":[event(i) for i in range(51,65)]},self.token)
        assert a["ack"]==50 and b["ack"]==64

    def archive(self):
        x=archive_segment(self.root,KEY,self.device,1,32)
        y=archive_segment(self.root,KEY,self.device,33,64)
        return x,y

    def snapshot(self):
        with psycopg.connect(DSN) as db:
            row=db.execute("""SELECT watermark FROM v2_quarantine_qa.devices
                               WHERE device_id=%s""",(self.device,)).fetchone()[0]
            count=db.execute("""SELECT COUNT(*),COALESCE(sum(sequence),0) FROM v2_quarantine_qa.receipts
                               WHERE device_id=%s""",(self.device,)).fetchone()
            return row,*count

    def post(self,events,token=None,device=None,stream=None):
        payload=json.dumps({"device_id":device or self.device,
                            "stream_id":stream or self.stream,
                            "events":events}).encode()
        req=urllib.request.Request(self.url,data=payload,method="POST",
             headers={"Content-Type":"application/json",
                      "x-device-token":token if token is not None else self.token})
        try:
            with urllib.request.urlopen(req,timeout=10) as resp:
                return resp.status,json.loads(resp.read())
        except urllib.error.HTTPError as err:
            return err.code,json.loads(err.read())

    def manifest(self,first=1):
        with psycopg.connect(DSN) as db:
            return db.execute("""SELECT company_id,device_id,stream_id,
                 seq_first,seq_last,event_count,blob_basename,blob_sha256,
                 plain_sha256,key_id
                 FROM v2_replay_qa.segment_manifests
                 WHERE device_id=%s AND seq_first=%s""",(self.device,first)).fetchone()

    def assert_originals(self):
        self.assertEqual(self.snapshot(),(64,64,2080))
        with psycopg.connect(DSN) as db:
            self.assertEqual(db.execute("""SELECT count(*) FROM v2_quarantine_qa.receipts
                 WHERE device_id=%s AND (billable OR event_played_at IS NOT NULL)""",
                 (self.device,)).fetchone()[0],0)

    def test_export_and_verified_restore_into_separate_sqlite(self):
        x,y=self.archive()
        self.assertEqual(x["count"]+y["count"],64)
        target=self.root/"restored_proofs.sqlite"
        n=restore_to_separate_sqlite(self.root,KEY,self.manifest(1),target)
        self.assertEqual(n,32)
        with sqlite3.connect(target) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0],"ok")
            self.assertEqual(db.execute("SELECT count(*) FROM restored_proofs").fetchone()[0],32)
            self.assertEqual(db.execute("SELECT min(sequence),max(sequence) FROM restored_proofs").fetchone(),(1,32))
        self.assert_originals()
        print("QA_ARCHIVE_RESTORE_PASS source_count=64 restored=32 encrypted_bytes="+str(x["archive_bytes"]),flush=True)

    def test_archive_only_replay_crosses_segment_boundary(self):
        self.archive()
        start=self.snapshot()
        status,data=self.post([event(32),event(33)])
        self.assertEqual(status,200)
        self.assertEqual(data,{"ack":64,"accepted":0,"duplicates":2,"billable":0,"archive_only":True})
        self.assertEqual(self.snapshot(),start)
        self.assert_originals()
        print("QA_ARCHIVE_ONLY_ACK_PASS archived_replay=2 ack=64 originals_unchanged=true",flush=True)

    def test_missing_archive_blocks_ack_even_with_originals_present(self):
        x,y=self.archive()
        (self.root/y["basename"]).rename(self.root/"missing.v2qa.hidden")
        self.assertEqual(self.post([event(33)])[0],503)
        self.assert_originals()

    def test_corrupted_ciphertext_blocks_ack(self):
        x,y=self.archive()
        path=self.root/x["basename"]
        packed=bytearray(path.read_bytes())
        packed[len(packed)//2]^=1
        path.write_bytes(packed)
        self.assertEqual(self.post([event(1)])[0],503)
        self.assert_originals()

    def test_truncated_file_blocks_ack(self):
        x,y=self.archive()
        p=self.root/x["basename"]
        p.write_bytes(p.read_bytes()[:25])
        self.assertEqual(self.post([event(1)])[0],503)
        self.assert_originals()

    def test_wrong_decryption_key_blocks_ack_and_restore(self):
        self.archive()
        wrong=bytes([b ^ 0xAA for b in KEY])
        with self.assertRaises(Exception):
            load_verified_segment(self.root,wrong,self.manifest(1))
        with self.assertRaises(Exception):
            restore_to_separate_sqlite(self.root,wrong,self.manifest(1),self.root/"bad.sqlite")
        self.assertFalse((self.root/"bad.sqlite").exists())
        from archive_replay import replay_only
        from server import Reject
        with self.assertRaises(Reject) as ctx:
            replay_only(self.root,wrong,{"device_id":self.device,"stream_id":self.stream,
                        "events":[event(1)]},self.token)
        self.assertEqual(ctx.exception.status,503)
        self.assert_originals()

    def test_changed_payload_conflicts_not_acknowledged(self):
        self.archive()
        fake=event(1,media="altered")
        code,msg=self.post([fake])
        self.assertEqual((code,msg["error"]),(409,"conflicting_archived_replay"))
        self.assert_originals()

    def test_unconfirmed_sequence_cannot_advance_ack(self):
        self.archive()
        code,msg=self.post([event(65)])
        self.assertEqual((code,msg["error"]),(409,"unconfirmed_sequence_no_new_ack"))
        self.assert_originals()

    def test_missing_manifest_rejected_despite_original_record(self):
        archive_segment(self.root,KEY,self.device,1,32)
        status,data=self.post([event(33)])
        self.assertEqual((status,data["error"]),(503,"archive_unavailable_no_ack"))
        self.assert_originals()

    def test_wrong_token_and_stream_cannot_access_archive(self):
        self.archive()
        self.assertEqual(self.post([event(1)],token="qa-wrong-token-0123456789")[0],401)
        self.assertEqual(self.post([event(1)],stream="other-stream")[0],401)
        self.assert_originals()

    def test_six_parallel_verified_replays_are_idempotent(self):
        self.archive()
        original=self.snapshot()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
            responses=list(ex.map(lambda _:self.post([event(i) for i in range(1,33)]),range(6)))
        self.assertTrue(all(status==200 and reply["duplicates"]==32 and reply["ack"]==64
                            for status,reply in responses),responses)
        self.assertEqual(self.snapshot(),original)
        print("QA_ARCHIVE_CONCURRENCY_PASS workers=6 verified_replays=192 new_ack=0",flush=True)

    def test_restricted_role_cannot_select_original_receipts(self):
        with psycopg.connect(DSN) as db:
            with db.transaction():
                db.execute("SET LOCAL ROLE v2_archive_reader_qa")
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    with db.transaction():
                        db.execute("SELECT count(*) FROM v2_quarantine_qa.receipts").fetchone()
        self.assert_originals()
        print("QA_ARCHIVE_PG_PRIVILEGE_PASS no_original_receipts_select=true",flush=True)

    def test_synthetic_disk_full_aborts_export_without_manifest(self):
        with self.assertRaises(OSError):
            archive_segment(self.root,KEY,self.device,1,32,simulate_disk_full=True)
        self.assertIsNone(self.manifest(1))
        self.assertFalse(any(self.root.glob("*.v2qa")))
        self.assertEqual(self.post([event(1)])[0],503)
        self.assert_originals()

    def test_simulated_restart_before_atomic_rename_does_not_ack(self):
        with self.assertRaisesRegex(RuntimeError,"simulated_restart"):
            archive_segment(self.root,KEY,self.device,1,32,simulate_restart=True)
        self.assertIsNone(self.manifest(1))
        self.assertEqual(self.post([event(1)])[0],503)
        self.assert_originals()

    def test_metadata_commit_failure_leaves_orphan_not_false_ack(self):
        with psycopg.connect(DSN) as db:
            db.execute("""CREATE FUNCTION v2_replay_qa.qa_failure() RETURNS trigger LANGUAGE plpgsql AS $$
                    BEGIN RAISE EXCEPTION 'qa_injected_manifest_write_failure'; END $$""")
            db.execute("""CREATE TRIGGER qa_fail_manifest BEFORE INSERT ON v2_replay_qa.segment_manifests
                    FOR EACH ROW EXECUTE FUNCTION v2_replay_qa.qa_failure()""")
        try:
            with self.assertRaises(psycopg.Error):
                archive_segment(self.root,KEY,self.device,1,32)
            self.assertIsNone(self.manifest(1))
            self.assertTrue(any(self.root.glob("*.v2qa")))  # orphan: do not treat as committed
            self.assertEqual(self.post([event(1)])[0],503)
            self.assert_originals()
        finally:
            with psycopg.connect(DSN) as db:
                db.execute("DROP TRIGGER qa_fail_manifest ON v2_replay_qa.segment_manifests")

    def test_recovery_after_missing_file_then_valid_restore(self):
        first,second=self.archive()
        path=self.root/first["basename"]
        backup=path.read_bytes()
        path.rename(self.root/"temporarily_unavailable")
        self.assertEqual(self.post([event(1)])[0],503)
        (self.root/"temporarily_unavailable").rename(path)
        self.assertEqual(self.post([event(1)])[0],200)
        target=self.root/"verified_restore.sqlite"
        self.assertEqual(restore_to_separate_sqlite(self.root,KEY,self.manifest(1),target),32)
        self.assert_originals()
        print("QA_ARCHIVE_RECOVERY_PASS archive_unavailable_then_restored=true",flush=True)

    def test_batch_across_missing_segment_never_partially_acks(self):
        archive_segment(self.root,KEY,self.device,1,32)
        before=self.snapshot()
        status,data=self.post([event(32),event(33)])
        self.assertEqual((status,data["error"]),(503,"archive_unavailable_no_ack"))
        self.assertEqual(self.snapshot(),before)
        self.assert_originals()
        print("QA_ARCHIVE_MULTISEGMENT_FAIL_CLOSED_PASS no_partial_ack=true",flush=True)

    def test_registered_segment_manifest_is_immutable(self):
        self.archive()
        recorded=self.manifest(1)
        with psycopg.connect(DSN) as db:
            with self.assertRaises(psycopg.Error) as err:
                with db.transaction():
                    db.execute("""UPDATE v2_replay_qa.segment_manifests
                        SET blob_sha256=%s
                        WHERE device_id=%s AND seq_first=1""",
                        ("f"*64,self.device))
        self.assertIn("qa_manifest_immutable",str(err.exception))
        self.assertEqual(self.manifest(1),recorded)
        self.assertEqual(self.post([event(1)])[0],200)
        self.assert_originals()
        print("QA_ARCHIVE_MANIFEST_IMMUTABLE_PASS",flush=True)

if __name__=="__main__":
    unittest.main(verbosity=2)
