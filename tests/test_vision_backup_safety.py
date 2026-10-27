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
                        {"name": "cover.png", "id": "1", "metadata": {"size": 15}}]
            if prefix == "photos/":
                return [{"name": "logo.webp", "id": "2", "metadata": {"size": 30}}]
            raise AssertionError(prefix)
        with mock.patch.object(backup, "request_json", side_effect=get_json):
            self.assertEqual(list(backup.storage_objects("https://example.invalid", "key", "bucket")),
                             [{"path": "photos/logo.webp", "size": 30, "etag": None},
                              {"path": "cover.png", "size": 15, "etag": None}])

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
                                       "image.jpg", Path(path) / "media" / "image.jpg",
                                       expected_size=1000)


    def test_client_major_must_be_17(self):
        def fake_run(args, **kw):
            tool = args[0]
            return mock.Mock(returncode=0,
                             stdout=(tool + " (PostgreSQL) 16.8").encode(),
                             stderr=b"")
        with mock.patch.object(backup.subprocess, "run", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "PostgreSQL version 17"):
                backup.require_pg17_tools()

    def test_client_major_17_is_accepted(self):
        def fake_run(args, **kw):
            name = args[0]
            version = (name + " (PostgreSQL) 17.11") if name != "age" else "1.2.1"
            return mock.Mock(returncode=0, stdout=version.encode(), stderr=b"")
        with mock.patch.object(backup.subprocess, "run", side_effect=fake_run):
            backup.require_pg17_tools()

    def test_missing_trusted_size_is_rejected(self):
        with tempfile.TemporaryDirectory() as path:
            with self.assertRaisesRegex(ValueError, "Source size"):
                backup.download_object("https://example.invalid", "secret", "media",
                                       "image.jpg", Path(path) / "image.jpg")

    def test_partial_bytes_without_content_length_rejected_by_origin_size(self):
        class Reply:
            status = 200
            headers = {}
            def __init__(self): self.buffer = io.BytesIO(b"short")
            def read(self, count): return self.buffer.read(count)
            def __enter__(self): return self
            def __exit__(self, *args): pass
        with tempfile.TemporaryDirectory() as path:
            with mock.patch.object(backup, "urlopen", return_value=Reply()):
                with self.assertRaisesRegex(ValueError, "trusted source size"):
                    backup.download_object("https://example.invalid", "secret", "media",
                                           "image.jpg", Path(path) / "image.jpg",
                                           expected_size=100)

    def test_wrong_source_etag_rejected_with_identical_file_length(self):
        class Reply:
            status = 200
            headers = {"Content-Length": "4"}
            def __init__(self): self.buffer = io.BytesIO(b"abcd")
            def read(self, count): return self.buffer.read(count)
            def __enter__(self): return self
            def __exit__(self, *args): pass
        with tempfile.TemporaryDirectory() as path:
            with mock.patch.object(backup, "urlopen", return_value=Reply()):
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    backup.download_object("https://example.invalid", "secret", "media",
                                           "image.jpg", Path(path) / "image.jpg", expected_size=4,
                                           expected_etag="00000000000000000000000000000000")

    def test_database_inventory_checks_identity_not_only_count(self):
        rows = '[{"bucket":"media","path":"correct.jpg","size":"12","etag":null}]'
        with mock.patch.object(backup, "verify_command", return_value=rows.encode()):
            self.assertEqual(backup.database_storage_inventory("fake://isolated"),
                             {("media", "correct.jpg"): {"size": 12, "etag": None}})

    def test_full_backup_refuses_wrong_object_at_same_count(self):
        source = {("media", "correct.jpg"): {"size": 12, "etag": None}}
        def fake_command(args, **kw):
            if args[0] == "pg_dump":
                Path(args[args.index("-f") + 1]).write_bytes(b"fake-dump-for-test")
                return b""
            if args[0] == "pg_restore":
                return b"TABLE DATA auth users"
            raise AssertionError(args)
        settings = {"VISION_BACKUP_DATABASE_URL": "isolated",
                    "VISION_BACKUP_SUPABASE_URL": "https://localhost",
                    "VISION_BACKUP_SERVICE_ROLE_KEY": "dummy",
                    "VISION_BACKUP_AGE_RECIPIENT": "age1dummy"}
        with tempfile.TemporaryDirectory() as path:
            target = Path(path) / "backup.age"
            with mock.patch.object(backup, "require_pg17_tools"):
                with mock.patch.object(backup, "database_storage_inventory", return_value=source):
                    with mock.patch.object(backup, "verify_command", side_effect=fake_command):
                        with mock.patch.object(backup, "request_json", return_value=[{"id":"media"}]):
                            with mock.patch.object(backup, "storage_objects", return_value=iter([
                                {"path":"wrong.jpg", "size":12, "etag":None}
                            ])):
                                with self.assertRaisesRegex(ValueError, "unexpected object"):
                                    backup.full_backup(target, settings)
            self.assertFalse(target.exists())

    def test_storage_listing_missing_size_is_rejected(self):
        with mock.patch.object(backup, "request_json", return_value=[
            {"name": "movie.mp4", "id": "1", "metadata": {}}
        ]):
            with self.assertRaisesRegex(ValueError, "source size"):
                list(backup.storage_objects("https://example.invalid", "key", "media"))

if __name__ == "__main__":
    unittest.main()
