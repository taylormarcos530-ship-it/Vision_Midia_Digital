const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const base = path.resolve(__dirname, '..');
const get = async file => import(pathToFileURL(path.join(base,'integration',file)).href);
const c1 = '11111111-1111-4111-8111-111111111111';
const c2 = '22222222-2222-4222-8222-222222222222';
const u1 = '33333333-3333-4333-8333-333333333333';
const u2 = '44444444-4444-4444-8444-444444444444';
const m1 = '55555555-5555-4555-8555-555555555555';
const p1 = '66666666-6666-4666-8666-666666666666';
const d1 = '77777777-7777-4777-8777-777777777777';
const logo = '88888888-8888-4888-8888-888888888888';
const video = '99999999-9999-4999-8999-999999999999';
const actor = (companyId = c1, role='owner',userId=u1) => ({userId, companyId, role, active:true, companyWritable:true});
const payload = (count=9) => ({
  templateKey:'butcher-01', storeName:'Casa de Carnes Bom Sabor', intervalSeconds:10,
  logoAssetId:null,videoAssetId:null,
  products:Array.from({length:count},(_,i)=>({id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(i+1).padStart(12,'0')}`,name:`Item ${i+1}`,priceCents:1090+i,enabled:true}))
});
const media = [
 {id:logo,companyId:c1,type:'image',status:'ready',privateStored:true},
 {id:video,companyId:c1,type:'video',status:'ready',privateStored:true}
];
function saveArg(override={}){return {actor:actor(),companyId:c1,menuId:m1,expectedRevision:0,requestId:p1,payload:payload(), ...override};}
function stageArg(override={}){return {actor:actor(),companyId:c1,menuId:m1,revision:1,device:{id:d1,companyId:c1,retired:false,accessStatus:'active'},mode:'interleave',...override};}
function throwsCode(fn, code){assert.throws(fn, e=>e?.code === code, `expected ${code}`)}

test('schema has real 8-item groups, accepted intervals and template',async()=>{
 const {PAGE_SIZE,ALLOWED_INTERVALS,MENU_TEMPLATE} = await get('menu-contract.mjs');
 assert.equal(PAGE_SIZE,8);assert.deepEqual(ALLOWED_INTERVALS,[5,10,15]);assert.equal(MENU_TEMPLATE,'butcher-01');
});
test('valid contract canonicalizes positions; preview eight products',async()=>{
 const {cleanMenuDraft,getPreviewRows}=await get('menu-contract.mjs');
 const p=cleanMenuDraft(payload(17));assert.equal(p.products[8].position,8);
 assert.equal(getPreviewRows(p,0).length,8);assert.equal(getPreviewRows(p,1).length,8);assert.equal(getPreviewRows(p,2).length,1);
});
test('empty menu yields empty preview, not phantom group',async()=>{const {cleanMenuDraft,getPreviewRows}=await get('menu-contract.mjs');assert.deepEqual(getPreviewRows(cleanMenuDraft(payload(0)),0),[])});
test('default empty product schema is accepted for drafts',async()=>{const {cleanMenuDraft}=await get('menu-contract.mjs'); assert.equal(cleanMenuDraft(payload(0)).products.length,0)});
test('rejects excessive products',async()=>{const {cleanMenuDraft}=await get('menu-contract.mjs');throwsCode(()=>cleanMenuDraft(payload(301)),'invalid_product_count')});
test('rejects fake price, decimal, negative and overflow cents',async()=>{const {cleanMenuDraft}=await get('menu-contract.mjs');for(const n of [-1,1.5,1e12,'1000',NaN]){const p=payload(1);p.products[0].priceCents=n;throwsCode(()=>cleanMenuDraft(p),'invalid_price')}});
test('duplicate product IDs are rejected',async()=>{const {cleanMenuDraft}=await get('menu-contract.mjs');const p=payload(2);p.products[1].id=p.products[0].id;throwsCode(()=>cleanMenuDraft(p),'duplicate_or_invalid_product_id')});
test('unknown fields are rejected rather than silently stored',async()=>{const {cleanMenuDraft}=await get('menu-contract.mjs');throwsCode(()=>cleanMenuDraft({...payload(),__protoHack:true}),'invalid_draft')});
test('unsupported interval and template fail closed',async()=>{const {cleanMenuDraft}=await get('menu-contract.mjs');throwsCode(()=>cleanMenuDraft({...payload(),intervalSeconds:6}),'invalid_interval');throwsCode(()=>cleanMenuDraft({...payload(),templateKey:'restaurant-01'}),'invalid_template')});
test('malformed product names rejected',async()=>{const {cleanMenuDraft}=await get('menu-contract.mjs');const p=payload(1);p.products[0].name=' ';throwsCode(()=>cleanMenuDraft(p),'invalid_name')});
test('asset mismatch between tenants is blocked',async()=>{const {cleanMenuDraft,assertTenantMedia}=await get('menu-contract.mjs');const p=payload(1);p.logoAssetId=logo; const d=cleanMenuDraft(p);throwsCode(()=>assertTenantMedia({companyId:c2,draft:d,media}),'image_asset_not_allowed')});
test('logo/video must use approved private storage, not URLs',async()=>{const {cleanMenuDraft}=await get('menu-contract.mjs');throwsCode(()=>cleanMenuDraft({...payload(),videoAssetId:'https://example.com/video.mp4'}),'invalid_video_id')});
test('viewer cannot save',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();throwsCode(()=>s.saveDraft(saveArg({actor:actor(c1,'viewer')})),'write_access_denied')});
test('inactive or suspended company cannot save',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();throwsCode(()=>s.saveDraft(saveArg({actor:{...actor(),active:false}})),'company_access_blocked');throwsCode(()=>s.saveDraft(saveArg({actor:{...actor(),companyWritable:false}})),'company_access_blocked')});
test('cross tenant write blocked even if menu ID is known',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();throwsCode(()=>s.saveDraft(saveArg({companyId:c2})),'company_access_denied')});
test('write requires signed-in actor',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');throwsCode(()=>new IsolatedMenuStore().saveDraft(saveArg({actor:null})),'unauthenticated')});
test('create persists immutable revision 1 with audit',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();const r=s.saveDraft(saveArg());assert.equal(r.revision,1);assert.equal(s.audit({actor:actor(),companyId:c1}).length,1)});
test('revision read clone cannot mutate persisted snapshot',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());const x=s.readRevision({actor:actor(),companyId:c1,menuId:m1,revision:1});x.products[0].priceCents=99;assert.notEqual(s.readRevision({actor:actor(),companyId:c1,menuId:m1,revision:1}).products[0].priceCents,99)});
test('version CAS rejects stale editor and preserves original',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());throwsCode(()=>s.saveDraft(saveArg({requestId:u2,payload:payload(4),expectedRevision:0})),'revision_conflict');assert.equal(s.readRevision({actor:actor(),companyId:c1,menuId:m1,revision:1}).products.length,9)});
test('successful update increments and old revision remains',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());const r=s.saveDraft(saveArg({requestId:u2,payload:payload(2),expectedRevision:1}));assert.equal(r.revision,2);assert.equal(s.readRevision({actor:actor(),companyId:c1,menuId:m1,revision:1}).products.length,9)});
test('idempotent retry returns old revision with no second audit',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());const r=s.saveDraft(saveArg());assert.equal(r.alreadyCommitted,true);assert.equal(s.audit({actor:actor(),companyId:c1}).length,1)});
test('idempotency key reused with different payload fails',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());throwsCode(()=>s.saveDraft(saveArg({payload:payload(1)})),'idempotency_conflict')});
test('idempotency key cannot change actor',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());throwsCode(()=>s.saveDraft(saveArg({actor:actor(c1,'admin',u2)})),'idempotency_conflict')});
test('same tenant only may read revision',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());throwsCode(()=>s.readRevision({actor:actor(c2),companyId:c1,menuId:m1,revision:1}),'company_access_denied')});
test('staging interleave is never live and cannot command a TV',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());const r=s.stageIntent(stageArg());assert.equal(r.active,false);assert.equal(r.status,'review_required');assert.equal(r.mode,'interleave')});
test('staging normal does not displace existing programming',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());const r=s.stageIntent(stageArg({mode:'normal'}));assert.equal(r.status,'normal_untouched');assert.equal(r.active,false)});
test('staging cross-company TV prohibited',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());throwsCode(()=>s.stageIntent(stageArg({device:{id:d1,companyId:c2,accessStatus:'active'}})),'device_not_allowed')});
test('blocked, pending or retired devices prohibited',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());for(const data of [{accessStatus:'pending'}, {accessStatus:'blocked'}, {retired:true}]){throwsCode(()=>s.stageIntent(stageArg({device:{id:d1,companyId:c1,accessStatus:'active',...data}})),'device_not_allowed')}});
test('staging menu-only cannot use an empty menu',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg({payload:payload(0)}));throwsCode(()=>s.stageIntent(stageArg({mode:'menu_only'})),'empty_menu')});
test('missing revision cannot be staged',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());throwsCode(()=>s.stageIntent(stageArg({revision:2})),'menu_revision_not_found')});
test('audit exposes only tenant own events',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());assert.deepEqual(s.audit({actor:actor(c2),companyId:c2}),[])});
test('staged intent cannot be read by other tenant',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();s.saveDraft(saveArg());s.stageIntent(stageArg());throwsCode(()=>s.readIntent({actor:actor(c2),companyId:c1,deviceId:d1}),'company_access_denied')});
test('actual media assets validated against type and state',async()=>{const {IsolatedMenuStore}=await get('menu-service.mjs');const s=new IsolatedMenuStore();const p=payload(1);p.logoAssetId=logo;p.videoAssetId=video;const ok=s.saveDraft(saveArg({payload:p,media}));assert.equal(ok.revision,1)});
test('SQL is review-only and outside official migrations directory',()=>{const p=path.join(base,'integration','vision-menu-schema.DRAFT.sql');assert.ok(fs.existsSync(p));assert.ok(!p.includes('supabase/migrations'));assert.match(fs.readFileSync(p,'utf8'),/NOT AN APPLIED MIGRATION/)});
test('SQL RLS enabled on each new table; only SELECT granted authenticated',()=>{const sql=fs.readFileSync(path.join(base,'integration','vision-menu-schema.DRAFT.sql'),'utf8');for(const t of ['drafts','revisions','intents','audit']){assert.match(sql,new RegExp(`ALTER TABLE public\\.vision_menu_${t} ENABLE ROW LEVEL SECURITY`));assert.match(sql,new RegExp(`CREATE POLICY menu_${t}_member_read`))}assert.doesNotMatch(sql,/GRANT\s+(INSERT|UPDATE|DELETE|ALL)\s+ON[^;]+TO\s+authenticated/i)});
test('SQL proposal always stages active false; cannot change playlists or gateway',()=>{const sql=fs.readFileSync(path.join(base,'integration','vision-menu-schema.DRAFT.sql'),'utf8');assert.match(sql,/active boolean NOT NULL DEFAULT false CHECK \(active IS FALSE\)/);assert.match(sql,/VALUES\(p_device_id,p_company_id,p_menu_id,p_revision,p_mode,v_status,false,v_actor\)/);assert.doesNotMatch(sql.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n'),/\b(UPDATE|DELETE FROM|INSERT INTO)\s+(?:public\.)?(?:playlists|campaigns|device_playlist_assignments|device_commands|devices)\b/i)});
test('backend proof-of-concept has no fetch, Supabase or player side-effects',()=>{for(const f of ['menu-contract.mjs','menu-service.mjs']){const text=fs.readFileSync(path.join(base,'integration',f),'utf8');assert.doesNotMatch(text,/\bfetch\s*\(|createClient\s*\(|Deno\.env|window\.|document\.|navigator\./)}});
