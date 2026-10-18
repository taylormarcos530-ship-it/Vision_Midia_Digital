/** Vision Menu — pure in-memory publication laboratory. No network, Supabase, TV or credentials. */
import {parseSavedState, INTERVALS} from './menu-data.mjs';
import {TEMPLATE_01} from './menu-template.mjs';

const own = (obj, name) => Object.prototype.hasOwnProperty.call(obj, name);
const clone = value => JSON.parse(JSON.stringify(value));
const WRITERS = new Set(['owner', 'admin', 'operator']);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

export class LabPublishError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'LabPublishError'; }
}
function stop(code, message) { throw new LabPublishError(code, message); }
function id(input) { return typeof input === 'string' && ID_PATTERN.test(input); }
function asVersion(v) { return Number.isSafeInteger(v) && v >= 0 ? v : NaN; }
function verifyDocument(input, company, assets) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.products)) stop('bad_document', 'Rascunho inválido.');
  let draft;
  try { draft = parseSavedState(input); }
  catch { stop('bad_document', 'Produtos, preços ou nomes inválidos.'); }
  if (draft.products.length > 300 || !INTERVALS.includes(draft.intervalSeconds)) stop('bad_document', 'Dados fora dos limites.');
  // Only mock media IDs scoped to the selected company are accepted; local blob URLs are never published.
  const videoAssetId = input.videoAssetId ?? null;
  if (videoAssetId != null && (!id(videoAssetId) || !assets.some(a => a.id === videoAssetId && a.companyId === company && a.type === 'video'))) {
    stop('media_mismatch', 'Vídeo não pertence à empresa ou não está na biblioteca fictícia.');
  }
  return { templateId: TEMPLATE_01.id, products: draft.products, intervalSeconds: draft.intervalSeconds, storeName: draft.storeName, videoAssetId };
}

