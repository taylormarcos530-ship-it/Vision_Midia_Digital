import hashlib
import os
from pathlib import Path
import runpy
import secrets
import subprocess
import tempfile
import unittest

verify = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/verify-android-signing-key.py'))['verify']

class SigningIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.key = Path(cls.temp.name) / 'test.jks'
        cls.fp = Path(cls.temp.name) / 'expected.sha256'
        cls.old = {name: os.environ.get(name) for name in ['KEYSTORE_PASSWORD', 'KEY_ALIAS']}
        os.environ['KEYSTORE_PASSWORD'] = secrets.token_urlsafe(24)
        os.environ['KEY_ALIAS'] = 'test'
        subprocess.run(['keytool','-genkeypair','-keystore',str(cls.key),'-alias','test',
            '-keyalg','RSA','-keysize','2048','-validity','1','-dname','CN=Test',
            '-storepass:env','KEYSTORE_PASSWORD','-keypass:env','KEYSTORE_PASSWORD'],
            check=True,capture_output=True)
        der = subprocess.check_output(['keytool','-exportcert','-keystore',str(cls.key),
            '-alias','test','-storepass:env','KEYSTORE_PASSWORD'],stderr=subprocess.DEVNULL)
        cls.expected = hashlib.sha256(der).hexdigest()

    def setUp(self):
        self.fp.write_text(self.expected+'\n')

    @classmethod
    def tearDownClass(cls):
        for name,value in cls.old.items():
            if value is None: os.environ.pop(name,None)
            else: os.environ[name] = value
        cls.temp.cleanup()

    def test_same_private_key_keeps_identity_on_repeated_exports(self):
        verify(str(self.key),str(self.fp))
        verify(str(self.key),str(self.fp))

    def test_changed_certificate_is_rejected(self):
        self.fp.write_text('0'*64)
        with self.assertRaisesRegex(ValueError,'identity mismatch'):
            verify(str(self.key),str(self.fp))

    def test_malformed_expected_certificate_is_rejected(self):
        self.fp.write_text('bad')
        with self.assertRaisesRegex(ValueError,'Invalid expected'):
            verify(str(self.key),str(self.fp))

    def test_missing_password_is_rejected_without_fallback_key(self):
        password = os.environ.pop('KEYSTORE_PASSWORD')
        try:
            with self.assertRaisesRegex(ValueError,'credentials missing'):
                verify(str(self.key),str(self.fp))
        finally: os.environ['KEYSTORE_PASSWORD'] = password

if __name__ == '__main__': unittest.main()
