"""Disposable-only advanced key rotation and orphan GC for synthetic Vision V2.
This is a QA extension: NOT a production KMS, crash-atomic rotation of a
multi-file cryptographic domain, or a substitute for actual encrypted backups.
"""
from __future__ import annotations
import fcntl,hashlib,importlib.util,os,re,stat,tempfile,time
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SPEC=importlib.util.spec_from_file_location("qa_secure_base",Path(__file__).parent/"qa.py")
qa=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(qa)
qa.configure()

_ALLOWED_ORPHAN=re.compile(r"^(?:stage-[0-9a-zA-Z-]+-[0-9]+\.aes\.tmp|(?:rev|source)-[0-9a-zA-Z-]+(?:-[0-9]+)?\.aes\.rotate\.tmp)$")

class RotatingServer(qa.SealedServer):
    def rotate_data_key(self,fail_before_publish=False):
        """Two-phase prepare of all ciphertext, then apply replacements.
        In-process reader safety is proved by version_guard. Host-crash
        midway through multiple os.replace is NOT atomic: production NO-GO.
        """
        with self.version_guard:
            old_key=self.data_key
            next_key=AESGCM.generate_key(bit_length=256)
            staged=[]
            try:
                for company,path in list(self.base_paths.items()):
                    path=Path(path)
                    stage=path.with_name(path.name+".rotate.tmp")
                    old=qa.AEADFrames(old_key,"source",str(company))
                    new=qa.AEADFrames(next_key,"source",str(company))
                    details=new.encrypt(stage,old.decrypt(path))
                    # Verify with new key BEFORE publishing any files.
                    digest=hashlib.sha256()
                    for block in new.decrypt(stage):digest.update(block)
                    if digest.hexdigest()!=details["plain_sha"]:
                        raise AssertionError("source_key_rotation_authentication_failed")
                    staged.append(("source",str(company),path,stage,details))
                for company,item in list(self.versions.items()):
                    path=Path(item["filepath"])
                    stage=path.with_name(path.name+".rotate.tmp")
                    identity=str(company)+"/"+str(item["revision"])
                    old=qa.AEADFrames(old_key,"archive",identity)
                    new=qa.AEADFrames(next_key,"archive",identity)
                    details=new.encrypt(stage,old.decrypt(path))
                    digest=hashlib.sha256()
                    for block in new.decrypt(stage):digest.update(block)
                    if digest.hexdigest()!=item["compressed_sha"]:
                        raise AssertionError("gzip_key_rotation_does_not_match_pinned_memfd")
                    staged.append(("archive",str(company),path,stage,details))
                if fail_before_publish:
                    raise OSError("injected_key_rotation_before_first_replace")
                for kind,company,path,stage,details in staged:
                    os.replace(stage,path)
                    if kind=="archive":
                        with self.mu:
                            item=self.versions[company]
                            item["encrypted_sha"]=details["encrypted_sha"]
                            item["encrypted_len"]=details["encrypted_len"]
                directory_fd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                try:os.fsync(directory_fd)
                finally:os.close(directory_fd)
                self.data_key=next_key
                self.disk_encrypted_bytes=sum(x.stat().st_size for x in self.root.iterdir() if x.is_file())
                return {"rotated_files":len(staged),
                        "new_key_different":next_key!=old_key,
                        "active_sealed_fds_unchanged":True,
                        "directory_fsync":True}
            finally:
                for _,_,_,stage,_ in staged:
                    if stage.exists():stage.unlink()

    def cleanup_orphan_stages(self):
        """Remove ONLY exact synthetic staging names in our private root.
        No directory traversal, no symlink following, one directory fd.
        Must run quiescently: file builder/revision updates use this same
        version_guard for lazy rebuild, but direct replay not globally fenced.
        """
        with self.version_guard:
            return cleanup_private_dir(self.root,only_staging=True)

def cleanup_private_dir(root,only_staging=True):
    root=Path(root)
    # Test fixture private path only, not arbitrary user-supplied directory.
    real_tmp=Path(tempfile.gettempdir()).resolve()
    resolved=root.resolve()
    if real_tmp not in resolved.parents or resolved==real_tmp:
        raise PermissionError("refuse_cleanup_outside_disposable_tmp")
    st=root.lstat()
    if not stat.S_ISDIR(st.st_mode) or (st.st_mode & 0o077):
        raise PermissionError("refuse_untrusted_or_public_temp_directory")
    dirfd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    removed=[]
    try:
        for name in os.listdir(dirfd):
            if name in (".","..") or "/" in name:continue
            if only_staging:
                approved=bool(_ALLOWED_ORPHAN.fullmatch(name))
            else:
                approved=bool(re.fullmatch(r"(?:stage|source|rev)-[0-9a-zA-Z.-]+(?:\.tmp)?",name))
            if not approved:continue
            fst=os.stat(name,dir_fd=dirfd,follow_symlinks=False)
            # unlink of symlinks does NOT follow their target.
            if not (stat.S_ISREG(fst.st_mode) or stat.S_ISLNK(fst.st_mode)):continue
            os.unlink(name,dir_fd=dirfd)
            removed.append(name)
        os.fsync(dirfd)
    finally:
        os.close(dirfd)
    return removed

def cleanup_dead_process_root(root,exitcode):
    if exitcode!=94:raise PermissionError("refuse_cleanup_when_process_not_confirmed_crashed")
    removed=cleanup_private_dir(root,only_staging=False)
    # Crash-created private fixture ONLY; ensure no remaining unexpected files.
    rest=list(Path(root).iterdir())
    if rest:raise AssertionError(("unexpected_orphan_name_not_deleted",list(map(str,rest))))
    Path(root).rmdir()
    return removed
