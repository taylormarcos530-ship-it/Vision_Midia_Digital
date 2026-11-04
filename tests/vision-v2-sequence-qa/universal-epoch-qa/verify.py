"""Disposable PG17 universal-epoch-by-handler experiment.

Positive: BOTH new and legacy *wrapped* HTTP handlers must read a central
non-destructive epoch before headers AND every block; 100/300 existing,
independent PG advisory locks remain held; writer COMMIT under 750ms.
Negative: ORIGINAL unwrapped legacy worker remains reachable and bypasses
the new epoch -> full SHA-valid report after revocation (SECURITY FAIL).

No production contact, no editing existing worker files, no claim of a secure
ingress rollout or physical byte delivery cutoff.
"""
from __future__ import annotations
import concurrent.futures,importlib.util,json,os,resource,sys,tempfile,time
from pathlib import Path
import psycopg
P=Path(__file__).resolve().parent
ROOT=P.parent
def mod(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module
base=mod("qa_v2_positive",ROOT/"toctou-continuous-qa"/"positive.py")
old=mod("qa_v2_old_holder",ROOT/"pg-lock-storm-qa"/"controller.py")
http=mod("qa_v2_http_oracle",ROOT/"block-fence-qa"/"verify.py")
assert os.getenv("GITHUB_REF")==base.BRANCH
assert os.getenv("QA_STREAM_GUARD_GROUP")=="1"
N=int(os.getenv("QA_TVS"));CHUNK=int(os.getenv("QA_CHUNK"))
assert N in (100,300) and CHUNK in (65536,262144)
for name in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(name),("live env forbidden",name)
def ck(ok,msg):assert ok,msg
def db_state():
 with base.con() as c:
  c.execute("SELECT pg_stat_clear_snapshot()")
  cts=c.execute("""SELECT count(*),count(DISTINCT pid) FROM pg_locks
    WHERE locktype='advisory' AND mode='ShareLock' AND granted AND
      classid=0 AND objid=%s""",(base.LOCK_GATE,)).fetchone()
  gate=c.execute("SELECT enabled,epoch FROM qa_mproc_gate WHERE id=1").fetchone()
  epoch=c.execute("SELECT enabled,epoch FROM qa_all_path_epoch WHERE id=1").fetchone()
  return dict(held=cts[0],unique=cts[1],legacy_enabled=gate[0],
              epoch_enabled=epoch[0] if epoch else None,
              epoch=epoch[1] if epoch else None,
              lsn=str(c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0]))
def close_epoch():
 start=time.monotonic()
 try:
  with base.con() as c:
   with c.transaction():
    c.execute("SELECT set_config('lock_timeout','500ms',true)")
    c.execute("UPDATE qa_all_path_epoch SET enabled=false,epoch=epoch+1 WHERE id=1")
    value=c.execute("SELECT epoch FROM qa_all_path_epoch WHERE id=1").fetchone()[0]
  return dict(committed=True,ms=round(1000*(time.monotonic()-start),3),epoch=value)
 except psycopg.errors.LockNotAvailable:
  return dict(committed=False,ms=round(1000*(time.monotonic()-start),3),
              error="LOCK_TIMEOUT")
def make_migrated_copy(path):
 src=(ROOT/"block-fence-qa"/"worker.py").read_text()
 start=src.index("def gate_allowed(c):")
 stop=src.index("class Handler(BaseHTTPRequestHandler):",start)
 guarded="""def gate_allowed(c):
 try:
  # A shared row lock spans only one bounded HTTP block, not the full report.
  row=c.execute('SELECT enabled,epoch FROM qa_all_path_epoch WHERE id=1 FOR SHARE').fetchone()
  S.add('universal_epoch_reads')
  if not row or row[0] is not True:
   S.add('universal_epoch_denied')
   return False
  c.execute('SET LOCAL ROLE qa_mproc_reader')
  c.execute("SELECT set_config('qa.tenant','synthetic',true)")
  c.execute('SELECT pg_advisory_xact_lock_shared(%s)',(LOCK,))
  old=c.execute('SELECT enabled FROM qa_mproc_gate WHERE id=1').fetchone()
  c.execute('SELECT pg_advisory_xact_lock_shared(%s)',(63918941,))
  member=c.execute("SELECT allowed FROM qa_mproc_membership WHERE tenant='synthetic'").fetchone()
  return bool(old and old[0] and member and member[0])
 except psycopg.Error:
  S.add('universal_authority_unreachable')
  return False
"""
 src=src[:start]+guarded+src[stop:]
 path.write_text(src)
 import py_compile;py_compile.compile(str(path),doraise=True)
def pctl(worker):
 try:
  for line in Path(f"/proc/{worker.proc.pid}/status").read_text().splitlines():
   if line.startswith("VmRSS:"):return int(line.split()[1])
 except FileNotFoundError:return None