export function createPublishLab({companies, members, devices, mediaAssets}) {
  const companiesById = new Map();
  const memberByKey = new Map();
  const devicesById = new Map();
  const drafts = new Map();
  const publication = new Map();
  const audit = [];
  for (const c of companies) {
    if (!id(c.id) || companiesById.has(c.id)) stop('bad_fixture', 'Empresas fictícias inválidas.');
    companiesById.set(c.id, {id:c.id,name:String(c.name),active:c.active === true});
  }
  for (const m of members) {
    if (!companiesById.has(m.companyId) || !id(m.actorId)) stop('bad_fixture','Membro fictício inválido.');
    memberByKey.set(`${m.companyId}:${m.actorId}`, {role:m.role, active:m.active === true});
  }
  for (const d of devices) {
    if (!id(d.id) || devicesById.has(d.id) || !companiesById.has(d.companyId)) stop('bad_fixture','TV fictícia inválida.');
    devicesById.set(d.id,{id:d.id,companyId:d.companyId,name:d.name,active:d.active === true,basePlaylistId:d.basePlaylistId ?? null, campaignActive:d.campaignActive === true,commercialActive:d.commercialActive === true});
  }
  for (const a of mediaAssets) if (!id(a.id) || !companiesById.has(a.companyId) || !['video','image'].includes(a.type)) stop('bad_fixture','Mídia fictícia inválida.');
  const assetCopy = mediaAssets.map(a=>({...a}));

  function member(actorId, companyId, writing = false) {
    const company = companiesById.get(companyId);
    const membership = memberByKey.get(`${companyId}:${actorId}`);
    if (!company?.active || !membership?.active || (writing && !WRITERS.has(membership.role))) stop('forbidden','Empresa ou permissão indisponível.');
    return membership;
  }
  function deviceFor(actorId, companyId, deviceId, writing = false) {
    member(actorId, companyId, writing);
    const device = devicesById.get(deviceId);
    if (!device || device.companyId !== companyId) stop('not_found','TV não pertence à empresa selecionada.');
    if (!device.active) stop('device_disabled','TV indisponível.');
    return device;
  }
  function currentDraft({actorId,companyId}) {
    member(actorId,companyId);
    const item=drafts.get(companyId);
    return item ? clone(item) : null;
  }
  function saveDraft({actorId,companyId,document,expectedVersion}) {
    member(actorId,companyId,true);
    const previous=drafts.get(companyId);
    if (asVersion(expectedVersion) !== (previous?.version || 0)) stop('conflict','Rascunho foi alterado. Recarregue antes de salvar.');
    const contents=verifyDocument(document,companyId,assetCopy);
    const next={version:(previous?.version || 0)+1,document:contents};
    drafts.set(companyId,next);
    audit.push({action:'save_draft',companyId,actorId,version:next.version});
    return clone(next);
  }
  function listDevices({actorId,companyId}) {
    member(actorId,companyId);
    return [...devicesById.values()].filter(d=>d.companyId===companyId).map(d=>({
      ...clone(d),menuVersion:publication.get(d.id)?.version||0,
      menuEnabled:publication.get(d.id)?.enabled===true,
    }));
  }
  function preflight({actorId,companyId,deviceId,mode='menu-only'}) {
    const d=deviceFor(actorId,companyId,deviceId,true);
    const draft=drafts.get(companyId);
    if (!draft) stop('no_draft','Salve um rascunho antes de publicar.');
    if (!draft.document.products.some(product => product.enabled)) stop('no_products','Nenhum produto ativo para a TV.');
    if (!draft.document.videoAssetId) stop('no_video','Escolha o vídeo fictício para a prévia da publicação.');
    if (mode !== 'menu-only') stop('unsupported_mode','Somente menu independente é permitido neste simulador.');
    if (d.campaignActive || d.commercialActive) stop('commercial_protected','Campanhas e anúncios existentes são protegidos.');
    if (d.basePlaylistId) stop('playlist_protected','Esta TV já tem playlist. Não substituí-la sem integração homologada.');
    return clone({companyId,deviceId,mode,expectedDraftVersion:draft.version,
      expectedDeviceVersion:publication.get(deviceId)?.version||0,
      templateId:draft.document.templateId,eligible:true});
  }
  function simulatePublish({actorId,companyId,deviceId,mode='menu-only',expectedDraftVersion,expectedDeviceVersion,confirm=false}) {
    if (confirm !== true) stop('confirmation_required','Confirme a simulação antes de publicar.');
    const eligibility=preflight({actorId,companyId,deviceId,mode});
    if (eligibility.expectedDraftVersion !== expectedDraftVersion || eligibility.expectedDeviceVersion !== expectedDeviceVersion) {
      stop('conflict','Rascunho ou TV alterados desde a prévia.');
    }
    const published={companyId,deviceId,enabled:true,mode,version:eligibility.expectedDeviceVersion+1,
      draftVersion:expectedDraftVersion,document:clone(drafts.get(companyId).document)};
    publication.set(deviceId,published);
    audit.push({action:'simulate_publish',companyId,deviceId,actorId,version:published.version});
    return clone(published);
  }
  function disableSimulatedMenu({actorId,companyId,deviceId,expectedDeviceVersion}) {
    deviceFor(actorId,companyId,deviceId,true);
    const current=publication.get(deviceId);
    if (!current || current.version !== expectedDeviceVersion) stop('conflict','Versão da TV divergente.');
    const next={...current,enabled:false,version:current.version+1};
    publication.set(deviceId,next);
    audit.push({action:'disable_menu',companyId,deviceId,actorId,version:next.version});
    return clone(next);
  }
  function publishedForDevice({actorId,companyId,deviceId}) {
    deviceFor(actorId,companyId,deviceId,false);
    const p=publication.get(deviceId);
    return p?clone(p):null;
  }
  function auditForCompany({actorId,companyId}) {
    member(actorId,companyId);
    return clone(audit.filter(x=>x.companyId===companyId));
  }
  return Object.freeze({saveDraft,currentDraft,listDevices,preflight,simulatePublish,disableSimulatedMenu,publishedForDevice,auditForCompany});
}
