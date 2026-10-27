#!/usr/bin/env python3
"""Offline verification of a Vision .age archive. Does not access Supabase or Drive."""
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

PROJECT_REF = "fpadgedrgcxrrqflzhjt"
ARCHIVE_ROOT = "vision-backup/"
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")

def _valid_relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError("Invalid backup archive path")
    parts = value.split("/")
    if any(p in ("", ".", "..") for p in parts):
        raise ValueError("Backup archive contains unsafe path component")
    return value

def _as_int(value, description):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(description + " is not a valid length")
    return value

def _as_sha(value, description):
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ValueError(description + " is not a SHA-256 digest")
    return value

def _verify_file(archive, member, size, sha256):
    with archive.extractfile(member) as fh:
        digest = hashlib.sha256()
        total = 0
        while True:
            data = fh.read(1024 * 1024)
            if not data:
                break
            total += len(data)
            if total > size:
                raise ValueError("Backup member exceeds declared size")
            digest.update(data)
    if total != size or digest.hexdigest() != sha256:
        raise ValueError("Backup file size or checksum differs from signed-in-archive manifest")

def verify_archive(encrypted, identity):
    encrypted = Path(encrypted).resolve()
    identity = Path(identity).resolve()
    if not encrypted.is_file() or not identity.is_file():
        raise ValueError("Missing encrypted archive or private identity file")
    if encrypted == identity:
        raise ValueError("Backup and key must not be the same file")
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="vision-verify-") as scratch:
        plaintext = Path(scratch) / "decrypted.tar.gz"
        result = subprocess.run(
            ["age", "--decrypt", "--identity", str(identity), "--output", str(plaintext), str(encrypted)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=False)
        if result.returncode:
            raise ValueError("Could not decrypt the backup with this identity or the ciphertext is damaged")
        with tarfile.open(plaintext, "r:gz") as tar:
            files = {}
            for member in tar.getmembers():
                if member.isdir():
                    continue
                if not member.isfile():
                    raise ValueError("Archive contains forbidden nonregular entries")
                _valid_relative(member.name)
                if not member.name.startswith(ARCHIVE_ROOT):
                    raise ValueError("Archive contains unexpected root")
                if member.name in files:
                    raise ValueError("Archive contains duplicate file paths")
                files[member.name] = member
            name = ARCHIVE_ROOT + "manifest.json"
            if name not in files:
                raise ValueError("Missing encrypted backup manifest")
            manifest_size = files[name].size
            if manifest_size < 2 or manifest_size > 16 * 1024 * 1024:
                raise ValueError("Backup manifest is missing or implausibly large")
            manifest = json.loads(tar.extractfile(files[name]).read())
            if manifest.get("project_ref") != PROJECT_REF or manifest.get("kind") != "read_only_encrypted_disaster_backup":
                raise ValueError("Not a Vision encrypted disaster backup")
            db = manifest.get("database")
            if not isinstance(db, dict):
                raise ValueError("Database manifest invalid")
            db_name = ARCHIVE_ROOT + "database.dump"
            if db_name not in files:
                raise ValueError("Database dump missing from encrypted archive")
            db_bytes = _as_int(db.get("bytes"), "Database size")
            db_sha = _as_sha(db.get("sha256"), "Database SHA-256")
            _verify_file(tar, files[db_name], db_bytes, db_sha)
            objects = manifest.get("objects")
            if not isinstance(objects, list):
                raise ValueError("Storage manifest invalid")
            expected = {name, db_name}
            for item in objects:
                if not isinstance(item, dict):
                    raise ValueError("Storage item is not an object")
                bucket = _valid_relative(item.get("bucket"))
                if "/" in bucket:
                    raise ValueError("Storage bucket invalid")
                path = _valid_relative(item.get("path"))
                obj_name = ARCHIVE_ROOT + "storage/" + bucket + "/" + path
                if obj_name in expected:
                    raise ValueError("Duplicated Storage object")
                expected.add(obj_name)
                if obj_name not in files:
                    raise ValueError("Storage media missing from encrypted archive")
                _verify_file(tar, files[obj_name], _as_int(item.get("bytes"), "Media size"),
                             _as_sha(item.get("sha256"), "Media SHA-256"))
            if set(files) != expected:
                raise ValueError("Archive contains missing or unrecognized files")
            return {"status": "PASS", "database_bytes": db_bytes, "media_files": len(objects),
                    "verified_entries": len(expected)}

def main():
    parser = argparse.ArgumentParser(description="Verify .age backup without contacting production")
    parser.add_argument("--backup", required=True, help="Encrypted Vision backup .age")
    parser.add_argument("--identity", required=True, help="Private age identity file, stored offline")
    args = parser.parse_args()
    if not args.backup.endswith(".age"):
        parser.error("Expected encrypted .age archive")
    result = verify_archive(args.backup, args.identity)
    print(json.dumps(result))

if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, tarfile.TarError, json.JSONDecodeError) as exc:
        print("VERIFY FAIL: " + str(exc), file=sys.stderr)
        sys.exit(1)
