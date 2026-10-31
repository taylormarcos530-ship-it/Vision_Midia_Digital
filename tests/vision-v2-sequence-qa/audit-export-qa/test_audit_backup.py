"""Synthetic local-only crypto/backup fault tests: never contact Supabase."""
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from audit_backup import export_audit, verify_and_decrypt, restore_audit_only, sha

PASS = "synthetic-test-password-do-not-use-2026"

def make_source(path):
    con=sqlite3.connect(path)
    con.executescript("""
    PRAGMA journal_mode=WAL;
    CREATE TABLE state(id INTEGER PRIMARY KEY,ack INTEGER NOT NULL,next_seq INTEGER NOT NULL);
    CREATE TABLE audit_proofs(seq INTEGER PRIMARY KEY,event_id TEXT,media TEXT,completed INTEGER,
      seconds REAL,boot TEXT,mono INTEGER,proof_sha TEXT);
    CREATE TABLE audit_reviews(id INTEGER PRIMARY KEY,seq INTEGER,code TEXT,evidence TEXT);
    INSERT INTO state VALUES(1,9,22);
    """)
    for seq in range(10,22):
        con.execute("INSERT INTO audit_proofs VALUES(?,?,?,?,?,?,?,?)",
             (seq,f"event-{seq:08d}", "ad-A", 1,15.0,"qa-boot-0001",seq*15000,sha(f"proof{seq}".encode())))
        con.execute("INSERT INTO audit_reviews(seq,code,evidence) VALUES(?,?,?)",
                    (seq,"PENDING_TIME","NO_TRUSTED_CLOCK"))
    con.commit()
    con.close()

def state(path):
    with sqlite3.connect(path) as con:
        return con.execute("SELECT ack,next_seq FROM state").fetchone(), tuple(
            con.execute("SELECT COUNT(*) FROM "+t).fetchone()[0] for t in
            ("audit_proofs","audit_reviews"))
