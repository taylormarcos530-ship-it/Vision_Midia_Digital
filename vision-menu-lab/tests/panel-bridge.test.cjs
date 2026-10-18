const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const p=import(pathToFileURL(path.join(__dirname,'..','panel-bridge.mjs')).href);
const base={signedIn:true,company:{id:'tenant-a',name:'Casa Bom Sabor',status:'active'},role:'owner',
 devices:[{id:'tv-a',name:'Minha TV',company_id:'tenant-a'},{id:'tv-b',name:'Outra TV',company_id:'tenant-b'}],
 media:[{id:'video-a',name:'Oferta',media_type:'video',company_id:'tenant-a',processing_status:'ready',storage_path:'tenant-a/video.mp4'},
 {id:'video-b',name:'Video estranho',media_type:'video',company_id:'tenant-b',processing_status:'ready',storage_path:'tenant-b/file.mp4'},
 {id:'video-pending',name:'Pendente',media_type:'video',company_id:'tenant-a',processing_status:'pending',storage_path:'tenant-a/p.mp4'}],
 assignments:[{company_id:'tenant-a',device_id:'tv-a',playlist_id:'playlist-a'}],campaigns:[],campaignTargets:[]};
const snapshot=async context=>(await p).buildMenuPreviewSnapshot(context);
test('sem login falha fechada',async()=>assert.equal((await snapshot({...base,signedIn:false})).available,false));
test('empresa suspensa falha fechada',async()=>assert.equal((await snapshot({...base,company:{...base.company,status:'suspended'}})).available,false));
test('papel inesperado falha fechada',async()=>assert.equal((await snapshot({...base,role:'support'})).available,false));
test('filtra TVs estranhas',async()=>assert.deepEqual((await snapshot(base)).devices.map(d=>d.id),['tv-a']));
test('filtra mídia estranha',async()=>assert.deepEqual((await snapshot(base)).videos.map(d=>d.id),['video-a']));
test('não expõe token ou storage path',async()=>assert.doesNotMatch(JSON.stringify(await snapshot({...base,token:'SECRET'})),/SECRET|storage_path|tenant-a\/video.mp4/));
test('nem administrador publica por esta ponte',async()=>assert.equal((await snapshot({...base,role:'admin'})).canPublish,false));
test('papel viewer é apenas leitura',async()=>{const s=await snapshot({...base,role:'viewer'});assert.equal(s.available,true);assert.equal(s.canPublish,false)});
test('marca playlist atribuída como protegida',async()=>assert.equal((await snapshot(base)).devices[0].hasAssignedPlaylist,true));
test('marca campanha ativa global como potencial conflito',async()=>{const s=await snapshot({...base,campaigns:[{company_id:'tenant-a',is_active:true,all_devices:true}]});assert.equal(s.devices[0].hasPotentialCampaign,true)});
test('campanha inativa não produz falso conflito',async()=>{const s=await snapshot({...base,campaigns:[{company_id:'tenant-a',is_active:false,all_devices:true}]});assert.equal(s.devices[0].hasPotentialCampaign,false)});
test('alvo de outra empresa não pode marcar TV local',async()=>{const s=await snapshot({...base,campaigns:[{company_id:'tenant-a',is_active:true,all_devices:false}],campaignTargets:[{company_id:'tenant-b',device_id:'tv-a'}]});assert.equal(s.devices[0].hasPotentialCampaign,false)});
test('não altera os dados originais',async()=>{const original=JSON.stringify(base);await snapshot(base);assert.equal(JSON.stringify(base),original)});
test('flag desativada não monta UI nem chama contexto',async()=>{let count=0;const {mountVisionMenuPreview}=await p;const r=mountVisionMenuPreview({doc:{querySelector(){throw new Error('DOM should not be accessed')}},win:{VISION_MENU_PANEL_ENABLED:false},getContext(){count++;return base}});assert.equal(r.mounted,false);assert.equal(count,0)});
test('flag indefinida falha fechada',async()=>{const {mountVisionMenuPreview}=await p;assert.equal(mountVisionMenuPreview({doc:{},win:{},getContext(){}}).mounted,false)});
