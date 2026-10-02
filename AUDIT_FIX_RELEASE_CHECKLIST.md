# Audit Fix Release Checklist

This branch contains the complete audit-fix set. Do not publish pieces out of order.

## 1. Database migrations first
Apply, in order:
1. `20261002195000_add_platform_login_visual.sql`
2. `20261002213000_audit_hardening.sql`

These add the login visual fields/public bucket, three missing FK indexes, stale-device sweep, retired-device command cleanup and trigger.

## 2. Edge Functions
Deploy the branch versions after the migrations:
- save-company
- public-signup
- public-signup-v2
- payment-receipt
- platform-settings
- public-config
- replace-device
- master-admin
- device-monitoring

Keep the current verify_jwt behavior for each function; do not weaken authentication.

## 3. Supabase Auth manual security setting
Enable **Leaked Password Protection** in Supabase Auth settings.
The current connector cannot mutate this project-level Auth setting.

## 4. Android Player
Run **Build Permanent Vision Player Preview APK** on the exact release branch/commit.
The workflow writes `downloads/Vision-Player-preview.source.json`.
The Downloads page blocks the APK automatically until that source fingerprint matches the current Player files.

For the commercial build, run **Build Signed Vision Player APK** only after signing secrets are configured. It now builds the exact selected ref/commit.

## 5. Frontend preview validation
Validate:
- login and password recovery cooldown;
- Dashboard/TVs/Monitoring/Media/Playlists/Reports;
- Master Dashboard/Clients/Plans/Audit;
- TV replacement;
- login visual upload;
- Downloads APK fingerprint state;
- offline PWA refresh behavior.

## 6. Production
Only merge/deploy after the user explicitly says **faça deploy**.