class EncryptedAuditQATests(unittest.TestCase):
    def setUp(self):
        self.dir=tempfile.TemporaryDirectory(prefix="vision-v2-crypto-qa-")
        self.addCleanup(self.dir.cleanup)
        self.root=Path(self.dir.name)
        self.source=self.root/"player.sqlite"
        self.backup=self.root/"encrypted.v2qa"
        self.restore=self.root/"restored_audit.sqlite"
        make_source(self.source)
        self.original=state(self.source)
    def backup_valid(self):
        return export_audit(self.source,self.backup,PASS)
    def assert_source_intact(self):
        self.assertEqual(state(self.source),self.original)

    def test_encrypt_then_restore_exact_count_and_hash(self):
        report=self.backup_valid()
        self.assertEqual(report["counts"],{"audit_proofs":12,"audit_reviews":12})
        self.assertEqual(report["source_ack"],9)
        self.assertNotIn(b"NO_TRUSTED_CLOCK",self.backup.read_bytes())
        original_manifest=verify_and_decrypt(self.backup,PASS)
        counts=restore_audit_only(self.backup,self.restore,PASS)
        self.assertEqual(counts,report["counts"])
        with sqlite3.connect(self.restore) as con:
            self.assertEqual(con.execute("PRAGMA integrity_check").fetchone()[0],"ok")
            self.assertEqual(con.execute("SELECT value FROM export_metadata WHERE key='source_ack_readonly'").fetchone()[0],"9")
            proof=[dict(zip(("seq","event_id","media","completed","seconds","boot","mono","proof_sha"),row)) for row in con.execute("SELECT * FROM audit_proofs ORDER BY seq")]
            self.assertEqual(proof,original_manifest["tables"]["audit_proofs"]["rows"])
        self.assert_source_intact()
        print("PASS_BACKUP_RESTORE sha256="+report["backup_sha256"]+" count=12 ACK_UNCHANGED=9")

    def test_wrong_password_rejected_no_restore(self):
        self.backup_valid()
        with self.assertRaises(Exception):
            restore_audit_only(self.backup,self.restore,"wrong-password-test-only")
        self.assertFalse(self.restore.exists())
        self.assert_source_intact()

    def test_ciphertext_tamper_fails_hash_and_auth(self):
        self.backup_valid()
        data=json.loads(self.backup.read_text())
        c=list(data["ciphertext"]);c[30]="A" if c[30]!="A" else "B"
        data["ciphertext"]="".join(c)
        self.backup.write_text(json.dumps(data))
        with self.assertRaises((ValueError,Exception)):
            restore_audit_only(self.backup,self.restore,PASS)
        self.assertFalse(self.restore.exists())
        self.assert_source_intact()

    def test_truncated_archive_rejected(self):
        self.backup_valid()
        data=self.backup.read_bytes()
        self.backup.write_bytes(data[:len(data)//2])
        with self.assertRaises(Exception):
            restore_audit_only(self.backup,self.restore,PASS)
        self.assertFalse(self.restore.exists())
        self.assert_source_intact()

    def test_disk_full_before_export_rename_leaves_no_artifact(self):
        with self.assertRaises(OSError) as caught:
            export_audit(self.source,self.backup,PASS,no_space=True)
        self.assertEqual(caught.exception.errno,28)
        self.assertFalse(self.backup.exists())
        self.assertEqual(list(self.root.glob("*.tmp")),[])
        self.assert_source_intact()

    def test_power_loss_before_export_rename_leaves_no_artifact(self):
        with self.assertRaisesRegex(RuntimeError,"simulated_power_loss"):
            export_audit(self.source,self.backup,PASS,power_loss=True)
        self.assertFalse(self.backup.exists())
        self.assert_source_intact()

    def test_disk_full_during_restore_keeps_source_and_target_absent(self):
        self.backup_valid()
        with self.assertRaises(OSError) as caught:
            restore_audit_only(self.backup,self.restore,PASS,no_space=True)
        self.assertEqual(caught.exception.errno,28)
        self.assertFalse(self.restore.exists())
        self.assert_source_intact()

    def test_power_loss_during_restore_is_atomic(self):
        self.backup_valid()
        with self.assertRaisesRegex(RuntimeError,"simulated_power_loss"):
            restore_audit_only(self.backup,self.restore,PASS,power_loss=True)
        self.assertFalse(self.restore.exists())
        self.assert_source_intact()

    def test_never_overwrite_an_existing_encrypted_backup(self):
        self.backup_valid()
        orig=self.backup.read_bytes()
        with self.assertRaises(FileExistsError):
            self.backup_valid()
        self.assertEqual(self.backup.read_bytes(),orig)
        self.assert_source_intact()

    def test_never_restore_over_an_existing_player_database(self):
        self.backup_valid()
        with self.assertRaises(FileExistsError):
            restore_audit_only(self.backup,self.source,PASS)
        self.assert_source_intact()

    def test_source_changes_after_backup_do_not_change_snapshot(self):
        self.backup_valid()
        with sqlite3.connect(self.source) as con:
            con.execute("INSERT INTO audit_reviews(seq,code,evidence) VALUES(?,?,?)",
                        (10,"NEW_REVIEW","case-added-after-snapshot"))
        manifest=verify_and_decrypt(self.backup,PASS)
        self.assertEqual(manifest["tables"]["audit_reviews"]["count"],12)
        self.assertEqual(restore_audit_only(self.backup,self.restore,PASS)["audit_reviews"],12)
        with sqlite3.connect(self.source) as con:
            self.assertEqual(con.execute("SELECT COUNT(*) FROM audit_reviews").fetchone()[0],13)

    def test_source_receipt_and_ack_never_modified_by_export(self):
        self.backup_valid()
        self.assert_source_intact()
        self.assertFalse(self.restore.exists())

if __name__=="__main__":
    unittest.main(verbosity=2)
