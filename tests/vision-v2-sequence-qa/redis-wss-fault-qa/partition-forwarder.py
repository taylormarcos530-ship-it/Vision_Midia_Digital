"""Local 127.0.0.1 TCP forwarding shim for disposable PG17 witness.
SIGKILL this process to simulate full client-to-witness network partition.
Not a wire-level physical network isolation or HA solution.
"""
import argparse,select,socket,socketserver
class Forward(socketserver.BaseRequestHandler):
 def handle(self):
  try: upstream=socket.create_connection(("127.0.0.1",self.server.target),timeout=2)
  except OSError:return
  try:
   self.request.settimeout(None);upstream.settimeout(None)
   while True:
    ready,_,_=select.select([self.request,upstream],[],[],5)
    for sock in ready:
     try: b=sock.recv(65536)
     except OSError:return
     if not b:return
     try:
      (upstream if sock is self.request else self.request).sendall(b)
     except OSError:return
  finally:upstream.close()
class Server(socketserver.ThreadingTCPServer):
 allow_reuse_address=True
 daemon_threads=True
 request_queue_size=128
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--listen",type=int,required=True)
 p.add_argument("--target",type=int,required=True)
 a=p.parse_args()
 assert a.listen==5434 and a.target==5433
 with Server(("127.0.0.1",a.listen),Forward) as srv:
  srv.target=a.target
  print("FORWARD_READY="+str(a.listen)+"=>"+str(a.target),flush=True)
  srv.serve_forever(poll_interval=.1)
if __name__=="__main__":main()
