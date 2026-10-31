"""Commercial RPC parity + synthetic HMAC JWT/RLS + 300 client restart/replay QA.
PostgreSQL 17 loopback disposable only. No production SQL, APK or deployment.
The report query shapes mirror GitHub migrations; NOT live RPC installation.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import date,datetime,timedelta,timezone
from decimal import Decimal
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import hashlib,hmac,json,math,os,resource,secrets,threading,time
from urllib import request,error
import psycopg
from pathlib import Path

DSN="postgresql://postgres:qa-only-local-password@127.0.0.1:5432/vision_v2_quarantine_disposable"
KEY=secrets.token_bytes(32)     # runtime-generated test-only key, never persisted/logged
WAVES=3
COUNT=300
BATCH=50
DAY=date(2026,10,31)
def connect():return psycopg.connect(DSN,autocommit=True,connect_timeout=8)
def scalar(c,query,args=()):return c.execute(query,args).fetchone()[0]
def canon(obj):return json.dumps(obj,sort_keys=True,separators=(",",":")).encode()
def b64(s):return base64.urlsafe_b64encode(s).rstrip(b"=").decode()
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
def jwt(company,device,mode="device",offset=3600):
    payload={"iss":"vision-v2-local-qa","aud":"disposable-v2",
             "company":company,"device":device,"mode":mode,
             "exp":int(time.time())+offset}
    s=b64(canon({"alg":"HS256","typ":"JWT"}))+"."+b64(canon(payload))
    return s+"."+b64(hmac.digest(KEY,s.encode(),"sha256"))
def claims(token):
    try:
        head,payload,sig=token.split(".")
        data=json.loads(base64.urlsafe_b64decode(payload+"="*(-len(payload)%4)))
        signed=(head+"."+payload).encode()
        expected=b64(hmac.digest(KEY,signed,"sha256"))
        if not hmac.compare_digest(expected,sig):raise ValueError("signature")
        if (data.get("iss"),data.get("aud"))!=("vision-v2-local-qa","disposable-v2"):raise ValueError("issuer")
        if data.get("exp",0)<=time.time() or data.get("mode") not in ("report","device"):raise ValueError("expired")
        if not data.get("company") or not data.get("device"):raise ValueError("claims")
        return data
    except Exception as exc:raise PermissionError("invalid_synthetic_token") from exc
def role(c,who):
    c.execute("SET LOCAL ROLE qa_vision_app")
    c.execute("SELECT set_config('request.jwt.claim.company',%s,true)",(who["company"],))
    c.execute("SELECT set_config('request.jwt.claim.device',%s,true)",(who["device"],))
    c.execute("SELECT set_config('request.jwt.claim.mode',%s,true)",(who["mode"],))
def dev(i):return f"dev-{i:03d}"
def co(i):return "company-A" if i<150 else "company-B"
def proof(d,seq):
    media=f"m-{seq%7}"
    boot="boot-A" if seq<=100 else "boot-B"
    mono=(seq-1 if seq<=100 else seq-101)*15000
    event_id=f"event-{seq:06d}"
    payload=f"{d}|{seq}|{media}|{boot}|{mono}"
    return {"seq":seq,"event_id":event_id,"media":media,"boot":boot,
            "mono":mono,"hash":sha(payload)}
def init():
    with connect() as c:
        assert scalar(c,"SELECT current_database()")=="vision_v2_quarantine_disposable"
        assert int(scalar(c,"SHOW server_version_num"))//10000==17
        c.execute(Path(__file__).with_name("schema.sql").read_text())
        with c.transaction():
            with c.cursor() as cur:
                cur.executemany("INSERT INTO qa_commercial.devices(company_id,device_id) VALUES(%s,%s)",
                      [(co(i),dev(i)) for i in range(COUNT)])
                cur.executemany("INSERT INTO qa_commercial.cursor(device_id) VALUES(%s)",
                      [(dev(i),) for i in range(COUNT)])
def fixture():
    """Historical name snapshots + repeated devices/media across days; 2 tenants."""
    with connect() as c:
        rows=[]
        for company in ("company-A","company-B"):
            for d in range(3):
                device=f"hist-{company[-1]}-{d}"
                for day in range(3):
                    for n in range(5):
                        seq=day*5+n+1
                        name="TV antiga" if day<2 else "TV renomeada"
                        camp="Campanha original" if day<2 else "Campanha renomeada"
                        media="Mídia original" if day<2 else "Mídia renomeada"
                        # Sao Paulo day: 23:50 and 00:10 cross UTC day boundary.
                        hour,minute=(23,50) if n%2==0 else (0,10)
                        localday=DAY+timedelta(days=day)
                        started=datetime(localday.year,localday.month,localday.day,hour,minute,
                                         tzinfo=timezone(timedelta(hours=-3)))
                        campaign="camp-1" if n%2==0 else "camp-2"
                        m_id="media-1" if n%3 else "media-2"
                        pl="playlist-1" if n<3 else "playlist-2"
                        rows.append((company,device,seq,f"hist-event-{seq}",campaign,pl,m_id,
                          name,camp,"Playlist histórica",media,started,localday,Decimal(15+n),n%2==0,sha(f"{device}:{seq}")))
        with c.transaction():
            c.executemany("""INSERT INTO qa_commercial.playback
              (company_id,device_id,seq,client_event_id,campaign_id,playlist_id,media_id,
               device_name,campaign_name,playlist_name,media_name,started_at,play_day,
               seconds,completed,hash_sha256)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",rows)
            # Quarantined without wall clock: explicitly excluded from paid report.
            c.executemany("""INSERT INTO qa_commercial.pending_time
                  (company_id,device_id,seq,client_event_id,hash_sha256)
                  VALUES(%s,%s,%s,%s,%s)""",
                 [(x[0],x[1],1000+x[2],"pending-"+x[3],x[15]) for x in rows[:24]])
        count=scalar(c,"SELECT count(*) FROM qa_commercial.playback")
        assert count==90
        assert scalar(c,"SELECT count(*) FROM qa_commercial.pending_time")==24
        assert scalar(c,"SELECT count(*) FROM qa_commercial.pending_time WHERE started_at IS NOT NULL OR billable")==0
        # Same original may replay but not be inserted or counted again.
        a=rows[0]
        with c.transaction():
            c.execute("""INSERT INTO qa_commercial.playback
                  (company_id,device_id,seq,client_event_id,campaign_id,playlist_id,media_id,
                   device_name,campaign_name,playlist_name,media_name,started_at,play_day,
                   seconds,completed,hash_sha256)
                  VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                  ON CONFLICT (device_id,seq) DO NOTHING""",a)
        assert scalar(c,"SELECT count(*) FROM qa_commercial.playback")==count
        return count
