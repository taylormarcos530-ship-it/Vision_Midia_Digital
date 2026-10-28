'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const player = fs.readFileSync(path.join(root,'player.js'),'utf8');
const manifest = fs.readFileSync(path.join(root,'android-player/app/src/main/AndroidManifest.xml'),'utf8');
const application = fs.readFileSync(path.join(root,'android-player/app/src/main/java/com/visionmidia/player/VisionFcmApplication.java'),'utf8');
const messaging = fs.readFileSync(path.join(root,'android-player/app/src/main/java/com/visionmidia/player/VisionFcmService.java'),'utf8');
const activity = fs.readFileSync(path.join(root,'android-player/app/src/main/java/com/visionmidia/player/MainActivity.java'),'utf8');
const server = fs.readFileSync(path.join(root,'supabase/functions/device-control/index.ts'),'utf8');
const gateway = fs.readFileSync(path.join(root,'supabase/functions/device-gateway/index.ts'),'utf8');
const db = fs.readFileSync(path.join(root,'supabase/qa-migrations/v29_device_fcm_tokens.sql'),'utf8');
const gradle = fs.readFileSync(path.join(root,'android-player/app/build.gradle'),'utf8');

test('FCM SDK registers a private Android message service',()=>{
  assert.match(gradle,/firebase-messaging:24\.1\.2/);
  assert.match(manifest,/android:name="\.VisionFcmApplication"/);
  assert.match(manifest,/android:name="\.VisionFcmService"/);
  assert.match(manifest,/com\.google\.firebase\.MESSAGING_EVENT/);
  assert.match(manifest,/VisionFcmService"[\s\S]*?android:exported="false"/);
  assert.match(application,/isGooglePlayServicesAvailable/);
  assert.match(application,/FirebaseApp\.initializeApp/);
  assert.match(application,/if \(!isConfigured\(\)\) return/);
});

test('FCM push messages are never executed directly',()=>{
  assert.match(messaging,/vision_command/);
  assert.match(messaging,/command_id/);
  assert.match(messaging,/PUSH_SIGNAL_KEY/);
  assert.doesNotMatch(messaging,/startActivity\(/);
  assert.doesNotMatch(messaging,/evaluateJavascript/);
  assert.match(activity,/getFcmTokenMarker\(/);
  assert.doesNotMatch(activity,/public String getFcmToken\(/);
  assert.match(activity,/fpadgedrgcxrrqflzhjt\.supabase\.co/);
  assert.match(player,/await gateway\(\{action:'register_push'\}\)/);
  assert.doesNotMatch(player,/fcm_token:fcmToken/);
  assert.match(activity,/consumePushSignal\(/);
  assert.match(player,/await gateway\(\{action:'commands'\}\)/);
  assert.match(player,/consumePushSignal/);
});

test('FCM must be configured on both sides before reducing polling',()=>{
  assert.match(gradle,/VISION_FCM_APP_ID/);
  assert.match(gradle,/VISION_FCM_PROJECT_ID/);
  assert.match(player,/state\.pushReady = response\.push_enabled === true/);
  assert.match(player,/if \(state\.pushReady && performance\.now\(\) - state\.lastCommandReconcileAt < 15 \* 60_000\) return/);
  assert.match(player,/BACKGROUND_POLL_INTERVALS\.commands/);
  assert.match(player,/state\.pushTimer = setInterval/);
  assert.match(player,/!state\.pushPending \|\| !state\.deviceToken \|\| !navigator\.onLine/);
});

test('FCM tokens are registered only with authenticated device',()=>{
  const auth = gateway.indexOf('const device = await authenticateDevice(admin, req)');
  const registration = gateway.indexOf("if (action === 'register_push')");
  assert.ok(auth > 0 && registration > auth);
  assert.match(gateway,/device_id:device\.id, company_id:device\.company_id/);
  assert.match(gateway,/VISION_FCM_ENABLED/);
  assert.match(gateway,/VISION_FCM_SERVICE_ACCOUNT_JSON/);
  assert.match(db,/ON DELETE CASCADE/);
  assert.match(db,/ENABLE ROW LEVEL SECURITY/);
  assert.match(db,/REVOKE ALL ON TABLE public\.device_push_tokens FROM PUBLIC, anon, authenticated/);
});

test('Master creates durable command BEFORE sending best effort push',()=>{
  const commandInsert = server.indexOf(".from('device_commands')");
  const pushCall = server.lastIndexOf('await dispatchDeviceCommandPush(admin, companyId, deviceId, command.id)');
  assert.ok(commandInsert >= 0 && pushCall > commandInsert);
  assert.match(server,/if \(!raw\) return 'not_configured'/);
  assert.match(server,/data:\{kind:'vision_command',command_id:commandId\}/);
  assert.match(server,/offline devices pick it up/);
  assert.doesNotMatch(server,/console\.(?:log|warn)\([^\n]*fcm_token/);
});

test('FCM build is opt-in and does not embed server private keys',()=>{
  assert.match(gradle,/versionCode 34/);
  assert.match(gradle,/applicationIdSuffix '\.homolog'/);
  assert.doesNotMatch(gradle,/SERVICE_ACCOUNT_JSON/);
  assert.doesNotMatch(application,/private_key/);
  assert.doesNotMatch(messaging,/private_key/);
});

test('Firebase public client app must match the QA package and not official stable',()=>{
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'android-player/app/firebase-homolog-public.json'),'utf8'));
  assert.equal(cfg.package_name,'com.visionmidia.player.homolog');
  assert.equal(cfg.project_id,'vision-midia-digital');
  assert.ok(cfg.mobilesdk_app_id.startsWith('1:'+cfg.project_number+':android:'));
  assert.ok(cfg.api_key.length>20);
  assert.match(gradle,/firebase-homolog-public\\.json/);
  assert.match(gradle,/qaFirebase\\.package_name != 'com\\.visionmidia\\.player\\.homolog'/);
  // Stable configuration defaults to empty; QA build type overrides only itself.
  assert.match(gradle,/buildConfigField 'String', 'VISION_FCM_APP_ID', JsonOutput\\.toJson\\(System\\.getenv\\('VISION_FCM_APP_ID'\\) \\?: ''\\)/);
});
