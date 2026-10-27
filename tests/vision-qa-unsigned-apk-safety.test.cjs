const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const build = fs.readFileSync('android-player/app/build.gradle', 'utf8');
const workflow = fs.readFileSync('.github/workflows/vision-qa-unsigned-apk.yml', 'utf8');

test('unsigned QA inherits homolog safety controls while explicitly disabling signing', () => {
  assert.match(build, /homologUnsigned\s*\{\s*initWith homolog\s*signingConfig = null\s*\}/);
  assert.match(build, /homolog\s*\{[\s\S]*?applicationIdSuffix '\.homolog'/);
  assert.match(build, /bootReceiverEnabled: 'false'/);
});

test('unsigned QA build is isolated and never receives signing credentials', () => {
  assert.match(workflow, /fix\/vision-supabase-free-traffic-isolated-20261027/);
  assert.match(workflow, /assembleHomologUnsigned/);
  assert.ok(workflow.includes('if "$APKSIGNER" verify "$OUT"'));
  assert.match(workflow, /zipalign/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /VISION_QA_KEYSTORE_|secrets\.|\.p12|\.jks|\bdeploy\b/i);
  assert.match(workflow, /UNSIGNED/);
});
