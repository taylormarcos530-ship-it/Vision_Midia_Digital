"""QA-only real fourth PG17 authority outside the THREE-voter rollback domain.

The 3 SQL voters are not consensus. An independent, pinned single-writer
JTI/term/owner guard can veto replay after restoring 2/3 or all 3 voters,
so long as the guard persists. Restoring the guard too REACCEPTS old JWT.
NO nonrollbackable hardware, Raft/Paxos, cross-host guarantees, or GO.
No official Supabase, Vercel, APK, real device or dataset connection.
"""
from __future__ import annotations
import concurrent.futures,importlib.util,json,os,resource,subprocess,sys,tempfile,time
from pathlib import Path
import psycopg
ROOT=Path(__file__).resolve().parent
OLD=ROOT.parent/"quorum-jti-qa"
S=importlib.util.spec_from_file_location("old_3voter_controller",OLD/"controller.py")
old=importlib.util.module_from_spec(S);S.loader.exec_module(old)
assert os.environ.get("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.environ.get("QA_STREAM_GUARD_GROUP")=="1"
for field in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(field),("production connectivity forbidden",field)
GUARD_DSN="postgresql://postgres:qa-only-guard-password@127.0.0.1:5437/vision_v2_guard_disposable?connect_timeout=1"
CID=os.environ["QA_INDEPENDENT_GUARD_CONTAINER"]
assert len(CID)>=12 and all(c in "0123456789abcdef" for c in CID.lower())
def ck(value,why):assert value,why
def setup():
 old.setup()
 with psycopg.connect(GUARD_DSN,autocommit=True) as c:
  ck(int(c.execute("SHOW server_version_num").fetchone()[0])//10000==17,"PG17 guard required")
  c.execute("CREATE SCHEMA qa_guard")
  c.execute("CREATE TABLE qa_guard.term(id int PRIMARY KEY,term bigint NOT NULL,leader text NOT NULL)")
  c.execute("INSERT INTO qa_guard.term VALUES(1,7,'leader-A')")
  c.execute("CREATE TABLE qa_guard.owner(device text PRIMARY KEY,tenant text NOT NULL,revoked boolean NOT NULL)")
  c.execute("INSERT INTO qa_guard.owner VALUES('tv-0000','company-A',false)")
  c.execute("""CREATE TABLE qa_guard.jti(
    jti text PRIMARY KEY,device text NOT NULL,tenant text NOT NULL,term bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp())""")
def guarded(token,leader="leader-A",term=7):
 start=time.monotonic()
 try:claims=old.W.gateway.verify(token)
 except PermissionError:
  return dict(result="DENY",cause="INVALID_SIGNATURE",elapsed_ms=round((time.monotonic()-start)*1000,3))
 try:
  with psycopg.connect(GUARD_DSN) as c:
   with c.transaction():
    c.execute("SELECT set_config('lock_timeout','250ms',true)")
    c.execute("SELECT set_config('statement_timeout','500ms',true)")
    c.execute("SELECT set_config('synchronous_commit','on',true)")
    authority=c.execute("SELECT term,leader FROM qa_guard.term WHERE id=1 FOR UPDATE").fetchone()
    owner=c.execute("SELECT tenant,revoked FROM qa_guard.owner WHERE device=%s FOR SHARE",(claims["device"],)).fetchone()
    if authority!=(term,leader) or owner!=(claims["company"],False):
     return dict(result="DENY",cause="OUTDATED_LEADER_OR_OWNER",
       elapsed_ms=round((time.monotonic()-start)*1000,3))
    consumed=c.execute("""INSERT INTO qa_guard.jti(jti,device,tenant,term) VALUES(%s,%s,%s,%s)
       ON CONFLICT DO NOTHING RETURNING jti""",
       (claims["jti"],claims["device"],claims["company"],term)).fetchone()
    if not consumed:
     return dict(result="DENY",cause="INDEPENDENT_JTI_ALREADY_SPENT",
       elapsed_ms=round((time.monotonic()-start)*1000,3))
 except (psycopg.Error,OSError):
  return dict(result="DENY",cause="GUARD_UNAVAILABLE_FAIL_CLOSED",
   elapsed_ms=round((time.monotonic()-start)*1000,3))
 voters=old.W.authorize(token,leader,term)
 return dict(result="ACK" if voters["status"]=="ACK" else "DENY",
   cause="GUARD_AND_2_OF_3" if voters["status"]=="ACK" else "INSUFFICIENT_VOTERS_JTI_BURNED",
   votes=voters["durable_voters"],elapsed_ms=round((time.monotonic()-start)*1000,3))
def backup_guard():
 data=old.docker(["pg_dump","-U","postgres","-Fc","-d","vision_v2_guard_disposable","-n","qa_guard"],CID)
 ck(len(data)>1000,"guard backup empty")
 return data
def restore_guard(blob):
 old.docker(["pg_restore","-U","postgres","-d","vision_v2_guard_disposable",
  "--clean","--if-exists","--no-owner","--exit-on-error"],CID,input=blob)
def guard_state():
 with psycopg.connect(GUARD_DSN) as c:
  row=c.execute("SELECT term,leader FROM qa_guard.term WHERE id=1").fetchone()
  return dict(term=row[0],leader=row[1],
   spent=c.execute("SELECT count(*) FROM qa_guard.jti").fetchone()[0],
   relation_bytes=c.execute("SELECT pg_total_relation_size('qa_guard.jti')").fetchone()[0],
   lsn=str(c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0]))
def guard_down():
 subprocess.run(["docker","stop","--time","1",CID],check=True,capture_output=True,timeout=15)
def guard_up():
 subprocess.run(["docker","start",CID],check=True,capture_output=True,timeout=15)
 deadline=time.monotonic()+12
 while time.monotonic()<deadline:
  r=subprocess.run(["docker","exec",CID,"pg_isready","-U","postgres","-d","vision_v2_guard_disposable"],
   capture_output=True,timeout=3)
  if r.returncode==0:return
  time.sleep(.13)
 raise AssertionError("guard not ready after restart")
def concurrent(token):
 with tempfile.TemporaryDirectory(prefix="qa_guarded_jti_") as folder:
  env=dict(os.environ,QA_BARRIER_DIR=folder)
  procs=[]
  try:
   for i in range(2):
    p=subprocess.Popen([sys.executable,"-u",str(ROOT/"verify.py"),"worker"],
     stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,
     text=True,bufsize=1)
    p.stdin.write(json.dumps({"token":token})+"\n");p.stdin.flush();p.stdin.close()
    procs.append(p)
   deadline=time.monotonic()+8
   while time.monotonic()<deadline and len(list(Path(folder).glob("ready-*")))<2:
    if any(p.poll() is not None for p in procs):break
    time.sleep(.005)
   ck(len(list(Path(folder).glob("ready-*")))==2,"two real worker barrier not synchronized")
   (Path(folder)/"release").write_text("NOW",encoding="utf8")
   results=[]
   for p in procs:
    line=p.stdout.readline()
    p.wait(timeout=10)
    ck(p.returncode==0,("auth subprocess failed",p.stderr.read()[:800]))
    results.append(json.loads(line));p.stdout.close();p.stderr.close()
   return results
  finally:
   for p in procs:
    if p.poll() is None:p.kill();p.wait(timeout=5)
def percentile(seq,q):
 a=sorted(seq);pos=(len(a)-1)*q;i=int(pos);r=pos-i
 return round(a[i]*(1-r)+a[min(i+1,len(a)-1)]*r,3)
def main():
 started=time.monotonic()
 setup()
 start_voters=old.stats()
 guard_first=guard_state()
 snapshots={n:old.backup(n) for n in old.names}
 guard_snapshot=backup_guard()
 report=dict(QA="PASS_DISPOSABLE_GUARD_PRESERVED_NO_HARDWARE_PROOF",
  production_GO=False,original_sources_preserved=True,real_PG17_voter_containers=3,
  real_external_PG17_guard_containers=1,
  single_guard_outside_three_voter_restore_domain=True,
  guard_is_nonrollbackable_in_reality=False,
  operational_consensus_proven=False,real_multihost_partitions_proven=False)
 guard_currently_up=True
 try:
  token=old.W.gateway.token("company-A","tv-0000")
  two=concurrent(token)
  ck(sum(x["result"]=="ACK" for x in two)==1,("two concurrent signed same-JTI logins allowed",two))
  report["two_real_OS_workers"]=dict(one_ACK_one_DENY=True,results=two)
  replay=guarded(token)
  ck(replay["result"]=="DENY" and replay["cause"]=="INDEPENDENT_JTI_ALREADY_SPENT",replay)
  report["replay_without_restore"]=dict(status="PASS_DENY",result=replay)
  # Real restore of two voter PostgreSQL17 databases, guard unmodified.
  old.restore("witness",snapshots["witness"])
  old.restore("shadow",snapshots["shadow"])
  two_restored=guarded(token)
  ck(two_restored["result"]=="DENY" and two_restored["cause"]=="INDEPENDENT_JTI_ALREADY_SPENT",
     ("two voter restore bypassed preserved independent guard",two_restored))
  report["2_of_3_real_pg_restore"]=dict(status="PASS_WHILE_SEPARATE_GUARD_INTACT",old_JTI_reaccepted=False,
    result=two_restored)
  # Restore third PG voter, guard still preserves spent old JWT.
  old.restore("anchor",snapshots["anchor"])
  three_restored=guarded(token)
  ck(three_restored["result"]=="DENY","3/3 rollback bypassed independent guard")
  report["3_of_3_voters_restored"]=dict(status="PASS_WHILE_SEPARATE_GUARD_INTACT",old_JTI_reaccepted=False)
  # Guard outage => fail closed and no voter writes for a fresh signed JWT.
  fresh=old.W.gateway.token("company-A","tv-0000")
  guard_down();guard_currently_up=False
  outage=guarded(fresh)
  ck(outage["result"]=="DENY" and outage["cause"]=="GUARD_UNAVAILABLE_FAIL_CLOSED",outage)
  guard_up();guard_currently_up=True
  after_restart=guarded(fresh)
  ck(after_restart["result"]=="ACK" and after_restart["votes"]>=2,after_restart)
  ck(guarded(fresh)["result"]=="DENY","accepted same spent JTI after guard outage")
  report["real_guard_stop_restart"]=dict(status="PASS_FAIL_CLOSED",offline=outage,recovered=after_restart,
    no_duplicate_after_restart=True)
  # Term fencing is manual and cross-DB election is NOT atomic.
  with psycopg.connect(GUARD_DSN) as c:
   c.execute("UPDATE qa_guard.term SET term=8,leader='leader-B' WHERE id=1")
  old.set_term(8,"leader-B",("witness","shadow"))
  stale=guarded(old.W.gateway.token("company-A","tv-0000"),leader="leader-A",term=7)
  current=guarded(old.W.gateway.token("company-A","tv-0000"),leader="leader-B",term=8)
  ck(stale["result"]=="DENY" and current["result"]=="ACK",("term fence failed",stale,current))
  report["manual_pinned_leader_term"]=dict(status="PASS_LOCAL_NOT_ELECTION",old_leader_DENY=True,
    new_leader_ACK=True)
  vals=[guarded(old.W.gateway.token("company-A","tv-0000"),leader="leader-B",term=8)
       for i in range(15)]
  ck(all(v["result"]=="ACK" for v in vals),"15 new JTI admissions failed")
  report["15_TV_signed_JTI_login_latency"]=dict(P95_ms=percentile([x["elapsed_ms"] for x in vals],.95),
    P99_ms=percentile([x["elapsed_ms"] for x in vals],.99),ACK=15)
  # Full rollback of guard and all three voters REACCEPTS old token.
  # This is an expected SECURITY FAIL, not a successful security gate.
  for n in old.names:old.restore(n,snapshots[n])
  restore_guard(guard_snapshot)
  revived=guarded(token)
  ck(revived["result"]=="ACK",
    ("expected full authority rollback counterexample missing",revived))
  report["FULL_3_voters_PLUS_guard_real_pg_restore"]=dict(status="SECURITY_FAIL_REPRODUCED",
    consumed_signed_JTI_reaccepted_after_full_rollback=True,result=revived)
  report["three_voters"]=old.stats()
  report["independent_guard"]=guard_state()
  report["WAL_delta_bytes"]={}
  for n in old.names:
   with psycopg.connect(old.DB[n]) as c:
    report["WAL_delta_bytes"][n]=int(c.execute("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",
      (report["three_voters"][n]["lsn"],start_voters[n]["lsn"])).fetchone()[0])
  with psycopg.connect(GUARD_DSN) as c:
   report["WAL_delta_bytes"]["external_guard"]=int(c.execute("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",
     (report["independent_guard"]["lsn"],guard_first["lsn"])).fetchone()[0])
  report["rss_controller_KiB"]=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
  report["security_verdict"]="FAIL_FULL_ROLLBACK_REPLAY_AND_UNPROVEN_SPLIT_BRAIN_CONSENSUS"
  report["elapsed_s"]=round(time.monotonic()-started,3)
  Path("qa-v2-guarded-majority.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_GUARDED_MAJORITY_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  if not guard_currently_up:
   try:guard_up()
   except Exception:pass
  for n in old.names:
   try:
    x=subprocess.run(["docker","inspect","-f","{{.State.Running}}",old.C[n]],capture_output=True,text=True)
    if x.stdout.strip()=="false":old.start(n)
   except Exception:pass
if __name__=="__main__":
 if len(sys.argv)>1 and sys.argv[1]=="worker":
  task=json.loads(sys.stdin.readline())
  barrier=os.getenv("QA_BARRIER_DIR")
  if barrier:
   (Path(barrier)/("ready-"+str(os.getpid()))).write_text("READY")
   until=time.monotonic()+8
   while not (Path(barrier)/"release").exists():
    if time.monotonic()>until:raise TimeoutError("barrier")
    time.sleep(.004)
  print(json.dumps(guarded(task["token"]),sort_keys=True),flush=True)
 else: main()
