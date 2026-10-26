#!/usr/bin/env python3
"""Vision off-site backup foundation. READ ONLY; outputs an age-encrypted archive locally.

Requires PostgreSQL 17 client binaries, Python 3.11+, and age CLI. Never writes
raw credentials, SQL dumps, or media to a git repository or an online artifact.
The operator must hold the age PRIVATE key in a separate, secure location.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

PROJECT_REF = "fpadgedrgcxrrqflzhjt"

def require_environment():
    names = ("VISION_BACKUP_DATABASE_URL", "VISION_BACKUP_SUPABASE_URL",
             "VISION_BACKUP_SERVICE_ROLE_KEY", "VISION_BACKUP_AGE_RECIPIENT")
    values = {key: os.environ.get(key, "").strip() for key in names}
    missing = [key for key, value in values.items() if not value]
    if missing:
        raise ValueError("Missing environment variables: " + ", ".join(missing))
    host = urlsplit(values["VISION_BACKUP_SUPABASE_URL"]).hostname
    if host != PROJECT_REF + ".supabase.co":
        raise ValueError("Supabase endpoint does not match the authorized Vision project")
    if not values["VISION_BACKUP_DATABASE_URL"].startswith(("postgres://", "postgresql://")):
        raise ValueError("Expected PostgreSQL connection URL")
    db_host = urlsplit(values["VISION_BACKUP_DATABASE_URL"]).hostname or ""
    if db_host != "db." + PROJECT_REF + ".supabase.co" and not db_host.endswith(".pooler.supabase.com"):
        raise ValueError("Unexpected database hostname; check the Vision database connection")
    if not re.fullmatch(r"age1[0-9a-z]{50,}", values["VISION_BACKUP_AGE_RECIPIENT"]):
        raise ValueError("Expected an age X25519 recipient PUBLIC key")
    return values

def safe_segment(name):
    if not isinstance(name, str) or not name or name in (".", "..") or "/" in name or "\\" in name or "\x00" in name:
        raise ValueError("Unsafe storage object name")
    return name

def request_json(api_base, key, endpoint, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Authorization": "Bearer " + key, "apikey": key}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = Request(api_base + endpoint, data=data, headers=headers,
                  method="POST" if data is not None else "GET")
    with urlopen(req, timeout=65) as response:
        return json.load(response)

def storage_objects(api_base, key, bucket, prefix=""):
    # Supabase Storage represents folders with null id/metadata; walk each path.
    offset = 0
    while True:
        rows = request_json(api_base, key, "/storage/v1/object/list/" + quote(bucket, safe=""),
                            {"prefix": prefix, "limit": 100, "offset": offset,
                             "sortBy": {"column": "name", "order": "asc"}})
        if not isinstance(rows, list):
            raise ValueError("Storage API returned a non-list response")
        for row in rows:
            name = safe_segment(row.get("name"))
            if row.get("id") is None and row.get("metadata") is None:
                yield from storage_objects(api_base, key, bucket, prefix + name + "/")
            else:
                yield prefix + name
        offset += len(rows)
        if len(rows) < 100:
            break

def download_object(api_base, key, bucket, object_path, destination):
    endpoint = "/storage/v1/object/authenticated/" + quote(bucket, safe="") + "/" + quote(object_path, safe="/")
    req = Request(api_base + endpoint, headers={"Authorization": "Bearer " + key, "apikey": key})
    sha = hashlib.sha256()
    length = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(req, timeout=120) as response, destination.open("xb") as output:
        if not (200 <= response.status < 300):
            raise ValueError("Storage download rejected")
        while True:
            data = response.read(256 * 1024)
            if not data:
                break
            sha.update(data)
            output.write(data)
            length += len(data)
        expected = response.headers.get("Content-Length")
        if expected is not None and int(expected) != length:
            raise ValueError("Media download truncated")
    return {"bytes": length, "sha256": sha.hexdigest()}

def verify_command(cmd, stdout=None):
    # Never print arguments: the database URL can contain a password.
    result = subprocess.run(cmd, stdout=stdout if stdout is not None else subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        raise RuntimeError("Backup command failed. Check connection, installed tools and permissions privately.")
    return result.stdout

def full_backup(destination, settings):
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise FileExistsError("Refusing to overwrite existing backup")
    with tempfile.TemporaryDirectory(prefix="vision-secure-backup-") as tmp:
        scratch = Path(tmp)
        root = scratch / "archive"
        root.mkdir(mode=0o700)
        dump = root / "database.dump"
        verify_command(["pg_dump", "-Fc", "--no-owner", "--no-acl",
                        "-f", str(dump), "-d", settings["VISION_BACKUP_DATABASE_URL"]])
        listing = verify_command(["pg_restore", "-l", str(dump)]).decode("utf-8", "replace")
        if not dump.stat().st_size or "TABLE DATA" not in listing or "auth users" not in listing:
            raise ValueError("Database archive verification failed: table data or auth users missing")

        base = settings["VISION_BACKUP_SUPABASE_URL"].rstrip("/")
        secret = settings["VISION_BACKUP_SERVICE_ROLE_KEY"]
        buckets = request_json(base, secret, "/storage/v1/bucket")
        if not isinstance(buckets, list):
            raise ValueError("Storage bucket enumeration failed")
        manifest = {"project_ref": PROJECT_REF, "kind": "read_only_encrypted_disaster_backup",
                    "captured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "database": {"bytes": dump.stat().st_size,
                                 "sha256": hashlib.file_digest(dump.open("rb"), "sha256").hexdigest()},
                    "objects": []}
        for bucket_row in buckets:
            bucket = safe_segment(bucket_row["id"])
            for object_path in storage_objects(base, secret, bucket):
                components = [safe_segment(c) for c in PurePosixPath(object_path).parts]
                local_file = root / "storage" / bucket
                for part in components:
                    local_file = local_file / part
                item = download_object(base, secret, bucket, object_path, local_file)
                manifest["objects"].append({"bucket": bucket, "path": object_path, **item})
                # Limit storage download concurrency to one and avoid bursty traffic.
                time.sleep(0.25)

        # Cross-check row counts; avoids silently incomplete recursive listings.
        raw_count = verify_command(["psql", "-X", "-A", "-t", "-d",
                                    settings["VISION_BACKUP_DATABASE_URL"],
                                    "-c", "SELECT count(*) FROM storage.objects;"])
        database_count = int(raw_count.decode().strip())
        if database_count != len(manifest["objects"]):
            raise ValueError("Storage object count mismatch; aborting incomplete backup")

        (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        plaintext_tar = scratch / "plaintext.tar.gz"
        with tarfile.open(plaintext_tar, "w:gz") as tar:
            tar.add(root, arcname="vision-backup")
        try:
            verify_command(["age", "-r", settings["VISION_BACKUP_AGE_RECIPIENT"],
                            "-o", str(destination), str(plaintext_tar)])
            if destination.stat().st_size < 100:
                raise RuntimeError("Encrypted output is unexpectedly small")
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        # Temporary plaintext backup is automatically removed after encryption.
        return {"database_bytes": manifest["database"]["bytes"],
                "storage_objects": len(manifest["objects"]),
                "encrypted_bytes": destination.stat().st_size}

def main():
    parser = argparse.ArgumentParser(description="Vision read-only encrypted backup")
    parser.add_argument("--output", help="Absolute or relative .age backup output path")
    parser.add_argument("--check", action="store_true", help="Check prerequisites only; do not connect or export")
    args = parser.parse_args()
    if args.check:
        for tool in ("pg_dump", "pg_restore", "psql", "age"):
            p = subprocess.run([tool, "--version"], capture_output=True, check=False)
            if p.returncode:
                raise RuntimeError("Required tool unavailable: " + tool)
        print("Backup tools available. No production data accessed.")
        return
    if not args.output or not str(args.output).endswith(".age"):
        parser.error("Use --output PATH.age (encrypted output required)")
    os.umask(0o077)
    settings = require_environment()
    summary = full_backup(Path(args.output), settings)
    print("Encrypted backup created locally. " + json.dumps(summary))
    print("PRIVATE decryption key must be stored safely outside the project and GitHub.")

if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError) as exc:
        print("Backup NOT completed: " + str(exc), file=sys.stderr)
        sys.exit(1)
