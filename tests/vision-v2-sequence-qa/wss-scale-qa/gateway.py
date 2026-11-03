"""Vision V2 WSS/Redis/PG17 disposable experimental gateway. NOT product code.
Only 127.0.0.1, synthetic HMAC JWT, localhost TLS certificate and ephemeral keys.
A Redis/DB backplane witness alone is NOT rollback-resistant fencing; production NO-GO.
"""
from __future__ import annotations
import argparse,asyncio,base64,hashlib,hmac,json,os,secrets,signal,ssl,time
import psycopg
from psycopg_pool import AsyncConnectionPool
from redis.asyncio import Redis
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
DB='vision_v2_quarantine_disposable'
DSN='postgresql://postgres:qa-only-local-password@127.0.0.1:5432/'+DB
SECRET=b'vision-wss-isolated-fixture-do-not-use-anywhere-else'
ISS='vision-qa-wss';AUD='vision-v2-disposable'
HEARTBEAT_TTL_MS=12000
def encode(obj):return json.dumps(obj,sort_keys=True,separators=(',',':')).encode()
def b64(x):return base64.urlsafe_b64encode(x).rstrip(b'=').decode()
def token(tenant,device,seconds=180):
 header=b64(encode({'alg':'HS256','typ':'JWT'}))
 payload=b64(encode({'iss':ISS,'aud':AUD,'company':tenant,'device':device,
  'iat':int(time.time()),'nbf':int(time.time())-1,'exp':int(time.time())+seconds,
  'jti':secrets.token_hex(12)}))
 body=header+'.'+payload
 return body+'.'+b64(hmac.digest(SECRET,body.encode(),'sha256'))
def verify(raw):
 try:
  first,second,third=raw.split('.')
  head=json.loads(base64.urlsafe_b64decode(first+'='*(-len(first)%4)))
  body=json.loads(base64.urlsafe_b64decode(second+'='*(-len(second)%4)))
  expected=b64(hmac.digest(SECRET,(first+'.'+second).encode(),'sha256'))
  now=int(time.time())
  assert head=={'alg':'HS256','typ':'JWT'} and hmac.compare_digest(expected,third)
  assert body.get('iss')==ISS and body.get('aud')==AUD
  assert body.get('nbf',0)<=now<body.get('exp',0)
  assert body.get('iat',0)<=now and body.get('exp',0)-now<=3600
  assert body.get('company') in ['company-A','company-B']
  assert isinstance(body.get('device'),str) and body['device'].startswith('tv-')
  assert isinstance(body.get('jti'),str) and len(body['jti'])>=24
  return body
 except Exception:raise PermissionError('UNAUTHENTICATED') from None
