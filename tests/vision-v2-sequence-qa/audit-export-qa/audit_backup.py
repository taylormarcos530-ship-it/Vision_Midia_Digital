"""Vision V2 QA only: authenticated encrypted export of SQLite audit tables.

Does not update the source DB, its ACK, pending receipts, or original records.
Restoration creates an independent audit-only database, never the player DB.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
import sqlite3
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

VERSION = 1
COLUMNS = {
    "audit_proofs": ("seq", "event_id", "media", "completed", "seconds", "boot", "mono", "proof_sha"),
    "audit_reviews": ("id", "seq", "code", "evidence"),
}
SCHEMA = """
CREATE TABLE audit_proofs(seq INTEGER PRIMARY KEY,event_id TEXT NOT NULL,
media TEXT NOT NULL,completed INTEGER NOT NULL,seconds REAL NOT NULL,
boot TEXT NOT NULL,mono INTEGER NOT NULL,proof_sha TEXT NOT NULL);
CREATE TABLE audit_reviews(id INTEGER PRIMARY KEY,seq INTEGER NOT NULL,
code TEXT NOT NULL,evidence TEXT NOT NULL,
FOREIGN KEY(seq) REFERENCES audit_proofs(seq));
CREATE TABLE export_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
"""
def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()

def sha(data: bytes):
    return hashlib.sha256(data).hexdigest()

def key_from_password(password: str, salt: bytes):
    if not isinstance(password, str) or len(password) < 14:
        raise ValueError("qa_password_too_short")
    return Scrypt(salt=salt, length=32, n=2**14, r=8, p=1).derive(password.encode())

def durable_write(path: Path, data: bytes, simulate_no_space=False, simulate_power_loss=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".v2-qa-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            midpoint = max(1, len(data)//2)
            f.write(data[:midpoint])
            if simulate_no_space:
                raise OSError(28, "ENOSPC synthetic injected")
            f.write(data[midpoint:])
            f.flush()
            os.fsync(f.fileno())
        if simulate_power_loss:
            raise RuntimeError("simulated_power_loss_before_rename")
        if path.exists():
            raise FileExistsError("refuse_overwrite_existing_backup")
        os.replace(temp, path)
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try: os.fsync(directory_fd)
            finally: os.close(directory_fd)
        except OSError:
            # Not all test filesystems support fsync(directory). File is already persisted.
            pass
    finally:
        if os.path.exists(temp):
            os.unlink(temp)

def _source_snapshot(source: Path):
    # sqlite backup API takes a coherent point-in-time snapshot while writers
    # may be using WAL. No source schema or row is changed.
    with tempfile.TemporaryDirectory(prefix="vision-v2-audit-snapshot-") as td:
        tmp = Path(td)/"source-snapshot.sqlite"
        src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
            dst.commit()
        finally:
            dst.close()
            src.close()
        snap = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
        try:
            if snap.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("invalid_source_sqlite")
            for table, columns in COLUMNS.items():
                existing = {row[1] for row in snap.execute(f"PRAGMA table_info({table})")}
                if not set(columns).issubset(existing):
                    raise ValueError(f"missing_columns_{table}")
            if not {"ack", "next_seq"}.issubset(
                {row[1] for row in snap.execute("PRAGMA table_info(state)")}):
                raise ValueError("missing_state")
            ack, next_seq = snap.execute("SELECT ack,next_seq FROM state WHERE id=1").fetchone()
            rows = {}
            for table, cols in COLUMNS.items():
                cols_sql = ",".join(cols)
                order = "seq" if table == "audit_proofs" else "id"
                rows[table] = [dict(zip(cols, row)) for row in snap.execute(
                    f"SELECT {cols_sql} FROM {table} ORDER BY {order}")]
            return ack, next_seq, rows
        finally:
            snap.close()

def _manifest(source: Path):
    ack, next_seq, rows = _source_snapshot(source)
    if ack < 0 or next_seq <= ack:
        raise ValueError("invalid_source_watermark")
    proof_seq = {r["seq"] for r in rows["audit_proofs"]}
    if any(r["seq"] not in proof_seq for r in rows["audit_reviews"]):
        raise ValueError("orphan_review")
    entries = {}
    for name, r in rows.items():
        entries[name] = {
            "columns": list(COLUMNS[name]),
            "count": len(r),
            "sha256": sha(canonical(r)),
            "rows": r,
        }
    return {"version": VERSION, "source_ack_readonly": ack,
            "source_next_seq_readonly": next_seq,
            "tables": entries}

def export_audit(source: Path, target: Path, password: str, *, no_space=False, power_loss=False):
    source, target = Path(source), Path(target)
    if not source.is_file():
        raise FileNotFoundError("qa_source_missing")
    manifest = _manifest(source)
    salt, nonce = os.urandom(16), os.urandom(12)
    aes = AESGCM(key_from_password(password, salt))
    plain = canonical(manifest)
    encrypted = aes.encrypt(nonce, plain, b"vision-v2-audit-v1")
    package = {"format": "VISION_V2_AUDIT_AES256_GCM",
               "version": VERSION, "kdf": "scrypt_N16384_r8_p1",
               "salt": base64.b64encode(salt).decode(),
               "nonce": base64.b64encode(nonce).decode(),
               "ciphertext": base64.b64encode(encrypted).decode(),
               "cipher_sha256": sha(encrypted)}
    durable_write(target, canonical(package), no_space, power_loss)
    return {"backup_sha256": sha(target.read_bytes()),
            "counts": {name: v["count"] for name, v in manifest["tables"].items()},
            "source_ack": manifest["source_ack_readonly"]}

def verify_and_decrypt(path: Path, password: str):
    package = json.loads(Path(path).read_bytes())
    if package.get("format") != "VISION_V2_AUDIT_AES256_GCM" or package.get("version") != VERSION:
        raise ValueError("invalid_format")
    if package.get("kdf") != "scrypt_N16384_r8_p1":
        raise ValueError("invalid_kdf")
    salt = base64.b64decode(package["salt"], validate=True)
    nonce = base64.b64decode(package["nonce"], validate=True)
    cipher = base64.b64decode(package["ciphertext"], validate=True)
    if len(salt) != 16 or len(nonce) != 12 or sha(cipher) != package["cipher_sha256"]:
        raise ValueError("invalid_cipher_integrity")
    plain = AESGCM(key_from_password(password, salt)).decrypt(
        nonce, cipher, b"vision-v2-audit-v1")
    manifest = json.loads(plain)
    if manifest.get("version") != VERSION or set(manifest.get("tables", {})) != set(COLUMNS):
        raise ValueError("invalid_manifest")
    for name, cols in COLUMNS.items():
        record = manifest["tables"][name]
        if record.get("columns") != list(cols) or record.get("count") != len(record.get("rows", [])):
            raise ValueError("invalid_table_metadata")
        if record.get("sha256") != sha(canonical(record["rows"])):
            raise ValueError("invalid_table_hash")
    return manifest

def restore_audit_only(backup: Path, target: Path, password: str, *,
                       no_space=False, power_loss=False):
    """Restore only audit material to a NEW DB; never touch the source queue."""
    manifest = verify_and_decrypt(backup, password)
    target = Path(target)
    if target.exists():
        raise FileExistsError("refuse_overwrite_existing_database")
    with tempfile.TemporaryDirectory(prefix="vision-v2-audit-restore-") as td:
        db_path = Path(td)/"recovered.sqlite"
        conn = sqlite3.connect(db_path)
        try:
            conn.executescript(SCHEMA)
            conn.execute("PRAGMA foreign_keys=ON")
            for name, cols in COLUMNS.items():
                placeholders = ",".join(["?"]*len(cols))
                col_sql = ",".join(cols)
                for record in manifest["tables"][name]["rows"]:
                    conn.execute(f"INSERT INTO {name}({col_sql}) VALUES({placeholders})",
                                 tuple(record[k] for k in cols))
            for key in ("source_ack_readonly", "source_next_seq_readonly"):
                conn.execute("INSERT INTO export_metadata(key,value) VALUES(?,?)",
                             (key, str(manifest[key])))
            conn.commit()
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("restore_integrity_failed")
        finally:
            conn.close()
        durable_write(target, db_path.read_bytes(), no_space, power_loss)
    return {name: meta["count"] for name, meta in manifest["tables"].items()}
