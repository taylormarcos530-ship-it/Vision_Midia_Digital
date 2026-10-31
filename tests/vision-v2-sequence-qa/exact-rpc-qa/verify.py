"""Run unmodified GitHub playback report/export RPCs in disposable PostgreSQL17.

A read-optimized CQRS projection duplicates event-level fields needed for the
*exact* JSON (including recent 250 rows and paginated export); a separate
daily aggregate supports efficient safe rollups. This does NOT claim daily
aggregates alone can reproduce the original RPC or DISTINCT across days.

All JWTs, user records, media and playback proofs are synthetic.
NO Supabase connection. Do not write to production or install on TV boxes.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import base64, hashlib, hmac, json, os, tempfile, time, uuid
from pathlib import Path
from zoneinfo import ZoneInfo
import psycopg

DSN="postgresql://postgres:qa-only-local-password@127.0.0.1:5432/vision_v2_quarantine_disposable"
REPO=Path(__file__).resolve().parents[3]
REPORT=REPO/"supabase/migrations/20260908025620_add_playback_report_rpc.sql"
EXPORT=REPO/"supabase/migrations/20260908025854_add_playback_export_rpc.sql"
COMPANIES=[uuid.uuid5(uuid.NAMESPACE_DNS,f"vision-v2-qa-company-{i}") for i in range(2)]
USER_IDS=["test-report-user-A","test-report-user-B"]
KEY=os.urandom(32) # ephemeral test-only HMAC key; never committed or printed.
SAO=ZoneInfo("America/Sao_Paulo")
TZ_UTC=timezone.utc
DAYS=[date(2026,10,30),date(2026,10,31),date(2026,11,1)]
COLUMNS=("id","client_event_id","company_id","device_id","campaign_id","playlist_id",
         "media_id","device_name","campaign_name","playlist_name","media_name",
         "started_at","ended_at","duration_seconds","completed")
FIELDS=", ".join(COLUMNS)
INSERT_FIELDS=", ".join("%s" for _ in COLUMNS)

def con():return psycopg.connect(DSN,autocommit=True,connect_timeout=6)
def scalar(c,q,args=()):return c.execute(q,args).fetchone()[0]
def assert_raise(fn,code=None):
    try:fn()
    except Exception as exc:
        if code and getattr(exc,"sqlstate",None)!=code:
            raise AssertionError(f"expected SQLSTATE {code}, got {getattr(exc,'sqlstate',None)}: {exc}") from exc
        return
    raise AssertionError("negative case did not fail")
def sha(data):return hashlib.sha256(data).hexdigest()
def enc(raw):return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
def token(company,user,ttl=3600):
    header=enc(b'{"alg":"HS256","typ":"JWT"}')
    claims=enc(json.dumps({"iss":"v2-local-only","aud":"v2-report-qa",
          "company_id":str(company),"sub":user,"exp":int(time.time())+ttl},
          separators=(",",":"),sort_keys=True).encode())
    msg=header+"."+claims
    return msg+"."+enc(hmac.digest(KEY,msg.encode(),"sha256"))
def decode(jwt):
    try:
        head,payload,sig=jwt.split(".")
        message=(head+"."+payload).encode()
        expected=enc(hmac.digest(KEY,message,"sha256"))
        if not hmac.compare_digest(expected,sig):raise ValueError("signature")
        h=json.loads(base64.urlsafe_b64decode(head+"="*(-len(head)%4)))
        o=json.loads(base64.urlsafe_b64decode(payload+"="*(-len(payload)%4)))
        if h.get("alg")!="HS256" or o.get("iss")!="v2-local-only" or o.get("aud")!="v2-report-qa":
            raise ValueError("wrong issuer")
        if o["exp"]<=time.time() or not o.get("company_id") or not o.get("sub"):
            raise ValueError("expired")
        return o
    except Exception as exc:
        raise PermissionError("untrusted_synthetic_jwt") from exc
def auth(c,claims):
    c.execute("SET LOCAL ROLE authenticated")
    c.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(claims["sub"],))
    c.execute("SELECT set_config('request.jwt.claim.company_id',%s,true)",(claims["company_id"],))
def rpc(c,name,company,a,b,campaign=None,device=None):
    return c.execute(f"SELECT public.{name}(%s,%s,%s,%s,%s)",(company,a,b,campaign,device)).fetchone()[0]
def export(c,name,company,a,b,campaign=None,device=None,limit=500,offset=0):
    return c.execute(f"SELECT * FROM public.{name}(%s,%s,%s,%s,%s,%s,%s)",
                     (company,a,b,campaign,device,limit,offset)).fetchall()
def bootstrap():
    report=REPORT.read_text(encoding="utf-8")
    events=EXPORT.read_text(encoding="utf-8")
    # The GitHub versions run UNMODIFIED. Only the derived CQRS function gets
    # precisely the function name and source-table substitutions.
    assert report.count("create or replace function public.get_playback_report(")==1
    assert report.count("from public.playback_logs l")==1
    assert events.count("create or replace function public.get_playback_events(")==1
    assert events.count("from public.playback_logs l")==1
    mirror=report.replace("function public.get_playback_report(",
                          "function public.get_playback_report_cqrs(")
    mirror=mirror.replace("from public.playback_logs l","from qa_rpc.read_events l")
    mirror=mirror.replace("function public.get_playback_report(uuid,date,date,uuid,uuid)",
                          "function public.get_playback_report_cqrs(uuid,date,date,uuid,uuid)")
    mirrored_export=events.replace("function public.get_playback_events(",
                                   "function public.get_playback_events_cqrs(")
    mirrored_export=mirrored_export.replace("from public.playback_logs l","from qa_rpc.read_events l")
    mirrored_export=mirrored_export.replace("function public.get_playback_events(uuid,date,date,uuid,uuid,integer,integer)",
                                             "function public.get_playback_events_cqrs(uuid,date,date,uuid,uuid,integer,integer)")
    assert mirror!=report and mirrored_export!=events
    with con() as c:
        assert scalar(c,"SELECT current_database()")=="vision_v2_quarantine_disposable"
        assert int(scalar(c,"SHOW server_version_num"))//10000==17
        c.execute((Path(__file__).parent/"scaffold.sql").read_text())
        c.execute(report)
        c.execute(events)
        c.execute(mirror)
        c.execute(mirrored_export)
    print("QA_RPC_EXACT_ORIGINAL_SQL="+json.dumps({
        "result":"PASS",
        "report_sha256":sha(report.encode()),"export_sha256":sha(events.encode()),
        "source_functions_installed_unmodified":2,
        "cqrs_derived_functions":2,
        "postgres_version":17},sort_keys=True),flush=True)

def uid(*items):
    return uuid.uuid5(uuid.NAMESPACE_DNS,":".join(map(str,items)))
def fixture():
    companies=[(COMPANIES[i],"America/Sao_Paulo") for i in range(2)]
    devices={};campaigns={};playlists={};medias={}
    for j in range(2):
        company=COMPANIES[j]
        devices[j]=[uid(company,"tv",n) for n in range(3)]
        campaigns[j]=[uid(company,"campaign",n) for n in range(3)]
        playlists[j]=[uid(company,"playlist",n) for n in range(2)]
        medias[j]=[uid(company,"media",n) for n in range(4)]
    with con() as c:
        with c.transaction():
            c.cursor().executemany("INSERT INTO public.companies VALUES(%s,%s)",companies)
            c.cursor().executemany("INSERT INTO private.memberships VALUES(%s,%s)",
                                    [(COMPANIES[i],USER_IDS[i]) for i in range(2)])
            for j in range(2):
                company=COMPANIES[j]
                for table,ids,prefix in (
                    ("devices",devices[j],"TV"),
                    ("campaigns",campaigns[j],"Campanha"),
                    ("playlists",playlists[j],"Playlist"),
                    ("media_assets",medias[j],"Mídia")):
                    c.cursor().executemany(f"INSERT INTO public.{table} VALUES(%s,%s,%s)",
                        [(x,company,f"{prefix} versão atual {i}") for i,x in enumerate(ids)])
            rows=[]
            for j in range(2):
                company=COMPANIES[j]
                # 332 events per company; 250-event truncation and pagination.
                # 7-minute intervals span midnight in the America/Sao_Paulo zone.
                start=datetime(2026,10,30,23,50,tzinfo=SAO)
                for n in range(332):
                    at=start+timedelta(minutes=7*n)+timedelta(seconds=j)
                    tv=devices[j][n%3]
                    campaign=None if n%13==0 else campaigns[j][n%3]
                    pl=None if n%11==0 else playlists[j][n%2]
                    media=None if n%17==0 else medias[j][n%4]
                    completed=n%4!=0
                    duration=Decimal(f"{15+(n%6)}.{n%10}")
                    devname="TV anterior" if n<166 else "TV renomeada"
                    campname="Campanha histórica" if n<166 else "Campanha nova"
                    medianame="Mídia original" if n<166 else "Mídia atual"
                    # Blank snapshots fall back to current dimension name.
                    snapdevice="" if n%31==0 else devname
                    snapcamp="" if n%29==0 else campname
                    snapplaylist="" if n%37==0 else "Playlist histórica"
                    snapmedia="" if n%41==0 else medianame
                    rows.append((uid(company,"event",n),f"event-{j}-{n:05d}",company,
                        tv,campaign,pl,media,snapdevice,snapcamp,snapplaylist,snapmedia,
                        at.astimezone(TZ_UTC),
                        None if n%7==0 else (at+timedelta(seconds=float(duration))).astimezone(TZ_UTC),
                        duration,completed))
            c.cursor().executemany(f"INSERT INTO public.playback_logs ({FIELDS}) VALUES({INSERT_FIELDS})",rows)
            # One missing RTC fixture per company: never enters playback_logs.
            c.cursor().executemany("""INSERT INTO qa_rpc.pending_without_time
                (company_id,device_id,sequence,client_event_id) VALUES(%s,%s,%s,%s)""",
                [(COMPANIES[i],devices[i][0],9001,f"invalid-clock-{i}") for i in range(2)])
            # Renaming live dimensions after old events: historical snapshots must
            # survive; fallback names must match in the two exact RPCs.
            c.execute("UPDATE public.devices SET name='TV NOME NOVO'")
            c.execute("UPDATE public.campaigns SET name='CAMPANHA NOME NOVO'")
            c.execute("UPDATE public.media_assets SET name='MÍDIA NOME NOVO'")
        assert scalar(c,"SELECT count(*) FROM public.playback_logs")==664
        assert scalar(c,"SELECT count(*) FROM qa_rpc.pending_without_time")==2
    return devices,campaigns

def fill_projector():
    """Projection of event-level report/expor﻿t model and daily aggregate in
    one transaction; snapshot names remain in source; no original deletion."""
    with con() as c:
        with c.transaction():
            c.execute(f"""INSERT INTO qa_rpc.read_events ({FIELDS})
                SELECT {FIELDS} FROM public.playback_logs
                ON CONFLICT (id) DO NOTHING""")
            c.execute("""INSERT INTO qa_rpc.daily
                (company_id,local_day,device_id,campaign_id,media_id,playlist_id,
                display_device,display_campaign,display_media,display_playlist,
                started,completed,seconds,first_play,last_play)
                SELECT l.company_id,(l.started_at AT TIME ZONE c.timezone)::date,
                       l.device_id,l.campaign_id,l.media_id,l.playlist_id,
                       coalesce(nullif(l.device_name,''),d.name,'TV removida'),
                       coalesce(nullif(l.campaign_name,''),ca.name,
                           CASE WHEN l.campaign_id IS NULL THEN 'Conteúdo padrão'
                                ELSE 'Campanha removida' END),
                       coalesce(nullif(l.media_name,''),m.name,'Mídia removida'),
                       coalesce(nullif(l.playlist_name,''),p.name,'Playlist removida'),
                       count(*),count(*) FILTER (WHERE l.completed),
                       sum(l.duration_seconds),min(l.started_at),max(l.started_at)
                FROM qa_rpc.read_events l
                JOIN public.companies c ON c.id=l.company_id
                LEFT JOIN public.devices d ON d.id=l.device_id AND d.company_id=l.company_id
                LEFT JOIN public.campaigns ca ON ca.id=l.campaign_id AND ca.company_id=l.company_id
                LEFT JOIN public.media_assets m ON m.id=l.media_id AND m.company_id=l.company_id
                LEFT JOIN public.playlists p ON p.id=l.playlist_id AND p.company_id=l.company_id
                GROUP BY l.company_id,(l.started_at AT TIME ZONE c.timezone)::date,
                   l.device_id,l.campaign_id,l.media_id,l.playlist_id,
                   coalesce(nullif(l.device_name,''),d.name,'TV removida'),
                   coalesce(nullif(l.campaign_name,''),ca.name,
                           CASE WHEN l.campaign_id IS NULL THEN 'Conteúdo padrão'
                                ELSE 'Campanha removida' END),
                   coalesce(nullif(l.media_name,''),m.name,'Mídia removida'),
                   coalesce(nullif(l.playlist_name,''),p.name,'Playlist removida')""")
            c.execute("UPDATE qa_rpc.cursor SET projected_count=%s,updated_at=clock_timestamp() WHERE singleton=1",
                       (scalar(c,"SELECT count(*) FROM public.playback_logs"),))
        assert scalar(c,"SELECT count(*) FROM qa_rpc.read_events")==664
        assert scalar(c,"SELECT sum(started) FROM qa_rpc.daily")==664
        return int(scalar(c,"SELECT count(*) FROM qa_rpc.daily"))

def injection_and_restore():
    # Failure must roll back everything including cursor; source is untouched.
    with con() as c:
        c.execute("""CREATE FUNCTION qa_rpc.fail_projection() RETURNS trigger
            LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''injected_projection_failure''; END'""")
        c.execute("""CREATE TRIGGER qa_fail_project BEFORE INSERT ON qa_rpc.daily
                     FOR EACH ROW EXECUTE FUNCTION qa_rpc.fail_projection()""")
        try:
            try:
                with c.transaction():
                    c.execute(f"""INSERT INTO qa_rpc.read_events ({FIELDS})
                      SELECT {FIELDS} FROM public.playback_logs ON CONFLICT (id) DO NOTHING""")
                    c.execute("""INSERT INTO qa_rpc.daily
                        (company_id,local_day,device_id,campaign_id,media_id,playlist_id,
                        display_device,display_campaign,display_media,display_playlist,
                        started,completed,seconds,first_play,last_play)
                        VALUES(%s,%s,%s,NULL,NULL,NULL,'d','c','m','p',1,1,15,clock_timestamp(),clock_timestamp())""",
                        (COMPANIES[0],DAYS[1],uid(COMPANIES[0],"tv",0)))
                    c.execute("UPDATE qa_rpc.cursor SET projected_count=1 WHERE singleton=1")
            except psycopg.Error:
                pass
            else:raise AssertionError("projector_exception_not_raised")
            assert scalar(c,"SELECT count(*) FROM qa_rpc.read_events")==0
            assert scalar(c,"SELECT count(*) FROM qa_rpc.daily")==0
            assert scalar(c,"SELECT projected_count FROM qa_rpc.cursor WHERE singleton=1")==0
        finally:
            c.execute("DROP TRIGGER qa_fail_project ON qa_rpc.daily")
    rows=fill_projector()
    # Build immutable backup independent of existing read projection using
    # JSONL serialisation; restore to NEW table and compare SQL contents.
    with tempfile.TemporaryDirectory(prefix="v2-rpc-disposable-") as tmp:
        backup=Path(tmp)/"read-model.jsonl"
        with con() as c:
            data=c.execute(f"SELECT {FIELDS} FROM qa_rpc.read_events ORDER BY id").fetchall()
        def serial(row):
            return [None if x is None else
                    x.isoformat() if isinstance(x,datetime) else
                    str(x) if isinstance(x,(uuid.UUID,Decimal)) else x for x in row]
        raw=b"".join(json.dumps(serial(r),separators=(",",":"),ensure_ascii=False).encode()+b"\n" for r in data)
        backup.write_bytes(raw)
        manifest={"sha256":sha(raw),"rows":len(data),"bytes":len(raw)}
        tampered=bytearray(raw)
        tampered[18]=(tampered[18]+1)%256
        assert sha(tampered)!=manifest["sha256"]
        assert sha(backup.read_bytes())==manifest["sha256"]
        with con() as c:
            c.execute("CREATE TABLE qa_rpc.restored_events (LIKE qa_rpc.read_events INCLUDING ALL)")
            def recover(line):
                fields=json.loads(line)
                for i in (0,2,3,4,5,6):
                    if fields[i] is not None:fields[i]=uuid.UUID(fields[i])
                for i in (11,12):
                    if fields[i] is not None:fields[i]=datetime.fromisoformat(fields[i])
                fields[13]=Decimal(fields[13])
                return fields
            with c.transaction():
                c.cursor().executemany(f"INSERT INTO qa_rpc.restored_events ({FIELDS}) VALUES({INSERT_FIELDS})",
                          (recover(line) for line in backup.read_bytes().splitlines()))
            assert scalar(c,"SELECT count(*) FROM qa_rpc.restored_events")==manifest["rows"]
            # Restored table represents independent persisted read model, not
            # an INSERT SELECT from still-existing source during restore.
            orig=c.execute(f"SELECT {FIELDS} FROM qa_rpc.read_events ORDER BY id").fetchall()
            new=c.execute(f"SELECT {FIELDS} FROM qa_rpc.restored_events ORDER BY id").fetchall()
            assert orig==new
            # Install original query logic against independently RESTORED
            # event rows: the source RPC stays unmodified.
            c.execute("GRANT SELECT ON qa_rpc.restored_events TO authenticated")
            c.execute("ALTER TABLE qa_rpc.restored_events ENABLE ROW LEVEL SECURITY")
            c.execute("""CREATE POLICY restored_tenant ON qa_rpc.restored_events
                  TO authenticated USING(
                    company_id::text=current_setting('request.jwt.claim.company_id',true))""")
            report_sql=REPORT.read_text(encoding="utf-8")
            report_restored=report_sql.replace(
                "function public.get_playback_report(",
                "function public.get_playback_report_restored(").replace(
                "from public.playback_logs l","from qa_rpc.restored_events l").replace(
                "function public.get_playback_report(uuid,date,date,uuid,uuid)",
                "function public.get_playback_report_restored(uuid,date,date,uuid,uuid)")
            export_sql=EXPORT.read_text(encoding="utf-8")
            export_restored=export_sql.replace(
                "function public.get_playback_events(",
                "function public.get_playback_events_restored(").replace(
                "from public.playback_logs l","from qa_rpc.restored_events l").replace(
                "function public.get_playback_events(uuid,date,date,uuid,uuid,integer,integer)",
                "function public.get_playback_events_restored(uuid,date,date,uuid,uuid,integer,integer)")
            c.execute(report_restored)
            c.execute(export_restored)
            before=scalar(c,"SELECT count(*) FROM public.playback_logs")
            assert before==664
            assert scalar(c,"SELECT count(*) FROM qa_rpc.read_events")==before
        return {"result":"PASS","restored_rows":manifest["rows"],
                "sha256_verified":True,"tampered_archive_rejected":True,
                "restored_from_serialized_bytes_not_source_query":True,
                "daily_rollup_rows":rows,"projector_atomic_rollback":True,
                "original_rows_unchanged":before}
