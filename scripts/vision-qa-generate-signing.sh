#!/usr/bin/env bash
# One-time stable QA key generation on the OWNER'S trusted computer only.
# Do not run in GitHub Actions or upload the resulting .p12 to GitHub.
set -euo pipefail
umask 077
: "${HOME:?A private home directory is required}"
command -v keytool >/dev/null || { echo 'JDK keytool is required. In Termux run: pkg install openjdk-17' >&2; exit 3; }
keydir="${HOME}/vision-qa-signing"
if [[ -L "${keydir}" ]]; then
  echo 'Refusing symbolic link for QA signing directory.' >&2
  exit 4
fi
mkdir -p "${keydir}"
chmod 700 "${keydir}"
keypath="${keydir}/vision-qa-homolog.p12"
if [[ -e "${keypath}" ]]; then
  echo 'A QA signing keystore already exists. Refusing to overwrite or rotate it.' >&2
  exit 4
fi
echo 'Generate PRIVATE signing key for new QA packages. Password prompts occur locally.'
echo 'Do not send this file or its passwords by chat and never commit it to GitHub.'
keytool -genkeypair -keyalg RSA -keysize 3072 -validity 12000 \
  -storetype PKCS12 \
  -alias vision_qa_homolog \
  -dname 'CN=Vision QA Homologacao, O=Vision Midia Digital, C=BR' \
  -keystore "${keypath}"
chmod 600 "${keypath}"
echo 'Signing key created locally; do NOT lose it, or later APK updates will be blocked.'
echo "Private file: ${keypath} (DO NOT SHARE)"
echo 'To inspect the PUBLIC fingerprint later, run this command and enter your password locally:'
echo "keytool -list -v -keystore \"${keypath}\" -alias vision_qa_homolog"
echo 'Never publish the private .p12 file.'
echo 'Before using it for APK signing, keep two tested copies OFFLINE (encrypted) on separate media.'
echo 'Keep the password separately. Never share the private .p12 or password in ChatGPT or GitHub.'
echo 'NOTE: This new key will NOT match the debug-signed QA APK already installed.'
