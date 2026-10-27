"""End-to-end disaster recovery test: isolated PostgreSQL 17 service + fake Storage.

Uses only fictitious records and locally generated age keys.
No real Supabase endpoint, service_role key, TV or deployment is accessed.
"""
import hashlib
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("vision_backup", ROOT / "scripts/vision-backup/backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

HOST = os.environ.get("VISION_TEST_PGHOST", "postgres")
PORT = int(os.environ.get("VISION_TEST_PGPORT", "5432"))
USER = "vision_tester"
PASSWORD = "fictitious-only-password"
SOURCE = f"postgresql://{USER}:{PASSWORD}@{HOST}:{PORT}/vision_source"
DESTINATION = f"postgresql://{USER}:{PASSWORD}@{HOST}:{PORT}/vision_restored"
MEDIA = {"intro.mp4": b"fictional video bytes" * 35,
         "photos/studio.jpg": b"fictional image bytes" * 13}

def pg(sql, database=SOURCE):
    result = subprocess.run(["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                             "-d", database, "-c", sql],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise AssertionError("SQL fixture or restoration verification failed: " + result.stderr.decode()[-2500:])
    return result.stdout.decode().strip()

def run(*command):
    result = subprocess.run(list(command), check=False, text=True, capture_output=True)
    if result.returncode:
        raise AssertionError("Isolated recovery subprocess failed: " + " ".join(command[:2]) + " " + result.stderr[-1500:])
    return result.stdout

class StorageHandler(http.server.BaseHTTPRequestHandler):
    variant = "normal"

    def log_message(self, format, *args):
        pass

    def respond(self, obj):
        blob = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def do_GET(self):
        if self.path == "/storage/v1/bucket":
            return self.respond([{"id":"media"}])
        root = "/storage/v1/object/authenticated/media/"
        if self.path.startswith(root):
            name = self.path[len(root):]
            if name not in MEDIA:
                self.send_error(404)
                return
            body = MEDIA[name]
            if StorageHandler.variant == "short" and name == "intro.mp4":
                body = body[:7]
            self.send_response(200)
            if StorageHandler.variant != "short":
                self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def do_POST(self):
        if self.path == "/storage/v1/object/list/media":
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            prefix = body.get("prefix", "")
            if prefix == "":
                name = "unexpected.mp4" if StorageHandler.variant == "rename" else "intro.mp4"
                entries = [
                    {"name": "photos", "id": None, "metadata": None},
                    {"name": name, "id": "test1",
                     "metadata": {"size": len(MEDIA["intro.mp4"]),
                                  "eTag": hashlib.md5(MEDIA["intro.mp4"]).hexdigest()}}
                ]
            elif prefix == "photos/":
                entries = [{"name": "studio.jpg", "id": "test2",
                            "metadata": {"size": len(MEDIA["photos/studio.jpg"]),
                                         "eTag": hashlib.md5(MEDIA["photos/studio.jpg"]).hexdigest()}}]
            else:
                entries = []
            return self.respond(entries)
        self.send_error(404)

class RestoreRealDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pg("CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage;")
        pg("""CREATE TABLE IF NOT EXISTS auth.users (
                   id uuid PRIMARY KEY, email text NOT NULL);
              CREATE TABLE IF NOT EXISTS storage.objects (
                   id text PRIMARY KEY, bucket_id text NOT NULL, name text NOT NULL,
                   metadata jsonb NOT NULL);
              CREATE TABLE IF NOT EXISTS public.clients (
                   id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                   tenant_id text NOT NULL, name text NOT NULL);
              CREATE TABLE IF NOT EXISTS public.tv_devices (
                   id integer PRIMARY KEY, client_id integer REFERENCES public.clients(id));
              CREATE TABLE IF NOT EXISTS public.playlists (
                   id integer PRIMARY KEY, client_id integer REFERENCES public.clients(id));
              CREATE TABLE IF NOT EXISTS public.playback_events (
                   id integer PRIMARY KEY, device_id integer REFERENCES public.tv_devices(id),
                   count integer NOT NULL CHECK (count >= 0));""")
        pg("""INSERT INTO auth.users VALUES
              ('00000000-0000-0000-0000-000000000001', 'teste@example.invalid');
              INSERT INTO public.clients (tenant_id,name) VALUES
              ('tenant_a','Academia de teste'),('tenant_b','Loja fictícia');
              INSERT INTO public.tv_devices VALUES (1,1),(2,2);
              INSERT INTO public.playlists VALUES (101,1),(102,2);
              INSERT INTO public.playback_events VALUES (201,1,100),(202,2,150);""")
        for index, (path, data) in enumerate(MEDIA.items(), start=1):
            md5 = hashlib.md5(data).hexdigest()
            pg("INSERT INTO storage.objects (id,bucket_id,name,metadata) "
               f"VALUES ('test{index}', 'media', '{path}', "
               f"""'{{"size":{len(data)},"eTag":"{md5}"}}'::jsonb);""")
        pg("""DO $$ BEGIN
                 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vision_readonly') THEN
                     CREATE ROLE vision_readonly NOLOGIN;
                 END IF;
              END $$;
              ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
              CREATE POLICY tenant_filter ON public.clients
                 FOR SELECT TO vision_readonly
                 USING (tenant_id = current_setting('vision.tenant_id', true));
              GRANT USAGE ON SCHEMA public TO vision_readonly;
              GRANT SELECT ON public.clients TO vision_readonly;""")
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), StorageHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.api = f"http://127.0.0.1:{cls.server.server_port}"
        cls.workspace = tempfile.TemporaryDirectory(prefix="vision-fixture-")
        cls.root = Path(cls.workspace.name)
        cls.identity = cls.root / "age-key.txt"
        run("age-keygen", "-o", str(cls.identity))
        cls.recipient = run("age-keygen", "-y", str(cls.identity)).strip()
        cls.settings = {
            "VISION_BACKUP_DATABASE_URL": SOURCE,
            "VISION_BACKUP_SUPABASE_URL": cls.api,
            "VISION_BACKUP_SERVICE_ROLE_KEY": "fictional-key-only",
            "VISION_BACKUP_AGE_RECIPIENT": cls.recipient
        }

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.workspace.cleanup()

    def setUp(self):
        StorageHandler.variant = "normal"

    def test_actual_postgres17_backup_encryption_restore_and_rls(self):
        output = self.root / "actual-database-test.age"
        summary = backup.full_backup(output, self.settings)
        self.assertEqual(summary["storage_objects"], 2)
        self.assertGreater(summary["database_bytes"], 1000)

        decrypted = self.root / "actual-database-test.tar.gz"
        run("age", "-d", "-i", str(self.identity), "-o", str(decrypted), str(output))
        with tarfile.open(decrypted, "r:gz") as archive:
            entries = {m.name: m for m in archive.getmembers()}
            manifest = json.load(archive.extractfile("vision-backup/manifest.json"))
            dump = archive.extractfile("vision-backup/database.dump").read()
            self.assertEqual(hashlib.sha256(dump).hexdigest(), manifest["database"]["sha256"])
            for item in manifest["objects"]:
                p = "vision-backup/storage/" + item["bucket"] + "/" + item["path"]
                payload = archive.extractfile(p).read()
                self.assertEqual(hashlib.sha256(payload).hexdigest(), item["sha256"])
                self.assertEqual(payload, MEDIA[item["path"]])
        dump_path = self.root / "restore.dump"
        dump_path.write_bytes(dump)
        run("createdb", "-h", HOST, "-p", str(PORT), "-U", USER, "vision_restored")
        run("pg_restore", "--exit-on-error", "--no-owner", "--dbname", DESTINATION, str(dump_path))
        for table in ("auth.users", "storage.objects", "public.clients",
                      "public.tv_devices", "public.playlists", "public.playback_events"):
            self.assertEqual(pg("SELECT count(*) FROM " + table, SOURCE),
                             pg("SELECT count(*) FROM " + table, DESTINATION), table)
        self.assertEqual(pg("SELECT sum(count) FROM public.playback_events", DESTINATION), "250")
        self.assertEqual(pg("SELECT count(*) FROM public.clients WHERE name LIKE 'Academia%'", DESTINATION), "1")
        self.assertEqual(pg("SELECT has_table_privilege('vision_readonly','public.clients','SELECT')", DESTINATION), "t")
        self.assertEqual(pg("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.clients'::regclass", DESTINATION), "t")
        self.assertEqual(pg("""SET ROLE vision_readonly; SET vision.tenant_id='tenant_a';
                               SELECT count(*) FROM public.clients;""", DESTINATION).splitlines()[-1], "1")
        self.assertEqual(pg("""SET ROLE vision_readonly; SET vision.tenant_id='tenant_unknown';
                               SELECT count(*) FROM public.clients;""", DESTINATION).splitlines()[-1], "0")
        self.assertEqual(pg("INSERT INTO public.clients (tenant_id,name) VALUES ('tenant_a','nova') RETURNING id", DESTINATION).splitlines()[-1], "3")

    def test_same_count_different_storage_identity_rejected(self):
        StorageHandler.variant = "rename"
        target = self.root / "rename-must-fail.age"
        with self.assertRaisesRegex(ValueError, "unexpected object"):
            backup.full_backup(target, self.settings)
        self.assertFalse(target.exists())

    def test_partial_media_without_length_rejected(self):
        StorageHandler.variant = "short"
        target = self.root / "partial-must-fail.age"
        with self.assertRaisesRegex(ValueError, "trusted source size"):
            backup.full_backup(target, self.settings)
        self.assertFalse(target.exists())

if __name__ == "__main__":
    unittest.main(verbosity=2)