def compare_full_json(devices,campaigns):
    cases=0;event_checks=0;total_events=0
    date_windows=[(DAYS[0],DAYS[0]),(DAYS[1],DAYS[1]),(DAYS[2],DAYS[2]),
                  (DAYS[0],DAYS[1]),(DAYS[0],DAYS[2]),(DAYS[1],DAYS[2])]
    for i,company in enumerate(COMPANIES):
        claim=decode(token(company,USER_IDS[i]))
        with con() as c:
            for begin,end in date_windows:
                combos=[(None,None),(campaigns[i][0],None),
                        (None,devices[i][0]),(campaigns[i][1],devices[i][1])]
                for camp,dev in combos:
                    with c.transaction():
                        auth(c,claim)
                        raw=rpc(c,"get_playback_report",company,begin,end,camp,dev)
                        cq=rpc(c,"get_playback_report_cqrs",company,begin,end,camp,dev)
                        restored=rpc(c,"get_playback_report_restored",company,begin,end,camp,dev)
                        assert raw==cq==restored,(i,begin,end,camp,dev)
                        assert set(raw)=={"timezone","start_date","end_date","summary",
                                        "campaigns","devices","media","events"}
                        assert raw["timezone"]=="America/Sao_Paulo"
                        assert len(raw["events"])<=250
                        assert raw["summary"]["started"]>=len(raw["events"])
                        # 24-hour interval timezone correctness: all JSON
                        # event timestamps map back to requested local day.
                        for e in raw["events"]:
                            when=datetime.fromisoformat(e["started_at"].replace("Z","+00:00"))
                            local=when.astimezone(SAO).date()
                            assert begin<=local<=end
                            event_checks+=1
                        total_events+=raw["summary"]["started"]
                        cases+=1
            # The full range must have >250 entries: preserves original limit.
            with c.transaction():
                auth(c,claim)
                all_rows=rpc(c,"get_playback_report",company,DAYS[0],DAYS[2])
                assert all_rows["summary"]["started"]==332
                assert len(all_rows["events"])==250
                assert all_rows["summary"]["devices"]==3
                assert all_rows["summary"]["campaigns"]==3
                assert all_rows["summary"]["media"]==4
                assert len({r["device_name"] for r in all_rows["events"]})>=2
                # Explicit UTC-to-Sao Paulo midnight boundary.
                edge=rpc(c,"get_playback_report",company,DAYS[0],DAYS[0])
                assert edge["summary"]["started"]>=1
            # export path: exact original SQL vs independent read model
            for limit,offset in [(12,0),(12,12),(500,0),(9999,0),(-9,-1)]:
                with c.transaction():
                    auth(c,claim)
                    a=export(c,"get_playback_events",company,DAYS[0],DAYS[2],
                             limit=limit,offset=offset)
                    b=export(c,"get_playback_events_cqrs",company,DAYS[0],DAYS[2],
                             limit=limit,offset=offset)
                    restored=export(c,"get_playback_events_restored",company,DAYS[0],DAYS[2],
                             limit=limit,offset=offset)
                    assert a==b==restored
                    assert len(a)<=1000
                    if limit==12 and offset==0:assert len(a)==12
                    if limit==9999:assert len(a)==332
                    if limit==-9:assert len(a)==1
                    cases+=1
            # company-owned filters for exported event list
            with c.transaction():
                auth(c,claim)
                a=export(c,"get_playback_events",company,DAYS[0],DAYS[2],
                         campaign=campaigns[i][0],device=devices[i][0])
                b=export(c,"get_playback_events_cqrs",company,DAYS[0],DAYS[2],
                         campaign=campaigns[i][0],device=devices[i][0])
                restored=export(c,"get_playback_events_restored",company,DAYS[0],DAYS[2],
                         campaign=campaigns[i][0],device=devices[i][0])
                assert a==b==restored
                cases+=1
    return {"result":"PASS","exact_json_report_comparisons":2*len(date_windows)*4,
            "exact_export_comparisons":2*6,
            "total_exact_query_comparisons":cases,
            "examined_event_timestamps":event_checks,"raw_summary_started_sum_across_queries":total_events,
            "recent_events_cap_250_checked":True,
            "restored_full_json_equal":True,
            "restored_export_equal":True,
            "timezone":"America/Sao_Paulo"}
