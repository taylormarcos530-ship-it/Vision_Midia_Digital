"""CI Docker two network namespaces + PG17 backend-network cut; NO production.
Requires disposable Docker daemon and localhost synthetic PostgreSQL.
"""
import json,math,os,psycopg,statistics,subprocess,threading,time
from urllib import request,error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DB="postgresql://postgres:qa-only-local-password@127.0.0.1:55432/vision_v2_quarantine_disposable"
CHANNEL="qa_vision_network_notify"
PREFIX="v2qa_"
def shell(*args):
    r=subprocess.run(args,text=True,capture_output=True,check=True)
    return r.stdout.strip()
def note(msg):print("QA_NETWORK_STEP="+msg,flush=True)
def read(node):
    port=18081 if node=="a" else 18082
    try:
        with request.urlopen(f"http://127.0.0.1:{port}/state",timeout=12) as r:
            return r.status,json.loads(r.read())
    except error.HTTPError as e:
        return e.code,json.loads(e.read())
def until(fn,timeout=12):
    deadline=time.monotonic()+timeout
    last=None
    while time.monotonic()<deadline:
        try:
            last=fn()
            if last:return last
        except Exception as e:last=repr(e)
        time.sleep(.12)
    raise AssertionError("condition_timeout:"+str(last))
def connect_pg():
    return psycopg.connect(DB,connect_timeout=3,autocommit=True)
def pulse(stop,metrics):
    while not stop.is_set():
        try:
            with connect_pg() as c:
                metrics["connections"]+=1
                while not stop.is_set():
                    c.execute("SELECT pg_notify(%s,%s)",(CHANNEL,"pulse"))
                    metrics["pulses"]+=1
                    stop.wait(.35)
        except Exception as exc:
            metrics["errors"]+=1
            stop.wait(.25)
def pctl(data,p):
    data=sorted(data);i=(len(data)-1)*p
    return round(data[math.floor(i)]+(data[math.ceil(i)]-data[math.floor(i)])*(i-math.floor(i)),3)
def wave(n):
    before=[read(z)[1]["sql_reads"] for z in "ab"]
    def hit(i):
        begin=time.perf_counter()
        code,body=read("ab"[i%2])
        assert code==200 and body["revision"]==2,(code,body)
        return (time.perf_counter()-begin)*1000
    with ThreadPoolExecutor(max_workers=n) as pool:
        latency=list(pool.map(hit,range(n)))
    after=[read(z)[1]["sql_reads"] for z in "ab"]
    assert before==after,("cache_hit_per_request_sql",before,after)
    return {"clients":n,"p95_ms":pctl(latency,.95),"p99_ms":pctl(latency,.99),
         "postgres_sql_reads_from_http":0,"http_responses":len(latency)}
def main():
    note("create_isolated_docker_networks")
    shell("docker","network","create",PREFIX+"front")
    shell("docker","network","create",PREFIX+"back")
    shell("docker","run","-d","--name",PREFIX+"pg","--network",PREFIX+"back",
          "-p","127.0.0.1:55432:5432","-e","POSTGRES_DB=vision_v2_quarantine_disposable",
          "-e","POSTGRES_USER=postgres","-e","POSTGRES_PASSWORD=qa-only-local-password",
          "postgres:17-alpine")
    until(lambda:connect_pg().close() or True,25)
    with connect_pg() as c:
        assert c.execute("SELECT current_database()").fetchone()[0]=="vision_v2_quarantine_disposable"
        assert int(c.execute("SHOW server_version_num").fetchone()[0])//10000==17
        c.execute("CREATE TABLE qa_network_outbox(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,revision bigint NOT NULL)")
        c.execute("INSERT INTO qa_network_outbox(revision) VALUES(1)")
    note("start_two_HTTP_replicas_two_Docker_namespaces")
    for node,port in (("a","18081"),("b","18082")):
        shell("docker","run","-d","--name",PREFIX+node,"--network",PREFIX+"front",
              "-p",f"127.0.0.1:{port}:8080","-e",f"QA_NODE={node}",
              "-e","QA_DB_DSN=postgresql://postgres:qa-only-local-password@v2qa_pg:5432/vision_v2_quarantine_disposable",
              "-e","QA_LEASE_SECONDS=1.7","v2qa-network-replica:ci")
        shell("docker","network","connect",PREFIX+"back",PREFIX+node)
    pids={n:int(shell("docker","inspect","--format","{{.State.Pid}}",PREFIX+n)) for n in "ab"}
    namespaces={n:shell("docker","exec",PREFIX+n,"python","-c",
         "import os;print(os.readlink('/proc/self/ns/net'))") for n in "ab"}
    assert len(set(namespaces.values()))==2,("not_two_network_namespaces",namespaces)
    stop=threading.Event();stats={"connections":0,"pulses":0,"errors":0}
    t=threading.Thread(target=pulse,args=(stop,stats),daemon=True);t.start()
    try:
        until(lambda:all(read(n)[0]==200 and read(n)[1]["revision"]==1 for n in "ab"),18)
        note("disconnect_only_backend_of_replica_b_keep_HTTP_frontend")
        shell("docker","network","disconnect","--force",PREFIX+"back",PREFIX+"b")
        until(lambda:read("b")[0]==503,8)
        assert read("a")[0]==200,"healthy_replica_disrupted"
        disconnected=read("b")
        assert disconnected[1]["backend_healthy"] is False
        note("publish_durable_outbox_change_while_b_backend_is_partitioned")
        with connect_pg() as c:
            with c.transaction():
                c.execute("INSERT INTO qa_network_outbox(revision) VALUES(2)")
                c.execute("SELECT pg_notify(%s,%s)",(CHANNEL,"outbox:2"))
        until(lambda:read("a")[0]==200 and read("a")[1]["revision"]==2,8)
        assert read("b")[0]==503,"partitioned_replica_served_cached_request"
        note("reconnect_backend_b_then_reload_durable_revision")
        shell("docker","network","connect",PREFIX+"back",PREFIX+"b")
        until(lambda:read("b")[0]==200 and read("b")[1]["revision"]==2,15)
        healthy={n:read(n)[1] for n in "ab"}
        results=[wave(100),wave(300)]
        states={n:read(n)[1] for n in "ab"}
        # Shared heartbeat SQL only: no DB query on GET for health.
        assert stats["connections"]<=3,stats
        result={"result":"PASS","postgres17_disposable":True,
          "two_distinct_docker_network_namespaces":True,
          "same_ephemeral_github_runner":True,"different_physical_hosts_tested":False,
          "backend_cut_b_frontend_still_accessible":True,
          "http_503_after_silent_feed_lease":True,
          "durable_outbox_recovered_after_reconnect":True,
          "two_replicas_latest_revision":True,
          "latency_http":results,"healthy_after":states,
          "heartbeat":{"pulses":stats["pulses"],"connections":stats["connections"],
                        "errors":stats["errors"],"production_cadence_not_tested":True},
          "docker_network_namespaces":namespaces,
          "docker_container_memory":{"a":shell("docker","stats","--no-stream","--format","{{.MemUsage}}",PREFIX+"a"),
                                     "b":shell("docker","stats","--no-stream","--format","{{.MemUsage}}",PREFIX+"b")},
          "no_prod_access":True,"go_production":False}
        print("QA_NETWORK_SUMMARY_JSON="+json.dumps(result,sort_keys=True),flush=True)
        print("QA_NETWORK_NAMESPACES_PASS=true",flush=True)
    finally:
        stop.set();t.join(4)

if __name__=="__main__":main()
