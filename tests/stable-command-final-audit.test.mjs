import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const player=readFileSync(new URL('../player.js',import.meta.url),'utf8');
for(const path of ['supabase/functions/device-gateway/index.ts','supabase/functions/device-bundle-stable/index.ts']){
 test(path+' requires authenticated, authorized device before status query',()=>{
  const s=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const auth=s.indexOf('const device ='),status=s.indexOf("if (action === 'command_status')");
  assert.ok(auth>=0&&auth<status);
  const part=s.slice(status,s.indexOf("if (action === 'command_result')",status));
  assert.match(part,/\.eq\('company_id', device\.company_id\)/);
  assert.match(part,/\.eq\('device_id', device\.id\)/);
  assert.doesNotMatch(part,/\.update\(|\.delete\(|\.insert\(/);
 });
 test(path+' terminal update is conditional and idempotent',()=>{
  const s=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const part=s.slice(s.indexOf("if (action === 'command_result')"),s.indexOf("if (action === 'screenshot_result')"));
  assert.match(part,/\.in\('status', \['pending', 'sent'\]\)/);
 });
}
test('reconciliation throttle uses monotonic 300000ms clock',()=>{
 const s=player.slice(player.indexOf('async function inspectCommandIntent'),player.indexOf('async function acknowledgeCompletedCommand'));
 assert.match(s,/performance\.now\(\)/);assert.match(s,/300000/);
});
test('restart intent is durable and no premature acknowledgement is sent',()=>{
 const s=player.slice(player.indexOf("if(command.command_type==='restart_player')"),player.indexOf("if(command.command_type==='update_apk')"));
 assert.match(s,/recordCommandIntent\(command\)/);
 assert.match(s,/setTimeout\(restartPlayerRuntime,250\)/);
 assert.doesNotMatch(s,/acknowledgeCompletedCommand|clearCommandIntent/);
});
test('history migration keeps multiple device identities',()=>{
 const s=player.slice(player.indexOf('async function inspectCommandIntent'),player.indexOf('async function acknowledgeCompletedCommand'));
 assert.match(s,/version:2,entries/);
 assert.match(s,/row\.device_id \|\| existing\?\.device_id/);
});