def build_cqrs():
    with connect() as c:
        with c.transaction():
            c.execute("""INSERT INTO qa_commercial.daily(
                company_id,device_id,campaign_id,playlist_id,media_id,
                device_name,campaign_name,playlist_name,media_name,play_day,
                started,completed,total_seconds,first_play,last_play)
              SELECT company_id,device_id,campaign_id,playlist_id,media_id,
                device_name,campaign_name,playlist_name,media_name,play_day,
                count(*),count(*) FILTER(WHERE completed),sum(seconds),min(started_at),max(started_at)
              FROM qa_commercial.playback
              GROUP BY company_id,device_id,campaign_id,playlist_id,media_id,
                       device_name,campaign_name,playlist_name,media_name,play_day""")
        assert scalar(c,"SELECT sum(started) FROM qa_commercial.daily")==90
def where_filter(company,first,last,campaign=None,device=None,media=None):
    sql="""company_id=%s AND play_day BETWEEN %s AND %s
          AND (%s::text IS NULL OR campaign_id=%s::text)
          AND (%s::text IS NULL OR device_id=%s::text)
          AND (%s::text IS NULL OR media_id=%s::text)"""
    return sql,(company,first,last,campaign,campaign,device,device,media,media)
def raw_vs_cqrs(c,company,first,last,campaign=None,device=None,media=None):
    condition,args=where_filter(company,first,last,campaign,device,media)
    # A CQRS grouped row acts as a distinct-presence bridge, not the SUM of
    # distinct counts across days. Mirrors report RPC grouping semantics.
    def summary(table):
        if table=="playback":
            fields="""count(*),count(*) FILTER(WHERE completed),sum(seconds),
                 count(distinct device_id),count(distinct campaign_id),count(distinct media_id),
                 min(started_at),max(started_at)"""
        else:
            fields="""sum(started),sum(completed),sum(total_seconds),
                 count(distinct device_id),count(distinct campaign_id),count(distinct media_id),
                 min(first_play),max(last_play)"""
        return c.execute(f"SELECT {fields} FROM qa_commercial.{table} WHERE {condition}",args).fetchone()
    assert summary("playback")==summary("daily"),(company,first,last,campaign,device,media)
    categories=[
      "campaign_id,campaign_name",
      "device_id,device_name",
      "media_id,media_name",
      "play_day",
      "campaign_id,campaign_name,device_id,device_name,media_id,media_name,playlist_id,playlist_name,play_day"
    ]
    for group in categories:
        def agg(table):
            cols=group+","
            if table=="playback":
                val="count(*),count(*) FILTER(WHERE completed),sum(seconds),min(started_at),max(started_at)"
            else:
                val="sum(started),sum(completed),sum(total_seconds),min(first_play),max(last_play)"
            return sorted(map(repr,c.execute(f"""SELECT {cols}{val}
                    FROM qa_commercial.{table} WHERE {condition} GROUP BY {group}""",args).fetchall()))
        assert agg("playback")==agg("daily"),(company,group,first,last,campaign,device,media)
