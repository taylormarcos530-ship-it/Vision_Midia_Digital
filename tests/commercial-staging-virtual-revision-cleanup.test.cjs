'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('supabase/sql/staging-virtual-revision-cleanup-20261018.sql','utf8');
test('staging-only narrow exception does not disable immutable revision trigger',()=>{
 assert.match(sql,/IS DISTINCT FROM 'jmiuitrrhtaeyrpuyohk'/);
 assert.match(sql,/to_regclass\('vision_menu_lab\.vision_menu_drafts'\)/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION private\.vision_revision_immutable\(\)/);
 assert.match(sql,/IF TG_OP='DELETE'/);
 assert.match(sql,/THEN RETURN OLD; END IF;/);
 assert.match(sql,/RAISE EXCEPTION 'immutable_revision';/);
 assert.doesNotMatch(sql,/DISABLE TRIGGER|session_replication_role|DROP TRIGGER|\bTRUNCATE\b|fpadgedrgcxrrqflzhjt/);
});
test('only verified synthetic lab revisions and matching campaign UUID may be deleted',()=>{
 for(const marker of ["OLD.name='LAB ONLY - 1px'","OLD.media_type='image'",
  "OLD.checksum ~*","OLD.source_storage_path ~* '^qa-commercial-probe/",
  "OLD.storage_path ~* '^commercial-ads/","c.name='LAB-VIRTUAL-' || OLD.checksum",
  "c.id=OLD.campaign_id"])assert.ok(sql.includes(marker),marker);
 assert.doesNotMatch(sql,/IF TG_OP='UPDATE'\s+THEN RETURN OLD/);
});
