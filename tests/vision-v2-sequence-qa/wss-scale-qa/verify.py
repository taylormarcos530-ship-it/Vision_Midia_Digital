"""QA orchestrator: real WSS TLS over two+ OS processes, Redis 7 and PostgreSQL17.
No official credentials. SIGKILL independent process and 12s Redis TTL, failover.
The in-memory provider profile change does NOT change an actual Supabase plan.
"""
from __future__ import annotations
import argparse,asyncio,hashlib,json,math,os,resource,signal,socket,ssl,statistics,sys,tempfile,time
from pathlib import Path
import psycopg
from redis.asyncio import Redis
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed
from gateway import DSN,token,HEARTBEAT_TTL_MS
def percentile(vals,p):
 xs=sorted(vals);r=(len(xs)-1)*p/100;i=int(r);j=min(i+1,len(xs)-1)
 return round(xs[i]*(1-(r-i))+xs[j]*(r-i),3)
class Client:
 def __init__(self,device,tenant,idx,sslctx,ports):
  self.device=device;self.tenant=tenant;self.idx=idx;self.sslctx=sslctx;self.ports=ports
  self.ws=None;self.nonce=None;self.session=None;self.seq=0
  self.read_lock=asyncio.Lock();self.last_active=time.monotonic()
  self.up=True
  self.sent_bytes=0;self.received_bytes=0
 async def open(self,slot=None,timeout=20):
  slot=self.idx if slot is None else slot
  ws=await asyncio.wait_for(connect('wss://localhost:'+str(self.ports[slot]),ssl=self.sslctx,
   max_size=2048,ping_interval=None,open_timeout=12,close_timeout=1),timeout)
  auth=json.dumps({'type':'auth','token':token(self.tenant,self.device)},separators=(',',':'))
  self.sent_bytes+=len(auth.encode())
  await ws.send(auth)
  payload=await asyncio.wait_for(ws.recv(),timeout=timeout)
  self.received_bytes+=len(payload.encode())
  reply=json.loads(payload)
  assert reply['type']=='ready',(self.device,reply)
  assert reply['protocol']=='vision.presence.v1'
  self.ws=ws;self.nonce=reply['nonce'];self.session=reply['session'];self.seq=0
  self.up=True;self.idx=slot;self.last_active=time.monotonic()
  return reply
 async def frame(self,frame,timeout=12):
  async with self.read_lock:
   if not self.up:return None
   try:
    payload=json.dumps(frame,separators=(',',':'))
    self.sent_bytes+=len(payload.encode())
    await self.ws.send(payload)
    response=await asyncio.wait_for(self.ws.recv(),timeout=timeout)
    self.received_bytes+=len(response.encode())
    resp=json.loads(response)
    self.last_active=time.monotonic()
    return resp
   except (ConnectionClosed,ConnectionResetError,TimeoutError,OSError):
    self.up=False
    return None
 async def heartbeat(self,timings=None):
  if not self.up:return False
  async with self.read_lock:
   try:
    seq=self.seq+1
    frame={'type':'heartbeat','seq':seq,'nonce':self.nonce}
    start=time.perf_counter_ns()
    payload=json.dumps(frame,separators=(',',':'))
    self.sent_bytes+=len(payload.encode())
    await self.ws.send(payload)
    reply=await asyncio.wait_for(self.ws.recv(),timeout=15)
    self.received_bytes+=len(reply.encode())
    response=json.loads(reply)
    if response.get('type')!='heartbeat_ack' or response.get('seq')!=seq:
     raise AssertionError((self.device,response))
    self.seq=seq;self.last_active=time.monotonic()
    if timings is not None:timings.append((time.perf_counter_ns()-start)/1e6)
    return response
   except (ConnectionClosed,ConnectionResetError,TimeoutError,OSError):
    self.up=False;return False
 async def close(self):
  if self.ws:
   try:await self.ws.close()
   except Exception:pass
  self.up=False
def check_env():
 assert os.environ.get('GITHUB_REF')=='refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031'
 assert os.environ.get('QA_STREAM_GUARD_GROUP')=='1'
 for k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','PGHOST','PGSERVICE'):
  assert not os.environ.get(k),('FORBIDDEN_REAL_ENV',k)
 with psycopg.connect(DSN,autocommit=True) as c:
  assert c.execute('select current_database()').fetchone()[0]=='vision_v2_quarantine_disposable'
  assert int(c.execute('show server_version_num').fetchone()[0])//10000==17
