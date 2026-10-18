/**
 * Vision Menu Digital — opt-in read-only panel bridge.
 * No API, storage, database, device command, or publication capability.
 * Receives a minimal snapshot from the already authenticated operational panel.
 */
const ROLES = new Set(['owner', 'admin', 'operator', 'viewer']);
const safe = value => typeof value === 'string' ? value.trim() : '';
const bounded = (value, max = 120) => safe(value).slice(0, max);
const validCompany = row => row && typeof row === 'object' && safe(row.id) && safe(row.name) && row.status === 'active';
export const VISION_MENU_PREVIEW_FLAG = 'VISION_MENU_PANEL_ENABLED';

export function buildMenuPreviewSnapshot(ctx) {
  const company = ctx?.company;
  const companyId = safe(company?.id);
  const role = safe(ctx?.role);
  // Frontend authorization is UX defense only, not an RLS/backend permission check.
  if (ctx?.signedIn !== true || !validCompany(company) || !ROLES.has(role)) {
    return Object.freeze({ available: false, reason: 'access_required', companyId: '', devices: [], videos: [], canPublish: false });
  }
  const devices = (Array.isArray(ctx.devices) ? ctx.devices : [])
    .filter(row => row?.company_id === companyId && !row.retired_at)
    .map(row => ({ id: bounded(row.id, 90), name: bounded(row.name, 90), status: bounded(row.status, 30) || 'unknown' }))
    .filter(row => row.id);
  const videos = (Array.isArray(ctx.media) ? ctx.media : [])
    .filter(row => row?.company_id === companyId && row.media_type === 'video' && row.processing_status === 'ready' && safe(row.storage_path))
    .map(row => ({ id: bounded(row.id, 90), name: bounded(row.name, 100) || 'Vídeo', sizeBytes: Number.isSafeInteger(row.size_bytes) ? row.size_bytes : null }))
    .filter(row => row.id);
  const assignments = new Set((Array.isArray(ctx.assignments) ? ctx.assignments : [])
    .filter(row => row.company_id === companyId && row.playlist_id)
    .map(row => row.device_id));
  const campaignTargets = new Set((Array.isArray(ctx.campaignTargets) ? ctx.campaignTargets : [])
    .filter(row => row.company_id === companyId)
    .map(row => row.device_id));
  const activeCampaigns = (Array.isArray(ctx.campaigns) ? ctx.campaigns : [])
    .filter(row => row.company_id === companyId && row.is_active === true);
  const defaultTarget = activeCampaigns.some(row => row.all_devices === true);
  const targetsAnyCampaign = activeCampaigns.length > 0;
  const caution = devices.map(d => ({
    ...d,
    hasAssignedPlaylist: assignments.has(d.id),
    hasPotentialCampaign: defaultTarget || (targetsAnyCampaign && campaignTargets.has(d.id)),
  }));
  return Object.freeze({
    available: true, companyId, companyName: bounded(company.name), role,
    devices: caution, videos, canPublish: false, mode: 'read-only',
    disclaimer: 'Prévia autenticada e somente leitura. Nenhuma TV, mídia ou playlist será alterada.',
  });
}

function el(doc, tag, options = {}) {
  const node = doc.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  return node;
}
function field(doc, labelText, items, emptyText) {
  const wrap = el(doc,'label',{className:'vision-menu-field'});
  wrap.append(el(doc,'span',{text:labelText}));
  const select = el(doc,'select');
  select.setAttribute('aria-label',labelText);
  const placeholder = el(doc,'option',{text: items.length ? 'Selecione para conferir' : emptyText});
  placeholder.value = '';
  select.append(placeholder);
  for (const item of items) {
    const option = el(doc,'option',{text:item.name});
    option.value = item.id;
    select.append(option);
  }
  wrap.append(select);
  return { wrap, select };
}