def main():
 started=time.monotonic()
 base.setup()
 with base.con() as c:
  c.execute("CREATE TABLE qa_all_path_epoch(id int PRIMARY KEY, enabled boolean NOT NULL, epoch bigint NOT NULL)")
  c.execute("INSERT INTO qa_all_path_epoch VALUES(1,true,1)")
 folder=Path(tempfile.mkdtemp(prefix="vision_v2_allpaths_"))
 make_migrated_copy(folder/"worker.py")
 prev=http.HERE
 holders=[];protected=[];unprotected=[]
 try:
  holders=[old.Worker(0,N//2),old.Worker(1,N//2)]
  first=db_state()
  ck(first["held"]==first["unique"]==N,("not N real PG backends",first))
  http.HERE=folder
  protected=[http.Child(0),http.Child(1)]
  http.HERE=ROOT/"block-fence-qa"
  unprotected=[http.Child(0)]
  http.HERE=folder
  migrated,peer=protected
  legacy=unprotected[0]
  ck(migrated.meta["sha"]==legacy.meta["sha"],"legacy source report differs")
  # Baseline: both routes serve exactly the same signed manifest source.
  pre=http.read(migrated.meta["port"],"/normal",timeout=6)
  rawpre=http.read(legacy.meta["port"],"/normal",timeout=6)
  ck(pre["application_valid"] and rawpre["application_valid"],"bad baseline")
  with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
   future=ex.submit(http.read,migrated.meta["port"],"/pause",8)
   http.await_count(migrated,"paused_after_first")
   result=close_epoch()
   ck(result["committed"] and result["ms"]<750,("non-destructive epoch exceeded budget",result))
   after=db_state()
   ck(after["held"]==after["unique"]==N and after["legacy_enabled"] and not after["epoch_enabled"],
      ("not preserving N active legacy holders",after))
   pending_before=migrated.metrics().get("application_write_completed_bytes",0)
   migrated.cmd("resume")
   truncated=future.result(timeout=9)
   ck(truncated["status"]==200 and not truncated["application_valid"],
      ("partial HTTP200 accepted",truncated))
   ck(migrated.metrics().get("application_write_completed_bytes",0)==pending_before,
      "extra application bytes after COMMIT")
  ports=[x.meta["port"] for x in protected]
  with concurrent.futures.ThreadPoolExecutor(max_workers=40) as ex:
   rejected=list(ex.map(lambda i:http.read(ports[i%2],"/normal",timeout=8),range(N)))
  ck(all(x["status"]==503 and not x["application_valid"] for x in rejected),
     ("wrapped legacy route admitted post-commit",[(x["status"],x["application_valid"]) for x in rejected if x["application_valid"]][:5]))
  # Negative: the original code does not read the new epoch. A reachable
  # direct legacy route still serves a complete authorized report.
  escaped=http.read(legacy.meta["port"],"/normal",timeout=8)
  ck(escaped["status"]==200 and escaped["application_valid"],
     ("required direct legacy bypass counterexample not reproduced",escaped))
  # Revoke access to the new authority: fail-closed for wrapped workers.
  with base.con() as c:
   c.execute("DELETE FROM qa_all_path_epoch WHERE id=1")
  vanished=[http.read(port,"/normal",timeout=5) for port in ports]
  ck(all(x["status"]==503 for x in vanished),"missing authority was not denied")
  remaining=db_state()
  ck(remaining["held"]==N,"legacy PG locks accidentally killed")
  lat=[x["ms"] for x in rejected]
  with base.con() as c:
   wal=int(c.execute("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",
       (remaining["lsn"],first["lsn"])).fetchone()[0])
  doc=dict(
    QA="PASS_EXPERIMENTAL_ALL_WRAPPED_PATHS_BUT_RAW_LEGACY_SECURITY_FAIL",
    production_GO=False,
    N_real_legacy_PG_backends=N,
    old_workers_killed_during_commit=0,
    epoch_writer=result,
    already_started_200_truncated=True,
    200_length_SHA_oracle_rejected_truncated=not truncated["application_valid"],
    wrapped_HTTP_GETs_denied_after_COMMIT=N,
    wrapped_HTTP_P95_ms=base.pct(lat,.95),
    wrapped_HTTP_P99_ms=base.pct(lat,.99),
    original_direct_legacy_route_http_200=True,
    original_direct_legacy_route_full_SHA_valid=True,
    wrapped_paths_denied_if_epoch_authority_missing=True,
    old_gate_remains_open=after["legacy_enabled"],
    epoch_table_deleted_during_negative_probe=True,
    originals_unchanged=True,
    original_data_SHA256=migrated.meta["sha"],
    min_new_epoch_checks_instrumented=sum(x.metrics().get("universal_epoch_reads",0) for x in protected),
    WAL_bytes_over_narrow_fixture=wal,
    protected_worker_RSS_kib=[pctl(x) for x in protected],
    limitations=["direct-to-origin remains reachable in synthetic test",
    "no proof every deployed legacy route uses the wrapper",
    "single CI runner not multi-host",
    "bytes queued before COMMIT can arrive afterwards"],
    security_verdict="FAIL_NO_GO_UNWRAPPED_LEGACY_ORIGIN_BYPASS",
    elapsed_seconds=round(time.monotonic()-started,3)
  )
  Path("qa-v2-all-paths.json").write_text(json.dumps(doc,indent=2,sort_keys=True))
  print("QA_V2_ALL_PATHS_JSON="+json.dumps(doc,sort_keys=True),flush=True)
 finally:
  http.HERE=prev
  for w in protected+unprotected:w.close()
  for w in holders:w.close()
if __name__=="__main__":main()