def access_negative():
    checks=0
    for i,company in enumerate(COMPANIES):
        good=decode(token(company,USER_IDS[i]))
        other=COMPANIES[1-i]
        with con() as c:
            with c.transaction():
                auth(c,good)
                assert scalar(c,"SELECT count(*) FROM public.playback_logs WHERE company_id=%s",(other,))==0
                assert scalar(c,"SELECT count(*) FROM qa_rpc.read_events WHERE company_id=%s",(other,))==0
                assert scalar(c,"SELECT count(*) FROM qa_rpc.daily WHERE company_id=%s",(other,))==0
                checks+=3
                # Authorization guard in original invoker RPC.
                assert_raise(lambda:rpc(c,"get_playback_report",other,DAYS[0],DAYS[2]),"42501")
                checks+=1
            # negative export test in independent new transaction
            with c.transaction():
                auth(c,good)
                assert_raise(lambda:export(c,"get_playback_events",other,DAYS[0],DAYS[2]),"42501")
                checks+=1
            with c.transaction():
                auth(c,good)
                assert_raise(lambda:rpc(c,"get_playback_report",company,DAYS[2],DAYS[0]))
                checks+=1
            with c.transaction():
                auth(c,good)
                assert_raise(lambda:rpc(c,"get_playback_report",company,DAYS[0],date(2028,1,1)))
                checks+=1
            with c.transaction():
                c.execute("SET LOCAL ROLE anon")
                assert_raise(lambda:rpc(c,"get_playback_report",company,DAYS[0],DAYS[2]),"42501")
                checks+=1
    assert_raise(lambda:decode(token(COMPANIES[0],USER_IDS[0],ttl=-10)))
    checks+=1
    fake=token(COMPANIES[0],USER_IDS[0])
    assert_raise(lambda:decode(fake[:-5]+"AAAAA"))
    checks+=1
    return {"result":"PASS","negative_security_cases":checks,
            "rls_company_leaks":0,"original_invoker_rpc_forbidden_cross_tenant":True,
            "export_forbidden_cross_tenant":True,"expired_or_modified_jwt_denied":True,
            "anonymous_rpc_denied":True}

