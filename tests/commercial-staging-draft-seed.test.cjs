const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=fs.readFileSync('tests/sql/staging_seed_two_draft_campaigns.sql','utf8');

test('only the independently marked Supabase staging database can receive visual drafts',()=>{
 assert.match(sql,/private\.vision_staging_guard/);
 assert.match(sql,/project_ref='jmiuitrrhtaeyrpuyohk'/);
 assert.match(sql,/staging_only_guard_rejected/);
 assert.match(sql,/staging_not_empty_for_safe_campaign_seed/);
 assert.doesNotMatch(sql,/fpadgedrgcxrrqflzhjt/);
 assert.match(sql,/begin;[\s\S]*commit;/);
});
test('visual drafts are idempotent and can never be accidentally delivered',()=>{
 assert.equal((sql.match(/insert into public\.vision_commercial_campaigns\(/g)||[]).length,2);
 assert.match(sql,/not exists\(select 1 from public\.vision_commercial_campaigns/);
 assert.match(sql,/c\.status<>'draft' or c\.current_revision_id is not null/);
 assert.match(sql,/unexpected_ad_delivery_state/);
 assert.match(sql,/HOMOLOGACAO A - Campanha ilustrativa \(NAO VEICULAR\)/);
 assert.match(sql,/HOMOLOGACAO B - Campanha ilustrativa \(NAO VEICULAR\)/);
 assert.doesNotMatch(sql,/insert\s+into\s+(?:public\.)?(?:devices|playback_logs|vision_commercial_targets|vision_commercial_revisions|vision_commercial_daily)/i);
 assert.doesNotMatch(sql,/update\s+public\.vision_commercial_campaigns/i);
 assert.doesNotMatch(sql,/insert\s+into\s+auth\./i);
 assert.doesNotMatch(sql,/delete\s+from\s+/i);
 assert.doesNotMatch(sql,/@gmail\.com|password|service_role/i);
});
test('portal safely renders a draft without media, TV links or fabricated impressions',async()=>{
 const {renderCampaigns,campaignSummary}=await import('../commercial-ui.mjs');
 const data={
   today:'2026-10-14',
   campaigns:[{id:'campaign-a',name:'HOMOLOGACAO A - Campanha ilustrativa (NAO VEICULAR)',status:'draft',start_date:'2026-10-14',end_date:'2026-11-13',current_revision_id:null}],
   revisions:[],targets:[],daily:[]
 };
 const html=renderCampaigns(data);
 assert.match(html,/Rascunho/);
 assert.match(html,/HOMOLOGACAO A/);
 assert.match(html,/Mídia não disponível/);
 assert.match(html,/Nenhum ponto vinculado/);
 assert.match(html,/Ainda não há reproduções registradas/);
 assert.deepEqual(campaignSummary(data,'campaign-a').points,{});
 assert.equal(campaignSummary(data,'campaign-a').total,0);
});
