"""Vision V2 disposable QA: encrypted proof archive across GitHub runner jobs.

The producer has only recipient PUBLIC key. Recipient PRIVATE key is held in a
separate one-day QA artifact and never printed. These are SYNTHETIC test keys,
not an actual KMS. Encrypted archive lives in GitHub Actions artifact storage;
a fresh runner later restores it. No database production access or deletion.
"""
import argparse, base64, hashlib, json, os, pathlib, secrets, sqlite3, sys, tempfile
from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa, ed25519
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def canon(d):return json.dumps(d,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
def digest(x):return hashlib.sha256(x).hexdigest()
def b64(x):return base64.b64encode(x).decode()
def ub64(s):return base64.b64decode(s,validate=True)
def dump(path,data):pathlib.Path(path).write_bytes(canon(data))
def read(path):return json.loads(pathlib.Path(path).read_bytes())

def make_recipient(directory):
    p=pathlib.Path(directory);p.mkdir(parents=True,exist_ok=True)
    k=rsa.generate_private_key(public_exponent=65537,key_size=3072)
    private=k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption())
    public=k.public_key().public_bytes(serialization.Encoding.PEM,
                                        serialization.PublicFormat.SubjectPublicKeyInfo)
    (p/"recipient-private.pem").write_bytes(private)
    os.chmod(p/"recipient-private.pem",0o600)
    (p/"recipient-public.pem").write_bytes(public)
    print("QA_EPHEMERAL_RECIPIENT_PREPARED=PASS rsa_bits=3072; private never logged")

def synthetic_original(n=1000):
    # Sample data not sourced from a player, customer, or Supabase.
    return [{"seq":i,"event_id":f"qa-proof-{i:08d}","boot":"qa-boot-0001",
             "media":f"media-{i%7}","played_at":None,"billable":False}
            for i in range(1,n+1)]

def make_package(public_path,out):
    p=pathlib.Path(out);p.mkdir(parents=True,exist_ok=True)
    pub=serialization.load_pem_public_key(pathlib.Path(public_path).read_bytes())
    entries=synthetic_original()
    original={"version":1,"stream":"qa-v2-stream-001","watermark_read_only":1000,"records":entries}
    plain=canon(original)
    key=AESGCM.generate_key(bit_length=256)
    nonce=os.urandom(12)
    associated=b"vision-v2-cross-runner-test-v1"
    ct=AESGCM(key).encrypt(nonce,plain,associated)
    wrapped=pub.encrypt(key,padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                                        algorithm=hashes.SHA256(),label=associated))
    (p/"archive.v2qa").write_bytes(ct)
    signer=ed25519.Ed25519PrivateKey.generate()
    signing_public=signer.public_key().public_bytes(serialization.Encoding.Raw,
                                                    serialization.PublicFormat.Raw)
    manifest={"format":"vision-v2-cross-runner-aesgcm","version":1,
              "event_count":len(entries),"first_seq":1,"last_seq":len(entries),
              "stream":"qa-v2-stream-001","watermark_read_only":1000,
              "cipher_sha256":digest(ct),"plain_sha256":digest(plain),
              "nonce":b64(nonce),"wrapped_aes_key":b64(wrapped),
              "aad":b64(associated),"signature_public":b64(signing_public)}
    manifest["signature"]=b64(signer.sign(canon(manifest)))
    dump(p/"manifest.json",manifest)
    # Never write AES key or signing private key to artifacts.
    print(f"QA_ENCRYPTED_ARCHIVE_CREATED=PASS records={len(entries)} bytes={len(ct)} "+
          "rsa_wrapped=true signed_manifest=true")
    return manifest

