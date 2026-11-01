"""Disposable CI-only network-namespace replica for real Docker backend cut.
No Supabase API, no repository secrets; ephemeral synthetic PostgreSQL 17.
"""
import json,os,psycopg,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
DB=os.environ["QA_DB_DSN"]
NODE=os.environ["QA_NODE"]
LEASE=float(os.getenv("QA_LEASE_SECONDS","1.7"))
CHANNEL="qa_vision_network_notify"
state={"connected":False,"fresh_at":0.0,"revision":0,"reads":0,
       "notices":0,"db_connections":0,"errors":0}
lock=threading.RLock()

def snapshot():
    with lock:return dict(state)

def listener():
    while True:
        try:
            with psycopg.connect(DB,autocommit=True,connect_timeout=2) as c:
                c.execute("LISTEN "+CHANNEL)
                # Read durable history once on start/restart, not per HTTP.
                latest=c.execute("SELECT coalesce(max(revision),1) FROM qa_network_outbox").fetchone()[0]
                with lock:
                    state["revision"]=int(latest)
                    state["reads"]+=1
                    state["db_connections"]+=1
                    state["connected"]=True
                    state["fresh_at"]=time.monotonic()
                while True:
                    for note in c.notifies(timeout=.17,stop_after=1):
                        with lock:
                            state["fresh_at"]=time.monotonic()
                            state["notices"]+=1
                        if note.payload=="pulse":continue
                        latest=c.execute("SELECT coalesce(max(revision),1) FROM qa_network_outbox").fetchone()[0]
                        with lock:
                            state["revision"]=int(latest)
                            state["reads"]+=1
                    # A half-open connection might never raise: force close
                    # after lease expiry, then reconnect and read outbox.
                    with lock:expired=time.monotonic()-state["fresh_at"]>LEASE
                    if expired:
                        with lock:state["connected"]=False
                        break
        except Exception:
            with lock:
                state["connected"]=False
                state["errors"]+=1
        time.sleep(.15)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        info=snapshot()
        age=time.monotonic()-info["fresh_at"]
        healthy=info["connected"] and age<=LEASE
        code=200 if healthy else 503
        response=json.dumps({"node":NODE,"pid":os.getpid(),
             "revision":info["revision"],"backend_healthy":bool(healthy),
             "age_seconds":round(age,3),"sql_reads":info["reads"],
             "notifications_received":info["notices"],
             "db_connections":info["db_connections"],
             "errors":info["errors"]}).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(response)))
        self.end_headers();self.wfile.write(response)

class Server(ThreadingHTTPServer):
    daemon_threads=True
    request_queue_size=512

if __name__=="__main__":
    t=threading.Thread(target=listener,daemon=True);t.start()
    Server(("0.0.0.0",8080),Handler).serve_forever()
