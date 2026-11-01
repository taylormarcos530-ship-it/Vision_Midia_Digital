"""External encrypted segment artifact; run on disposable PG17 only.

Two DIFFERENT GitHub-hosted jobs exchange an archive artifact and an explicitly
test-only 32-byte key artifact (separate artifact, NEVER suitable for production).
Archives and manifests contain ONLY synthetic records. All original rows remain.
"""
from __future__ import annotations
import argparse
import base64
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import time
import uuid
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import psycopg

HERE=Path(__file__).resolve().parent
VERIFY=HERE.parent/"exact-rpc-qa"/"verify.py"
SPEC=importlib.util.spec_from_file_location("vision_v2_exact_rpc_verify",VERIFY)
v=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(v)
TABLES=["public.companies","public.devices","public.campaigns",
        "public.playlists","public.media_assets","private.memberships",
        "public.playback_logs","qa_rpc.pending_without_time"]
FIELDS=list(v.COLUMNS)
DAY_RANGES=[(v.DAYS[0],v.DAYS[0]),(v.DAYS[1],v.DAYS[1]),
            (v.DAYS[2],v.DAYS[2]),(v.DAYS[0],v.DAYS[1]),
            (v.DAYS[0],v.DAYS[2]),(v.DAYS[1],v.DAYS[2])]
SEG_MAX=120
FORMAT="VISION_V2_AEAD_EXTERNAL_SEGMENT_QA_1"

def canonical(x):return json.dumps(x,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False,default=str).encode()
def digest(x):return hashlib.sha256(x).hexdigest()
def bench_queries():
    """Snapshot exact RPC JSON and export outputs for two companies."""
    report=[]
    with v.con() as c:
        for i,company in enumerate(v.COMPANIES):
            who=v.decode(v.token(company,v.USER_IDS[i]))
            for begin,end in DAY_RANGES:
                filters=[(None,None),(v.uid(company,"campaign",0),None),
                    (None,v.uid(company,"tv",0)),
                    (v.uid(company,"campaign",1),v.uid(company,"tv",1))]
                for camp,dev in filters:
                    with c.transaction():
                        v.auth(c,who)
                        obj=v.rpc(c,"get_playback_report",company,begin,end,camp,dev)
                        export=v.export(c,"get_playback_events",company,begin,end,
                                        camp,dev,limit=1000,offset=0)
                        report.append({"company":str(company),"start":begin.isoformat(),
                        "end":end.isoformat(),"campaign":str(camp) if camp else None,
                        "device":str(dev) if dev else None,
                        "report":obj,"export":[list(a) for a in export]})
    assert len(report)==48
    return report

def get_source():
    with v.con() as c:
        result={}
        for table in TABLES:
            # Simplicity: fully generic source table schema mirrored on restore.
            cols=[x[0] for x in c.execute("""SELECT column_name FROM information_schema.columns
                       WHERE table_schema=%s AND table_name=%s
                       ORDER BY ordinal_position""",table.split(".")).fetchall()]
            data=c.execute(f"SELECT {', '.join(cols)} FROM {table}").fetchall()
            result[table]={"cols":cols,"rows":[[val if isinstance(val,(str,int,float,bool)) or val is None
                         else val.isoformat() if hasattr(val,"isoformat") else str(val)
                         for val in row] for row in data]}
        assert len(result["public.playback_logs"]["rows"])==664
        return result

def encrypt_segment(key,identifier,obj):
    plain=canonical({"descriptor":identifier,"payload":obj})
    nonce=secrets.token_bytes(12)
    aad=canonical(identifier)
    ciphertext=AESGCM(key).encrypt(nonce,plain,aad)
    envelope=canonical({"format":FORMAT,"nonce":base64.b64encode(nonce).decode(),
                        "ciphertext":base64.b64encode(ciphertext).decode()})
    return plain,envelope

