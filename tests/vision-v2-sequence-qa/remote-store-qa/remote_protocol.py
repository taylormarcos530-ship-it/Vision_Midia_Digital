"""Client protocol to disposable independent Docker HTTP object-store.

QA boundaries: PostgreSQL 17 disposable, no source deletes, no ACK advancement,
storage API over loopback, ephemeral per-run AES key and authorization tokens.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import tempfile
import urllib.error
import urllib.request

import psycopg
from archive_replay import (descriptor,encrypt_segment,load_verified_segment,
                            restore_to_separate_sqlite)
from server import (DSN, Reject,hash_token,event_hash,validate_event)

ROOT=os.environ["V2_OBJECTSTORE_BASE_URL"].rstrip("/")
TOKEN=os.environ["QA_STORE_TOKEN"]
ADMIN=os.environ["QA_STORE_ADMIN_TOKEN"]
SIGN_KEY=bytes.fromhex(os.environ["QA_STORE_RECEIPT_KEY_HEX"])
AES_KEY=bytes.fromhex(os.environ["VISION_V2_QA_ARCHIVE_KEY_HEX"])
assert len(SIGN_KEY)==32 and len(AES_KEY)==32

def sha(data):return hashlib.sha256(data).hexdigest()
def body(obj):return json.dumps(obj,sort_keys=True,separators=(",",":")).encode()

class StorageOffline(Exception):pass

def request(method,route,data=None,admin=False):
    raw=body(data) if isinstance(data,dict) else data
    req=urllib.request.Request(ROOT+route,data=raw,method=method,
        headers={"Authorization":"Bearer "+(ADMIN if admin else TOKEN),
                 "Content-Type":"application/octet-stream"})
    try:
        with urllib.request.urlopen(req,timeout=4) as resp:
            response=resp.read()
            if route.startswith("/objects/") and method=="GET":
                return resp.status,response
            return resp.status,json.loads(response)
    except urllib.error.HTTPError as err:
        payload=json.loads(err.read())
        return err.code,payload
    except (urllib.error.URLError,TimeoutError,OSError) as err:
        raise StorageOffline("independent_store_unreachable") from err

def get(name):
    return request("GET","/objects/"+name)

def control(mode):
    status,data=request("POST","/_qa/control",{"mode":mode},admin=True)
    assert status==200,(status,data)

def validate_receipt(receipt,name,payload):
    expected={"name":name,"sha256":sha(payload),"bytes":len(payload),"durable":True}
    if not all(receipt.get(k)==v for k,v in expected.items()):
        raise ValueError("invalid_durable_receipt")
    signature=hmac.new(SIGN_KEY,
        f"{name}\n{expected['sha256']}\n{expected['bytes']}".encode(),
        hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature,receipt.get("mac","")):
        raise ValueError("untrusted_durable_receipt")

def original_rows(device,first,last):
    if not (0<first<=last and last-first+1<=100):
        raise ValueError("segment_range")
    with psycopg.connect(DSN) as db:
        if db.execute("SELECT current_database()").fetchone()[0]!="vision_v2_quarantine_disposable":
            raise RuntimeError("non_disposable_database")
        dev=db.execute("""SELECT company_id,stream_id,watermark
            FROM v2_quarantine_qa.devices WHERE device_id=%s""",(device,)).fetchone()
        if not dev or dev[2]<last:
            raise ValueError("unconfirmed_archive_segment")
        rows=db.execute("""SELECT sequence,event_id,media_id,boot_id,mono_ms,
                   seconds,completed,payload_sha256
            FROM v2_quarantine_qa.receipts WHERE device_id=%s AND stream_id=%s
            AND sequence BETWEEN %s AND %s ORDER BY sequence""",
            (device,dev[1],first,last)).fetchall()
    if len(rows)!=last-first+1 or any(row[0]!=first+i for i,row in enumerate(rows)):
        raise ValueError("missing_original_proof")
    return dev[0],dev[1],rows

def validate_download(data,record,expected=None):
    # Record format: company/device/stream/first/last/count/name/blobsha/plainsha/keyid
    if sha(data)!=record[7]:
        raise ValueError("remote_cipher_sha_mismatch")
    with tempfile.TemporaryDirectory(prefix="vision-v2-qa-remote-verify-") as td:
        p=Path(td)/record[6]
        p.write_bytes(data)
        entries=load_verified_segment(td,AES_KEY,record)
    if expected is not None and entries!=expected:
        raise ValueError("remote_contents_do_not_match_original_hashes")
    return entries

def export_remote_segment(device,first,last):
    company,stream,rows=original_rows(device,first,last)
    ident=descriptor(company,device,stream,first,last)
    blob,plain_sha=encrypt_segment(rows,ident,AES_KEY)
    name=f"{device}-{stream}-{first:06}-{last:06}.v2qa"
    status,remote=get(name)
    if status==404:
        status,receipt=request("PUT","/objects/"+name,blob)
        if status not in (200,201):
            raise StorageOffline("durable_upload_not_confirmed")
        validate_receipt(receipt,name,blob)
        status,remote=get(name)
    if status!=200:
        raise StorageOffline("remote_object_cannot_be_read_back")
    # Existing object can differ in ciphertext nonce but must match plaintext.
    expected={r[0]:r[-1] for r in rows}
    record=(company,device,stream,first,last,len(rows),name,sha(remote),
            plain_sha,"qa-ephemeral-v1")
    validate_download(remote,record,expected)
    # No manifest without a successful GET/verification of remote bytes.
    with psycopg.connect(DSN) as db:
        db.execute("""INSERT INTO v2_replay_qa.segment_manifests
            (company_id,device_id,stream_id,seq_first,seq_last,event_count,
             blob_basename,blob_sha256,plain_sha256,key_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",record)
    return {"name":name,"encrypted_bytes":len(remote),
            "plain_sha256":plain_sha,"cipher_sha256":sha(remote)}

def fetch_verified_manifest(manifest):
    code,content=get(manifest[6])
    if code!=200:
        raise StorageOffline("remote_archive_unavailable")
    return validate_download(content,manifest)

def restore_remote(manifest,path):
    code,content=get(manifest[6])
    if code!=200:raise StorageOffline("no_verified_remote_restore")
    validate_download(content,manifest)
    with tempfile.TemporaryDirectory(prefix="vision-v2-qa-remote-restore-") as td:
        (Path(td)/manifest[6]).write_bytes(content)
        return restore_to_separate_sqlite(td,AES_KEY,manifest,path)

def replay_remote_only(payload,token):
    # This routine is intentionally read-only and uses the metadata-only DB role.
    if not isinstance(payload,dict) or set(payload)!={"device_id","stream_id","events"}:
        raise Reject("invalid_body",400)
    device,stream,events=payload["device_id"],payload["stream_id"],payload["events"]
    if not isinstance(events,list) or not 1<=len(events)<=50:
        raise Reject("invalid_batch",400)
    if not isinstance(token,str) or not 16<=len(token)<=256:
        raise Reject("unauthorized",401)
    prev=0
    for e in events:
        validate_event(e)
        if e["sequence"]<=prev:raise Reject("unordered_batch",400)
        prev=e["sequence"]
    with psycopg.connect(DSN) as db:
      with db.transaction():
        db.execute("SET LOCAL ROLE v2_archive_reader_qa")
        d=db.execute("""SELECT company_id,stream_id,watermark,token_sha256
            FROM v2_quarantine_qa.devices WHERE device_id=%s""",(device,)).fetchone()
        if not d or d[1]!=stream or not hmac.compare_digest(d[3],hash_token(token)):
            raise Reject("unauthorized",401)
        company,_,watermark,_=d
        if events[-1]["sequence"]>watermark:
            raise Reject("unconfirmed_sequence_no_ack",409)
        loaded={}
        for e in events:
            seq=e["sequence"]
            manifest=db.execute("""SELECT company_id,device_id,stream_id,seq_first,
                   seq_last,event_count,blob_basename,blob_sha256,plain_sha256,key_id
              FROM v2_replay_qa.segment_manifests
              WHERE device_id=%s AND stream_id=%s
                AND seq_first<=%s AND seq_last>=%s""",
              (device,stream,seq,seq)).fetchone()
            if not manifest or manifest[0]!=company:
                raise Reject("manifest_missing_no_ack",503)
            identity=(manifest[3],manifest[4])
            if identity not in loaded:
                try:loaded[identity]=fetch_verified_manifest(manifest)
                except Exception:raise Reject("remote_unverified_no_ack",503)
            if not hmac.compare_digest(loaded[identity].get(seq,""),event_hash(e)):
                raise Reject("replay_payload_conflict",409)
        return {"ack":watermark,"accepted":0,"duplicates":len(events),
                "billable":0,"archive_remote_verified":True}