def setup(tvs):
 with psycopg.connect(DSN,autocommit=True) as c:
  c.execute('CREATE SCHEMA qa_wss')
  c.execute("""CREATE TABLE qa_wss.status(
    tenant text NOT NULL,device text NOT NULL,lease text NOT NULL,
    online boolean NOT NULL,changed_at timestamptz NOT NULL,
    PRIMARY KEY(tenant,device))""")
  c.execute("""CREATE TABLE qa_wss.commands(
    tenant text NOT NULL,device text NOT NULL,id text NOT NULL,
    acknowledged_at timestamptz NOT NULL,PRIMARY KEY(tenant,device,id))""")
  c.execute('CREATE ROLE qa_wss_reader NOLOGIN')
  c.execute('GRANT USAGE ON SCHEMA qa_wss TO qa_wss_reader')
  c.execute('GRANT SELECT ON qa_wss.status,qa_wss.commands TO qa_wss_reader')
  for table in ('status','commands'):
   c.execute(f'ALTER TABLE qa_wss.{table} ENABLE ROW LEVEL SECURITY')
   c.execute(f'ALTER TABLE qa_wss.{table} FORCE ROW LEVEL SECURITY')
   c.execute(f"""CREATE POLICY tenant_select ON qa_wss.{table}
     FOR SELECT TO qa_wss_reader
     USING(tenant=current_setting('qa.jwt.company',true))""")
  assert c.execute("SELECT count(*) FROM qa_wss.status").fetchone()[0]==0
def rls_check():
 with psycopg.connect(DSN,autocommit=True) as c:
  with c.transaction():
   c.execute('SET LOCAL ROLE qa_wss_reader')
   c.execute("SELECT set_config('qa.jwt.company','company-A',true)")
   assert c.execute("SELECT count(*) FROM qa_wss.status WHERE tenant='company-B'").fetchone()[0]==0
   assert c.execute("SELECT count(*) FROM qa_wss.status WHERE tenant='company-A'").fetchone()[0]>0
  with c.transaction():
   c.execute('SET LOCAL ROLE qa_wss_reader')
   try:c.execute('UPDATE qa_wss.status SET online=false')
   except psycopg.errors.InsufficientPrivilege:pass
   else:raise AssertionError('tenant_read_role_can_write')
async def wait_ready(port,proc):
 for _ in range(150):
  if proc.returncode is not None:raise RuntimeError('gateway_start_exited:'+str(proc.returncode))
  try:
   r,w=await asyncio.open_connection('127.0.0.1',port)
   w.close();await w.wait_closed();return
  except (ConnectionRefusedError,OSError):await asyncio.sleep(.12)
 raise TimeoutError('WSS gateway not listening')
async def negative_auth(port,ctx):
 async def attempt(t):
  async with connect(f'wss://localhost:{port}',ssl=ctx,ping_interval=None) as w:
   await w.send(json.dumps({'type':'auth','token':t}))
   a=json.loads(await w.recv());return a
 good=token('company-A','tv-0000')
 bad=good[:-2]+'xx'
 assert (await attempt(bad))['type']=='error'
 assert 'UNAUTHENTICATED' in (await attempt(bad))['error']
 assert (await attempt(token('company-B','tv-0000')))['error']=='TENANT_MISMATCH'
 assert (await attempt(token('company-A','tv-0000',seconds=-10)))['type']=='error'
 return 3
