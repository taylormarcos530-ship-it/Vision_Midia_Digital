#!/usr/bin/env bash
# Offline/local reproducible QA signing. NO GitHub Secrets, no production.
# Operator must provide all credentials through a local private environment.
set -euo pipefail
umask 077
: "${VISION_QA_KEYSTORE_FILE:?Stable private keystore file is required}"
: "${VISION_QA_KEYSTORE_PASSWORD:?Keystore password is required}"
: "${VISION_QA_KEY_ALIAS:?Key alias is required}"
: "${VISION_QA_KEY_PASSWORD:?Key password is required}"
: "${VISION_QA_EXPECTED_CERT_SHA256:?A previously pinned signing certificate fingerprint is required}"
if [[ ! -f "${VISION_QA_KEYSTORE_FILE}" ]]; then
  echo 'Signing keystore not found. Refusing to build distributable QA APK.' >&2
  exit 3
fi
fingerprint="${VISION_QA_EXPECTED_CERT_SHA256//:/}"
fingerprint="${fingerprint,,}"
if [[ ! "${fingerprint}" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo 'Expected signing certificate SHA-256 has an invalid format.' >&2
  exit 3
fi
gradle -p android-player --no-daemon assembleHomolog
apk=android-player/app/build/outputs/apk/homolog/app-homolog.apk
if [[ ! -s "${apk}" ]]; then
  echo 'No APK generated.' >&2; exit 3
fi
if [[ -z "${ANDROID_HOME:-}" || ! -x "${ANDROID_HOME}/build-tools/35.0.0/apksigner" ]]; then
  echo 'Android build-tools 35 apksigner is required for certificate verification.' >&2
  exit 3
fi
verifier="${ANDROID_HOME}/build-tools/35.0.0/apksigner"
cert="$("${verifier}" verify --print-certs "${apk}" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1)"
cert="${cert,,}"
if [[ "${cert}" != "${fingerprint}" ]]; then
  echo 'QA signing certificate is NOT the pinned certificate. Refusing distribution.' >&2
  exit 4
fi
aapt="${ANDROID_HOME}/build-tools/35.0.0/aapt"
"${aapt}" dump badging "${apk}" | grep -qF "package: name='com.visionmidia.player.homolog'"
echo 'QA APK signature and isolated package verified. Local-only build completed.'
sha256sum "${apk}"
echo "File remains locally at ${apk}. No deployment or device installation was performed."
