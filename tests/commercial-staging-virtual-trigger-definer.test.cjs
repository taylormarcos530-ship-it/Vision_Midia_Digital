const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const script=fs.readFileSync('supabase/sql/staging-virtual-trigger-definer-20261018.sql','utf8');
test('service_role correction only adjusts a guarded trigger execution privilege',()=>{
 assert.match(script,/IS DISTINCT FROM 'jmiuitrrhtaeyrpuyohk'/);
 assert.match(script,/to_regclass\('vision_menu_lab\.vision_menu_drafts'\)/);
 assert.match(script,/owner_name IS DISTINCT FROM 'postgres'/);
 assert.match(script,/c\.name=''LAB-VIRTUAL-'' \|\| OLD\.checksum/);
 assert.match(script,/RAISE EXCEPTION ''immutable_revision''/);
 assert.match(script,/ALTER FUNCTION private\.vision_revision_immutable\(\) SECURITY DEFINER;/);
 assert.doesNotMatch(script,/GRANT |DROP |DISABLE TRIGGER|TRUNCATE|COMMIT|fpadgedrgcxrrqflzhjt/i);
});