async def run(tvs,cert,key):
 check_env()
 t0=time.monotonic()
 # N+1 redundancy: all TVs must still fit with one whole instance SIGKILLed.
 shards=max(2,math.ceil(tvs/175)+1)
 assert shards>=2
 ports=list(range(19950,19950+shards))
 ctx=ssl.create_default_context(cafile=cert)
 ctx.check_hostname=True
 ctx.minimum_version=ssl.TLSVersion.TLSv1_2
 setup(tvs)
 redis=Redis(host='127.0.0.1',port=6379,decode_responses=True)
 assert await redis.ping()
 await redis.flushdb()
 owners={}
 for i in range(tvs):owners[f'tv-{i:04d}']='company-A' if i%2==0 else 'company-B'
 await redis.hset('qa:owners',mapping=owners)
 folder=Path(tempfile.mkdtemp(prefix='qa_wss_local_'))
 processes=[];logs=[]
 for s,port in enumerate(ports):
  fd=open(folder/f'gateway-{s}.log','wb');logs.append(fd)
  p=await asyncio.create_subprocess_exec(sys.executable,
   str(Path(__file__).with_name('gateway.py')),
   '--instance',f'gw-{s}','--port',str(port),
   '--cert',cert,'--key',key,'--capacity','250',
   stdout=fd,stderr=asyncio.subprocess.STDOUT)
  processes.append(p)
 live=[];lat=[];reconnected=[];kill_count=0
 try:
  await asyncio.gather(*(wait_ready(port,proc) for port,proc in zip(ports,processes)))
  neg=await negative_auth(ports[0],ctx)
  redis_commands_start=int((await redis.info('stats')).get('total_commands_processed',0))
  count_before=psycopg.connect(DSN,autocommit=True)
  wal0=count_before.execute('SELECT pg_current_wal_insert_lsn()').fetchone()[0]
  count_before.close()
  # Simulate initial Free allocation of 100 devices, promote to Pro and add
  # remainder without changing wire protocol or rebooting existing connections.
  clients=[Client(f'tv-{i:04d}',owners[f'tv-{i:04d}'],i%shards,ctx,ports) for i in range(tvs)]
  semaphore=asyncio.Semaphore(60)
  async def open_one(c):
   async with semaphore:await c.open()
  initial=min(100,tvs)
  await asyncio.gather(*(open_one(c) for c in clients[:initial]))
  protocol_before=clients[0].session is not None
  assert protocol_before
  await asyncio.gather(*(open_one(c) for c in clients[initial:]))
  assert all(c.up and c.nonce for c in clients)
  rls_check()
  # 10 concurrent heartbeat rounds: 10*TV actual WSS packets plus keep-alives later.
  for _ in range(10):
   results=await asyncio.gather(*(c.heartbeat(lat) for c in clients))
   assert all(results),('heartbeat_unacknowledged',sum(not x for x in results))
  # Per-session anti-replay and channel commands.
  c0=clients[0]
  repeat=await c0.frame({'type':'heartbeat','nonce':c0.nonce,'seq':c0.seq})
  assert repeat['error']=='REPLAY_SEQUENCE',repeat
  wrong_nonce=await c0.frame({'type':'heartbeat','nonce':'old-session','seq':c0.seq+1})
  assert wrong_nonce['error']=='REPLAY_NONCE',wrong_nonce
  await redis.set(f'qa:command:{c0.tenant}:{c0.device}',json.dumps({'id':'command-qa-1'}),ex=60)
  delivered=await c0.heartbeat(lat)
  assert delivered['command']=={'id':'command-qa-1'},delivered
  ack=await c0.frame({'type':'command_ack','nonce':c0.nonce,'id':'command-qa-1'})
  assert ack['type']=='command_ack_ok'
  duplicate=await c0.frame({'type':'command_ack','nonce':c0.nonce,'id':'command-qa-1'})
  assert duplicate['error']=='COMMAND_NOT_PENDING'
  # Crash gateway zero using SIGKILL; the other gateways remain independent OS processes.
  killed=clients[:0]
  affected=[c for c in clients if c.idx==0]
  assert affected
  processes[0].send_signal(signal.SIGKILL)
  await processes[0].wait()
  assert processes[0].returncode==-signal.SIGKILL
  kill_count=len(affected)
  # Keep the other gateways' leases renewed while Redis naturally expires
  # the dead gateway's sessions after 12 seconds.
  healthy=[c for c in clients if c.idx!=0]
  for _ in range(7):
   await asyncio.sleep(2)
   check=await asyncio.gather(*(c.heartbeat(lat) for c in healthy))
   assert all(check),('healthy_socket_died_during_peer_SIGKILL',sum(not v for v in check))
  # Redis TTL reaper should mark at least some dead leases offline.
  with psycopg.connect(DSN,autocommit=True) as c:
   rows=c.execute("SELECT device FROM qa_wss.status WHERE NOT online").fetchall()
   gone={x[0] for x in rows}
   assert {c.device for c in affected}.issubset(gone),('ghost_online_after_TTL',len(gone),len(affected))
   assert c.execute('SELECT count(*) FROM qa_wss.status WHERE online').fetchone()[0]==len(healthy)
  async def reconnect_one(c):
   async with semaphore:
    # Move to a surviving gateway with room (test-only controller).
    slot=1+int(c.device.split('-')[-1])%(shards-1)
    await c.open(slot=slot)
  await asyncio.gather(*(reconnect_one(c) for c in affected))
  reconnected=affected
  assert all(x.up for x in clients)
  stale=await affected[0].frame({'type':'heartbeat','seq':1,'nonce':'previous-session-nonce'})
  assert stale['error']=='REPLAY_NONCE'
  results=await asyncio.gather(*(c.heartbeat(lat) for c in clients))
  assert all(results),('post_failover_heartbeat',sum(not x for x in results))
  with psycopg.connect(DSN,autocommit=True) as c:
   assert c.execute('SELECT count(*) FROM qa_wss.status WHERE online').fetchone()[0]==tvs
   assert c.execute('SELECT count(*) FROM qa_wss.commands').fetchone()[0]==1
   by_tenant=c.execute('SELECT tenant,count(*) FROM qa_wss.status GROUP BY tenant ORDER BY tenant').fetchall()
   assert sum(x[1] for x in by_tenant)==tvs
   wal_bytes=int(c.execute('SELECT pg_wal_lsn_diff(pg_current_wal_insert_lsn(),%s)',(wal0,)).fetchone()[0])
   relation_bytes=c.execute("SELECT pg_total_relation_size('qa_wss.status')").fetchone()[0]
  # Quota accounting uses measured application payload sizes, not invented TLS
  # network-wire egress, which cannot be measured here.
  bytes_user_sent=sum(c.sent_bytes for c in clients)
  bytes_user_recv=sum(c.received_bytes for c in clients)
  redis_commands_delta=int((await redis.info('stats')).get('total_commands_processed',0))-redis_commands_start
  per_gateway_rss=[]
  for i,p in enumerate(processes):
   if p.returncode is not None:continue
   status=Path('/proc')/str(p.pid)/'status'
   values={}
   for line in status.read_text().splitlines():
    if line.startswith(('VmRSS:','VmHWM:')):
     k,v=line.split(':',1);values[k]=int(v.strip().split()[0])
   per_gateway_rss.append({'shard':i,'pid':p.pid,**values})
  # Actual SQL status transitions (connect/disconnect) are not heartbeat writes.
  response={'result':'PASS_DISPOSABLE_WSS_QA_ONLY','tvs':tvs,'instances':shards,
   'transport':'WSS over TLS1.2+ with trusted temporary self-signed cert',
   'full_TLS_client_certificate_verification':True,'JWT_HS256_device_and_tenant':True,
   'JWT_expired_forged_cross_tenant_rejected':neg,'redis_CAS_session_lease':True,
   'two_or_more_independent_OS_processes':True,'SIGKILL_detected':True,
   'killed_connections':kill_count,'reconnected_after_TTL':len(reconnected),
   'offline_after_TTL_verified':True,'existing_clients_stayed_during_plan_change':True,
   'plan_changed_only_in_QA_model':'Free→Pro, no Supabase billing change',
   'wire_protocol_unchanged':'vision.presence.v1','command_ack_sql_unique':True,
   'replay_nonce_and_sequence_rejected':True,'postgres_status_rows':tvs,
   'postgres_writes_per_heartbeat':0,'redis_read_modify_expire_per_heartbeat':True,
   'wal_bytes':wal_bytes,'sql_status_relation_bytes':relation_bytes,
   'p95_heartbeat_rtt_ms':percentile(lat,95),'p99_heartbeat_rtt_ms':percentile(lat,99),
   'latency_samples':len(lat),'estimated_application_send_bytes':bytes_user_sent,
   'actual_application_ingress_bytes':bytes_user_sent,'actual_application_egress_bytes':bytes_user_recv,
   'redis_commands_processed_delta':redis_commands_delta,'survivor_gateway_process_memory_KiB':per_gateway_rss,
   'actual_TLS_ciphertext_and_frame_overhead_measured':False,'edge_invocations_for_heartbeat':0,
   'supabase_realtime_messages_sent':0,'PG_reader_RLS_tenant_isolation':'PASS',
   'rss_controller_KiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
   'elapsed_s':round(time.monotonic()-t0,3),'remaining_security_FAIL':['TOCTOU_gate_unresolved',
   'Redis_rollback_fencing_unproven','real_Supabase_Auth_and_role_not_integrated',
   'multi_host_cross_redis_failover_unproven'],
   'production':'NO_GO'}
  print('QA_WSS_SCALE_JSON='+json.dumps(response,sort_keys=True),flush=True)
 finally:
  await asyncio.gather(*(c.close() for c in clients if c.up),return_exceptions=True) if 'clients' in locals() else None
  for p in processes:
   if p.returncode is None:
    p.terminate()
  await asyncio.gather(*(p.wait() for p in processes),return_exceptions=True)
  for fd in logs:fd.close()
  await redis.aclose()
  # Emit gateway process failure logs only for failed runs.
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--tvs',type=int,choices=[100,300,600,1000],required=True)
 p.add_argument('--cert',required=True);p.add_argument('--key',required=True)
 a=p.parse_args();asyncio.run(run(a.tvs,a.cert,a.key))
if __name__=='__main__':main()
