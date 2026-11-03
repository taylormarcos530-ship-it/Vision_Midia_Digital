"""Disposable PG17 real advisory lock holder. No network or official credentials.
Multiple independent sessions hold a shared xact lock until real OS SIGKILL.
It does NOT model a safely deployable server-side cancellation mechanism.
"""
import concurrent.futures,json,os,resource,signal,sys,threading,time
import psycopg
BR="refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102"
assert os.getenv("GITHUB_REF")==BR and os.getenv("QA_STREAM_GUARD_GROUP")=="1"
for k in ("DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PGHOST","PGSERVICE","REDIS_URL"):
 assert not os.getenv(k),(k,"live_credentials_prohibited")
N=int(os.environ["QA_HOLDER_COUNT"]);IDENT=os.environ["QA_HOLDER_ID"]
assert N in (50,150) and IDENT in ("0","1")
LOCK=63918942
KW=dict(host="127.0.0.1",port=5432,dbname="vision_v2_quarantine_disposable",
 user="postgres",password="qa-only-local-password",connect_timeout=5)
start=threading.Barrier(N+1)
release=threading.Event()
errors=[]
pids=[]
mu=threading.Lock()
def holder(i):
 try:
  c=psycopg.connect(**KW)
  try:
   with c.transaction():
    c.execute("SELECT pg_advisory_xact_lock_shared(%s)",(LOCK,))
    pid=int(c.execute("SELECT pg_backend_pid()").fetchone()[0])
    with mu:pids.append(pid)
    start.wait(timeout=30)
    release.wait(timeout=45)
  finally:c.close()
 except BaseException as ex:
  with mu:errors.append(str(ex))
  try:start.abort()
  except Exception:pass
def main():
 with concurrent.futures.ThreadPoolExecutor(max_workers=N) as pool:
  jobs=[pool.submit(holder,i) for i in range(N)]
  start.wait(timeout=32)
  assert len(pids)==N and len(set(pids))==N,(len(pids),errors)
  print(json.dumps({"type":"LOCKS_HELD","worker":IDENT,"n":N,"pids":sorted(pids),
     "pid":os.getpid(),"rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
     "sql_explicit_queries_lower_bound":N*2}),flush=True)
  while True:
   line=sys.stdin.readline()
   if not line:break
   cmd=json.loads(line)["cmd"]
   if cmd=="release":
    release.set()
    print('{"type":"RELEASED"}',flush=True)
    break
   if cmd=="stats":
    print(json.dumps({"type":"STATS","n":len(pids),"rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}),flush=True)
  release.set()
  for f in jobs:f.result(timeout=10)
  assert not errors,errors
if __name__=="__main__":main()
