'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {commercialPilotDeviceAllowed:allowed}=require('../supabase/functions/_shared/commercial-pilot-allowlist.mjs');
const a='11111111-2222-4333-8444-555555555555';
const b='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const other='abcdefab-1234-4abe-8abc-abcdefabcdef';
test('commercial pilot requires BOTH global flag and explicit TV UUID',()=>{
  assert.equal(allowed(a,'true',a),true);
  assert.equal(allowed(b,'true',a),false);
  assert.equal(allowed(a,'false',a),false);
  assert.equal(allowed(a,undefined,a),false);
  assert.equal(allowed(a,'true',undefined),false);
  assert.equal(allowed(a,'true',''),false);
  assert.equal(allowed(a,'TRUE',a),false);
  assert.equal(allowed(a,true,a),false);
  assert.equal(allowed(a,'true','*'),false);
});
test('multiple explicit IDs, whitespace and case work without widening membership',()=>{
  assert.equal(allowed(a,'true',b+' , '+a),true);
  assert.equal(allowed(other,'true',b+' , '+a),false);
  assert.equal(allowed(b.toUpperCase(),'true',b),true);
  assert.equal(allowed(a,'true',a+','+other),true);
});
test('any malformed allowlist denies everything (fail closed)',()=>{
  for(const raw of [' '+a+', *',a+',oops',a+',',','+a,
    a+';'+b,a+', '+b+', '+other+', '+a+', '+b+', '+other,'  ',(a+',').repeat(25)]){
    assert.equal(allowed(a,'true',raw),false,raw);
  }
  assert.equal(allowed('bad-device','true',a),false);
});
test('all commercial gateway entrypoints are gated by identical per-TV opt-in',()=>{
  const s=fs.readFileSync('supabase/functions/device-gateway/index.ts','utf8');
  const guard="commercialPilotDeviceAllowed(device.id, Deno.env.get('VISION_COMMERCIAL_ENABLED'), Deno.env.get('VISION_COMMERCIAL_PILOT_DEVICE_IDS'))";
  assert.equal(s.split(guard).length-1,3);
  assert.match(s,/augmentCommercial\(admin, device,/);
  assert.match(s,/decorateCommercialRows\(admin, device\.id,/);
  assert.match(s,/refreshCommercialDaily\(admin, device\.id,/);
  assert.doesNotMatch(s,/Deno\.env\.get\('VISION_COMMERCIAL_ENABLED'\) === 'true'/);
});