def parity():
    checked=0
    with connect() as c:
        for tenant in ("company-A","company-B"):
            for start,end in ((0,0),(1,1),(2,2),(0,1),(0,2)):
                for mode in ("all","campaign","device","media"):
                    cid="camp-1" if mode=="campaign" else None
                    d=f"hist-{tenant[-1]}-0" if mode=="device" else None
                    m="media-1" if mode=="media" else None
                    raw_vs_cqrs(c,tenant,DAY+timedelta(days=start),
                              DAY+timedelta(days=end),cid,d,m)
                    checked+=1
        # Demonstrate naive SUM(daily DISTINCT devices) overcounts a multi-day report.
        n=scalar(c,"SELECT count(distinct device_id) FROM qa_commercial.playback WHERE company_id='company-A'")
        naive=scalar(c,"SELECT sum(x.n) FROM (SELECT count(distinct device_id) AS n FROM qa_commercial.playback WHERE company_id='company-A' GROUP BY play_day) x")
        assert naive>n,(naive,n)
        # Historical name changes: same ID appears under both snapshot versions.
        assert scalar(c,"SELECT count(distinct device_name) FROM qa_commercial.playback WHERE device_id='hist-A-0'")==2
        assert scalar(c,"SELECT count(distinct device_name) FROM qa_commercial.daily WHERE device_id='hist-A-0'")==2
        return {"result":"PASS","report_filter_combinations":checked,
                "grouping_shapes":5,"total_group_comparisons":checked*5,
                "distinct_devices_correct":n,"naive_sum_of_daily_distinct":naive,
                "historical_names_preserved":True,"pending_without_time_excluded":24}
def rls_check():
    with connect() as c:
        user=claims(jwt("company-A","*",mode="report"))
        with c.transaction():
            role(c,user)
            a=scalar(c,"SELECT count(*) FROM qa_commercial.playback")
            b=scalar(c,"SELECT count(*) FROM qa_commercial.playback WHERE company_id='company-B'")
            d=scalar(c,"SELECT count(*) FROM qa_commercial.daily")
            pending=scalar(c,"SELECT count(*) FROM qa_commercial.pending_time")
            assert a==45 and b==0 and d>0 and pending==24
        # Synthetic JWT from company A cannot request company B or device B;
        # the database policy, not only the gateway, enforces isolation.
        user=claims(jwt("company-B","*",mode="report"))
        with c.transaction():
            role(c,user)
            assert scalar(c,"SELECT count(*) FROM qa_commercial.playback WHERE company_id='company-A'")==0
        assert "company-A" not in claims(jwt("company-B","*",mode="report"))["company"]
        expired=jwt("company-A","*",mode="report",offset=-1)
        try:claims(expired)
        except PermissionError:pass
        else:raise AssertionError("expired_synthetic_jwt_accepted")
        forged=jwt("company-B","*",mode="report")
        forged=forged[:-4]+"AAAA"
        try:claims(forged)
        except PermissionError:pass
        else:raise AssertionError("tampered_synthetic_jwt_accepted")
        return {"result":"PASS","tenant_A_visible_raw":a,"tenant_B_leak":b,
                "tenant_A_quarantine":pending,"jwt_expired_rejected":True,
                "jwt_tampering_rejected":True,"sql_rls_enforced":True}
