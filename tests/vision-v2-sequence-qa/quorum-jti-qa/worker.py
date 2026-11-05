"""QA ONLY: three disposable PG17 voters with deterministic leader-term fencing.
A local admission requires 2/3 durable ON CONFLICT DO NOTHING inserts. This is
NOT Raft/Paxos, atomic distributed commit, physical anti-rollback or HA.
Fail closed when majority not obtained; partial writes intentionally persist.
"""
import json,os,sys,time,resource
from pathlib import Path
import psycopg
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/"wss-scale-qa"))
import gateway
assert os.getenv("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for k in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(k),("forbidden production credentials",k)
VOTERS=(
 "postgresql://postgres:qa-only-witness-password@127.0.0.1:5433/vision_v2_witness_disposable?connect_timeout=1",
 "postgresql://postgres:qa-only-shadow-password@127.0.0.1:5435/vision_v2_witness_shadow_disposable?connect_timeout=1",
 "postgresql://postgres:qa-only-anchor-password@127.0.0.1:5436/vision_v2_anchor_disposable?connect_timeout=1"
)
def vote(dsn,jti,tenant,device,leader,term):
 try:
  with psycopg.connect(dsn) as c:
   with c.transaction():
    c.execute("SELECT set_config('statement_timeout','450ms',true)")
    c.execute("SELECT set_config('lock_timeout','150ms',true)")
    c.execute("SELECT set_config('synchronous_commit','on',true)")
    row=c.execute("SELECT term,leader FROM qa_quorum.term WHERE id=1 FOR UPDATE").fetchone()
    if not row or row!=(term,leader):return False
    owner=c.execute("SELECT tenant,revoked FROM qa_quorum.owner WHERE device=%s FOR SHARE",(device,)).fetchone()
    if not owner or owner!=(tenant,False):return False
    inserted=c.execute("""INSERT INTO qa_quorum.spent(jti,device,tenant,term,leader)
      VALUES(%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING jti""",
      (jti,device,tenant,term,leader)).fetchone()
    return bool(inserted)
 except (psycopg.Error,OSError):return False
def authorize(token,leader="leader-A",term=7):
 claims=gateway.verify(token)
 begun=time.monotonic()
 accepted=0;tried=0
 for dsn in VOTERS:
  tried+=1
  if vote(dsn,claims["jti"],claims["company"],claims["device"],leader,term):accepted+=1
 return dict(status="ACK" if accepted>=2 else "DENY",durable_voters=accepted,
   attempted=tried,jti=claims["jti"],leader=leader,term=term,
   latency_ms=round((time.monotonic()-begun)*1000,3),
   rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
if __name__=="__main__":
 item=json.loads(sys.stdin.read())
 barrier=os.getenv("QA_BARRIER_DIR")
 if barrier:
  ready=Path(barrier)/("ready-"+str(os.getpid()))
  ready.write_text("READY",encoding="utf-8")
  until=time.monotonic()+8
  while not (Path(barrier)/"release").exists():
   if time.monotonic()>until:raise TimeoutError("QA deterministic two-worker barrier")
   time.sleep(.006)
 print(json.dumps(authorize(item["token"],item.get("leader","leader-A"),item.get("term",7)),sort_keys=True),flush=True)
