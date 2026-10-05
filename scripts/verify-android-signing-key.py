"""Check the restored private key against the public permanent identity."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys

def verify(key_path, fingerprint_path):
    expected = Path(fingerprint_path).read_text().strip().lower()
    if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("Invalid expected certificate fingerprint")
    if not os.environ.get("KEYSTORE_PASSWORD") or not os.environ.get("KEY_ALIAS"):
        raise ValueError("Signing credentials missing")
    result = subprocess.run(["keytool", "-exportcert", "-keystore", key_path,
        "-alias", os.environ["KEY_ALIAS"], "-storepass:env", "KEYSTORE_PASSWORD"],
        capture_output=True)
    if result.returncode:
        raise ValueError("Could not export signing certificate")
    if hashlib.sha256(result.stdout).hexdigest() != expected:
        raise ValueError("Permanent signing identity mismatch")

if __name__ == "__main__":
    try:
        verify(*sys.argv[1:])
    except (ValueError, OSError, TypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    print("Permanent signing identity verified")
