"""Adversarial 3-node etcd Raft quorum experiment. No production use."""
from __future__ import annotations
import json,os,resource,subprocess,sys,tempfile,time
from pathlib import Path
import raft_api as raft
import pg_backup
assert os.getenv("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for env in ("SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","DATABASE_URL","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(env),("production credential forbidden",env)
def ck(v,msg):assert v,msg
def pct(seq,q):
 a=sorted(seq);p=(len(a)-1)*q;i=int(p);return round(a[i]*(1-(p-i))+a[min(i+1,len(a)-1)]*(p-i),3)
def two_processes(jti,pin):
 with tempfile.TemporaryDirectory(prefix="qa_etcd_raft_barrier_") as tmp:
  processes=[];env=dict(os.environ,QA_BARRIER_DIR=tmp)
  try:
   for _ in range(2):
    x=subprocess.Popen([sys.executable,"-u",str(Path(__file__).resolve()),"worker"],
     stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    x.stdin.write(json.dumps({"jti":jti,"pin":pin})+"\n");x.stdin.flush();x.stdin.close()
    processes.append(x)
   deadline=time.monotonic()+9
   while len(list(Path(tmp).glob("ready-*")))<2 and time.monotonic()<deadline:
    ck(all(x.poll() is None for x in processes),"OS process crashed before barrier")
    time.sleep(.006)
   ck(len(list(Path(tmp).glob("ready-*")))==2,"real OS processes missing")
   (Path(tmp)/"release").write_text("NOW")
   result=[]
   for x in processes:
    line=x.stdout.readline();x.wait(timeout=10)
    ck(x.returncode==0,("OS worker failed",x.stderr.read()[:600]))
    result.append(json.loads(line))
   return result
  finally:
   for x in processes:
    if x.poll() is None:x.kill();x.wait(timeout=3)
def docker(args):
 return subprocess.run(["docker",*args],check=True,capture_output=True,timeout=12)
def initial_cluster():
 deadline=time.monotonic()+45
 while time.monotonic()<deadline:
  try:
   a=[raft.status(h) for h in raft.HOSTS]
   ck(len({x["member"] for x in a})==3,"not independent raft members")
   ck(len({x["cluster"] for x in a})==1,"wrong cluster ID")
   ck(len({x["leader"] for x in a})==1,"no leader")
   return a
  except Exception:time.sleep(.32)
 raise AssertionError("three real etcd nodes never elected Raft leader")
def main():
 start=time.monotonic();states=initial_cluster()
 pin=states[0]["cluster"]
 raft.put("term","epoch7:leaderA")
 raft.put("owner/tv-0000","company-A")
 images,lsn=pg_backup.backup_all()
 results=two_processes("spent-JTI-identical-000001",pin)
 ck(sum(x["status"]=="ACK" for x in results)==1,results)
 ck(raft.txn("spent-JTI-identical-000001",pin=pin)["status"]=="DENY","JTI replay accepted")
 report=dict(production_GO=False,etcd_members=3,PG17_clusters=4,Redis7_local_only=True,
  real_two_OS_workers=dict(ACK=1,DENY=1,results=results),
  local_PG_SQL_restore_alone_not_Raft_rollback=True,
  security_verdict="NO_GO_OWN_RAFT_CLUSTER_ROLLBACK_TRUST_ROOT_UNPROVEN")
 rev_before=raft.status(raft.HOSTS[0])["revision"]
 report["four_PG17_physical_pg_dump_and_pg_restore"]=pg_backup.write_and_restore(
  "spent-JTI-identical-000001",images,lsn)
 ck(raft.txn("spent-JTI-identical-000001",pin=pin)["status"]=="DENY",
  "four PG17 real restore undid durable independent Raft JTI")
 rev_after=raft.status(raft.HOSTS[0])["revision"]
 ck(rev_after>=rev_before,"etcd Raft revision went backward after SQL restore")
 report["PG17_restore_Raft_still_consume_JTI"]=dict(status="PASS",
  old_JTI_rejected=True,revision_before=rev_before,revision_after=rev_after)
 raft.put("term","epoch8:leaderB")
 old=raft.txn("old-leader-00001",term="epoch7:leaderA",pin=pin)
 new=raft.txn("new-leader-00001",term="epoch8:leaderB",pin=pin)
 ck(old["status"]=="DENY" and new["status"]=="ACK","term fence")
 report["Raft_committed_term_fence"]=dict(old_leader_DENY=True,new_term_ACK=True,
  actual_client_election_not_tested=True)
 fifteen=[raft.txn("tv15-"+str(i).zfill(4),term="epoch8:leaderB",pin=pin) for i in range(15)]
 ck(all(x["status"]=="ACK" for x in fifteen),"15 JTI admissions")
 report["15_TV_JTI"]=dict(ACK=15,P95_ms=pct([x["ms"] for x in fifteen],.95),
  P99_ms=pct([x["ms"] for x in fifteen],.99))
 current=[raft.status(h) for h in raft.HOSTS]
 leader=current[0]["leader"]
 indexes=[i for i,s in enumerate(current) if s["member"]==leader]
 ck(len(indexes)==1,"Raft leader not unique")
 ix=indexes[0];node="qa-etcd-"+str(ix)
 docker(["network","disconnect","-f","qa-raft",node])
 healthy=[raft.HOSTS[j] for j in range(3) if j!=ix]
 try:
  deadline=time.monotonic()+22
  after=None
  while time.monotonic()<deadline:
   try:
    values=[raft.status(h) for h in healthy]
    if values[0]["leader"]==values[1]["leader"] and values[0]["leader"]!=leader:
     after=values;break
   except Exception:pass
   time.sleep(.28)
  ck(after is not None,"2/3 majority Raft did not elect after Docker leader isolation")
  majority=raft.txn("isolated-leader-majority-new",term="epoch8:leaderB",
   host=healthy[0],pin=pin)
  isolated=raft.txn("isolated-leader-minority-new",term="epoch8:leaderB",
   host=raft.HOSTS[ix],pin=pin)
  ck(majority["status"]=="ACK" and isolated["status"]=="DENY",
   ("split-brain Raft write",majority,isolated))
  report["real_Docker_network_partition_old_leader"]=dict(
   status="PASS_RAFT_2_OF_3_REELECT",majority_committed=True,
   isolated_member_denied=True,raft_term=after[0]["term"])
 finally:
  docker(["network","connect","qa-raft",node])
  deadline=time.monotonic()+20
  while time.monotonic()<deadline:
   try:
    s=[raft.status(h) for h in raft.HOSTS]
    if len({x["leader"] for x in s})==1:break
   except Exception:pass
   time.sleep(.3)
 ck(raft.txn("spent-JTI-identical-000001",term="epoch8:leaderB",pin=pin)["status"]=="DENY",
  "healed node replay")
 # An independent cluster is NOT Raft quorum with the authoritative cluster.
 shadow=raft.status(raft.SHADOW)
 ck(shadow["cluster"]!=pin,"shadow is not independent")
 raft.put("term","epoch8:leaderB",host=raft.SHADOW)
 raft.put("owner/tv-0000","company-A",host=raft.SHADOW)
 dup="jti-shared-two-uncoordinated-clusters"
 approved=raft.txn(dup,term="epoch8:leaderB",pin=pin)
 unpinned=raft.txn(dup,term="epoch8:leaderB",host=raft.SHADOW)
 pinned=raft.txn("foreign-cluster-token",term="epoch8:leaderB",
  host=raft.SHADOW,pin=pin)
 ck(approved["status"]=="ACK" and unpinned["status"]=="ACK" and
  pinned["status"]=="DENY" and pinned["reason"]=="FOREIGN_CLUSTER",
  "foreign cluster identity counterexample")
 report["independent_wrong_membership_split_brain"]=dict(
  unpinned_duplicate_ACCEPTED=True,pinned_foreign_cluster_DENY=True,
  status="SECURITY_FAIL_IF_ENDPOINT_PIN_MISSING")
 report["controller_RSS_KiB"]=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
 report["duration_s"]=round(time.monotonic()-start,3)
 report["limitations"]=[
  "etcd Raft had 3 members but all containers were on ONE CI host",
  "isolated CI bridge uses plaintext etcd peer and client HTTP; no prod mTLS",
  "application election and JWT ingress/WSS not wired to this Raft fixture",
  "full rollback of etcd own state not prevented by independent hardware monotonic root",
  "recreating same cluster identity can invalidate cluster-id pin as antirollback defense",
  "4 PostgreSQL17 backups/restores were synthetic SQL schemas, not all production data",
  "outside-cluster shadow still accepts identical JTI if client does not pin membership"]
 Path("qa-raft-integrity.json").write_text(json.dumps(report,sort_keys=True,indent=2))
 print("QA_RAFT_INTEGRITY_JSON="+json.dumps(report,sort_keys=True),flush=True)
def worker():
 x=json.loads(sys.stdin.readline())
 d=os.getenv("QA_BARRIER_DIR")
 if d:
  (Path(d)/("ready-"+str(os.getpid()))).write_text("READY")
  until=time.monotonic()+9
  while not (Path(d)/"release").exists():
   if time.monotonic()>until:raise TimeoutError("synchronized worker barrier")
   time.sleep(.005)
 print(json.dumps(raft.txn(x["jti"],pin=x["pin"]),sort_keys=True),flush=True)
if __name__=="__main__":
 if len(sys.argv)>1 and sys.argv[1]=="worker":worker()
 else:main()