def decrypt_segment(key,identifier,envelope,expected):
    if not hmac_equal(digest(envelope),expected["cipher_sha256"]):
        raise ValueError("ciphertext_sha256_mismatch")
    data=json.loads(envelope)
    if data.get("format")!=FORMAT:raise ValueError("wrong_format")
    nonce=base64.b64decode(data["nonce"],validate=True)
    ciphertext=base64.b64decode(data["ciphertext"],validate=True)
    if len(nonce)!=12:raise ValueError("bad_nonce")
    plain=AESGCM(key).decrypt(nonce,ciphertext,canonical(identifier))
    if not hmac_equal(digest(plain),expected["plain_sha256"]):
        raise ValueError("plaintext_sha256_mismatch")
    parsed=json.loads(plain)
    if parsed.get("descriptor")!=identifier:raise ValueError("descriptor_mismatch")
    if len(parsed["payload"]["rows"])!=expected["row_count"]:
        raise ValueError("count_mismatch")
    return parsed["payload"]

def hmac_equal(a,b):
    import hmac
    return hmac.compare_digest(a,b)

def segments(data,folder,key):
    manifest={"format":FORMAT,"segments":[],"source_rows":len(data["public.playback_logs"]["rows"]),
              "source_tables":list(TABLES)}
    for name,payload in data.items():
        cols,rows=payload["cols"],payload["rows"]
        for off in range(0,max(len(rows),1),SEG_MAX):
            chunk=rows[off:off+SEG_MAX]
            identifier={"table":name,"start":off,"stop":off+len(chunk),
                        "columns":cols,"version":1}
            plain,envelope=encrypt_segment(key,identifier,{"cols":cols,"rows":chunk})
            basename=f"seg-{len(manifest['segments']):03d}.v2qa"
            (folder/basename).write_bytes(envelope)
            manifest["segments"].append({
                "file":basename,"descriptor":identifier,
                "row_count":len(chunk),"plain_sha256":digest(plain),
                "cipher_sha256":digest(envelope),
                "cipher_bytes":len(envelope),"plain_bytes":len(plain)})
    return manifest

def obj_stats():
    with v.con() as c:
        return {"source_table_bytes":int(v.scalar(c,"SELECT pg_total_relation_size('public.playback_logs')")),
        "source_index_bytes":int(v.scalar(c,"SELECT pg_indexes_size('public.playback_logs')")),
        "read_model_table_bytes":int(v.scalar(c,"SELECT pg_total_relation_size('qa_rpc.read_events')")),
        "read_model_index_bytes":int(v.scalar(c,"SELECT pg_indexes_size('qa_rpc.read_events')")),
        "daily_table_bytes":int(v.scalar(c,"SELECT pg_total_relation_size('qa_rpc.daily')")),
        "daily_index_bytes":int(v.scalar(c,"SELECT pg_indexes_size('qa_rpc.daily')")),
        "database_bytes":int(v.scalar(c,"SELECT pg_database_size(current_database())"))}

def producer(root,secret):
    root.mkdir(parents=True,exist_ok=True)
    secret.mkdir(parents=True,exist_ok=True)
    v.bootstrap()
    v.fixture()
    source_rows=int(v.scalar(v.con(),"SELECT count(*) FROM public.playback_logs"))
    # Atomic projector failure and full restore checks from previous QA,
    # then create separate read model and daily rollup.
    v.injection_and_restore()
    baseline=bench_queries()
    source=get_source()
    key=secrets.token_bytes(32)
    keyfile=secret/"synthetic-only-aes256.key"
    keyfile.write_bytes(key)
    os.chmod(keyfile,0o600)
    manifest=segments(source,root,key)
    baseline_bytes=canonical(baseline)
    (root/"baseline.json").write_bytes(baseline_bytes)
    manifest["baseline_sha256"]=digest(baseline_bytes)
    manifest["source_stats"]=obj_stats()
    (root/"manifest.json").write_bytes(canonical(manifest))
    assert int(v.scalar(v.con(),"SELECT count(*) FROM public.playback_logs"))==source_rows==664
    print("QA_ARCHIVE_PRODUCER_JSON="+canonical({"result":"PASS",
       "original_rows_unchanged":source_rows,
       "segments":len(manifest["segments"]),
       "encrypted_archive_bytes":sum(x["cipher_bytes"] for x in manifest["segments"]),
       "plaintext_bytes":sum(x["plain_bytes"] for x in manifest["segments"]),
       "key_published_in_logs":False,"originals_deleted":False,
       "baseline_report_queries":len(baseline),
       "source_stats":manifest["source_stats"]}).decode(),flush=True)

