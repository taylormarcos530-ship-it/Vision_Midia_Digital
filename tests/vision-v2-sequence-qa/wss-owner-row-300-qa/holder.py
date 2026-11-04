"""Disposable PG17 physical OS process holding N/2 row FOR SHARE transactions.
The precise tuple-level locks may not appear as separate pg_locks rows:
verify explicit SQL, 100/300 DISTINCT backend PIDs, RowShareLock relations and
a blocked real writer. No official project/network credentials, ever.
"""
import concurrent.futures,json,os,resource,sys,threading,time
import psycopg
assert os.getenv('GITHUB_REF')=='refs/heads/experiment/vision-v2-toctou-continuous-guard-qa-20261102'
assert os.getenv('QA_STREAM_GUARD_GROUP')=='1'
for key in ('DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PGHOST','PGSERVICE','REDIS_URL'):
 assert not os.getenv(key),(key,'production credentials forbidden')
N=int(os.environ['QA_ROW_HOLDERS']);WORKER=os.environ['QA_ROW_WORKER']
assert N in (50,150) and WORKER in ('0','1')
DB=dict(host='127.0.0.1',port=5432,dbname='vision_v2_quarantine_disposable',
  user='postgres',password='qa-only-local-password',connect_timeout=4,
  application_name='vision-v2-row-holder-'+WORKER)
barrier=threading.Barrier(N+1)
event=threading.Event()
ids=[];errors=[];mutex=threading.Lock()
def hold(i):
 try:
  with psycopg.connect(**DB) as c:
   with c.transaction():
    pid=c.execute('SELECT pg_backend_pid()').fetchone()[0]
    row=c.execute("SELECT tenant FROM qa_owner WHERE device='tv-0000' FOR SHARE").fetchone()
    assert row==('company-A',),row
    with mutex:ids.append(pid)
    barrier.wait(timeout=28)
    event.wait(timeout=30)
 except BaseException as e:
  with mutex:errors.append(str(e))
  try:barrier.abort()
  except BaseException:pass
def main():
 with concurrent.futures.ThreadPoolExecutor(max_workers=N) as ex:
  fs=[ex.submit(hold,i) for i in range(N)]
  barrier.wait(timeout=32)
  assert len(ids)==N and len(set(ids))==N,(len(ids),errors)
  print(json.dumps(dict(type='ROW_HOLDERS_READY',PIDs=ids,count=N,worker=WORKER,
    process_pid=os.getpid(),rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)),flush=True)
  for line in sys.stdin:
   msg=json.loads(line)
   if msg.get('cmd')=='release':
    event.set()
    print('{"released":true}',flush=True)
    break
  event.set()
  for f in fs:f.result(timeout=8)
  assert not errors,errors
if __name__=='__main__':main()
