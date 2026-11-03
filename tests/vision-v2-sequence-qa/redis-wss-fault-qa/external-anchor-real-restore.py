"""Real PostgreSQL17 logical restores plus two independent OS auth processes.
ONE canonical external JTI/owner anchor blocks duplicates after two auth DBs roll
back; restoring or splitting the anchor recreates the SECURITY FAIL.
No true non-rollbackable authority, no HA, no production connections.
"""
from __future__ import annotations
import concurrent.futures,json,os,resource,signal,subprocess,sys,tempfile,time
from pathlib import Path
import psycopg
from redis import Redis
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/"wss-scale-qa"))
import gateway
assert os.environ.get("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.environ.get("QA_STREAM_GUARD_GROUP")=="1"
for k in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(k),("official_credentials_prohibited",k)
PRIMARY="postgresql://postgres:qa-only-witness-password@127.0.0.1:5433/vision_v2_witness_disposable?connect_timeout=2"
SECONDARY="postgresql://postgres:qa-only-shadow-password@127.0.0.1:5435/vision_v2_witness_shadow_disposable?connect_timeout=2"
ANCHOR="postgresql://postgres:qa-only-anchor-password@127.0.0.1:5436/vision_v2_anchor_disposable?connect_timeout=2"
CONTAINERS={key:os.environ["QA_"+key.upper()+"_CONTAINER"] for key in ("primary","secondary","anchor")}
for name,ident in CONTAINERS.items():
 assert len(ident)>=12 and all(x in "0123456789abcdef" for x in ident.lower()),(name,ident)
def ck(x,msg):assert x,msg
def docker(cmd,id,data=None):
 args=["docker","exec"]+(["-i"] if data is not None else [])+[id,*cmd]
 return subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                       check=True,timeout=40).stdout
def make(dsn,anchor=False):
 with psycopg.connect(dsn,autocommit=True) as c:
  ck(int(c.execute("SHOW server_version_num").fetchone()[0])//10000==17,"PG17 only")
  if anchor:
   c.execute("CREATE SCHEMA qa_anchor")
   c.execute("""CREATE TABLE qa_anchor.owner(device text PRIMARY KEY,
     tenant text NOT NULL,revoked boolean NOT NULL DEFAULT false)""")
   c.execute("""CREATE TABLE qa_anchor.jti(jti text PRIMARY KEY,
     tenant text NOT NULL,device text NOT NULL,
     consumed_at timestamptz DEFAULT clock_timestamp())""")
   c.execute("INSERT INTO qa_anchor.owner(device,tenant) VALUES('tv-0000','company-A')")
  else:
   c.execute("CREATE SCHEMA qa_local")
   c.execute("CREATE TABLE qa_local.jti(jti text PRIMARY KEY)")
def counts():
 with psycopg.connect(ANCHOR,autocommit=True) as c:
  return dict(rows=int(c.execute("SELECT count(*) FROM qa_anchor.jti").fetchone()[0]),
              owner=c.execute("SELECT tenant FROM qa_anchor.owner WHERE device='tv-0000'").fetchone()[0],
              bytes=int(c.execute("SELECT pg_total_relation_size('qa_anchor.jti')").fetchone()[0]),
              lsn=str(c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0]))
def backup(key,schema):
 db={"primary":"vision_v2_witness_disposable",
     "secondary":"vision_v2_witness_shadow_disposable",
     "anchor":"vision_v2_anchor_disposable"}[key]
 data=docker(["pg_dump","-U","postgres","-d",db,"-Fc","-n",schema],CONTAINERS[key])
 ck(len(data)>1000,("missing backup",key,len(data)))
 return data
def restore(key,data):
 db={"primary":"vision_v2_witness_disposable",
     "secondary":"vision_v2_witness_shadow_disposable",
     "anchor":"vision_v2_anchor_disposable"}[key]
 return docker(["pg_restore","-U","postgres","-d",db,
                "--clean","--if-exists","--no-owner","--exit-on-error"],CONTAINERS[key],data)
