"""Disposable THREE PostgreSQL17 voter JTI fencing experiment with real pg_restore.

2/3 durable local votes and pinned leader term are NOT consensus:
non-atomic writes, Byzantine/privileged restores, reconfiguration,
network partition timing and cross-host cluster membership are unproven.
A two-voter rollback REACCEPTS the same signed token: SECURITY FAIL.
"""
from __future__ import annotations
import concurrent.futures,importlib.util,json,os,resource,subprocess,sys,tempfile,time
from pathlib import Path
import psycopg
P=Path(__file__).resolve().parent
S=importlib.util.spec_from_file_location("quorum_worker",P/"worker.py")
W=importlib.util.module_from_spec(S);S.loader.exec_module(W)
assert os.getenv("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for k in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(k),("live infrastructure forbidden",k)
names=("witness","shadow","anchor")
C={name:os.environ["QA_VOTER_"+name.upper()+"_CONTAINER"] for name in names}
for name,id in C.items():
 assert len(id)>=12 and all(ch in "0123456789abcdef" for ch in id.lower()),(name,id)
DB={name:dsn for name,dsn in zip(names,W.VOTERS)}
DATABASES={"witness":"vision_v2_witness_disposable","shadow":"vision_v2_witness_shadow_disposable","anchor":"vision_v2_anchor_disposable"}
def ck(cond,why):assert cond,why
def docker(args,container,input=None):
 cmd=["docker","exec"]+([] if input is None else ["-i"])+[container,*args]
 return subprocess.run(cmd,input=input,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=40).stdout
def setup():
 for dsn in DB.values():
  with psycopg.connect(dsn,autocommit=True) as c:
   ck(int(c.execute("SHOW server_version_num").fetchone()[0])//10000==17,"not pg17")
   c.execute("CREATE SCHEMA qa_quorum")
   c.execute("CREATE TABLE qa_quorum.term(id integer PRIMARY KEY,term bigint NOT NULL,leader text NOT NULL)")
   c.execute("INSERT INTO qa_quorum.term VALUES(1,7,'leader-A')")
   c.execute("CREATE TABLE qa_quorum.owner(device text PRIMARY KEY,tenant text NOT NULL,revoked boolean NOT NULL)")
   c.execute("INSERT INTO qa_quorum.owner VALUES('tv-0000','company-A',false)")
   c.execute("""CREATE TABLE qa_quorum.spent(jti text PRIMARY KEY,device text NOT NULL,tenant text NOT NULL,
      term bigint NOT NULL,leader text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp())""")
def backup(name):
 data=docker(["pg_dump","-U","postgres","-Fc","-d",DATABASES[name],"-n","qa_quorum"],C[name])
 ck(len(data)>1000,("real dump missing",name))
 return data
def restore(name,blob):
 docker(["pg_restore","-U","postgres","-d",DATABASES[name],
         "--clean","--if-exists","--no-owner","--exit-on-error"],C[name],input=blob)
def stats():
 state={}
 for name,dsn in DB.items():
  with psycopg.connect(dsn,autocommit=True) as c:
   row=c.execute("SELECT term,leader FROM qa_quorum.term WHERE id=1").fetchone()
   state[name]=dict(term=row[0],leader=row[1],
    spent=c.execute("SELECT count(*) FROM qa_quorum.spent").fetchone()[0],
    db_bytes=c.execute("SELECT pg_database_size(current_database())").fetchone()[0],
    spent_relation_bytes=c.execute("SELECT pg_total_relation_size('qa_quorum.spent')").fetchone()[0],
    lsn=str(c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0]))
 return state
def single(token,leader="leader-A",term=7):
 p=subprocess.run([sys.executable,"-u",str(P/"worker.py")],
   input=json.dumps(dict(token=token,leader=leader,term=term)),text=True,
   capture_output=True,timeout=12,check=True)
 return json.loads(p.stdout.strip())
def parallel(token):
 with tempfile.TemporaryDirectory(prefix="qa_v2_quorum_barrier_") as temp:
  env=dict(os.environ,QA_BARRIER_DIR=temp)
  tasks=[]
  for i in range(2):
   p=subprocess.Popen([sys.executable,"-u",str(P/"worker.py")],
      stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
      text=True,bufsize=1,env=env)
   p.stdin.write(json.dumps(dict(token=token))+"\n")
   p.stdin.flush();p.stdin.close()
   tasks.append(p)
  end=time.monotonic()+9
  while time.monotonic()<end and len(list(Path(temp).glob("ready-*")))<2:
   if any(p.poll() is not None for p in tasks):break
   time.sleep(.004)
  ck(len(list(Path(temp).glob("ready-*")))==2,"real two OS process barrier not reached")
  (Path(temp)/"release").write_text("GO")
  responses=[]
  for p in tasks:
   line=p.stdout.readline();p.wait(timeout=8)
   ck(p.returncode==0,("auth worker failed",p.returncode,p.stderr.read()[:900]))
   responses.append(json.loads(line))
   p.stdout.close();p.stderr.close()
  return responses
def set_term(term,leader,names_to_update):
 for name in names_to_update:
  with psycopg.connect(DB[name]) as c:
   c.execute("UPDATE qa_quorum.term SET term=%s,leader=%s WHERE id=1",(term,leader))
def stop(name):
 subprocess.run(["docker","stop","--time","1",C[name]],check=True,capture_output=True,timeout=12)
def start(name):
 subprocess.run(["docker","start",C[name]],check=True,capture_output=True,timeout=15)
 end=time.monotonic()+15
 while time.monotonic()<end:
  p=subprocess.run(["docker","exec",C[name],"pg_isready","-U","postgres","-d",DATABASES[name]],
    capture_output=True)
  if p.returncode==0:return
  time.sleep(.18)
 raise AssertionError(("voter failed restart",name))
def percent(a,p):
 z=sorted(a);index=(len(z)-1)*p;i=int(index);w=index-i
 return round(z[i]*(1-w)+z[min(len(z)-1,i+1)]*w,3)
def main():
 t=time.monotonic()
 setup()
 initial=stats()
 images={name:backup(name) for name in names}
 report=dict(production_GO=False,actual_PostgreSQL17_voters=3,actual_distinct_worker_processes=2,
   primitive="non_atomic_SQL_majority_vote_and_pinned_leader_term_NOT_CONSENSUS",
   quorum_size=2,independent_monotonic_hardware_or_consensus=False,
   initial_backup_bytes={k:len(v) for k,v in images.items()},synthetic_tokens_only=True)
 try:
  token=W.gateway.token("company-A","tv-0000")
  simultaneous=parallel(token)
  ck(sum(x["status"]=="ACK" for x in simultaneous)==1,
     ("same JTI admitted twice through real two-process local 2/3 vote",simultaneous))
  ck(single(token)["status"]=="DENY","JWT replay not rejected after 2/3 local durable commit")
  report["two_process_same_JTI"]=dict(status="PASS_LOCAL_AT_MOST_ONE_QUORUM_ACK",workers=simultaneous)

  # One voter failure does not prevent 2/3 majority; two down must fail closed.
  stop("anchor")
  one_down=single(W.gateway.token("company-A","tv-0000"))
  ck(one_down["status"]=="ACK" and one_down["durable_voters"]==2,one_down)
  start("anchor")
  stop("shadow");stop("anchor")
  two_down=single(W.gateway.token("company-A","tv-0000"))
  ck(two_down["status"]=="DENY" and two_down["durable_voters"]<2,two_down)
  start("shadow");start("anchor")
  report["voter_failures"]=dict(one_down=dict(result=one_down,status="PASS_LOCAL_MAJORITY"),
    two_down=dict(result=two_down,status="PASS_FAIL_CLOSED_MINORITIED"))

  # One voter restored to old physical SQL snapshot: remaining majority still
  # has the consumed JTI; repeated signed token must not acquire 2 votes.
  restore("witness",images["witness"])
  one_rollback=single(token)
  ck(one_rollback["status"]=="DENY",("single restored voter let replay through",one_rollback))
  report["single_voter_pg_restore"]=dict(status="PASS_IF_AT_LEAST_TWO_VOTERS_STILL_DURABLE",
    token_reaccepted=False,attempt=one_rollback)

  # REAL pg_dump + pg_restore of two voters back before original used token:
  # a 2/3 majority reverses token history, and full JTI replay is accepted.
  restore("witness",images["witness"])
  restore("shadow",images["shadow"])
  majority_rollback=single(token)
  ck(majority_rollback["status"]=="ACK" and majority_rollback["durable_voters"]>=2,
     ("two-voter restore counterexample was not reproduced",majority_rollback))
  report["two_voter_pg_restore"]=dict(status="SECURITY_FAIL_REPRODUCED",
    old_signed_JTI_reaccepted=True,attempt=majority_rollback,
    majority_restore_reverses_durable_history=True)

  # Manual leader term changes are NOT a safe election/quorum consensus proof.
  # Two upgraded PG voters fence term7 leader-A; one stale third voter cannot
  # make quorum alone, but privileged majority rollback can reinstate term7.
  set_term(8,"leader-B",("witness","shadow"))
  old_leader=single(W.gateway.token("company-A","tv-0000"),leader="leader-A",term=7)
  new_leader=single(W.gateway.token("company-A","tv-0000"),leader="leader-B",term=8)
  ck(old_leader["status"]=="DENY" and new_leader["status"]=="ACK",
     ("manual term fencing ineffective",old_leader,new_leader))
  report["manual_term_fencing"]=dict(status="PASS_LOCAL_ONLY_NOT_AN_ELECTION",
    stale_leader_rejected=True,new_majority_leader_accepted=True,
    old=old_leader,new=new_leader)

  # Token-majority storage metrics on 15 signed independent disposable JWTs.
  values=[single(W.gateway.token("company-A","tv-0000"),leader="leader-B",term=8)
          for _ in range(15)]
  ck(all(x["status"]=="ACK" for x in values),"candidate capacity 15 JTI");
  report["15_token_login_trial"]=dict(P95_ms=percent([x["latency_ms"] for x in values],.95),
    P99_ms=percent([x["latency_ms"] for x in values],.99),
    ACKs=15,
    explicit_JTI_voter_transactions_at_least=30,
    not_WSS_per_frame_latency=True)
  end=stats()
  report["storage"]=end
  report["WAL_delta_bytes"]={}
  for name in names:
   with psycopg.connect(DB[name]) as c:
    report["WAL_delta_bytes"][name]=int(c.execute(
      "SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",(end[name]["lsn"],initial[name]["lsn"])).fetchone()[0])
  report["RSS_Controller_KiB"]=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
  report["security_verdict"]="FAIL_NO_GO_2OF3_RESTORE_REPLAY_SPLIT_BRAIN_AND_NO_CONSENSUS"
  report["limitations"]=[
   "Three durable SQL votes are not Raft/Paxos quorum agreement",
   "Partial writes may remain after refused admission",
   "Actual multi-host network partition, leader election and quorum membership not proven",
   "Two-voter pg_restore reaccepts consumed signed token",
   "Two independent quorum sets/split-brain not integrated (prior 2-anchor test FAIL remains)",
   "Hardware monotonic anchor, cryptographic membership certificates absent",
   "No real authenticated player transition or on-device WSS integration"]
  report["elapsed_s"]=round(time.monotonic()-t,3)
  Path("qa-v2-three-voter-quorum.json").write_text(json.dumps(report,indent=2,sort_keys=True))
  print("QA_3VOTER_QUORUM_JSON="+json.dumps(report,sort_keys=True),flush=True)
 finally:
  for name in names:
   try:
    p=subprocess.run(["docker","inspect","-f","{{.State.Running}}",C[name]],capture_output=True,text=True)
    if p.stdout.strip()=="false":start(name)
   except Exception:pass
if __name__=="__main__":main()
