"""Shared QA HS256 issuer/identity for HTTPS and WSS; no real credentials."""
from __future__ import annotations
import base64,hashlib,hmac,json,os,re,secrets,time
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/"raft-etcd-qa"))
import raft_api as raft
ISS="vision-v2-qa-one-issuer"
AUD="vision-v2-qa-unified-device"
SCOPES=("wss:presence","manifest:read","proofs:write")
def encode(v):return base64.urlsafe_b64encode(v).rstrip(b"=").decode()
def decode(s):return base64.urlsafe_b64decode(s+"="*((-len(s))%4))
def root():return Path(os.environ["QA_IDENTITY_KEY_DIR"])
def active():return (root()/"active-kid").read_text().strip()
def key(kid):
 if kid not in ("k1","k2"):raise ValueError("unapproved kid")
 data=(root()/(kid+".key")).read_bytes()
 if len(data)!=32:raise ValueError("invalid test key")
 return data
def mint(device,company="company-A",kid=None,seconds=180):
 kid=kid or active();now=int(time.time())
 header=encode(json.dumps({"alg":"HS256","typ":"JWT","kid":kid},sort_keys=True).encode())
 claims={"iss":ISS,"aud":AUD,"company":company,"device":device,"scope":list(SCOPES),
  "iat":now,"nbf":now-1,"exp":now+seconds,"term":"epoch8:leaderB",
  "jti":secrets.token_hex(12)}
 payload=encode(json.dumps(claims,sort_keys=True).encode())
 data=header+"."+payload
 return data+"."+encode(hmac.new(key(kid),data.encode(),hashlib.sha256).digest())
def claims(raw,scope,device=None):
 try:
  if not isinstance(raw,str) or len(raw)>4096:return None
  a,b,c=raw.split(".")
  head=json.loads(decode(a));body=json.loads(decode(b))
  if set(head)!={"alg","typ","kid"} or head["alg"]!="HS256" or head["typ"]!="JWT":return None
  if head["kid"]!=active():return None
  target=encode(hmac.new(key(head["kid"]),(a+"."+b).encode(),hashlib.sha256).digest())
  if not hmac.compare_digest(target,c):return None
  now=int(time.time())
  if body["iss"]!=ISS or body["aud"]!=AUD or body["company"]!="company-A":return None
  if not re.fullmatch("tv-[0-9]{4}",body["device"]):return None
  if device is not None and body["device"]!=device:return None
  if body["term"]!="epoch8:leaderB":return None
  if scope not in body["scope"] or not isinstance(body["scope"],list):return None
  if not isinstance(body["jti"],str) or not re.fullmatch("[0-9a-f]{24}",body["jti"]):return None
  if not all(isinstance(body[k],int) and not isinstance(body[k],bool) for k in ("iat","nbf","exp")):return None
  if body["iat"]>now or body["nbf"]>now or body["exp"]<=now or body["exp"]-now>300:return None
  return body
 except Exception:return None
def fenced(body):
 if body is None:return False
 try:
  return (raft.get("term")=="epoch8:leaderB" and
    raft.get("owner/"+body["device"])==body["company"] and
    raft.get("revoked/"+body["device"])!= "true")
 except Exception:return False
def authenticate(raw,scope,device=None):
 c=claims(raw,scope,device)
 return c if fenced(c) else None
