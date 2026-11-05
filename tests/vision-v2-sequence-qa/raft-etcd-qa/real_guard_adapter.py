"""Actual previous 3-voter + guard QA schemas rolled back together while Raft persists.

Shows unwrapped old SQL authority ACK after full pg_restore (SECURITY FAIL),
but a mandatory Raft JTI CAS gate denies this spent token. All 4 databases
are local PG17 disposable, no real rollback-proof external hardware.
"""
from __future__ import annotations
import importlib.util,json,os,resource,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/"raft-etcd-qa"))
import raft_api as raft
SPEC=importlib.util.spec_from_file_location("original_guarded",HERE.parent/"guarded-majority-qa"/"verify.py")
G=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(G)
assert os.getenv("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for k in ("SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","DATABASE_URL","REDIS_URL","PGHOST","PGSERVICE"):
 assert not os.getenv(k),("forbidden official connection",k)
def main():
 t=time.monotonic()
 G.setup()
 images={name:G.old.backup(name) for name in G.old.names}
 guarded=G.backup_guard()
 token=G.old.W.gateway.token("company-A","tv-0000")
 signed=G.old.W.gateway.verify(token)
 expected_cluster=raft.status(raft.HOSTS[0])["cluster"]
 # Prove that before SQL restore both independent gates have spent the same JTI.
 sql_before=G.guarded(token)
 raft_before=raft.txn(signed["jti"],term="epoch8:leaderB",pin=expected_cluster)
 assert sql_before["result"]=="ACK" and raft_before["status"]=="ACK",(
  "initial SQL and Raft admission did not succeed",sql_before,raft_before)
 for n in G.old.names:G.old.restore(n,images[n])
 G.restore_guard(guarded)
 # Old unwrapped four-PG17 authority alone is vulnerable to full rollback.
 unwrapped=G.guarded(token)
 assert unwrapped["result"]=="ACK",(
  "four-PG SQL restore did not reproduce historical replay counterexample",unwrapped)
 # Mandatory independent actual Raft transaction remains consumed.
 fenced=raft.txn(signed["jti"],term="epoch8:leaderB",pin=expected_cluster)
 assert fenced["status"]=="DENY" and fenced["reason"]=="CAS_DENY",fenced
 # Network quorum and cluster-ID verification are required in production.
 report={
  "production_GO":False,"real_PG17_three_voters_and_guard_rolled_back":True,
  "actual_previous_SQL_authority_schema_restored":True,
  "historical_unwrapped_SQL_JTI_reaccepted":"ACK"==unwrapped["result"],
  "independent_etcd_Raft_JTI_prevented_replay":"DENY"==fenced["status"],
  "initial_RAFT_JTI_revision":raft_before["revision"],
  "last_RAFT_JTI_revision":fenced["revision"],
  "cluster_pinned":True,
  "SQL_full_rollback_security_verdict":"SECURITY_FAIL_IF_INGRESS_CAN_BYPASS_RAFT",
  "Raft_ledger_security_verdict":"PASS_IF_RAFT_ITSELF_NOT_RESTORED",
  "full_RAFT_cluster_rollback_resistance_proven":False,
  "cross_host_consensus_proven":False,
  "latency_Raft_initial_ms":raft_before["ms"],
  "latency_Raft_replay_ms":fenced["ms"],
  "legacy_SQL_replay_voters":unwrapped.get("votes",0),
  "controller_RSS_KiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
  "duration_s":round(time.monotonic()-t,3),
  "release_verdict":"NO_GO_GLOBAL_ROLLBACK_MEMBERSHIP_AND_ALL_INGRESS_UNPROVEN"
 }
 Path("qa-real-3voter-plus-guard-raft.json").write_text(json.dumps(report,sort_keys=True,indent=2))
 print("QA_REAL_GUARD_RAFT_INTEGRATION_JSON="+json.dumps(report,sort_keys=True),flush=True)
if __name__=="__main__":main()