def recover(private_path,package_dir,destination):
    d=pathlib.Path(package_dir)
    m=read(d/"manifest.json")
    sig=ub64(m.pop("signature"))
    signer=ed25519.Ed25519PublicKey.from_public_bytes(ub64(m["signature_public"]))
    signer.verify(sig,canon(m))
    if m["format"]!="vision-v2-cross-runner-aesgcm" or m["version"]!=1:raise ValueError("format")
    ct=(d/"archive.v2qa").read_bytes()
    if digest(ct)!=m["cipher_sha256"]:raise ValueError("cipher_hash")
    aad=ub64(m["aad"])
    private=serialization.load_pem_private_key(pathlib.Path(private_path).read_bytes(),password=None)
    key=private.decrypt(ub64(m["wrapped_aes_key"]),
                        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                                     algorithm=hashes.SHA256(),label=aad))
    plain=AESGCM(key).decrypt(ub64(m["nonce"]),ct,aad)
    if digest(plain)!=m["plain_sha256"]:raise ValueError("plain_hash")
    payload=json.loads(plain)
    records=payload["records"]
    if (payload.get("stream")!=m["stream"] or payload.get("watermark_read_only")!=1000 or
        len(records)!=m["event_count"] or m["first_seq"]!=1 or
        m["last_seq"]!=len(records)):
        raise ValueError("manifest_content_mismatch")
    for i,e in enumerate(records,1):
        if e["seq"]!=i or e["played_at"] is not None or e["billable"] is not False:
            raise ValueError("fake_datetime_or_noncontiguous_event")
    destination=pathlib.Path(destination)
    if destination.exists():raise FileExistsError("refuse_database_overwrite")
    with tempfile.TemporaryDirectory(prefix="qa-restore-") as tmp:
        db_file=pathlib.Path(tmp)/"restored.sqlite"
        with sqlite3.connect(db_file) as db:
            db.execute("CREATE TABLE archived_proofs(seq INTEGER PRIMARY KEY,event_id TEXT UNIQUE NOT NULL, played_at TEXT,billable INTEGER NOT NULL)")
            db.executemany("INSERT INTO archived_proofs VALUES(?,?,?,?)",
                           ((e["seq"],e["event_id"],e["played_at"],int(e["billable"]))
                            for e in records))
            db.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT)")
            db.execute("INSERT INTO metadata VALUES('watermark_read_only',?)",(str(payload["watermark_read_only"]),))
            db.commit()
            assert db.execute("PRAGMA integrity_check").fetchone()[0]=="ok"
            assert db.execute("SELECT count(*) FROM archived_proofs").fetchone()[0]==1000
        # New target only. Original source DB is never opened, let alone deleted.
        with destination.open("xb") as f:
            f.write(db_file.read_bytes());f.flush();os.fsync(f.fileno())
    print("QA_CROSS_RUNNER_RESTORE=PASS verified_events=1000 ack_unchanged=1000 "+
          "fake_dates=0 new_sqlite=true")
    return True

def destructive_variants(private_path,src_root):
    """Fault injections on COPIES only; original archive stays unchanged."""
    root=pathlib.Path(src_root)
    with tempfile.TemporaryDirectory(prefix="qa-faults-") as tmp:
        t=pathlib.Path(tmp)
        original_m=(root/"manifest.json").read_bytes()
        original_c=(root/"archive.v2qa").read_bytes()
        def fixture():
            (t/"manifest.json").write_bytes(original_m)
            (t/"archive.v2qa").write_bytes(original_c)
        def must_fail(tag,operation):
            try:operation()
            except (ValueError,InvalidSignature,InvalidTag,FileNotFoundError,TypeError):
                print("QA_FAIL_CLOSED_"+tag+"=PASS");return
            raise AssertionError("UNSAFE_SUCCESS_"+tag)
        fixture()
        (t/"archive.v2qa").write_bytes(original_c[:len(original_c)//2])
        must_fail("TRUNCATED",lambda:recover(private_path,t,t/"bad1.sqlite"))
        fixture()
        bytearray_data=bytearray(original_c);bytearray_data[8]^=0x01
        (t/"archive.v2qa").write_bytes(bytearray_data)
        must_fail("TAMPERED",lambda:recover(private_path,t,t/"bad2.sqlite"))
        fixture()
        (t/"archive.v2qa").unlink()
        must_fail("MISSING_REMOTE_ARTIFACT",lambda:recover(private_path,t,t/"bad3.sqlite"))
        fixture()
        edited=json.loads(original_m);edited["watermark_read_only"]=999
        dump(t/"manifest.json",edited)
        must_fail("MANIFEST_SIGNATURE",lambda:recover(private_path,t,t/"bad4.sqlite"))
        with tempfile.TemporaryDirectory(prefix="qa-wrong-recipient-") as wrong:
            make_recipient(wrong)
            fixture()
            must_fail("WRONG_KEY",lambda:recover(pathlib.Path(wrong)/"recipient-private.pem",
                                                 t,t/"bad5.sqlite"))
        assert not list(t.glob("bad*.sqlite"))
        assert (root/"archive.v2qa").read_bytes()==original_c
        assert (root/"manifest.json").read_bytes()==original_m
    print("QA_INDEPENDENT_FAULTS=PASS cases=5 no_original_deletion=true")

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("command",choices=["recipient","pack","restore","faults"])
    ap.add_argument("--private")
    ap.add_argument("--public")
    ap.add_argument("--root",required=True)
    ap.add_argument("--output")
    args=ap.parse_args()
    if args.command=="recipient":make_recipient(args.root)
    elif args.command=="pack":make_package(args.public,args.root)
    elif args.command=="restore":recover(args.private,args.root,args.output)
    else:destructive_variants(args.private,args.root)
