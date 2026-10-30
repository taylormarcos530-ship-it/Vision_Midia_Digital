import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../supabase/functions/device-health-alerts/index.ts', import.meta.url),'utf8');
test('8-minute alert threshold unchanged',()=>{
 assert.match(code,/OFFLINE_AFTER_MS = 8 \* 60 \* 1000/);
 assert.match(code,/now - seenAt <= OFFLINE_AFTER_MS/);
});
test('only changed device health states write',()=>{
 assert.match(code,/const stateChanged = previous\.connected !== connected/);
 assert.match(code,/previous\.active_error_key !== activeError/);
 assert.match(code,/previous\.outdated_apk_key !== outdated/);
 assert.match(code,/if \(stateChanged\) \{[\s\S]*?\.upsert\(next, \{ onConflict: 'device_id' \}\)/);
});
test('offline and recovery notifications retained',()=>{
 assert.match(code,/enqueue\(admin, device, 'offline'/);
 assert.match(code,/enqueue\(admin, device, 'online'/);
});