REFRESH="""if redis.call('GET',KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE',KEYS[1],ARGV[2])
else return 0 end"""
RELEASE="""if redis.call('GET',KEYS[1]) == ARGV[1] then
 return redis.call('DEL',KEYS[1])
else return 0 end"""
class Gateway:
 def __init__(self,instance,port,max_connections):
  self.instance=instance;self.port=port;self.max_connections=max_connections
  self.active={};self.redis=Redis(host='127.0.0.1',port=6379,decode_responses=True)
  self.pool=AsyncConnectionPool(DSN,min_size=1,max_size=6,open=False)
  self.stop=asyncio.Event();self.heartbeat_msgs=0;self.status_updates=0
 def key(self,tenant,device):return f'qa:lease:{tenant}:{device}'
 async def update_status(self,tenant,device,lease,online):
  async with self.pool.connection() as c:
   if online:
    await c.execute("""INSERT INTO qa_wss.status(tenant,device,lease,online,changed_at)
      VALUES(%s,%s,%s,true,clock_timestamp())
      ON CONFLICT(tenant,device) DO UPDATE SET lease=EXCLUDED.lease,online=true,
       changed_at=clock_timestamp()""",(tenant,device,lease))
   else:
    await c.execute("""UPDATE qa_wss.status SET online=false,changed_at=clock_timestamp()
      WHERE tenant=%s AND device=%s AND lease=%s AND online=true""",(tenant,device,lease))
  self.status_updates+=1
 async def sweep(self):
  while not self.stop.is_set():
   try:
    # One ephemeral local Redis leader: failover checked only in QA, not hardened
    # distributed lease authority. A separate independent witness is still required.
    if await self.redis.set('qa:sweep:lock',self.instance,nx=True,ex=2):
     async with self.pool.connection() as c:
      cur=await c.execute("SELECT tenant,device,lease FROM qa_wss.status WHERE online")
      rows=await cur.fetchall()
     pipe=self.redis.pipeline(transaction=False)
     for tenant,device,lease in rows:pipe.get(self.key(tenant,device))
     leases=await pipe.execute()
     for (tenant,device,lease),current in zip(rows,leases):
      if current!=lease:await self.update_status(tenant,device,lease,False)
     # Do not DEL a shared lock unconditionally; it can now be owned by another instance.
   except Exception as exc:
    print('QA_SWEEP_FAIL='+str(exc)[:150],flush=True)
   await asyncio.sleep(1)
 async def handle(self,ws):
  tenant=None;device=None;lease=None
  try:
   msg=json.loads(await asyncio.wait_for(ws.recv(),timeout=9))
   if msg.get('type')!='auth':raise PermissionError('AUTH_REQUIRED')
   claims=verify(str(msg.get('token','')))
   tenant=claims['company'];device=claims['device']
   owner=await self.redis.hget('qa:owners',device)
   if owner!=tenant:raise PermissionError('TENANT_MISMATCH')
   if len(self.active)>=self.max_connections:raise PermissionError('CAPACITY_EXHAUSTED')
   # Consume JWT jti once per expiry, atomically across every gateway. A reused
   # bearer credential is rejected instead of replacing another TV session.
   ttl=max(1,int(claims['exp'])-int(time.time()))
   accepted=await self.redis.set('qa:spent-jti:'+claims['jti'],'1',ex=ttl,nx=True)
   if not accepted:raise PermissionError('JWT_REPLAY')
   lease=secrets.token_hex(18)
   await self.redis.set(self.key(tenant,device),lease,px=HEARTBEAT_TTL_MS)
   await self.update_status(tenant,device,lease,True)
   self.active[lease]=ws
   nonce=secrets.token_hex(12)
   seq=0
   await ws.send(json.dumps({'type':'ready','protocol':'vision.presence.v1','nonce':nonce,
     'session':lease,'instance':self.instance}))
   async for raw in ws:
    if isinstance(raw,bytes) or len(raw)>1000:
     await ws.send(json.dumps({'type':'error','error':'INVALID_FRAME'}));break
    x=json.loads(raw)
    if x.get('nonce')!=nonce:
     await ws.send(json.dumps({'type':'error','error':'REPLAY_NONCE'}));continue
    ok=await self.redis.eval(REFRESH,1,self.key(tenant,device),lease,HEARTBEAT_TTL_MS)
    if not ok:
     await ws.send(json.dumps({'type':'error','error':'STALE_LEASE'}));break
    if x.get('type')=='heartbeat':
     n=x.get('seq')
     if type(n)!=int or n<=seq:
      await ws.send(json.dumps({'type':'error','error':'REPLAY_SEQUENCE'}));continue
     seq=n;self.heartbeat_msgs+=1
     cmd=await self.redis.get(f'qa:command:{tenant}:{device}')
     await ws.send(json.dumps({'type':'heartbeat_ack','seq':seq,'command':json.loads(cmd) if cmd else None}))
    elif x.get('type')=='command_ack':
     command_id=x.get('id')
     if not isinstance(command_id,str):raise ValueError('BAD_COMMAND')
     key=f'qa:command:{tenant}:{device}'
     cmd=await self.redis.get(key)
     if not cmd or json.loads(cmd).get('id')!=command_id:
      await ws.send(json.dumps({'type':'error','error':'COMMAND_NOT_PENDING'}));continue
     # Idempotent SQL transition, never one SQL call per heartbeat.
     async with self.pool.connection() as c:
      await c.execute("""INSERT INTO qa_wss.commands(tenant,device,id,acknowledged_at)
        VALUES(%s,%s,%s,clock_timestamp()) ON CONFLICT DO NOTHING""",(tenant,device,command_id))
     await self.redis.delete(key)
     await ws.send(json.dumps({'type':'command_ack_ok','id':command_id}))
    else:await ws.send(json.dumps({'type':'error','error':'INVALID_ACTION'}))
  except (ConnectionClosed,asyncio.TimeoutError):
   pass
  except Exception as exc:
   try:await ws.send(json.dumps({'type':'error','error':str(exc)[:60]}))
   except Exception:pass
  finally:
   if lease:
    self.active.pop(lease,None)
    try:
     dropped=await self.redis.eval(RELEASE,1,self.key(tenant,device),lease)
     if dropped:await self.update_status(tenant,device,lease,False)
    except Exception as exc:print('QA_RELEASE_FAIL='+str(exc)[:140],flush=True)
 async def run(self,cert,key):
  await self.pool.open(wait=True)
  context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
  context.minimum_version=ssl.TLSVersion.TLSv1_2
  context.load_cert_chain(certfile=cert,keyfile=key)
  task=asyncio.create_task(self.sweep())
  loop=asyncio.get_running_loop()
  for code in (signal.SIGTERM,signal.SIGINT):
   loop.add_signal_handler(code,self.stop.set)
  try:
   async with serve(self.handle,'127.0.0.1',self.port,ssl=context,
       max_size=1024,max_queue=32,ping_interval=None,ping_timeout=None,
       close_timeout=1,open_timeout=8,backlog=1500):
    print(f'QA_WSS_READY={self.instance}:{self.port}',flush=True)
    await self.stop.wait()
  finally:
   task.cancel();await asyncio.gather(task,return_exceptions=True)
   await self.pool.close();await self.redis.aclose()
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--instance',required=True);p.add_argument('--port',type=int,required=True)
 p.add_argument('--cert',required=True);p.add_argument('--key',required=True)
 p.add_argument('--capacity',type=int,default=250);a=p.parse_args()
 assert os.environ.get('GITHUB_REF')=='refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031'
 assert os.environ.get('QA_STREAM_GUARD_GROUP')=='1'
 assert all(not os.environ.get(k) for k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','PGHOST'))
 asyncio.run(Gateway(a.instance,a.port,a.capacity).run(a.cert,a.key))
if __name__=='__main__':main()