def negative_archive_tests(root,manifest,key):
    entries=manifest["segments"]
    first=entries[0]
    file=root/first["file"]
    original=file.read_bytes()
    def should_reject(fn,case):
        try:fn()
        except Exception:
            return
        raise AssertionError("archive_failure_not_detected_"+case)
    def read_file():
        return decrypt_segment(key,first["descriptor"],file.read_bytes(),first)
    file.rename(file.with_suffix(".temporarily-offline"))
    try:should_reject(read_file,"missing_file")
    finally:file.with_suffix(".temporarily-offline").rename(file)
    tampered=bytearray(original);tampered[len(tampered)//2]^=8
    file.write_bytes(tampered)
    try:should_reject(read_file,"altered_ciphertext")
    finally:file.write_bytes(original)
    file.write_bytes(original[:len(original)//2])
    try:should_reject(read_file,"truncated_file")
    finally:file.write_bytes(original)
    should_reject(lambda:decrypt_segment(secrets.token_bytes(32),first["descriptor"],original,first),
                  "wrong_key")
    assert read_file()["rows"] is not None
    return {"result":"PASS","unavailable":True,"tamper":True,
            "truncated":True,"wrong_key":True,"recovered_from_outage":True}

def collect_verified(root,manifest,key):
    restored={}
    for seg in manifest["segments"]:
        file=root/seg["file"]
        if not file.is_file():raise FileNotFoundError(file.name)
        item=decrypt_segment(key,seg["descriptor"],file.read_bytes(),seg)
        name=seg["descriptor"]["table"]
        if name not in restored:restored[name]={"cols":item["cols"],"rows":[]}
        if restored[name]["cols"]!=item["cols"]:raise ValueError("columns_change")
        if len(restored[name]["rows"])!=seg["descriptor"]["start"]:
            raise ValueError("missing_out_of_order_segment")
        restored[name]["rows"].extend(item["rows"])
    if len(restored["public.playback_logs"]["rows"])!=664:
        raise ValueError("missing_playback_rows")
    return restored

def typed(col,value):
    if value is None:return None
    if col in {"id","company_id","device_id","campaign_id","playlist_id","media_id"}:
        return uuid.UUID(value)
    if col in {"started_at","ended_at","received_at"}:
        return datetime.fromisoformat(value)
    if col=="duration_seconds":
        return Decimal(value)
    return value

def restore_db(data):
    with v.con() as c:
        with c.transaction():
            for name in TABLES:
                item=data[name]
                cols=item["cols"]
                rows=[[typed(c,v) for c,v in zip(cols,r)] for r in item["rows"]]
                if rows:
                    sql=f"INSERT INTO {name} ({', '.join(cols)}) VALUES ({', '.join(['%s']*len(cols))})"
                    c.cursor().executemany(sql,rows)
        assert int(v.scalar(c,"SELECT count(*) FROM public.playback_logs"))==664
        assert int(v.scalar(c,"SELECT count(*) FROM qa_rpc.pending_without_time"))==2

def compare_to_reference(ref):
    comparisons=0
    lat_source=[];lat_read=[]
    with v.con() as c:
        for row in ref:
            company=uuid.UUID(row["company"])
            index=v.COMPANIES.index(company)
            who=v.decode(v.token(company,v.USER_IDS[index]))
            start=date.fromisoformat(row["start"])
            end=date.fromisoformat(row["end"])
            camp=uuid.UUID(row["campaign"]) if row["campaign"] else None
            dev=uuid.UUID(row["device"]) if row["device"] else None
            with c.transaction():
                v.auth(c,who)
                t=time.perf_counter()
                original=v.rpc(c,"get_playback_report",company,start,end,camp,dev)
                lat_source.append((time.perf_counter()-t)*1000)
                t=time.perf_counter()
                cqrs=v.rpc(c,"get_playback_report_cqrs",company,start,end,camp,dev)
                lat_read.append((time.perf_counter()-t)*1000)
                assert canonical(original)==canonical(row["report"])==canonical(cqrs)
                raw=v.export(c,"get_playback_events",company,start,end,camp,dev,
                             limit=1000,offset=0)
                qc=v.export(c,"get_playback_events_cqrs",company,start,end,camp,dev,
                            limit=1000,offset=0)
                assert canonical([list(x) for x in raw])==canonical(row["export"])==canonical([list(x) for x in qc])
                comparisons+=1
    def percentile(xs,p):
        import math
        z=sorted(xs)
        return round(z[max(0,math.ceil(p*len(z))-1)],3)
    return {"result":"PASS","full_json_equal":comparisons,"export_equal":comparisons,
            "raw_report_p95_ms":percentile(lat_source,.95),
            "cqrs_report_p95_ms":percentile(lat_read,.95),
            "raw_report_median_ms":round(sorted(lat_source)[len(lat_source)//2],3),
            "cqrs_report_median_ms":round(sorted(lat_read)[len(lat_read)//2],3)}

def consumer(root,secret):
    manifest=json.loads((root/"manifest.json").read_bytes())
    key=(secret/"synthetic-only-aes256.key").read_bytes()
    assert len(key)==32
    ref_bytes=(root/"baseline.json").read_bytes()
    if digest(ref_bytes)!=manifest["baseline_sha256"]:raise ValueError("tampered_baseline")
    negative=negative_archive_tests(root,manifest,key)
    # No partial ACK: decode/verify ENTIRE manifest before any INSERT.
    data=collect_verified(root,manifest,key)
    v.bootstrap()
    restore_db(data)
    # ACK is only after all objects authenticated and DB commit succeeds.
    with v.con() as c:
        c.execute("""CREATE TABLE qa_rpc.archive_ack(
          id text PRIMARY KEY, segments integer NOT NULL, rows bigint NOT NULL,
          manifest_hash text NOT NULL)""")
        record=(digest(canonical(manifest)),len(manifest["segments"]),664)
        c.execute("""INSERT INTO qa_rpc.archive_ack VALUES(%s,%s,%s,%s)""",
                  ("archive-qa-1",record[1],record[2],record[0]))
        # Replayed identical archive must not advance ACK or duplicate a row.
        retry=collect_verified(root,manifest,key)
        assert len(retry["public.playback_logs"]["rows"])==664
        c.execute("""INSERT INTO qa_rpc.archive_ack VALUES(%s,%s,%s,%s)
                     ON CONFLICT(id) DO NOTHING""",
                  ("archive-qa-1",record[1],record[2],record[0]))
        assert int(v.scalar(c,"SELECT count(*) FROM qa_rpc.archive_ack"))==1
    # QA read projection and daily CQRS, keeping all source records.
    v.fill_projector()
    parity=compare_to_reference(json.loads(ref_bytes))
    after=obj_stats()
    before=manifest["source_stats"]
    assert before["source_table_bytes"]>0 and after["source_table_bytes"]>0
    assert int(v.scalar(v.con(),"SELECT count(*) FROM public.playback_logs"))==664
    result={"result":"PASS","independent_runner":True,
        "archive_sha256_by_segment":True,"negative_tests":negative,
        "external_archive_bytes":sum(x["cipher_bytes"] for x in manifest["segments"]),
        "segments":len(manifest["segments"]),"original_rows_retained":664,
        "archive_ack_once":True,"retry_no_duplicate":True,
        "baseline":before,"restored":after,"parity":parity,
        "storage_not_reduced_without_raw_retention":True}
    print("QA_ARCHIVE_INDEPENDENT_RESTORE_JSON="+canonical(result).decode(),flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=["producer","consumer"],required=True)
    p.add_argument("--archive",type=Path,required=True)
    p.add_argument("--key-dir",type=Path,required=True)
    a=p.parse_args()
    if a.mode=="producer":producer(a.archive,a.key_dir)
    else:consumer(a.archive,a.key_dir)
