"""Vision V2 experimental persistent presence adapter, REAL asyncio TCP on loopback.
This is a socket protocol experiment, NOT WebSocket or deployed Supabase Realtime.
300 concurrent connections; no Edge calls for heartbeat; no SQL per heartbeat.
"""
from __future__ import annotations
import argparse,asyncio,hashlib,hmac,json,os,resource,secrets,statistics,time
import psycopg
DB='vision_v2_quarantine_disposable'
KW=dict(host='127.0.0.1',port=5432,dbname=DB,user='postgres',
        password='qa-only-local-password',connect_timeout=5)
SECRET=b'only-in-disposable-qa-20261102-never-prod'
def mac(device):return hmac.new(SECRET,device.encode(),'sha256').hexdigest()
def pctl(v,p):
 v=sorted(v);t=(len(v)-1)*p/100;i=int(t);j=min(len(v)-1,i+1)
 return round(v[i]*(1-(t-i))+v[j]*(t-i),3)
class State:
 def __init__(self,tvs):
  self.tvs=tvs;self.seen={};self.connections={};self.online=set()
  self.status_writes=0;self.heartbeat_messages=0;self.bytes_in=0;self.bytes_out=0
  self.stale_dropped=0;self.denied=0;self.requests=0;self.auth=0;self.commands=0
  self.server_epoch=secrets.token_hex(8)
  self.start=time.monotonic()
 def pg_write(self,device,on):
  with psycopg.connect(**KW,autocommit=True) as c:
   c.execute("""INSERT INTO qa_presence.status(device,online,gateway_epoch,last_change)
    VALUES(%s,%s,%s,clock_timestamp())
    ON CONFLICT(device) DO UPDATE SET online=EXCLUDED.online,
      gateway_epoch=EXCLUDED.gateway_epoch,last_change=clock_timestamp()
    WHERE qa_presence.status.online IS DISTINCT FROM EXCLUDED.online
       OR qa_presence.status.gateway_epoch IS DISTINCT FROM EXCLUDED.gateway_epoch""",
      (device,on,self.server_epoch))
   self.status_writes+=1
 async def handler(self,reader,writer):
  current=None
  try:
   line=await asyncio.wait_for(reader.readline(),timeout=5)
   self.bytes_in+=len(line)
   if len(line)>500 or not line:raise ValueError('untrusted_hello')
   payload=json.loads(line)
   dev=payload.get('device','')
   signed=payload.get('token','')
   if not isinstance(dev,str) or not dev.startswith('tv-') or len(dev)>30 or not hmac.compare_digest(str(signed),mac(dev)):
    self.denied+=1;writer.write(b'{"error":"UNAUTHORIZED"}\n');await writer.drain();return
   self.auth+=1;current=dev
   self.online.add(dev);self.connections[dev]=writer;self.seen[dev]=0
   self.pg_write(dev,True)
   writer.write(b'{"ok":true,"epoch":"qa"}\n');await writer.drain()
   while True:
    line=await asyncio.wait_for(reader.readline(),timeout=8)
    if not line:break
    self.bytes_in+=len(line)
    if len(line)>300:break
    self.requests+=1
    obj=json.loads(line)
    seq=obj.get('seq')
    if obj.get('type')=='heartbeat' and type(seq)==int and seq>self.seen[dev]:
     self.seen[dev]=seq;self.heartbeat_messages+=1
     resp={'ack':seq}
    elif obj.get('type')=='command_ack':
     self.commands+=1;resp={'command_ack':obj.get('id')}
    else:
     self.stale_dropped+=1;resp={'error':'STALE_OR_INVALID'}
    b=(json.dumps(resp,separators=(',',':'))+'\n').encode()
    self.bytes_out+=len(b)
    writer.write(b);await writer.drain()
  except (ConnectionResetError,asyncio.TimeoutError,json.JSONDecodeError,ValueError):
   pass
  finally:
   if current is not None and self.connections.get(current) is writer:
    self.connections.pop(current,None);self.online.discard(current)
    self.pg_write(current,False)
   writer.close()
   try:await writer.wait_closed()
   except Exception:pass
async def client(i,port,rounds,latencies,drop=False):
 dev=f'tv-{i:04d}'
 rd,wr=await asyncio.open_connection('127.0.0.1',port)
 wr.write((json.dumps({'device':dev,'token':mac(dev)})+'\n').encode());await wr.drain()
 hello=await rd.readline();assert json.loads(hello).get('ok') is True
 for seq in range(1,rounds+1):
  b=(json.dumps({'type':'heartbeat','seq':seq})+'\n').encode()
  st=time.perf_counter_ns();wr.write(b);await wr.drain()
  response=json.loads(await rd.readline());assert response=={'ack':seq},(dev,response)
  latencies.append((time.perf_counter_ns()-st)/1e6)
 # Send duplicate seq to verify no heartbeat counted or persisted.
 wr.write((json.dumps({'type':'heartbeat','seq':rounds})+'\n').encode());await wr.drain()
 assert json.loads(await rd.readline())['error']=='STALE_OR_INVALID'
 if i==0:
  wr.write(b'{"type":"command_ack","id":"demo-cmd"}\n');await wr.drain()
  assert json.loads(await rd.readline())['command_ack']=='demo-cmd'
 if drop:
  wr.close();await wr.wait_closed()
 return (rd,wr)