class Worker:
 def __init__(self,who,anchor=ANCHOR):
  self.who=who
  env=dict(os.environ,QA_LOCAL_ROLE=who,QA_ANCHOR_DSN=anchor)
  self.proc=subprocess.Popen([sys.executable,"-u",str(ROOT/"anchor-jti-worker.py")],
          stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
          text=True,bufsize=1,env=env)
  first=self.proc.stdout.readline()
  ck(first,(who,self.proc.poll()))
  meta=json.loads(first)
  ck(meta["ready"]==who,"bad auth subprocess")
 def auth(self,token):
  self.proc.stdin.write(json.dumps(dict(op="auth",token=token))+"\n");self.proc.stdin.flush()
  line=self.proc.stdout.readline()
  ck(line,("authority process ended",self.who,self.proc.poll()))
  return json.loads(line)
 def end(self):
  if self.proc.poll() is None:
   try:
    self.proc.stdin.write('{"op":"stop"}\n');self.proc.stdin.flush()
    self.proc.wait(timeout=3)
   except Exception:
    self.proc.kill();self.proc.wait(timeout=4)
  for f in (self.proc.stdin,self.proc.stdout,self.proc.stderr):
   try:f.close()
   except OSError:pass
def concurrently(w1,w2,token1,token2):
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  a=pool.submit(w1.auth,token1);b=pool.submit(w2.auth,token2)
  return a.result(timeout=8),b.result(timeout=8)
def reset_local(snap):
 for role in ("primary","secondary"):restore(role,snap[role])
def container_state(cmd):
 cid=CONTAINERS["anchor"]
 return subprocess.run(["docker",cmd,cid],stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                       check=True,text=True,timeout=35).stdout.strip()
def wait_anchor():
 until=time.monotonic()+14
 while time.monotonic()<until:
  try:
   with psycopg.connect(ANCHOR,connect_timeout=1) as c:
    if c.execute("SELECT 1").fetchone()[0]==1:return
  except psycopg.Error:time.sleep(.12)
 raise AssertionError("external anchor never recovered")
