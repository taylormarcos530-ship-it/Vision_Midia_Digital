'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'supabase', 'qa-compat');
const before = fs.readFileSync(path.join(root,'device-gateway-v20-backup-20261028.ts'),'utf8');
const after = fs.readFileSync(path.join(root,'device-gateway-v21-qa-register-compat.ts'),'utf8');
const patchStart = after.indexOf('    // Compatibility reply for the explicitly isolated QA APKs only.');
const patchEnd = after.indexOf("    if (action === 'player_settings')",patchStart);
assert.ok(patchStart > 0 && patchEnd > patchStart);
const withoutPatch = after.slice(0,patchStart)+after.slice(patchEnd);
const section = after.slice(patchStart,patchEnd);

test('candidate is byte-for-byte identical to deployed v20 except isolated QA handler',()=>{
  assert.equal(withoutPatch,before,'all other source, including production playback, pairing and commands, must be unchanged');
  assert.ok(before.includes("return json({ error: 'unknown_action' }, 400)"));
  assert.equal((after.match(/if \(action === 'register_push'\)/g)||[]).length,1);
});

test('authentication and access checks happen before compatibility response',()=>{
  assert.ok(after.indexOf('const device = await authenticateDevice(admin, req)') < patchStart);
  assert.ok(after.indexOf("if (!device) return json({ error: 'invalid_device_token' }, 401)") < patchStart);
  assert.ok(after.indexOf("if (device.account_block)") < patchStart);
  assert.ok(after.indexOf("if (device.access_block === 'expired')") < patchStart);
});

test('QA V34/V35 acknowledge absent FCM only; all other apps retain previous behavior',()=>{
  const execute = new Function('action','req','json',section+'\nreturn undefined');
  const invoke = (agent,action='register_push')=>execute(action,{headers:{get(k){assert.equal(k,'user-agent');return agent}}},(data,status=200)=>({data,status}));
  for(const version of ['1.5.22','1.5.23']) {
    const ret = invoke('VisionPlayerAndroid/'+version+'-homologacao');
    assert.equal(ret.status,200);
    assert.equal(ret.data.ok,true);
    assert.equal(ret.data.push_enabled,false);
  }
  for(const bad of ['VisionPlayerAndroid/1.5.20-stable','VisionPlayerAndroid/1.5.21-homologacao','VisionPlayerAndroid/1.5.24-homologacao','','Chrome/1.0']) {
    const ret=invoke(bad);
    assert.equal(ret.status,400);
    assert.equal(ret.data.error,'unknown_action');
  }
  assert.equal(invoke('VisionPlayerAndroid/1.5.22-homologacao','commands'),undefined);
});

test('no push token persistence, credentials, paid-plan updates or changes in SQL',()=>{
  assert.doesNotMatch(section,/\.from\(|\.insert\(|\.update\(|\.upsert\(|fcm_token|await|service_account/);
  assert.match(section,/push_enabled:false/);
  assert.match(section,/registration_status:'fcm_unavailable'/);
});
