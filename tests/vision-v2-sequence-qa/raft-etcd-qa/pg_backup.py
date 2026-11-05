"""Real four PG17 backup/restore only on disposable CI service/container IDs."""
from __future__ import annotations
import os,subprocess
import psycopg
DBS=[
 ("main",5432,"qa-only-local-password","vision_v2_quarantine_disposable"),
 ("witness",5433,"qa-only-witness-password","vision_v2_witness_disposable"),
 ("shadow",5435,"qa-only-shadow-password","vision_v2_witness_shadow_disposable"),
 ("anchor",5436,"qa-only-anchor-password","vision_v2_anchor_disposable")]
def shell(args,id,data=None):
 command=["docker","exec"]+(["-i"] if data is not None else [])+[id,*args]
 return subprocess.run(command,input=data,check=True,capture_output=True,timeout=45).stdout
def dsn(row):
 n,port,password,db=row
 return f"postgresql://postgres:{password}@127.0.0.1:{port}/{db}?connect_timeout=2"
def backup_all():
 snapshots={};lsn={}
 for row in DBS:
  name,_,_,db=row
  with psycopg.connect(dsn(row),autocommit=True) as c:
   assert int(c.execute("SHOW server_version_num").fetchone()[0])//10000==17
   c.execute("CREATE SCHEMA qa_raft_sql")
   c.execute("CREATE TABLE qa_raft_sql.spent(jti text PRIMARY KEY)")
   lsn[name]=str(c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0])
  ident=os.environ["QA_PG_"+name.upper()+"_ID"]
  assert len(ident)>=12 and all(ch in "0123456789abcdef" for ch in ident.lower())
  snapshots[name]=shell(["pg_dump","-U","postgres","-d",db,"-Fc","-n","qa_raft_sql"],ident)
  assert len(snapshots[name])>1000
 return snapshots,lsn
def write_and_restore(jti,snapshots,lsn):
 for row in DBS:
  with psycopg.connect(dsn(row)) as c:
   c.execute("INSERT INTO qa_raft_sql.spent VALUES(%s)",(jti,))
 for name,port,password,db in DBS:
  ident=os.environ["QA_PG_"+name.upper()+"_ID"]
  shell(["pg_restore","-U","postgres","-d",db,"--clean","--if-exists","--no-owner","--exit-on-error"],ident,snapshots[name])
 stats={}
 for row in DBS:
  name=row[0]
  with psycopg.connect(dsn(row)) as c:
   count=int(c.execute("SELECT count(*) FROM qa_raft_sql.spent").fetchone()[0])
   assert count==0
   now=str(c.execute("SELECT pg_current_wal_insert_lsn()").fetchone()[0])
   stats[name]={"rows_after_real_restore":count,
    "wal_delta_bytes":int(c.execute("SELECT pg_wal_lsn_diff(%s::pg_lsn,%s::pg_lsn)",(now,lsn[name])).fetchone()[0]),
    "db_bytes":int(c.execute("SELECT pg_database_size(current_database())").fetchone()[0])}
 return stats