class Gateway(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=512
    def __init__(self,once,flags):
        super().__init__(("127.0.0.1",0),Handler)
        self.sema=threading.BoundedSemaphore(16)
        self.lock=threading.Lock()
        self.flags=flags             # preserve outage-once markers across gateway restart
        self.counters={"http":0,"retryable":0,"new":0,"duplicate":0,"unauthorized":0,"conflicts":0}
        self.once=once
    def accept(self,payload,token):
        who=claims(token)
        if who["mode"]!="device" or set(payload)!={"device","company","events"}:
            raise PermissionError("invalid_event_claim")
        d,tenant,events=payload["device"],payload["company"],payload["events"]
        if d!=who["device"] or tenant!=who["company"]:raise PermissionError("identity_mismatch")
        if not isinstance(events,list) or not 1<=len(events)<=BATCH:raise ValueError("batch")
        if any(not isinstance(e,dict) or set(e)!={"seq","event_id","media","boot","mono","hash"} for e in events):
            raise ValueError("schema")
        for i,e in enumerate(events):
            if e!=proof(d,e["seq"]):raise ValueError("altered_proof")
            if i and e["seq"]!=events[i-1]["seq"]+1:raise ValueError("sequence_gap")
        idx=int(d.split("-")[1]);first=events[0]["seq"]
        # one no-commit outage per selected TV in the second wave
        if first==51 and idx%10==0:
            key=("outage",d)
            with self.lock:
                if key not in self.flags:
                    self.flags.add(key)
                    raise RuntimeError("network_down")
        with self.sema:
            with connect() as c:
                with c.transaction():
                    role(c,who)
                    row=c.execute("""SELECT watermark FROM qa_commercial.devices
                              WHERE device_id=%s FOR UPDATE""",(d,)).fetchone()
                    if row is None:raise PermissionError("rls_device")
                    mark=row[0]
                    old=[e for e in events if e["seq"]<=mark]
                    new=[e for e in events if e["seq"]>mark]
                    if old:
                        original=dict(c.execute("""SELECT seq,hash_sha256 FROM qa_commercial.pending_time
                            WHERE device_id=%s AND seq BETWEEN %s AND %s""",
                            (d,old[0]["seq"],old[-1]["seq"])).fetchall())
                        if any(original.get(e["seq"])!=e["hash"] for e in old):raise ValueError("replay_conflict")
                    if new:
                        if new[0]["seq"]!=mark+1:raise ValueError("missing_sequence")
                        c.executemany("""INSERT INTO qa_commercial.pending_time
                           (company_id,device_id,seq,client_event_id,hash_sha256)
                           VALUES(%s,%s,%s,%s,%s)""",
                           [(tenant,d,e["seq"],e["event_id"],e["hash"]) for e in new])
                        if first==101 and idx==0:
                            key=("rollback",d)
                            with self.lock:
                                if key not in self.flags:
                                    self.flags.add(key)
                                    raise RuntimeError("rollback_after_insert")
                        c.execute("UPDATE qa_commercial.devices SET watermark=%s WHERE device_id=%s",
                                  (new[-1]["seq"],d))
            with self.lock:
                self.counters["new"]+=len(new);self.counters["duplicate"]+=len(old)
            return {"ack":mark+len(new),"new":len(new),"duplicate":len(old)}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def response(self,code,data):
        raw=canon(data)
        self.send_response(code);self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        with self.server.lock:self.server.counters["http"]+=1
        if self.path!="/qa/ingest":return self.response(404,{"error":"path"})
        try:
            size=int(self.headers.get("Content-Length","-1"))
            if not 0<size<=16000:raise ValueError("size")
            data=json.loads(self.rfile.read(size))
            result=self.server.accept(data,self.headers.get("Authorization","").removeprefix("Bearer "))
            d=data["device"]
            if result["new"] and result["ack"]==50 and int(d.split("-")[1])%15==0:
                key=("lost_ack",d)
                with self.server.lock:
                    if key not in self.server.flags:
                        self.server.flags.add(key);self.server.counters["retryable"]+=1
                        return self.response(503,{"error":"lost_after_commit"})
            return self.response(200,result)
        except PermissionError:
            with self.server.lock:self.server.counters["unauthorized"]+=1
            return self.response(401,{"error":"unauthorized"})
        except ValueError:
            with self.server.lock:self.server.counters["conflicts"]+=1
            return self.response(409,{"error":"invalid_or_replay"})
        except Exception:
            with self.server.lock:self.server.counters["retryable"]+=1
            return self.response(503,{"error":"transient"})
def post(base,payload,token):
    req=request.Request(base+"/qa/ingest",data=canon(payload),method="POST",
                        headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    started=time.perf_counter()
    try:
        with request.urlopen(req,timeout=25) as r:
            return r.status,json.loads(r.read()),(time.perf_counter()-started)*1000
    except error.HTTPError as e:
        return e.code,json.loads(e.read()),(time.perf_counter()-started)*1000
def percentile(values,p):
    sorted_values=sorted(values)
    return round(sorted_values[max(0,math.ceil(len(values)*p)-1)],2) if values else 0
class Monitor:
    def __init__(self):
        self.end=threading.Event()
        self.samples=0;self.max_wait=0;self.max_sessions=0
    def loop(self):
        with connect() as c:
            while not self.end.is_set():
                waits,active=c.execute("""SELECT count(*) FILTER(WHERE wait_event_type='Lock'),
                           count(*) FROM pg_stat_activity WHERE datname=current_database()""").fetchone()
                self.max_wait=max(self.max_wait,waits)
                self.max_sessions=max(self.max_sessions,active)
                self.samples+=1
                self.end.wait(.05)
def stress():
    flags=set()
    latencies=[];retry=0
    server=None;runner=None
    monitor=Monitor();monitor_thread=threading.Thread(target=monitor.loop,daemon=True)
    monitor_thread.start()
    boot=time.perf_counter()
    phases=[]
    def start_server():
        nonlocal server,runner
        server=Gateway(True,flags)
        runner=threading.Thread(target=server.serve_forever,daemon=True)
        runner.start()
        return f"http://127.0.0.1:{server.server_address[1]}"
    def stop_server():
        server.shutdown();server.server_close();runner.join(5)
    base=start_server()
    try:
        with ThreadPoolExecutor(max_workers=COUNT) as pool:
            for wave in range(WAVES):
                first=wave*BATCH+1
                def client(i):
                    token=jwt(co(i),dev(i))
                    payload={"device":dev(i),"company":co(i),
                             "events":[proof(dev(i),j) for j in range(first,first+BATCH)]}
                    durations=[]
                    for attempt in range(5):
                        code,body,ms=post(base,payload,token)
                        durations.append(ms)
                        if code==200:
                            assert body["ack"]==first+BATCH-1
                            assert body["new"] in (0,BATCH)
                            return durations,attempt
                        assert code==503,(code,body)
                        time.sleep(.02*(attempt+1))
                    raise AssertionError("not_recovered")
                results=list(pool.map(client,range(COUNT)))
                latencies.extend(t for duration,_ in results for t in duration)
                retry+=sum(x[1] for x in results)
                phases.append({"wave":wave+1,"clients_completed":len(results),"elapsed_s":round(time.perf_counter()-boot,2)})
                if wave==0:
                    stop_server()
                    base=start_server()
                    # Recovery after gateway process restart: replay all 300
                    # already-ACKed batches; every replay must have new=0.
                    def old_replay(i):
                        payload={"device":dev(i),"company":co(i),
                                 "events":[proof(dev(i),j) for j in range(1,51)]}
                        status,out,ms=post(base,payload,jwt(co(i),dev(i)))
                        assert status==200 and out["ack"]==50 and out["new"]==0 and out["duplicate"]==50
                        return ms
                    latencies.extend(pool.map(old_replay,range(COUNT)))
        # Negative checks: tampering, cross-company, expired JWT, gap, restart durable cursor.
        good={"device":dev(0),"company":co(0),"events":[proof(dev(0),j) for j in range(1,51)]}
        wrong=jwt("company-B",dev(0))
        assert post(base,good,wrong)[0]==401
        assert post(base,good,jwt(co(0),dev(0),offset=-5))[0]==401
        corrupted=json.loads(canon(good))
        corrupted["events"][0]["media"]="fake"
        assert post(base,corrupted,jwt(co(0),dev(0)))[0]==409
        gap={"device":dev(0),"company":co(0),"events":[proof(dev(0),152)]}
        assert post(base,gap,jwt(co(0),dev(0)))[0]==409
        with connect() as c:
            assert scalar(c,"SELECT count(*) FROM qa_commercial.pending_time")==COUNT*WAVES*BATCH+24
            assert scalar(c,"SELECT count(*) FROM qa_commercial.pending_time WHERE billable OR started_at IS NOT NULL")==0
            assert scalar(c,"SELECT count(*) FROM qa_commercial.devices WHERE watermark=150")==COUNT
            assert scalar(c,"SELECT sum(started) FROM qa_commercial.daily")==90
            c.execute("SELECT pg_stat_clear_snapshot()")
            vacc=scalar(c,"SELECT COALESCE(sum(autovacuum_count),0) FROM pg_stat_all_tables WHERE schemaname='qa_commercial'")
            deadlocks=scalar(c,"SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()")
            tablebytes=scalar(c,"SELECT pg_total_relation_size('qa_commercial.pending_time')")
        elapsed=round(time.perf_counter()-boot,2)
        return {"result":"PASS","clients":COUNT,"waves":WAVES,"clients_in_each_wave":COUNT,
                "completed_events":COUNT*WAVES*BATCH,"gateway_restart_after_first_wave":True,
                "replayed_after_restart":COUNT*BATCH,
                "retries":retry,"p95_http_ms":percentile(latencies,.95),
                "p99_http_ms":percentile(latencies,.99),"elapsed_seconds":elapsed,
                "gateway_phase_checks":phases,
                "max_sql_sessions_sampled":monitor.max_sessions,
                "max_lock_waiters_sampled":monitor.max_wait,
                "monitor_samples":monitor.samples,
                "python_max_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                "pg_deadlocks":deadlocks,"pg_autovacuum_count":int(vacc),
                "pending_relation_bytes":tablebytes,
                "recovered_without_duplicate":True,
                "original_commercial_cqrs_unchanged":True,
                "no_time_misclassified":0}
    finally:
        if server:stop_server()
        monitor.end.set();monitor_thread.join(5)
def main():
    init()
    count=fixture()
    build_cqrs()
    equal=parity();auth=rls_check()
    print("QA_REPORT_PARITY_JSON="+json.dumps(equal,sort_keys=True,separators=(",",":")),flush=True)
    print("QA_SYNTHETIC_JWT_RLS_JSON="+json.dumps(auth,sort_keys=True,separators=(",",":")),flush=True)
    result=stress()
    print("QA_300_GATEWAY_RESTART_JSON="+json.dumps(result,sort_keys=True,separators=(",",":")),flush=True)
    assert result["completed_events"]==45000
    with connect() as c:
        assert scalar(c,"SELECT count(*) FROM qa_commercial.playback")==count
        assert scalar(c,"SELECT count(*) FROM qa_commercial.pending_time")==45024
        assert scalar(c,"SELECT sum(started) FROM qa_commercial.daily")==count
    print("QA_COMMERCIAL_PARITY_RLS_RESTART_PASS=true",flush=True)
if __name__=="__main__":main()
