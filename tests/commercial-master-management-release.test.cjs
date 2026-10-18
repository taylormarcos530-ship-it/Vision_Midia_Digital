const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const root='supabase/releases/commercial_master_management_20261018/';
const master=fs.readFileSync(root+'master-admin/index.ts','utf8');
const logic=fs.readFileSync(root+'_shared/commercial-master.mjs','utf8');
const gateway=fs.readFileSync('supabase/releases/commercial_off_20261018/device-gateway/index.ts','utf8');
test('Master can register, update, report and manage campaigns without enabling delivery',()=>{
 assert.match(master,/if\(a\.startsWith\('commercial_'\)\)\{return J\(await commercialMaster\(admin,user,role,b\)\)\}/);
 assert.match(master,/if\(!canWrite\(role\)\)return J\(\{error:'master_read_only'/);
 assert.match(logic,/commercial_create_advertiser/);
 assert.match(logic,/commercial_save_campaign/);
 assert.match(logic,/commercial_report/);
 assert.match(logic,/commercial_archive_advertiser/);
});
test('Master-only revision lookups restore editing without exposing source IDs to advertiser portal',()=>{
 assert.match(logic,/revisions:requireData\(revisions\)/);
 assert.match(logic,/vision_commercial_revisions'\)\.select\('id,campaign_id,source_media_id'\)/);
 const sql=fs.readFileSync('supabase/sql/vision-commercial-production-install-20261018.sql','utf8');
 assert.match(sql,/REVOKE SELECT ON TABLE public\.vision_commercial_revisions FROM authenticated/);
 assert.match(sql,/GRANT SELECT \(/);
});
test('gateway delivery remains blocked on every TV after management enablement',()=>{
 assert.match(gateway,/const COMMERCIAL_RELEASE_APPROVED = false;/);
 assert.equal((gateway.match(/COMMERCIAL_RELEASE_APPROVED && commercialPilotDeviceAllowed/g)||[]).length,3);
});