async def reject_unauthorized(port):
 rd,w=await asyncio.open_connection('127.0.0.1',port)
 w.write(b'{"device":"tv-9999","token":"forged"}\n');await w.drain()
 assert b'UNAUTHORIZED' in await rd.readline()
 w.close();await w.wait_closed()
async def run(tvs):
 assert os.environ.get('GITHUB_REF')=='refs/heads/experiment/vision-v2-sequence-watermark-qa-20261031'
 assert os.environ.get('QA_STREAM_GUARD_GROUP')=='1'
 assert all(not os.environ.get(k) for k in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','PGHOST','PGSERVICE'))
 with psycopg.connect(**KW,autocommit=True) as c:
  assert c.execute('select current_database()').fetchone()[0]==DB
  assert int(c.execute('show server_version_num').fetchone()[0])//10000==17
  c.execute('CREATE SCHEMA qa_presence')
  c.execute("""CREATE TABLE qa_presence.status(
    device text PRIMARY KEY,online boolean NOT NULL,
    gateway_epoch text NOT NULL,last_change timestamptz NOT NULL)""")
 state=State(tvs);lat=[];start=time.monotonic()
 server=await asyncio.start_server(state.handler,'127.0.0.1',0,backlog=max(tvs*2,100))
 port=server.sockets[0].getsockname()[1]
 try:
  rounds=40 # One virtual hour at heartbeat cadence 90s; real packets exchanged.
  await reject_unauthorized(port)
  sockets=await asyncio.gather(*(client(i,port,rounds,lat,drop=False) for i in range(tvs)))
  await asyncio.sleep(.12)
  assert len(state.online)==tvs,len(state.online)
  assert state.heartbeat_messages==tvs*rounds
  assert state.status_writes==tvs
  # Abrupt transport disconnect for five clients, then real reconnect.
  disconnected=sockets[:min(5,tvs)]
  for reader,writer in disconnected:
   writer.transport.abort()
  await asyncio.sleep(.15)
  assert len(state.online)==tvs-len(disconnected),(len(state.online),tvs)
  after_drop=state.status_writes
  assert after_drop==tvs+len(disconnected)
  resumed=await asyncio.gather(*(client(i,port,rounds,lat,drop=False) for i in range(len(disconnected))))
  await asyncio.sleep(.12)
  assert len(state.online)==tvs
  assert state.status_writes==tvs+2*len(disconnected)
  # Cross-tenant data model is not supplied to the socket client; per-device HMAC
  # verifies identity only. Real JWT/tenant authorization remains a NO-GO gate.
  for rd,wr in sockets[len(disconnected):]+resumed:
   wr.close()
  await asyncio.gather(*(wr.wait_closed() for rd,wr in sockets[len(disconnected):]+resumed))
  await asyncio.sleep(.15)
  assert not state.online
  with psycopg.connect(**KW,autocommit=True) as c:
   assert c.execute('select count(*) from qa_presence.status').fetchone()[0]==tvs
   assert c.execute('select count(*) from qa_presence.status where online').fetchone()[0]==0
   sqlbytes=c.execute("select pg_total_relation_size('qa_presence.status')").fetchone()[0]
  messages=state.heartbeat_messages
  assert state.stale_dropped==tvs+len(disconnected)
  assert state.denied==1
  assert state.commands==1
  elapsed=round(time.monotonic()-start,3)
  # Financial modeling of one message sent per TV per 90s, independently
  # of whether Realtime websocket or custom gateway is chosen.
  month=int(tvs*30*86400/90)
  per_day=int(tvs*86400/90)
  result={'result':'PASS_ISOLATED_TCP_QA_ONLY','tvs':tvs,'persistent_connections':tvs,
   'real_tcp_heartbeat_packets':messages,'real_tcp_heartbeat_roundtrips':messages,
   'postgres_writes_for_heartbeat':0,'postgres_status_transition_writes':state.status_writes,
   'pg_relation_bytes':sqlbytes,'bytes_client_to_gateway_including_handshakes':state.bytes_in,
   'bytes_gateway_to_client_responses':state.bytes_out,
   'stale_heartbeat_rejected':state.stale_dropped,'tampered_identity_denied':state.denied,
   'commands_acknowledged':state.commands,'reconnections':len(disconnected),
   'latency_p95_ms':pctl(lat,95),'latency_p99_ms':pctl(lat,99),
   'monthly_heartbeat_messages_projected':month,'per_day_heartbeat_messages_projected':per_day,
   'monthly_Edge_calls_if_persistent_transport':0,
   'supabase_Realtime_messages_if_used':'>= '+str(month)+' before broadcasts/fanout',
   'pro_500_peak_connections_cap_fits':tvs<=500,
   'free_200_peak_connections_cap_fits':tvs<=200,
   'rss_python_KiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
   'elapsed_s':elapsed,'sql_ack_safety_not_proven_for_remote_archive':True,
   'network_note':'TCP loopback test, NOT WebSocket, APNs, Supabase Realtime or multi-host',
   'production':'NO_GO'}
  print('QA_PRESENCE_TRANSPORT_JSON='+json.dumps(result,sort_keys=True),flush=True)
 finally:
  server.close();await server.wait_closed()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--tvs',type=int,choices=[10,100,300,600],required=True)
 a=p.parse_args()
 asyncio.run(run(a.tvs))
