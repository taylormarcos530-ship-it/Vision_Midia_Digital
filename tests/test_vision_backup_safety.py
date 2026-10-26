import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "vision-backup" / "backup.py"
spec = importlib.util.spec_from_file_location("vision_backup", SCRIPT)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class BackupSafetyTests(unittest.TestCase):
    def test_block_traversal_and_slashes(self):
        for value in ("", ".", "..", "../x", "/etc/passwd", "a/b", "a\\b", "a\x00b"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                backup.safe_segment(value)

    def test_refuse_wrong_project(self):
        env = {
            "VISION_BACKUP_DATABASE_URL": "postgresql://user:pass@other.db/postgres",
            "VISION_BACKUP_SUPABASE_URL": "https://foreign.supabase.co",
            "VISION_BACKUP_SERVICE_ROLE_KEY": "not-a-real-key",
            "VISION_BACKUP_AGE_RECIPIENT": "age1" + "q" * 58,
        }
        with mock.patch.dict(os.environ, env), self.assertRaisesRegex(ValueError, "authorized Vision project"):
            backup.require_environment()

    def test_never_accept_missing_credentials(self):
        with mock.patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(ValueError, "Missing environment variables"):
            backup.require_environment()

    def test_accept_expected_project_and_public_recipient_only(self):
        env = {
            "VISION_BACKUP_DATABASE_URL": "postgresql://postgres:example@db.fpadgedrgcxrrqflzhjt.supabase.co/postgres",
            "VISION_BACKUP_SUPABASE_URL": "https://fpadgedrgcxrrqflzhjt.supabase.co",
            "VISION_BACKUP_SERVICE_ROLE_KEY": "example-not-a-secret",
            "VISION_BACKUP_AGE_RECIPIENT": "age1" + "q" * 58,
        }
        with mock.patch.dict(os.environ, env):
            self.assertEqual(backup.require_environment(), env)

    def test_storage_recurses_folders_without_losing_items(self):
        def get_json(_url, _key, endpoint, payload=None):
            prefix = payload["prefix"]
            offset = payload["offset"]
            if offset: return []
            if prefix == "":
                return [{"name": "photos", "id": None, "metadata": None},
                        {"name": "cover.png", "id": "1", "metadata": {"mimetype": "image/png"}}]
            if prefix == "photos/":
                return [{"name": "logo.webp", "id": "2", "metadata": {"mimetype": "image/webp"}}]
            raise AssertionError(prefix)
        with mock.patch.object(backup, "request_json", side_effect=get_json):
            self.assertEqual(list(backup.storage_objects("https://example.invalid", "key", "bucket")),
                             ["photos/logo.webp", "cover.png"])

    def test_encryption_prevents_plaintext_backup_destination(self):
        import argparse
        # Missing secrets must fail before any network access or writes.
        with mock.patch.dict(os.environ, {}, clear=True):
            with tempfile.TemporaryDirectory() as path:
                destination = Path(path) / "vision.age"
                with self.assertRaises(ValueError):
                    backup.full_backup(destination, backup.require_environment())
                self.assertFalse(destination.exists())

    def test_existing_backups_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as path:
            target = Path(path) / "vision.age"
            target.write_bytes(b"already-encrypted")
            with self.assertRaises(FileExistsError):
                backup.full_backup(target, {})
            self.assertEqual(target.read_bytes(), b"already-encrypted")

    def test_storage_download_detects_truncation(self):
        class Reply:
            status = 200
            headers = {"Content-Length": "1000"}
            def __init__(self): self.buffer = io.BytesIO(b"only-5")
            def read(self, size): return self.buffer.read(size)
            def __enter__(self): return self
            def __exit__(self, *args): pass
        with tempfile.TemporaryDirectory() as path, mock.patch.object(backup, "urlopen", return_value=Reply()):
            with self.assertRaisesRegex(ValueError, "truncated"):
                backup.download_object("https://example.invalid", "secret", "media",
                                       "image.jpg", Path(path) / "media" / "image.jpg")

if __name__ == "__main__":
    unittest.main()
