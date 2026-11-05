"""Local three-member etcd Raft authority. NO production use or hardware antirollback claim."""
from __future__ import annotations
import base64,json,os,time,urllib.request
HOSTS=[f"http://127.0.0.1:{12379+i}" for i in range(3)]
SHADOW="http://127.0.0.1:12382"
def enc(text):return base64.b64encode(text.encode()).decode()
def req(endpoint,path,body,timeout=2.5):
 request=urllib.request.Request(endpoint+path,data=json.dumps(body).encode(),
  headers={"Content-Type":"application/json"},method="POST")
 with urllib.request.urlopen(request,timeout=timeout) as resp:return json.loads(resp.read())
def key(s):return enc("vision-v2-qa/"+s)
def put(name,value,host=None):
 return req(host or HOSTS[0],"/v3/kv/put",{"key":key(name),"value":enc(value)})
def get(name,host=None):
 data=req(host or HOSTS[0],"/v3/kv/range",{"key":key(name)})
 v=data.get("kvs",[])
 return base64.b64decode(v[0]["value"]).decode() if v else None
def status(host):
 x=req(host,"/v3/maintenance/status",{})
 return {"cluster":x["header"]["cluster_id"],"member":x["header"]["member_id"],
  "leader":x["leader"],"term":int(x["raftTerm"]),"revision":int(x["header"].get("revision",0))}
def txn(jti,term="epoch7:leaderA",company="company-A",device="tv-0000",host=None,pin=None):
 start=time.monotonic();endpoint=host or HOSTS[0]
 try:
  if pin is not None and status(endpoint)["cluster"]!=pin:
   return {"status":"DENY","reason":"FOREIGN_CLUSTER","ms":round(1000*(time.monotonic()-start),3)}
  compares=[
   {"target":"VERSION","result":"EQUAL","key":key("spent/"+jti),"version":"0"},
   {"target":"VALUE","result":"EQUAL","key":key("term"),"value":enc(term)},
   {"target":"VALUE","result":"EQUAL","key":key("owner/"+device),"value":enc(company)}
  ]
  response=req(endpoint,"/v3/kv/txn",{"compare":compares,"success":[{
   "requestPut":{"key":key("spent/"+jti),"value":enc("consumed:"+company)}}],"failure":[]})
  return {"status":"ACK" if response["succeeded"] else "DENY",
   "reason":"RAFT_LINEARIZABLE_ATOMIC_TXN" if response["succeeded"] else "CAS_DENY",
   "revision":int(response.get("header",{}).get("revision",0)),"ms":round(1000*(time.monotonic()-start),3)}
 except Exception as e:
  return {"status":"DENY","reason":"NO_QUORUM_OR_NETWORK","exception":type(e).__name__,
   "ms":round(1000*(time.monotonic()-start),3)}
