# Permanent APK signing and controlled migration

Status: prepared and tested locally. Stable Android compilation and physical migration are pending. No live APK, domain, device, or data was changed.

Base: 5be647ffe212e7c6267c0df2d775522987c7e52b, containing the approved frontend fixes at 9651918. The current main domain remains on its validated deploy.

## Identity

Legacy APK 1.5.2 signer: 371c40153fee9e7aa8fa2bb6f4a1d93c76da543761706eadf6c6bab4fe6eeadf.
Legacy APK 1.5.3 signer: e2c4dea2d6540be6049e6c9976d2a2aae047d83ee320bcd56f80ea4c7cd4172e.
Neither private legacy key was found in accessible workspace, repository history or archived GitHub artifacts.

Stable package: com.visionmidia.player.stable; version 1.5.4-stable, code 16. Separate package lets the legacy app remain installed during migration. The private permanent key and four GitHub secret values are in the owner's private backup, never in this repository. The public expected fingerprint is android-player/signing-certificate.sha256. Stable deep link uses visionmidia-stable://setup/CODE, while debug preserves visionmidia://setup/CODE. The existing web panel still links to the legacy scheme; use manual company setup code for initial stable migration.

## Remaining execution

1. Add ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD to this repository's Actions secrets using the private backup.
2. Publish the prepared source, then dispatch Build Signed Vision Player APK for that exact ref. No debug APK is a replacement for this signed stable release.
3. Verify successful Android compile, apksigner validation, pinned signer, non-debuggable stable package and manifest metadata. Only then update download config to the signed APK and its metadata, and deploy the tested release to the main domain. Keep the approved preview backup.
4. Install Vision Player Estável next to the current app; do not uninstall or clear data in the old app. Initially disable automatic startup in the new app so both apps do not compete on reboot. Enter the company setup code and obtain a new six-digit pairing code.
5. In the existing TV menu select Substituir TV and enter the NEW app pairing code. Do not use Excluir TV or ordinary pair-new-TV. This operation revokes the old credential; perform it only when the new app is ready.
6. Confirm playlist, orientation, audio, kiosk settings and playback in the new app. Check a complete playlist cycle, restart and device online state before removing the legacy app or enabling new automatic startup. Once the replacement is committed, reverting just an APK cannot restore the old revoked pairing.

## Evidence and limits

Four signing tests pass: repeated identity, wrong key rejection, malformed expected fingerprint rejection, missing secrets rejection. Permanent owner key matches pinned public identity; no password printed. Existing 28 frontend/feed/device tests pass. Workflow YAML parses. Gradle Android compile and installation were NOT executed in this environment.

Read-only live SQL inspection confirms replace_device_from_pairing exists, locks both old device and pairing, enforces company scope, copies settings, transfers playlist assignments and campaigns, retires old device, and revokes its credential. No replacement or migration was executed. Physical device storage is separate between packages; cached media and old local credentials are not copied.

GitHub connector does not expose repository secret writes or workflow dispatch. Browser fallback needs explicit authorization before account UI operations.
