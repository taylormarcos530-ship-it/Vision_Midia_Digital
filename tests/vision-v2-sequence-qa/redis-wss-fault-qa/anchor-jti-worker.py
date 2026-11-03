"""Separate authority PROCESS for synthetic JWT JTI and owner authorization.
JTI is globally unique only when all processes use ONE external PG17 anchor.
Not a production WSS gateway, not a monotonic hardware/anti-rollback proof.
"""
import json,os,sys,time
import psycopg
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent/"wss-scale-qa"
sys.path.insert(0,str(ROOT))
import gateway
assert os.getenv("GITHUB_REF")=="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for k in ("SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","DATABASE_URL","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(k),(k,"live credential prohibited")
ROLE=os.environ["QA_LOCAL_ROLE"]
assert ROLE in ("primary","secondary","shadow-rogue")
PORT=5433 if ROLE=="primary" else 5435
LOCAL=f"postgresql://postgres:{'qa-only-witness-password' if PORT==5433 else 'qa-only-shadow-password'}@127.0.0.1:{PORT}/"+("vision_v2_witness_disposable" if PORT==5433 else "vision_v2_witness_shadow_disposable")+"?connect_timeout=2"
ANCHOR=os.environ["QA_ANCHOR_DSN"]
assert ANCHOR.startswith("postgresql://postgres:") and ("@127.0.0.1:5436/" in ANCHOR or "@127.0.0.1:5435/" in ANCHOR)
def authorize(msg):
 try:
  claims=gateway.verify(msg["token"])
  device=claims["device"];tenant=claims["company"];jti=claims["jti"]
  # Fake local mirror may roll back but never may authorize without global anchor.
  with psycopg.connect(LOCAL) as local:
   with local.transaction():
    cur=local.execute("INSERT INTO qa_local.jti(jti) VALUES(%s) ON CONFLICT DO NOTHING RETURNING jti",(jti,))
    if cur.fetchone() is None:return dict(accepted=False,error="LOCAL_JTI_REPLAY")
    with psycopg.connect(ANCHOR) as auth:
     with auth.transaction():
      row=auth.execute(
        "SELECT tenant FROM qa_anchor.owner WHERE device=%s AND NOT revoked FOR SHARE",
        (device,)).fetchone()
      if not row or row[0]!=tenant:
       raise PermissionError("GLOBAL_OWNER_DENIED")
      accepted=auth.execute(
       "INSERT INTO qa_anchor.jti(jti,tenant,device) VALUES(%s,%s,%s) "
       "ON CONFLICT DO NOTHING RETURNING jti",(jti,tenant,device)).fetchone()
      if accepted is None:raise PermissionError("GLOBAL_JTI_REPLAY")
  return dict(accepted=True,tenant=tenant,device=device,global_jti_added=True)
 except PermissionError as ex:return dict(accepted=False,error=str(ex))
 except Exception as ex:return dict(accepted=False,error="AUTHORITY_UNAVAILABLE",reason=type(ex).__name__)
def main():
 print(json.dumps({"ready":ROLE,"pid":os.getpid(),"anchor_port":5435 if "@127.0.0.1:5435/" in ANCHOR else 5436}),flush=True)
 for line in sys.stdin:
  try:
   msg=json.loads(line)
   if msg.get("op")=="stop":print('{"bye":true}',flush=True);break
   if msg.get("op")=="auth":print(json.dumps(authorize(msg),sort_keys=True),flush=True)
   else:print('{"error":"UNKNOWN"}',flush=True)
  except Exception as e:print(json.dumps({"error":"TEST_WORKER_ERROR","type":type(e).__name__}),flush=True)
if __name__=="__main__":main()