/** Keep the normal panel untouched when disabled. Do not attach API clients or event handlers. */
export function mountVisionMenuPreview({doc = document, win = window, getContext}) {
  if (win[VISION_MENU_PREVIEW_FLAG] !== true || typeof getContext !== 'function') return { mounted:false };
  const nav = doc.querySelector('#sidebar .nav-list');
  const content = doc.querySelector('.content-area');
  if (!nav || !content) return { mounted:false };
  if (doc.querySelector('#view-vision-menu')) return { mounted:false };

  const style = el(doc,'style');
  style.textContent = `#view-vision-menu{max-width:1000px}#view-vision-menu .vision-menu-preview{padding:18px;border-radius:14px;border:1px solid var(--border-color,#aaa5);background:var(--card-bg,transparent)}
  #vision-menu-preview-nav[hidden]{display:none!important}#view-vision-menu .vision-menu-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}
  #view-vision-menu .vision-menu-field{display:grid;gap:7px;font-weight:600}
  #view-vision-menu select{width:100%;max-width:100%;padding:10px;color:inherit;background:var(--input-bg,transparent);border:1px solid #9998;border-radius:8px}
  #view-vision-menu .vision-menu-note{font-size:.92rem;opacity:.85;margin-top:12px}
  @media(max-width:660px){#vision-menu-preview-nav[hidden]{display:none!important}#view-vision-menu .vision-menu-grid{grid-template-columns:1fr}}`;
  doc.head.append(style);
  const button = el(doc,'button',{className:'nav-item',text:'▤ Menu Digital · prévia'});
  button.type='button';
  button.id='vision-menu-preview-nav';
  const playlists = nav.querySelector('[data-view="playlists"]');
  playlists ? playlists.insertAdjacentElement('afterend',button) : nav.append(button);
  const section = el(doc,'section',{className:'view-section hidden'});
  section.id='view-vision-menu';
  const card = el(doc,'div',{className:'vision-menu-preview'});
  const heading=el(doc,'h2',{text:'Menu Digital · integração em homologação'});
  const status=el(doc,'p',{text:'Carregando os dados já autorizados pelo painel.'});
  status.setAttribute('role','status');
  const grid=el(doc,'div',{className:'vision-menu-grid'});
  const devices=field(doc,'TVs cadastradas nesta empresa',[],'Nenhuma TV');
  const media=field(doc,'Vídeos disponíveis nesta empresa',[],'Nenhum vídeo');
  grid.append(devices.wrap,media.wrap);
  const detail=el(doc,'p',{className:'vision-menu-note',text:'A publicação real permanece bloqueada. O Menu Digital não altera playlists nem anúncios.'});
  const warning=el(doc,'p',{className:'vision-menu-note',text:'Atualizar preços e publicar dependerá de backend/RLS homologados.'});
  card.append(heading,status,grid,detail,warning);
  section.append(card);
  content.append(section);
  let opened=false;
  let snapshot=null;
  const choose = (select,items) => {
    const previous=select.value;
    select.replaceChildren();
    const empty=el(doc,'option',{text:items.length?'Selecione para conferir':'Nenhuma opção disponível'});
    empty.value='';select.append(empty);
    for(const x of items) {const o=el(doc,'option',{text:x.name});o.value=x.id;select.append(o)}
    if (items.some(x => x.id === previous)) select.value = previous;
  };
  const updateDetail = () => {
    if (!snapshot?.available) {detail.textContent='Autenticação ou vínculo de empresa indisponível.';return}
    const tv=snapshot.devices.find(x=>x.id===devices.select.value);
    detail.textContent=tv ? (tv.hasPotentialCampaign||tv.hasAssignedPlaylist
      ? 'TV com programação existente: preservada e protegida. Nenhuma alteração permitida.'
      : 'TV sem atribuição direta identificada nesta prévia. Publicação real continua bloqueada.')
      : snapshot.disclaimer;
  };
  const refresh=()=>{
    snapshot=buildMenuPreviewSnapshot(getContext());
    button.hidden=!snapshot.available;
    if (!snapshot.available) {
      section.classList.add('hidden');opened=false;
      choose(devices.select,[]);choose(media.select,[]);
      status.textContent='Acesso indisponível.';return;
    }
    status.textContent=`${snapshot.companyName}: ${snapshot.devices.length} TV(s), ${snapshot.videos.length} vídeo(s) disponível(is).`;
    choose(devices.select,snapshot.devices);choose(media.select,snapshot.videos);
    updateDetail();
  };
  button.hidden=true;
  button.addEventListener('click',()=>{
    refresh();
    if (!snapshot.available) return;
    doc.querySelectorAll('.view-section').forEach(s=>s.classList.add('hidden'));
    section.classList.remove('hidden');
    doc.querySelectorAll('.nav-item[data-view]').forEach(x=>x.classList.remove('active'));
    button.classList.add('active');opened=true;
    const title=doc.querySelector('#view-title');if(title)title.textContent='Menu Digital';
    const kicker=doc.querySelector('#view-kicker');if(kicker)kicker.textContent='HOMOLOGAÇÃO · LEITURA';
    doc.querySelector('#sidebar')?.classList.remove('open');
  });
  devices.select.addEventListener('change',updateDetail);
  doc.addEventListener('click',event=>{
    if (event.target?.closest?.('.nav-item[data-view],.nav-item[data-saas-view]')) {
      if(opened){opened=false;button.classList.remove('active');section.classList.add('hidden')}
    }
  });
  win.addEventListener('vision-menu-panel-updated',refresh);
  win.addEventListener('vision-session-changed',refresh);
  refresh();
  return Object.freeze({mounted:true,refresh});
}
