"""Vision V2 archive replay - disposable PostgreSQL / loopback only.

Encrypted files live OUTSIDE PostgreSQL in runner temp dir. The replay-only
database role has no SELECT privilege on the original receipts table.
All originals remain present during every test; no DELETE/UPDATE is performed.
Do not use this QA AES key management or HTTP server in production.
"""
from __future__ import annotations
import base64
from decimal import Decimal
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import tempfile
import threading

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import psycopg

from server import DSN, Reject, event_hash, hash_token, validate_event

SEGMENT_MAX=100
MAX_ARCHIVE_FILE=4*1024*1024
FORMAT="VISION_V2_ARCHIVE_AES256GCM_V1"
BASENAME=re.compile(r"^[a-z0-9_-]{5,100}\.v2qa$")
SHA=re.compile(r"^[a-f0-9]{64}$")
EVENT_FIELDS=("sequence","event_id","media_id","boot_id","mono_ms","seconds","completed")

def canonical(obj):
    return json.dumps(obj,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def sqlite_event(row):
    seq,event_id,media_id,boot_id,mono_ms,seconds,completed,digest=row
    if isinstance(seconds,Decimal):
        seconds=int(seconds) if seconds==int(seconds) else float(seconds)
    item={"sequence":seq,"event_id":event_id,"media_id":media_id,
          "boot_id":boot_id,"mono_ms":mono_ms,"seconds":seconds,
          "completed":bool(completed)}
    validate_event(item)
    if not hmac.compare_digest(event_hash(item),digest):
        raise ValueError("source_digest_mismatch")
    return {"event":item,"payload_sha256":digest}

def descriptor(company,device,stream,first,last):
    return {"company_id":company,"device_id":device,"stream_id":stream,
            "seq_first":first,"seq_last":last,"version":1}

def encrypt_segment(source_rows,ident,key):
    assert len(key)==32
    entries=[sqlite_event(row) for row in source_rows]
    raw=canonical({"descriptor":ident,"entries":entries})
    nonce=os.urandom(12)
    ciphertext=AESGCM(key).encrypt(nonce,raw,canonical(ident))
    packed=canonical({"format":FORMAT,"nonce":base64.b64encode(nonce).decode(),
                      "ciphertext":base64.b64encode(ciphertext).decode()})
    return packed,sha(raw)

def write_durable_new(path,data,simulate_disk_full=False,simulate_restart=False):
    if path.exists(): raise FileExistsError("archive_path_already_exists")
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix=".archive-",suffix=".tmp")
    try:
        with os.fdopen(fd,"wb") as out:
            out.write(data[:len(data)//2])
            if simulate_disk_full:
                raise OSError(28,"synthetic ENOSPC before archive commit")
            out.write(data[len(data)//2:])
            out.flush();os.fsync(out.fileno())
        if simulate_restart:
            raise RuntimeError("simulated_restart_before_archive_rename")
        if path.exists(): raise FileExistsError("archive_path_already_exists")
        os.replace(tmp,path)
        directory_fd=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory_fd)
        finally:os.close(directory_fd)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def archive_segment(root, key, device, first, last,
                    simulate_disk_full=False,simulate_restart=False):
    if not (0<first<=last and last-first+1<=SEGMENT_MAX):
        raise ValueError("segment_range")
    with psycopg.connect(DSN,connect_timeout=5) as conn:
        if conn.execute("SELECT current_database()").fetchone()[0]!="vision_v2_quarantine_disposable":
            raise RuntimeError("not_disposable")
        device_info=conn.execute("""SELECT company_id,stream_id,watermark
               FROM v2_quarantine_qa.devices WHERE device_id=%s""",(device,)).fetchone()
        if not device_info or last>device_info[2]:
            raise ValueError("unconfirmed_segment")
        company,stream,watermark=device_info
        rows=conn.execute("""SELECT sequence,event_id,media_id,boot_id,mono_ms,seconds,completed,payload_sha256
               FROM v2_quarantine_qa.receipts
               WHERE device_id=%s AND stream_id=%s AND sequence BETWEEN %s AND %s
               ORDER BY sequence""",(device,stream,first,last)).fetchall()
        if len(rows)!=last-first+1 or any(row[0]!=first+i for i,row in enumerate(rows)):
            raise ValueError("missing_original_receipt")
    ident=descriptor(company,device,stream,first,last)
    blob,plain_sha=encrypt_segment(rows,ident,key)
    name=f"{device}-{stream}-{first:06}-{last:06}.v2qa"
    if not BASENAME.fullmatch(name):
        raise ValueError("invalid_archive_basename")
    root=Path(root)
    root.mkdir(parents=True,exist_ok=True)
    destination=root/name
    write_durable_new(destination,blob,simulate_disk_full,simulate_restart)
    # Durable file is created BEFORE metadata. Metadata failure => orphan,
    # never false success/ACK. No original receipt is removed.
    with psycopg.connect(DSN,connect_timeout=5) as conn:
        conn.execute("""INSERT INTO v2_replay_qa.segment_manifests
            (company_id,device_id,stream_id,seq_first,seq_last,event_count,
             blob_basename,blob_sha256,plain_sha256,key_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'qa-ephemeral-v1')""",
            (company,device,stream,first,last,len(rows),name,sha(blob),plain_sha))
    return {"basename":name,"archive_bytes":len(blob),"count":len(rows),
            "plain_sha256":plain_sha,"blob_sha256":sha(blob)}

def load_verified_segment(root,key,manifest):
    company,device,stream,first,last,count,basename,blob_sha,plain_sha,key_id=manifest
    if key_id!="qa-ephemeral-v1" or not BASENAME.fullmatch(basename):
        raise ValueError("untrusted_manifest")
    if count!=last-first+1 or count<1 or count>SEGMENT_MAX:
        raise ValueError("incorrect_segment_count")
    if not SHA.fullmatch(blob_sha) or not SHA.fullmatch(plain_sha):
        raise ValueError("invalid_archive_hash")
    root=Path(root)
    path=root/basename
    # no directory traversals or symbolic links
    if path.is_symlink() or not path.is_file() or path.stat().st_size>MAX_ARCHIVE_FILE:
        raise FileNotFoundError("encrypted_archive_unavailable")
    raw=path.read_bytes()
    if not hmac.compare_digest(sha(raw),blob_sha):
        raise ValueError("ciphertext_sha256_mismatch")
    package=json.loads(raw)
    if set(package)!={"format","nonce","ciphertext"} or package["format"]!=FORMAT:
        raise ValueError("archive_format_invalid")
    nonce=base64.b64decode(package["nonce"],validate=True)
    cipher=base64.b64decode(package["ciphertext"],validate=True)
    if len(nonce)!=12 or len(cipher)>MAX_ARCHIVE_FILE:
        raise ValueError("archive_cipher_invalid")
    ident=descriptor(company,device,stream,first,last)
    plain=AESGCM(key).decrypt(nonce,cipher,canonical(ident))
    if not hmac.compare_digest(sha(plain),plain_sha):
        raise ValueError("plain_sha256_mismatch")
    doc=json.loads(plain)
    if doc.get("descriptor")!=ident or len(doc.get("entries",[]))!=count:
        raise ValueError("archive_descriptor_invalid")
    entries={}
    for index,entry in enumerate(doc["entries"]):
        if set(entry)!={"event","payload_sha256"}:
            raise ValueError("invalid_archive_event_fields")
        e=entry["event"]
        validate_event(e)
        seq=first+index
        if e["sequence"]!=seq or not hmac.compare_digest(event_hash(e),entry["payload_sha256"]):
            raise ValueError("archive_event_hash_or_sequence_mismatch")
        entries[seq]=entry["payload_sha256"]
    return entries

def restore_to_separate_sqlite(root,key,manifest,output):
    entries=load_verified_segment(root,key,manifest)
    output=Path(output)
    if output.exists(): raise FileExistsError("refuse_existing_restore")
    with tempfile.TemporaryDirectory(prefix="vision-v2-archive-restore-") as tmp:
        intermediate=Path(tmp)/"restored.sqlite"
        db=sqlite3.connect(intermediate)
        try:
            db.execute("CREATE TABLE restored_proofs(sequence INTEGER PRIMARY KEY,sha256 TEXT NOT NULL)")
            db.executemany("INSERT INTO restored_proofs(sequence,sha256) VALUES(?,?)",entries.items())
            db.commit()
            if db.execute("PRAGMA integrity_check").fetchone()[0]!="ok":
                raise ValueError("bad_restore_integrity")
        finally:db.close()
        write_durable_new(output,intermediate.read_bytes())
    return len(entries)

def replay_only(root,key,body,token):
    if not isinstance(body,dict) or set(body)!={"device_id","stream_id","events"}:
        raise Reject("invalid_body",400)
    device,stream,events=body["device_id"],body["stream_id"],body["events"]
    if (not isinstance(device,str) or not isinstance(stream,str) or
        not re.fullmatch(r"[A-Za-z0-9_-]{3,120}",device) or
        not re.fullmatch(r"[A-Za-z0-9_-]{3,120}",stream) or
        not isinstance(events,list) or not 1<=len(events)<=50 or
        not isinstance(token,str) or not 16<=len(token)<=256):
        raise Reject("invalid_body_or_token",400)
    prev=0
    for e in events:
        validate_event(e)
        if e["sequence"]<=prev:raise Reject("unordered_batch",400)
        prev=e["sequence"]
    # Restrict PostgreSQL privileges to metadata-only read; never consult
    # v2_quarantine_qa.receipts even though originals exist in test DB.
    with psycopg.connect(DSN,connect_timeout=5) as conn:
      with conn.transaction():
        conn.execute("SET LOCAL ROLE v2_archive_reader_qa")
        device_state=conn.execute("""SELECT company_id,stream_id,watermark,token_sha256
               FROM v2_quarantine_qa.devices WHERE device_id=%s""",(device,)).fetchone()
        if not device_state or device_state[1]!=stream or not hmac.compare_digest(
             device_state[3],hash_token(token)):
            raise Reject("unauthorized",401)
        company,_,watermark,_=device_state
        if events[-1]["sequence"]>watermark:
            raise Reject("unconfirmed_sequence_no_new_ack",409)
        archives={}
        for e in events:
            seq=e["sequence"]
            row=conn.execute("""SELECT company_id,device_id,stream_id,seq_first,
                       seq_last,event_count,blob_basename,blob_sha256,plain_sha256,key_id
                FROM v2_replay_qa.segment_manifests
                WHERE device_id=%s AND stream_id=%s
                      AND seq_first<=%s AND seq_last>=%s""",
                (device,stream,seq,seq)).fetchone()
            if not row or row[0]!=company:
                raise Reject("archive_unavailable_no_ack",503)
            identity=(row[3],row[4])
            if identity not in archives:
                try:archives[identity]=load_verified_segment(root,key,row)
                except Exception:
                    raise Reject("archive_unverified_no_ack",503)
            previous=archives[identity].get(seq)
            if not previous or not hmac.compare_digest(previous,event_hash(e)):
                raise Reject("conflicting_archived_replay",409)
        ack=watermark
    # No DB mutation is possible for the restricted role.
    return {"ack":ack,"accepted":0,"duplicates":len(events),"billable":0,
            "archive_only":True}

class ArchiveHandler(BaseHTTPRequestHandler):
    root=None
    key=None
    def log_message(self,*args):pass
    def do_POST(self):
        if self.path!="/qa/archive-replay":
            return self.reply(404,{"error":"not_found"})
        try:
            length=int(self.headers.get("Content-Length","-1"))
            if not 0<length<=65536:raise Reject("payload_size",413)
            body=json.loads(self.rfile.read(length))
            reply=replay_only(self.root,self.key,body,self.headers.get("x-device-token",""))
            self.reply(200,reply)
        except Reject as exc:
            self.reply(exc.status,{"error":exc.code})
        except Exception:
            self.reply(503,{"error":"unverified_archive_no_ack"})
    def reply(self,status,data):
        raw=canonical(data)
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

def start_archive_server(root,key):
    class ScopedHandler(ArchiveHandler):
        pass
    ScopedHandler.root=Path(root)
    ScopedHandler.key=key
    server=ThreadingHTTPServer(("127.0.0.1",0),ScopedHandler)
    worker=threading.Thread(target=server.serve_forever,daemon=True)
    worker.start()
    return server,worker
