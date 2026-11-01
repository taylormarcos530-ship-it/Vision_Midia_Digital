"""Vision V2 isolated PG17 durable AES-GCM multi-file generation QA.

Synthetic fixed wrap key: TEST ONLY, never use as KMS/production material.
The committed manifest POINTER is the single atomic filesystem publication;
per-file os.replace may crash with active pointer still on old generation.
The persistent PREPARED receipt carries new wrapped key and expected SHA.
Recovery regenerates missing/corrupt files from prior committed generation,
then switches pointer and commits receipt. This is QA, not universal storage.
"""
from __future__ import annotations
import fcntl,hashlib,hmac,importlib.util,json,multiprocessing as mp,os,resource,shutil,stat,tempfile,time
from pathlib import Path
import psycopg
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
BASE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("qa_v2_aes",BASE/"qa.py")
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
MASTER=hashlib.sha256(b"VISION V2 FIXTURE ONLY -- NEVER PROD SECRET -- 20261101").digest()
DOCS=("company-a-report","company-b-report","company-a-source","company-b-source")
def conn():
    return psycopg.connect(host="127.0.0.1",port=5432,
        dbname="vision_v2_quarantine_disposable",user="postgres",
        password="qa-only-local-password",connect_timeout=3)
def ck(b,label):assert b,label
def canonical(record):
    return json.dumps(record,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()
def fsync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def atomic_json(path,record):
    path=Path(path)
    staging=path.with_name(path.name+".new")
    blob=canonical(record)
    fd=os.open(staging,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_CLOEXEC,0o600)
    with os.fdopen(fd,"wb") as f:f.write(blob);f.flush();os.fsync(f.fileno())
    os.replace(staging,path);fsync_dir(path.parent)
def signed_manifest(generation):
    obj={"generation":generation,"protocol":"VisionV2DisposableAESGenerationV1"}
    obj["hmac"]=hmac.new(MASTER,canonical(obj),hashlib.sha256).hexdigest()
    return obj
def read_manifest(root):
    blob=(Path(root)/"active.json").read_bytes()
    obj=json.loads(blob);signature=obj.pop("hmac")
    ck(hmac.compare_digest(signature,hmac.new(MASTER,canonical(obj),hashlib.sha256).hexdigest()),
       "manifest_signature_mismatch")
    return int(obj["generation"])
def wrap(key,gen):
    nonce=os.urandom(12)
    return nonce+AESGCM(MASTER).encrypt(nonce,key,f"v2-qa-gen:{gen}".encode())
def unwrap(buf,gen):
    return AESGCM(MASTER).decrypt(buf[:12],buf[12:],f"v2-qa-gen:{gen}".encode())
def payloads():
    return {n:((n+"-synthetic-pg17-")*7600).encode() for n in DOCS}
def receipt(db,gen):
    row=db.execute("""SELECT parent_gen,state,wrapped_key,expected_sha
        FROM qa_v2_durable_rotation WHERE generation=%s""",(gen,)).fetchone()
    if not row:raise ValueError("missing_durable_key_receipt")
    return {"gen":gen,"parent":row[0],"state":row[1],"key":unwrap(row[2],gen),
            "sha":row[3]}
def prepare(root):
    root=Path(root)
    if root.exists() and any(root.iterdir()):
        raise FileExistsError("init_only_empty_disposable_root")
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    with conn() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS qa_v2_durable_rotation(
            generation integer PRIMARY KEY,parent_gen integer,
            state text NOT NULL CHECK(state IN ('PREPARED','COMMITTED')),
            wrapped_key bytea NOT NULL, expected_sha jsonb NOT NULL)""")
    initial=payloads()
    key=AESGCM.generate_key(bit_length=256)
    gen0=root/"gen-000"
    gen0.mkdir(mode=0o700)
    for name,plain in initial.items():
        path=gen0/(name+".aes")
        qa.AEADFrames(key,"keyring","gen0/"+name).encrypt(path,[plain])
    fsync_dir(gen0)
    hashes={name:hashlib.sha256(data).hexdigest() for name,data in initial.items()}
    with conn() as db:
        db.execute("""INSERT INTO qa_v2_durable_rotation(generation,parent_gen,state,wrapped_key,expected_sha)
            VALUES(0,NULL,'COMMITTED',%s,%s::jsonb)""",(wrap(key,0),json.dumps(hashes)))
    atomic_json(root/"active.json",signed_manifest(0))
    return hashes
def decode(root,gen):
    root=Path(root)
    with conn() as db:
        entry=receipt(db,gen)
    if entry["state"]!="COMMITTED":raise PermissionError("generation_receipt_not_committed")
    out={}
    for name in DOCS:
        path=root/(f"gen-{gen:03d}")/(name+".aes")
        pieces=list(qa.AEADFrames(entry["key"],"keyring",f"gen{gen}/"+name).decrypt(path))
        out[name]=b"".join(pieces)
        ck(hashlib.sha256(out[name]).hexdigest()==entry["sha"][name],
           "generation_content_hash_invalid")
    return out
def active(root):
    gen=read_manifest(root)
    return gen,decode(root,gen)
def start_rotation(root,new_gen):
    parent,plain=active(root)
    ck(new_gen==parent+1,"generation_must_advance_exactly_one")
    key=AESGCM.generate_key(bit_length=256)
    expected={n:hashlib.sha256(data).hexdigest() for n,data in plain.items()}
    with conn() as db:
        db.execute("""INSERT INTO qa_v2_durable_rotation(generation,parent_gen,state,wrapped_key,expected_sha)
          VALUES(%s,%s,'PREPARED',%s,%s::jsonb)""",
          (new_gen,parent,wrap(key,new_gen),json.dumps(expected)))
    return {"generation":new_gen,"parent":parent,"prepared_receipt":True}
def resume(root,crash_at=None):
    root=Path(root)
    with conn() as db:
        pending=db.execute("""SELECT generation FROM qa_v2_durable_rotation
           WHERE state='PREPARED' ORDER BY generation ASC""").fetchall()
    results=[]
    for (gen,) in pending:
        with conn() as db:ent=receipt(db,gen)
        parent=ent["parent"];old=read_manifest(root)
        if old not in (parent,gen):raise PermissionError("manifest_generation_not_receipt_parent")
        # If pointer is already gen, validate all ciphertext before completing
        # durable SQL COMMIT; no unverified generation is served to a client.
        if old==parent:
            source=decode(root,parent)
            target=root/f"gen-{gen:03d}"
            target.mkdir(mode=0o700,exist_ok=True)
            count=0
            for name in DOCS:
                dest=target/(name+".aes")
                # Existing partial generation file must authenticate; if bad,
                # replace from old COMMITTED generation rather than serving.
                valid=False
                if dest.exists():
                    try:
                        plain=b"".join(qa.AEADFrames(ent["key"],"keyring",
                           f"gen{gen}/"+name).decrypt(dest))
                        valid=hashlib.sha256(plain).hexdigest()==ent["sha"][name]
                    except Exception:valid=False
                if not valid:
                    stage=target/(name+".aes.staging")
                    if stage.exists():stage.unlink()
                    qa.AEADFrames(ent["key"],"keyring",f"gen{gen}/"+name).encrypt(stage,[source[name]])
                    os.replace(stage,dest)
                    count+=1
                    if crash_at=="rename_1" and count==1:os._exit(94)
                    if crash_at=="rename_2" and count==2:os._exit(95)
            fsync_dir(target)
            # Verify new generation again, without yet requiring COMMITTED.
            for name in DOCS:
                blob=b"".join(qa.AEADFrames(ent["key"],"keyring",
                      f"gen{gen}/"+name).decrypt(target/(name+".aes")))
                ck(hashlib.sha256(blob).hexdigest()==ent["sha"][name],
                   "prepublication_AES_integrity_failed")
            atomic_json(root/"active.json",signed_manifest(gen))
            if crash_at=="manifest_before_SQL_commit":os._exit(96)
        # Pointer new: verify before durable receipt commit. A reader will
        # fail-closed while receipt is PREPARED, even if pointer was swapped.
        for name in DOCS:
            blob=b"".join(qa.AEADFrames(ent["key"],"keyring",
                f"gen{gen}/"+name).decrypt(root/f"gen-{gen:03d}"/(name+".aes")))
            ck(hashlib.sha256(blob).hexdigest()==ent["sha"][name],
               "postpublication_AES_integrity_failed")
        with conn() as db:
            db.execute("""UPDATE qa_v2_durable_rotation SET state='COMMITTED'
                WHERE generation=%s AND state='PREPARED'""",(gen,))
        results.append({"generation":gen,"rollforward":True,
                        "previous_pointer":old,"source_commit":True})
    return results
def recover(root):
    results=resume(root)
    gen,data=active(root)
    return gen,data,results
def pin_old_descriptor(data):
    fd=os.memfd_create("v2-qa-old-generation",os.MFD_ALLOW_SEALING|os.MFD_CLOEXEC)
    os.write(fd,data)
    seals=fcntl.F_SEAL_WRITE|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_SEAL
    fcntl.fcntl(fd,fcntl.F_ADD_SEALS,seals)
    ck(fcntl.fcntl(fd,fcntl.F_GET_SEALS)&seals==seals,"pinned_fd_not_sealed")
    return fd
def gc_old(root,pinned_fd,expected):
    root=Path(root)
    latest=read_manifest(root)
    with conn() as db:
        row=db.execute("""SELECT state FROM qa_v2_durable_rotation
             WHERE generation=%s""",(latest,)).fetchone()
    ck(row and row[0]=="COMMITTED","gc_before_durable_receipt")
    removed=[]
    for p in root.glob("gen-*"):
        if not p.is_dir():continue
        if p.name==f"gen-{latest:03d}":continue
        ck((p.stat().st_mode&0o077)==0,"gc_untrusted_dir")
        for child in p.iterdir():
            ck(child.is_file() and not child.is_symlink(),"gc_untrusted_file")
            child.unlink();removed.append(child.name)
        p.rmdir()
    ck(os.pread(pinned_fd,len(expected),0)==expected,"old_immutable_reader_reaped")
    fsync_dir(root)
    return removed