def main():
 began=time.monotonic()
 make(PRIMARY);make(SECONDARY);make(ANCHOR,True)
 snapshots={x:backup(x,"qa_anchor" if x=="anchor" else "qa_local") for x in CONTAINERS}
 old_lsn=counts()["lsn"]
 redis0=Redis(host="127.0.0.1",port=6379,decode_responses=True)
 redis1=Redis(host="127.0.0.1",port=6380,decode_responses=True)
 ck(redis0.ping() and redis1.ping(),"Redis 7 services missing")
 redis0.flushdb();redis1.flushdb()
 redis0.hset("qa:owners",mapping={"tv-0000":"company-A"})
 redis1.hset("qa:owners",mapping={"tv-0000":"company-B"})
 workers=[];down=False
 report=dict(
  production_GO=False,one_CI_runner=True,
  distinct_PG17_local_authority_instances=2,
  canonical_JTI_owner_anchor_PG17_service=True,
  Redis7_primary_secondary=True,
  production_verified=False,
  nonrollbackable_monotonic_hardware_anchor=False,
  SQL_transactions_across_two_PG_clusters_atomic=False)
 try:
  a=Worker("primary");b=Worker("secondary");workers=[a,b]
  t=gateway.token("company-A","tv-0000")
  first=concurrently(a,b,t,t)
  ck(sum(x["accepted"] for x in first)==1,("two processes accepted shared JTI",first))
  ck(any(x.get("error")=="GLOBAL_JTI_REPLAY" for x in first),"wrong reject")
  report["shared_one_external_anchor"]=dict(status="PASS_LOCAL",two_distinct_OS_authorities=True,
     one_JTI_accepted=True,other_globally_rejected=True,
     divergent_Redis_ownership_ignored=True)
  # Local owner's state may disagree with canonical external PG anchor.
  token_b=gateway.token("company-B","tv-0000")
  wrong=b.auth(token_b)
  ck(not wrong["accepted"] and wrong.get("error")=="GLOBAL_OWNER_DENIED",
     ("company-B incorrectly granted TV",wrong))
  report["owner_source_of_truth"]=dict(status="PASS_LOCAL",wrong_company_denied=True)
  # ACTUAL pg_restore of both mirror authorities, preserving canonical anchor.
  reset_local(snapshots)
  redis0.flushdb();redis1.flushdb()
  recovered=concurrently(a,b,t,t)
  ck(all(not x["accepted"] and x.get("error")=="GLOBAL_JTI_REPLAY" for x in recovered),
     ("JTI survived local DB restore but was accepted",recovered))
  report["both_authority_PG17_logically_restored"]=dict(status="PASS_WHILE_ANCHOR_PRESERVED",
   real_pg_dump_pg_restore=True,previous_JTI_rejected_by_separate_anchor=True)
  # OS Docker stop of just canonical anchor. Both auth processes must deny.
  container_state("stop");down=True
  unavailable=concurrently(a,b,gateway.token("company-A","tv-0000"),
                           gateway.token("company-A","tv-0000"))
  ck(all(not x["accepted"] and x.get("error")=="AUTHORITY_UNAVAILABLE" for x in unavailable),
     ("anchor unavailable was not fail-closed",unavailable))
  container_state("start");down=False
  wait_anchor()
  reset_local(snapshots)
  back=concurrently(a,b,t,t)
  ck(all(not x["accepted"] and x.get("error")=="GLOBAL_JTI_REPLAY" for x in back),
     ("anchor restarted and previous JTI escaped",back))
  report["anchor_real_container_stop_restart"]=dict(
   status="PASS_LOCAL_NO_NEW_AUTH_IF_DOWN",no_login_if_canonical_anchor_down=True,
   spent_JTI_after_restart_remains_rejected=True)
  # Independent monotonic durability is NOT established: restore anchor itself
  # to an earlier real pg_dump; old spent JWT then becomes acceptable again.
  restore("anchor",snapshots["anchor"])
  reset_local(snapshots)
  redis0.flushdb();redis1.flushdb()
  replay=concurrently(a,b,t,t)
  ck(sum(x["accepted"] for x in replay)==1,
      ("full rollback failed to reproduce old JWT reacceptance",replay))
  report["ALL_local_and_global_authority_restored"]=dict(
   status="SECURITY_FAIL_REPRODUCED",
   old_signed_JTI_accepted_after_anchor_restore=True,
   physical_WAL_snapshot_restore_not_tested=True,
   snapshot_bytes={k:len(v) for k,v in snapshots.items()})
  # Simulate two uncoordinated global anchors. A rogue process intentionally
  # points to a local PG17 DB with separate owner/JTI; no majority election.
  with psycopg.connect(SECONDARY,autocommit=True) as c:
   c.execute("CREATE SCHEMA qa_anchor")
   c.execute("CREATE TABLE qa_anchor.owner(device text PRIMARY KEY,tenant text,revoked boolean NOT NULL DEFAULT false)")
   c.execute("CREATE TABLE qa_anchor.jti(jti text PRIMARY KEY,tenant text,device text)")
   c.execute("INSERT INTO qa_anchor.owner VALUES('tv-0000','company-A',false)")
  reset_local(snapshots)
  redis0.flushdb();redis1.flushdb()
  rogue=Worker("shadow-rogue",anchor=SECONDARY);workers.append(rogue)
  split=gateway.token("company-A","tv-0000")
  results=concurrently(a,rogue,split,split)
  ck(all(x["accepted"] for x in results),("split-brain replay negative not reproduced",results))
  report["two_uncoordinated_external_anchors"]=dict(status="SECURITY_FAIL_REPRODUCED",
   same_JTI_accepted_by_both=True,global_leader_or_quorum_unproven=True)
  after=counts()
  with psycopg.connect(ANCHOR,autocommit=True) as c:
   wal=int(c.execute("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",
                     (after["lsn"],old_lsn)).fetchone()[0])
  report["anchor_storage"]=dict(**after,WAL_delta_bytes=wal)
  report["cost"]=dict(
   minimum_canonical_SQL_queries_per_new_login=2,
   cross_database_transactions=2,
   per_heartbeat_extra_SQL_in_this_login_only_protocol=0,
   cross_PG_latency_and_paid_cost_unmeasured=True)
  report["security_verdict"]="NO_GO_FULL_RESTORE_AND_SPLIT_BRAIN_REMAIN_UNSAFE"
  report["elapsed_seconds"]=round(time.monotonic()-began,3)
  Path("qa-v2-external-anchor.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_EXTERNAL_JTI_ANCHOR_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  if down:
   try:container_state("start")
   except Exception:pass
  for w in workers:w.end()
  redis0.close();redis1.close()
if __name__=="__main__":main()
