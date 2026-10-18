import {createPublishLab, LabPublishError} from './publish-contract.mjs';
import {companies,members,devices,mediaAssets} from './fixtures/publish-lab.mjs';
import {DEFAULT_STORE_KEY,parseSavedState,createState} from './menu-data.mjs';

const $=name=>document.getElementById(name);
const store=createPublishLab({companies,members,devices,mediaAssets});
const companyId='demo-butcher';
const actorId='owner-butcher';
let currentDocument=null;
let draftVersion=0;
let preview=null;
let currentPublished=null;
function announce(node,text,error=false){node.textContent=text;node.dataset.error=error?'true':'false';}
function invalidatePreview(){preview=null;$('publish').disabled=true;announce($('check-result'),'Execute novamente a verificação antes de publicar.');}
function showStatus(){
  const deviceId=$('device').value;
  try{
    const data=store.publishedForDevice({actorId,companyId,deviceId});
    $('device-status').textContent=JSON.stringify(data??{deviceId,enabled:false,message:'TV fictícia sem menu publicado'},null,2);
    $('audit-status').textContent=JSON.stringify(store.auditForCompany({actorId,companyId}),null,2);
    currentPublished=data;
    $('disable').disabled=!data?.enabled;
  }catch(error){announce($('publish-result'),error.message,true)}
}
function chooseDraft(){
  try {
    const raw=localStorage.getItem(DEFAULT_STORE_KEY);
    const parsed=raw?parseSavedState(JSON.parse(raw)):createState();
    currentDocument={products:parsed.products,intervalSeconds:parsed.intervalSeconds,storeName:parsed.storeName,videoAssetId:$('media').value||null};
    $('draft-description').textContent=raw?`Rascunho importado: ${parsed.products.length} produtos (nenhuma logo ou vídeo local enviado).`:`Exemplo demonstrativo carregado: ${parsed.products.length} produtos.`;
    invalidatePreview();
  }catch{
    currentDocument=null;
    announce($('draft-description'),'Rascunho salvo inválido. Corrija-o no editor.',true);
  }
}
function safeAction(callback,target='publish-result'){
  try{callback()}catch(e){
    const msg=e instanceof LabPublishError?`${e.code}: ${e.message}`:'Não foi possível concluir a simulação.';
    if(target==='check-result')invalidatePreview();
    announce($(target),msg,true);
  }
}
for(const d of store.listDevices({actorId,companyId})) {
  const option=document.createElement('option');option.value=d.id;option.textContent=d.name;$('device').append(option);
}
$('import').addEventListener('click',chooseDraft);
$('media').addEventListener('change',()=>{if(currentDocument){currentDocument.videoAssetId=$('media').value||null;invalidatePreview()}});
$('device').addEventListener('change',()=>{invalidatePreview();showStatus()});
$('confirm').addEventListener('change',()=>{$('publish').disabled=!preview||!$('confirm').checked});
$('save').addEventListener('click',()=>safeAction(()=>{
  if(!currentDocument)throw new LabPublishError('no_import','Importe um rascunho antes de salvar.');
  const result=store.saveDraft({actorId,companyId,document:currentDocument,expectedVersion:draftVersion});
  draftVersion=result.version;
  invalidatePreview();
  announce($('publish-result'),`Rascunho fictício salvo: revisão ${draftVersion}. Nenhuma TV alterada.`);
  showStatus();
}));
$('preflight').addEventListener('click',()=>safeAction(()=>{
  preview=store.preflight({actorId,companyId,deviceId:$('device').value});
  $('publish').disabled=!$('confirm').checked;
  announce($('check-result'),`Aprovado somente no laboratório. Rascunho ${preview.expectedDraftVersion}; TV ${preview.expectedDeviceVersion}.`);
},'check-result'));
$('publish').addEventListener('click',()=>safeAction(()=>{
  if(!preview)throw new LabPublishError('no_preflight','Execute a verificação.');
  const data=store.simulatePublish({actorId,companyId,deviceId:preview.deviceId,mode:preview.mode,expectedDraftVersion:preview.expectedDraftVersion,expectedDeviceVersion:preview.expectedDeviceVersion,confirm:$('confirm').checked});
  announce($('publish-result'),`Publicação fictícia registrada na TV ${data.deviceId} (versão ${data.version}). Nenhum dispositivo real foi contatado.`);
  invalidatePreview();
  showStatus();
}));
$('disable').addEventListener('click',()=>safeAction(()=>{
  if(!currentPublished)throw new LabPublishError('not_published','Menu ainda não publicado.');
  const data=store.disableSimulatedMenu({actorId,companyId,deviceId:currentPublished.deviceId,expectedDeviceVersion:currentPublished.version});
  announce($('publish-result'),`Menu fictício desativado na TV ${data.deviceId}. Playlist original preservada.`);
  invalidatePreview();showStatus();
}));
chooseDraft();showStatus();