def daily_distinct():
    with con() as c:
        for company in COMPANIES:
            raw=scalar(c,"SELECT count(distinct device_id) FROM public.playback_logs WHERE company_id=%s",(company,))
            correct=scalar(c,"SELECT count(distinct device_id) FROM qa_rpc.daily WHERE company_id=%s",(company,))
            naive=scalar(c,"SELECT sum(v.n) FROM (SELECT count(distinct device_id) n FROM qa_rpc.daily WHERE company_id=%s GROUP BY local_day) v",(company,))
            assert raw==correct==3
            assert naive>correct
            assert scalar(c,"SELECT sum(started) FROM qa_rpc.daily WHERE company_id=%s",(company,))==332
        return {"result":"PASS","distinct_devices_correct":3,
                "naive_summed_daily_distinct":int(naive),
                "raw_vs_daily_cqrs_counts_equal":True}

def main():
    bootstrap()
    devices,campaigns=fixture()
    restored=injection_and_restore()
    full=compare_full_json(devices,campaigns)
    security=access_negative()
    distinct=daily_distinct()
    for key,value in [("QA_EXACT_RPC_RESTORE_JSON",restored),
                      ("QA_EXACT_RPC_PARITY_JSON",full),
                      ("QA_EXACT_RPC_SECURITY_JSON",security),
                      ("QA_EXACT_RPC_DAILY_JSON",distinct)]:
        print(key+"="+json.dumps(value,sort_keys=True,separators=(",",":"),default=str),flush=True)
    print("QA_EXACT_RPC_ORIGINAL_CQRS_FULL_JSON_PASS=true",flush=True)
if __name__=="__main__":main()
