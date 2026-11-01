"""QA-only compact CQRS + encrypted on-demand archive; no permanent event read-model.

Runner A: 664 source originals -> AES256GCM segments by company+day,
manifest SHA256, report/export reference. Runner B: brand-new PG17 with 664
synthetic originals still preserved; daily CQRS only; HTTP loopback archive;
the original GitHub RPC SQL executes against transaction-local TEMP event rows.
Never DELETE originals. Test-only key via a separate Actions artifact; NO KMS.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import date,datetime
from decimal import Decimal
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
import argparse,base64,hashlib,hmac,importlib.util,json,math,os
from pathlib import Path
import secrets,statistics,threading,time,uuid
from urllib import request,error
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import psycopg

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("v2_exact_verify",HERE.parent/"exact-rpc-qa"/"verify.py")
v=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(v)
FORMAT="VISION_V2_ONDEMAND_AES256GCM_1"
COLS=list(v.COLUMNS)
KEY_FIELDS={"id","company_id","device_id","campaign_id","playlist_id","media_id"}
SEG_MAX=120
WINDOWS=[(v.DAYS[0],v.DAYS[0]),(v.DAYS[1],v.DAYS[1]),
         (v.DAYS[2],v.DAYS[2]),(v.DAYS[0],v.DAYS[1]),(v.DAYS[0],v.DAYS[2]),
         (v.DAYS[1],v.DAYS[2])]
def canon(x):return json.dumps(x,sort_keys=True,separators=(",",":"),default=str,ensure_ascii=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def metric(c):
    q=lambda name: int(v.scalar(c,f"SELECT {name}"))
    return {"database_bytes":q("pg_database_size(current_database())"),
      "raw_table_and_indexes_bytes":q("pg_total_relation_size('public.playback_logs')"),
      "raw_indexes_bytes":q("pg_indexes_size('public.playback_logs')"),
      "daily_table_and_indexes_bytes":q("pg_total_relation_size('qa_rpc.daily')"),
      "daily_indexes_bytes":q("pg_indexes_size('qa_rpc.daily')")}
def no_event_copy(c):
    c.execute("DROP FUNCTION public.get_playback_report_cqrs(uuid,date,date,uuid,uuid)")
    c.execute("DROP FUNCTION public.get_playback_events_cqrs(uuid,date,date,uuid,uuid,integer,integer)")
    c.execute("DROP TABLE qa_rpc.read_events")
    assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
def rollup(c):
    # Derived strictly from raw proofs, never into a second event table.
    with c.transaction():
        c.execute("""INSERT INTO qa_rpc.daily
          (company_id,local_day,device_id,campaign_id,media_id,playlist_id,
           display_device,display_campaign,display_media,display_playlist,
           started,completed,seconds,first_play,last_play)
          SELECT l.company_id,(l.started_at AT TIME ZONE cmp.timezone)::date,
           l.device_id,l.campaign_id,l.media_id,l.playlist_id,
           COALESCE(NULLIF(l.device_name,''),d.name,'TV removida'),
           COALESCE(NULLIF(l.campaign_name,''),ca.name,
              CASE WHEN l.campaign_id IS NULL THEN 'Conteúdo padrão'
                   ELSE 'Campanha removida' END),
           COALESCE(NULLIF(l.media_name,''),m.name,'Mídia removida'),
           COALESCE(NULLIF(l.playlist_name,''),p.name,'Playlist removida'),
           count(*),count(*) FILTER(WHERE l.completed),sum(l.duration_seconds),
           min(l.started_at),max(l.started_at)
          FROM public.playback_logs l
          JOIN public.companies cmp ON cmp.id=l.company_id
          LEFT JOIN public.devices d ON d.id=l.device_id AND d.company_id=l.company_id
          LEFT JOIN public.campaigns ca ON ca.id=l.campaign_id AND ca.company_id=l.company_id
          LEFT JOIN public.media_assets m ON m.id=l.media_id AND m.company_id=l.company_id
          LEFT JOIN public.playlists p ON p.id=l.playlist_id AND p.company_id=l.company_id
          GROUP BY l.company_id,(l.started_at AT TIME ZONE cmp.timezone)::date,
           l.device_id,l.campaign_id,l.media_id,l.playlist_id,
           COALESCE(NULLIF(l.device_name,''),d.name,'TV removida'),
           COALESCE(NULLIF(l.campaign_name,''),ca.name,
              CASE WHEN l.campaign_id IS NULL THEN 'Conteúdo padrão'
                   ELSE 'Campanha removida' END),
           COALESCE(NULLIF(l.media_name,''),m.name,'Mídia removida'),
           COALESCE(NULLIF(l.playlist_name,''),p.name,'Playlist removida')""")
        c.execute("UPDATE qa_rpc.cursor SET projected_count=664 WHERE singleton=1")
    assert int(v.scalar(c,"SELECT sum(started) FROM qa_rpc.daily"))==664
    assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
    return int(v.scalar(c,"SELECT count(*) FROM qa_rpc.daily"))
def setup():
    v.bootstrap()
    v.fixture()
    with v.con() as c:
        before=metric(c)
        no_event_copy(c)
        assert v.scalar(c,"SELECT count(*) FROM public.playback_logs")==664
        after=rollup(c)
        return {"before":before,"after":metric(c),"daily_groups":after}
def cases():
    out=[]
    for i,company in enumerate(v.COMPANIES):
        for start,end in WINDOWS:
            for campaign,device in ((None,None),(v.uid(company,"campaign",0),None),
                                     (None,v.uid(company,"tv",0)),
                                     (v.uid(company,"campaign",1),v.uid(company,"tv",1))):
                out.append({"company":str(company),"start":start.isoformat(),"end":end.isoformat(),
                    "campaign":str(campaign) if campaign else None,
                    "device":str(device) if device else None})
    assert len(out)==48
    return out
def query_original(row):
    company=uuid.UUID(row["company"]);i=v.COMPANIES.index(company)
    start=date.fromisoformat(row["start"]);end=date.fromisoformat(row["end"])
    campaign=uuid.UUID(row["campaign"]) if row["campaign"] else None
    device=uuid.UUID(row["device"]) if row["device"] else None
    with v.con() as c:
        with c.transaction():
            v.auth(c,v.decode(v.token(company,v.USER_IDS[i])))
            report=v.rpc(c,"get_playback_report",company,start,end,campaign,device)
            exported=v.export(c,"get_playback_events",company,start,end,campaign,device,limit=1000)
            return {"report":report,"export":[list(x) for x in exported]}
def serialize(row):
    return [x.isoformat() if hasattr(x,"isoformat") else str(x) if isinstance(x,(uuid.UUID,Decimal)) else x for x in row]
def raw_rows_by_tenant_day():
    with v.con() as c:
        records=c.execute("SELECT "+v.FIELDS+" FROM public.playback_logs ORDER BY company_id,started_at,id").fetchall()
    groups=defaultdict(list)
    for rec in records:
        co=str(rec[2])
        local=rec[11].astimezone(v.SAO).date().isoformat()
        groups[(co,local)].append(serialize(rec))
    assert sum(len(v) for v in groups.values())==664
    return groups
def encrypt(key,descriptor,rows):
    plain=canon({"descriptor":descriptor,"rows":rows,"columns":COLS})
    nonce=secrets.token_bytes(12)
    ciphertext=AESGCM(key).encrypt(nonce,plain,canon(descriptor))
    blob=canon({"format":FORMAT,"nonce":base64.b64encode(nonce).decode(),
                "ciphertext":base64.b64encode(ciphertext).decode()})
    return plain,blob
def decrypt(key,metadata,blob):
    if not hmac.compare_digest(sha(blob),metadata["cipher_sha256"]):
        raise ValueError("hash_cipher_mismatch")
    envelope=json.loads(blob)
    if envelope["format"]!=FORMAT:raise ValueError("format")
    nonce=base64.b64decode(envelope["nonce"],validate=True)
    body=base64.b64decode(envelope["ciphertext"],validate=True)
    plain=AESGCM(key).decrypt(nonce,body,canon(metadata["descriptor"]))
    if sha(plain)!=metadata["plain_sha256"]:raise ValueError("plain_hash")
    decoded=json.loads(plain)
    if decoded["descriptor"]!=metadata["descriptor"] or decoded["columns"]!=COLS:
        raise ValueError("descriptor")
    if len(decoded["rows"])!=metadata["count"]:raise ValueError("count")
    return decoded["rows"]
def producer(root,keydir):
    root.mkdir(parents=True,exist_ok=True);keydir.mkdir(parents=True,exist_ok=True)
    setup_result=setup()
    baseline=[{"case":x,"result":query_original(x)} for x in cases()]
    key=secrets.token_bytes(32)
    keyfile=keydir/"synthetic-qa-key"
    keyfile.write_bytes(key);os.chmod(keyfile,0o600)
    groups=raw_rows_by_tenant_day()
    manifest={"format":FORMAT,"segments":[],"source_rows":664}
    for (company,local),events in sorted(groups.items()):
        for offset in range(0,len(events),SEG_MAX):
            rows=events[offset:offset+SEG_MAX]
            ident={"company":company,"local_day":local,"offset":offset,"count":len(rows)}
            plain,blob=encrypt(key,ident,rows)
            filename=f"proofs-{len(manifest['segments']):03d}.v2qa"
            (root/filename).write_bytes(blob)
            manifest["segments"].append({"file":filename,"descriptor":ident,
                 "count":len(rows),"cipher_sha256":sha(blob),"plain_sha256":sha(plain),
                 "encrypted_bytes":len(blob),"plaintext_bytes":len(plain)})
    baseline_bytes=canon(baseline)
    (root/"rpc-baseline.json").write_bytes(baseline_bytes)
    manifest["rpc_baseline_sha256"]=sha(baseline_bytes)
    (root/"manifest.json").write_bytes(canon(manifest))
    assert sum(x["count"] for x in manifest["segments"])==664
    assert setup_result["daily_groups"]>0
    stats={"result":"PASS","original_rows":664,
        "no_second_event_read_model":True,"daily_groups":setup_result["daily_groups"],
        "segments":len(manifest["segments"]),
        "archive_blob_bytes":sum(x["encrypted_bytes"] for x in manifest["segments"]),
        "manifest_bytes":(root/"manifest.json").stat().st_size,
        "baseline_bytes":len(baseline_bytes),
        "test_key_bytes":len(key),
        "source_db_before_after":setup_result}
    print("QA_COMPACT_PRODUCER_JSON="+canon(stats).decode(),flush=True)

class Store(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,folder):
        super().__init__(("127.0.0.1",0),Handler)
        self.folder=folder
        self.requests=0
        self.offline=set()
        self.lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        name=self.path.removeprefix("/")
        with self.server.lock:
            self.server.requests+=1
            if name in self.server.offline:
                self.send_response(503);self.end_headers();return
        if name not in {p.name for p in self.server.folder.glob("*.v2qa")}:
            self.send_response(404);self.end_headers();return
        blob=(self.server.folder/name).read_bytes()
        self.send_response(200);self.send_header("Content-Length",str(len(blob)))
        self.end_headers();self.wfile.write(blob)
def load_table(c,rows):
    c.execute("CREATE TEMP TABLE qa_ondemand_events (LIKE public.playback_logs) ON COMMIT PRESERVE ROWS")
    c.execute("GRANT SELECT ON pg_temp.qa_ondemand_events TO authenticated")
    # Temp rows survive until connection ends; NO permanent SQL table or index.
    with c.transaction():
        with c.cursor() as cur:
            cur.executemany(f"INSERT INTO pg_temp.qa_ondemand_events ({v.FIELDS}) VALUES ({v.INSERT_FIELDS})",
                            ([None if val is None else uuid.UUID(val) if field in KEY_FIELDS else
                              datetime.fromisoformat(val) if field in ("started_at","ended_at") else
                              Decimal(val) if field=="duration_seconds" else val
                              for field,val in zip(COLS,item)] for item in rows))
    return len(rows)
def install_on_demand_rpc():
    report=v.REPORT.read_text()
    export=v.EXPORT.read_text()
    for sql,old,new,signature in [
        (report,"get_playback_report","get_playback_report_ondemand",
         "uuid,date,date,uuid,uuid"),
        (export,"get_playback_events","get_playback_events_ondemand",
         "uuid,date,date,uuid,uuid,integer,integer")]:
        repl=sql.replace("function public."+old+"(","function public."+new+"(")
        repl=repl.replace("from public.playback_logs l","from pg_temp.qa_ondemand_events l")
        repl=repl.replace(f"function public.{old}({signature})",
                          f"function public.{new}({signature})")
        assert repl!=sql and "from pg_temp.qa_ondemand_events l" in repl
        with v.con() as c:c.execute(repl)
def summary_stats():
    with v.con() as c:
        m=metric(c)
        assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
        assert v.scalar(c,"SELECT count(*) FROM public.playback_logs")==664
        assert v.scalar(c,"SELECT count(*) FROM qa_rpc.pending_without_time")==2
        assert int(v.scalar(c,"SELECT sum(started) FROM qa_rpc.daily"))==664
        return m
class Archive:
    def __init__(self,base,manifest,key):
        self.base=base;self.manifest=manifest;self.key=key
        self.cache={};self.misses=0;self.hits=0;self.failed=0
    def get(self,metadata,force_cold=False,retries=0):
        filename=metadata["file"]
        if not force_cold and filename in self.cache:
            self.hits+=1;return self.cache[filename]
        for try_n in range(retries+1):
            try:
                with request.urlopen(self.base+"/"+filename,timeout=8) as response:
                    blob=response.read()
                rows=decrypt(self.key,metadata,blob)
                self.misses+=1
                self.cache[filename]=rows
                return rows
            except Exception:
                self.failed+=1
                if try_n==retries:raise
                time.sleep(.025)
    def select(self,company,begin,end,force_cold=False,retries=0):
        rows=[]
        for entry in self.manifest["segments"]:
            ident=entry["descriptor"]
            if ident["company"]!=str(company):continue
            day=date.fromisoformat(ident["local_day"])
            if not begin<=day<=end:continue
            rows.extend(self.get(entry,force_cold,retries))
        return rows
def pctl(values,p):
    a=sorted(values)
    return round(a[math.ceil(len(a)*p)-1],3)
def use_case(archive,row):
    company=uuid.UUID(row["company"]);i=v.COMPANIES.index(company)
    begin=date.fromisoformat(row["start"]);end=date.fromisoformat(row["end"])
    campaign=uuid.UUID(row["campaign"]) if row["campaign"] else None
    device=uuid.UUID(row["device"]) if row["device"] else None
    selected=archive.select(company,begin,end)
    with v.con() as c:
        load_table(c,selected)
        with c.transaction():
            v.auth(c,v.decode(v.token(company,v.USER_IDS[i])))
            report=v.rpc(c,"get_playback_report_ondemand",company,begin,end,campaign,device)
            exported=v.export(c,"get_playback_events_ondemand",company,begin,end,
                              campaign,device,limit=1000,offset=0)
            assert v.scalar(c,"SELECT count(*) FROM pg_temp.qa_ondemand_events WHERE company_id<>%s",(company,))==0
    return {"report":report,"export":[list(x) for x in exported]}
def failures(store,archive,manifest,key,baseline):
    first=manifest["segments"][0]
    filename=first["file"]
    archive.cache.clear()
    with store.lock:store.offline.add(filename)
    try:
        try:archive.get(first,force_cold=True)
        except Exception:pass
        else:raise AssertionError("offline_must_fail_closed")
    finally:
        with store.lock:store.offline.clear()
    assert filename not in archive.cache
    # Retry and recover, only then permit an archive ACK.
    archive.get(first,force_cold=True,retries=1)
    old=(store.folder/filename).read_bytes()
    changed=bytearray(old);changed[len(changed)//2]^=8
    (store.folder/filename).write_bytes(changed)
    try:
        try:archive.get(first,force_cold=True)
        except Exception:pass
        else:raise AssertionError("tampered_file_accepted")
    finally:(store.folder/filename).write_bytes(old)
    try:
        decrypt(secrets.token_bytes(32),first,old)
    except Exception:pass
    else:raise AssertionError("wrong_key_accepted")
    assert sum(len(archive.get(part,force_cold=True)) for part in manifest["segments"])==664
    with v.con() as c:
        c.execute("""CREATE TABLE qa_rpc.archive_ack (
          archive_id text PRIMARY KEY,verified_rows bigint NOT NULL,
          manifest_sha256 text NOT NULL)""")
        mhash=sha(canon(manifest))
        with c.transaction():
            c.execute("INSERT INTO qa_rpc.archive_ack VALUES(%s,%s,%s)",
                     ("archive-qa",664,mhash))
        with c.transaction():
            c.execute("""INSERT INTO qa_rpc.archive_ack VALUES(%s,%s,%s)
                         ON CONFLICT DO NOTHING""",("archive-qa",664,mhash))
        assert v.scalar(c,"SELECT count(*) FROM qa_rpc.archive_ack")==1
    return {"missing_or_offline_rejected":True,"recovered":True,
            "tamper_rejected":True,"wrong_key_rejected":True,
            "ack_once_after_full_verification":True,"retry_idempotent":True}
def consumer(root,keydir):
    manifest=json.loads((root/"manifest.json").read_bytes())
    key=(keydir/"synthetic-qa-key").read_bytes()
    assert len(key)==32
    baseline_raw=(root/"rpc-baseline.json").read_bytes()
    assert sha(baseline_raw)==manifest["rpc_baseline_sha256"]
    baseline=json.loads(baseline_raw)
    setup_result=setup()
    assert setup_result["daily_groups"]>0
    install_on_demand_rpc()
    store=Store(root)
    t=threading.Thread(target=store.serve_forever,daemon=True);t.start()
    base=f"http://127.0.0.1:{store.server_address[1]}"
    try:
        archive=Archive(base,manifest,key)
        checks=failures(store,archive,manifest,key,baseline)
        archive.cache.clear()
        cold=[];warm=[];raw=[]
        # First run: cold HTTP+GCM+TEMP SQL; second: in-memory cache+TEMP SQL.
        for entry in baseline:
            args=entry["case"]
            t0=time.perf_counter();calculated=use_case(archive,args)
            cold.append((time.perf_counter()-t0)*1000)
            assert canon(calculated)==canon(entry["result"])
        cold_reads=store.requests
        for entry in baseline:
            args=entry["case"]
            t0=time.perf_counter();calculated=use_case(archive,args)
            warm.append((time.perf_counter()-t0)*1000)
            assert canon(calculated)==canon(entry["result"])
        assert store.requests==cold_reads # warm cache makes ZERO new object GETs
        for entry in baseline:
            t0=time.perf_counter();out=query_original(entry["case"])
            raw.append((time.perf_counter()-t0)*1000)
            assert canon(out)==canon(entry["result"])
        with v.con() as c:
            one=v.scalar(c,"SELECT count(distinct device_id) FROM public.playback_logs WHERE company_id=%s",(v.COMPANIES[0],))
            distinct=v.scalar(c,"SELECT count(distinct device_id) FROM qa_rpc.daily WHERE company_id=%s",(v.COMPANIES[0],))
            assert one==distinct==3
            stat=summary_stats()
            # Day aggregate alone cannot support event-by-event export.
            assert v.scalar(c,"SELECT count(*) FROM qa_rpc.daily")<664
            assert v.scalar(c,"SELECT to_regclass('qa_rpc.read_events')") is None
        archive_total=sum(x["encrypted_bytes"] for x in manifest["segments"])
        manifest_bytes=(root/"manifest.json").stat().st_size
        baseline_bytes=len(baseline_raw)
        total=stat["database_bytes"]+archive_total+manifest_bytes+baseline_bytes+32
        print("QA_ONDEMAND_COMPACT_PASS_JSON="+canon({
           "result":"PASS","independent_runner":True,"originals_unchanged":664,
           "no_second_permanent_event_copy":True,"daily_rows":setup_result["daily_groups"],
           "full_json_compared_cold":48,"full_json_compared_warm":48,
           "export_compared_cold":48,"export_compared_warm":48,
           "source_rpc_reference_compared":48,
           "cold_p95_ms":pctl(cold,.95),"cold_p99_ms":pctl(cold,.99),
           "warm_p95_ms":pctl(warm,.95),"warm_p99_ms":pctl(warm,.99),
           "raw_p95_ms":pctl(raw,.95),"raw_p99_ms":pctl(raw,.99),
           "http_object_get_total":store.requests,
           "http_get_during_warm":0,"cache_hits":archive.hits,
           "cache_misses":archive.misses,"http_failures_injected":archive.failed,
           "archive_segments":len(manifest["segments"]),
           "encrypted_bytes":archive_total,"manifest_bytes":manifest_bytes,
           "reference_bytes":baseline_bytes,"synthetic_key_bytes":32,
           "database_bytes":stat["database_bytes"],
           "raw_index_bytes":stat["raw_indexes_bytes"],
           "daily_index_bytes":stat["daily_indexes_bytes"],
           "total_db_plus_external_artifacts_bytes":total,
           "baseline_raw_db_bytes_before_daily":setup_result["before"]["database_bytes"],
           "no_net_saving_with_originals_retained":True,
           "failure_cases":checks,"tenant_isolation":True,
           "distinct_devices_correct":3}).decode(),flush=True)
    finally:
        store.shutdown();store.server_close();t.join(3)
if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--mode",choices=("producer","consumer"),required=True)
    parser.add_argument("--archive",type=Path,required=True)
    parser.add_argument("--key-dir",type=Path,required=True)
    args=parser.parse_args()
    (producer if args.mode=="producer" else consumer)(args.archive,args.key_dir)
