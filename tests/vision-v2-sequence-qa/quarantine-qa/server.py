"""Loopback-only QA HTTP quarantine service, NOT a production Edge Function.

Requires disposable PostgreSQL database and synthetic tokens. No date is
assigned to events; received_at is SERVER RECEIPT time, not playback time.
"""
from __future__ import annotations
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import threading

import psycopg

DSN=os.environ.get("VISION_V2_QA_POSTGRES_DSN","")
MAX_BODY=65536
REGEX=re.compile(r"^[A-Za-z0-9_-]{3,120}$")
EVENT_KEYS={"sequence","event_id","media_id","boot_id","mono_ms","seconds","completed"}

class Reject(Exception):
    def __init__(self, code, status):
        super().__init__(code)
        self.code=code
        self.status=status

def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def event_hash(event):
    raw=json.dumps(event, sort_keys=True, separators=(",",":"),allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()

def validate_event(e):
    if not isinstance(e,dict) or set(e)!=EVENT_KEYS:
        raise Reject("invalid_event_fields_or_timestamp",400)
    if type(e["sequence"]) is not int or e["sequence"] < 1 or e["sequence"] >= 2**63:
        raise Reject("invalid_sequence",400)
    for field in ("event_id","media_id","boot_id"):
        if not isinstance(e[field],str) or not REGEX.fullmatch(e[field]):
            raise Reject("invalid_event_identity",400)
    if type(e["mono_ms"]) is not int or not 0 <= e["mono_ms"] < 2**63:
        raise Reject("invalid_monotonic",400)
    if type(e["seconds"]) not in (int,float) or not 0 <= e["seconds"] <= 3600:
        raise Reject("invalid_duration",400)
    if type(e["completed"]) is not bool:
        raise Reject("invalid_completed",400)

def ingest(body, token):
    if not isinstance(body,dict) or set(body)!={"device_id","stream_id","events"}:
        raise Reject("invalid_body",400)
    device_id,stream_id,events=body["device_id"],body["stream_id"],body["events"]
    if any(not isinstance(s,str) or not REGEX.fullmatch(s) for s in (device_id,stream_id)):
        raise Reject("invalid_device_stream",400)
    if not isinstance(events,list) or not 1<=len(events)<=50:
        raise Reject("invalid_batch",400)
    last=0
    for e in events:
        validate_event(e)
        if e["sequence"]<=last:
            raise Reject("unordered_batch",400)
        last=e["sequence"]
    if not isinstance(token,str) or not 16<=len(token)<=256:
        raise Reject("unauthorized",401)
    # PostgreSQL row-lock serializes all devices' ACK movement. Every statement
    # happens inside one psycopg transaction; exceptions abort without an ACK.
    with psycopg.connect(DSN,connect_timeout=3) as conn:
      with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("""
              SELECT company_id,watermark,stream_id,token_sha256
              FROM v2_quarantine_qa.devices WHERE device_id=%s FOR UPDATE
            """,(device_id,))
            d=cur.fetchone()
            if not d or d[2]!=stream_id or d[3]!=hash_token(token):
                raise Reject("unauthorized",401)
            company,watermark,_,_=d
            expected=watermark+1
            accepted=duplicates=0
            for e in events:
                digest=event_hash(e)
                seq=e["sequence"]
                if seq<=watermark:
                    cur.execute("""
                      SELECT payload_sha256 FROM v2_quarantine_qa.receipts
                      WHERE device_id=%s AND stream_id=%s AND sequence=%s
                    """,(device_id,stream_id,seq))
                    previous=cur.fetchone()
                    if not previous or previous[0]!=digest:
                        raise Reject("conflicting_replay",409)
                    duplicates+=1
                    continue
                if seq!=expected:
                    raise Reject("sequence_gap",409)
                cur.execute("""
                  INSERT INTO v2_quarantine_qa.receipts
                    (company_id,device_id,stream_id,sequence,event_id,media_id,
                    boot_id,mono_ms,seconds,completed,payload_sha256)
                  VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,(company,device_id,stream_id,seq,e["event_id"],e["media_id"],
                    e["boot_id"],e["mono_ms"],e["seconds"],e["completed"],digest))
                accepted+=1
                expected+=1
            if accepted:
                cur.execute("""
                  UPDATE v2_quarantine_qa.devices SET watermark=%s
                  WHERE device_id=%s AND stream_id=%s
                """,(expected-1,device_id,stream_id))
            ack=expected-1
    return {"ack":ack,"accepted":accepted,"duplicates":duplicates,
            "quarantined":accepted,"billable":0}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        if self.path!="/qa/quarantine":
            self.reply(404,{"error":"not_found"});return
        try:
            size=int(self.headers.get("content-length","-1"))
            if size<1 or size>MAX_BODY: raise Reject("payload_size",413)
            body=json.loads(self.rfile.read(size))
            response=ingest(body,self.headers.get("x-device-token",""))
            self.reply(200,response)
        except Reject as ex:
            self.reply(ex.status,{"error":ex.code})
        except (ValueError,json.JSONDecodeError):
            self.reply(400,{"error":"invalid_json"})
        except Exception:
            # Do not emit an ACK when database rollback/connection fails.
            self.reply(503,{"error":"gateway_unavailable"})
    def reply(self,status,data):
        payload=json.dumps(data,separators=(",",":")).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

def start_test_server():
    server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    return server,thread
