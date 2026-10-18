export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const number=value=>new Intl.NumberFormat('pt-BR').format(Number(value)||0);
export const date=value=>value?value.slice(0,10).split('-').reverse().join('/'):'—';
export const time=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value)):'Nenhuma exibição registrada';
export function campaignState(c,today){const days=Math.max(0,Math.round((Date.parse(c.end_date+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000)+1);return {label:c.status==='draft'?'Rascunho':c.status==='paused'?'Pausada':c.end_date<today?'Encerrada':c.start_date>today?'Agendada':'Ativa',days};}
export function campaignSummary(data,id){const rows=(data.daily||[]).filter(r=>r.campaign_id===id);const points={},days={};let total=0,today=0,last=null;for(const r of rows){const n=Number(r.completed_count)||0;total+=n;if(r.day===data.today)today+=n;points[r.device_id]=(points[r.device_id]||0)+n;days[r.day]=(days[r.day]||0)+n;if(r.last_completed_at&&(!last||r.last_completed_at>last))last=r.last_completed_at;}return {total,today,last,points,days};}
// Counts are based on completed TV playback events, not browser preview plays.
// Group by immutable creative revision and by day/TV, never by filename.
export function creativeDailyBreakdown(data,campaignId){
 const revisions=(data.revisions||[]).filter(r=>r.campaign_id===campaignId);
 const rows=(data.daily||[]).filter(r=>r.campaign_id===campaignId);
 const points=new Map((data.targets||[]).filter(t=>t.campaign_id===campaignId)
  .map(t=>[t.device_id,t.point_name+' · '+t.device_name]));
 return revisions.map(revision=>{
  const daily=rows.filter(row=>row.revision_id===revision.id);
  let completed=0,today=0;
  const history=daily.map(row=>{
   const count=Math.max(0,Number(row.completed_count)||0);
   completed+=count;
   if(row.day===data.today)today+=count;
   return {day:row.day,point:points.get(row.device_id)||'TV vinculada anteriormente',completed:count};
  }).sort((a,b)=>b.day.localeCompare(a.day)||a.point.localeCompare(b.point,'pt-BR'));
  return {id:revision.id,name:revision.name||'Anúncio sem nome',
   media_type:revision.media_type,created_at:revision.created_at,
   total:completed,today,history};
 }).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
}
export function renderCreativeBreakdown(data,campaignId){
 const items=creativeDailyBreakdown(data,campaignId);
 if(!items.length)return '<section class="creative-breakdown"><h3>Exibições por mídia</h3><p class="muted">Nenhuma mídia comercial vinculada.</p></section>';
 return '<section class="creative-breakdown" aria-label="Exibições por cada mídia comercial"><h3>Exibições por mídia</h3>'+
 '<p class="muted">Os números aumentam somente quando o Player conclui a exibição na TV. Assistir à prévia no navegador não é contabilizado.</p>'+
 items.map(item=>'<article class="creative-entry" data-creative-id="'+esc(item.id)+'"><div class="creative-entry-head">'+
 '<div><strong>'+esc(item.name)+'</strong><small>'+(item.media_type==='video'?'Vídeo':'Imagem')+'</small></div>'+
 '<button type="button" class="commercial-watch" data-watch-revision="'+esc(item.id)+'">▶ Ver prévia</button></div>'+
 '<div class="creative-entry-counts"><span>Hoje <b>'+number(item.today)+'</b></span><span>Total <b>'+number(item.total)+'</b></span></div>'+
 '<details data-history-revision="'+esc(item.id)+'"><summary>Histórico por dia e TV</summary>'+
 '<div class="table-scroll"><table><thead><tr><th>Dia</th><th>Ponto</th><th>Exibições</th></tr></thead><tbody>'+
 (item.history.map(row=>'<tr><td>'+date(row.day)+'</td><td>'+esc(row.point)+'</td><td>'+number(row.completed)+'</td></tr>').join('')||
 '<tr><td colspan="3">Nenhuma exibição comercial concluída.</td></tr>')+
 '</tbody></table></div></details></article>').join('')+'</section>';
}
const deliveryLabels={pending_player_check:'Aguardando confirmação da TV',no_base_playlist:'TV sem playlist disponível',shuffle_preserved:'Modo aleatório preservado; anúncio não inserido',single_preserved:'Modo de mídia única preservado; anúncio não inserido',scheduled_base_preserved:'Agenda da playlist preservada; anúncio não inserido',legacy_player:'Player sem suporte à validade do anúncio',timezone_preserved:'Fuso do ponto não suportado nesta etapa',no_active_campaign:'Sem anúncio elegível neste momento',manifest_ready:'Anúncio incluído na programação',media_unavailable:'Uma ou mais mídias comerciais indisponíveis'};
export function renderCampaigns(data,showDelivery=false){return (data.campaigns||[]).map(c=>{const s=campaignSummary(data,c.id),status=campaignState(c,data.today);const targets=(data.targets||[]).filter(t=>t.campaign_id===c.id);const revision=(data.revisions||[]).find(r=>r.id===c.current_revision_id);return `<article class="campaign" data-campaign-id="${esc(c.id)}"><div class="campaign-head"><div><span class="eyebrow">CAMPANHA</span><h2>${esc(c.name)}</h2></div><span class="badge ${status.label==='Ativa'?'active':''}">${esc(status.label)}</span></div><div class="campaign-body"><div class="creative" data-revision="${esc(c.current_revision_id)}"><span>▶</span><strong>${esc(revision?.name||'Mídia não disponível')}</strong><small>Prévia da propaganda</small></div><div class="metrics"><div><span>Exibições hoje</span><strong>${number(s.today)}</strong></div><div><span>Total de exibições</span><strong>${number(s.total)}</strong></div><div class="last"><span>Última exibição registrada</span><b>${esc(time(s.last))}</b></div></div></div><div class="period"><span>Início <b>${date(c.start_date)}</b></span><span>Vencimento <b>${date(c.end_date)}</b></span><span>Dias restantes <b>${number(status.days)}</b></span></div><h3>Seus pontos de divulgação</h3><div class="points">${targets.map(t=>`<div class="point"><div><strong>${esc(t.point_name)}</strong><small>${esc(t.device_name)}${t.active?'':' · vínculo encerrado'}</small><small>Última conexão: ${t.last_seen_at?esc(time(t.last_seen_at)):'sem registro'}</small><small class="commercial-live-indicator ${t.commercial_on_screen?'active':''}">${t.commercial_on_screen?'● Anúncio sinalizado em reprodução pela TV':'◯ Sem confirmação de anúncio em tela'}</small>${t.public_location? `<small class="commercial-point-address">📍 ${esc([t.public_location.label,t.public_location.address,t.public_location.neighborhood,t.public_location.city].filter(Boolean).join(' · '))}</small>`:''}${showDelivery?`<small>Programação: ${esc(deliveryLabels[t.delivery_status]||deliveryLabels.pending_player_check)}</small>`:''}</div><span class="badge ${t.online?'active':''}">TV ${t.online?'ONLINE':'OFFLINE'}</span><b>${number(s.points[t.device_id])}<small>exibições</small></b></div>`).join('')||'<p>Nenhum ponto vinculado.</p>'}</div>${renderCreativeBreakdown(data,c.id)}<details><summary>Histórico diário</summary><div class="table-scroll"><table><thead><tr><th>Dia</th><th>Exibições concluídas</th></tr></thead><tbody>${Object.entries(s.days).sort(([a],[b])=>b.localeCompare(a)).map(([day,n])=>`<tr><td>${date(day)}</td><td>${number(n)}</td></tr>`).join('')||'<tr><td colspan="2">Ainda não há reproduções registradas.</td></tr>'}</tbody></table></div></details></article>`;}).join('')||'<div class="empty"><h2>Sua publicidade, acompanhada de perto.</h2><p>Quando a Vision vincular uma campanha ao seu cadastro, ela aparecerá aqui.</p></div>';}
// Preserve signed previews and playing videos on metrics-only refresh.
// The card is replaced only when its commercial revision changes.
export function sameCommercialRevision(previous,next){
 const p=previous?.querySelector?.('.creative');
 const n=next?.querySelector?.('.creative');
 return Boolean(p&&n&&p.getAttribute('data-revision')===n.getAttribute('data-revision'));
}
export function updateCommercialCards(root,data,showDelivery=false){
 const candidate=document.createElement('div');
 candidate.innerHTML=renderCampaigns(data,showDelivery);
 const old=new Map(Array.from(root.children).filter(el=>el.hasAttribute?.('data-campaign-id'))
  .map(el=>[el.getAttribute('data-campaign-id'),el]));
 const desired=[];
 for(const next of Array.from(candidate.children)){
  const existing=old.get(next.getAttribute('data-campaign-id'));
  if(existing&&sameCommercialRevision(existing,next)){
   // Preserve the original .creative subtree and its media network request.
   for(const selector of ['.campaign-head','.metrics','.period','.points','.creative-breakdown','details']){
    const before=existing.querySelector(selector);
    const after=next.querySelector(selector);
    if(!before||!after)continue;
    if(selector==='details'&&before.open)after.open=true;
    if(selector==='.creative-breakdown'){
     const opened=new Set(Array.from(before.querySelectorAll('[data-history-revision][open]'))
      .map(el=>el.getAttribute('data-history-revision')));
     after.querySelectorAll('[data-history-revision]').forEach(el=>{
      if(opened.has(el.getAttribute('data-history-revision')))el.open=true;
     });
    }
    before.replaceWith(after);
   }
   desired.push(existing);
  }else desired.push(next);
 }
 // Retain existing DOM nodes at their current position whenever possible;
 // replacing the whole root would restart an open video.
 for(let i=0;i<desired.length;i++){
  if(root.children[i]!==desired[i])root.insertBefore(desired[i],root.children[i]||null);
 }
 while(root.children.length>desired.length)root.lastElementChild.remove();
}
export function demoData(){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return {advertiser:{id:'demo',name:'Loja do João — demonstração',email:'exemplo@anunciante.test'},today,campaigns:[{id:'demo',name:'Teste Portal Vision',status:'draft',start_date:today,end_date:today,current_revision_id:'demo-r'}],revisions:[{id:'demo-r',name:'Sua propaganda aparece aqui',media_type:'image'}],targets:[{campaign_id:'demo',device_id:'demo-tv',point_name:'Auto Center — ponto ilustrativo',device_name:'TV de demonstração',online:false,active:true,last_seen_at:null}],daily:[]};}
export class CommercialAPI{
 constructor(master=false){this.master=master;this.config=window.VISION_COMMERCIAL_CONFIG;this.key=(master?'vision_midia_session_v1':'vision_advertiser_session_v1')+(this.config?.environment==='staging'?'_staging_v1':'');this.store=master?localStorage:sessionStorage;this.refreshing=null;this.authGeneration=0;}
 session(){try{return JSON.parse(this.store.getItem(this.key)||'null')}catch{return null}}
 save(data){this.store.setItem(this.key,JSON.stringify({...data,expires_at:data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600)}));}
 clear(){this.authGeneration++;this.store.removeItem(this.key);}
 async request(path,{method='POST',body,auth=true,retry=true}={}){
  if(!this.config?.enabled||!this.config.supabaseUrl||!this.config.supabasePublishableKey)throw new Error('Homologação ainda não conectada. Nenhum dado de produção será alterado.');
  const session=this.session();if(auth&&!session?.access_token)throw Object.assign(new Error('Entre com seu e-mail e senha.'),{status:401});
  const res=await fetch(this.config.supabaseUrl+path,{method,cache:'no-store',headers:{apikey:this.config.supabasePublishableKey,'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+session.access_token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await res.json().catch(()=>({}));
  if(auth&&res.status===401&&retry&&session?.refresh_token){await this.refresh();return this.request(path,{method,body,auth,retry:false})}
  if(!res.ok){const raw=data.error_description||data.message||data.error||'Falha ao consultar';const messages={commercial_device_capacity_20:'Esta TV já possui 20 campanhas comerciais no período. Reduza os vínculos ou ajuste as datas.',advertiser_unavailable:'Seu acesso não está disponível. Fale com a Vision.',commercial_staging_not_enabled:'Módulo aguardando ativação no ambiente de homologação.',master_forbidden:'Acesso exclusivo do Master.',separate_advertiser_account:'Use um e-mail exclusivo do anunciante.',activate_advertiser_first:'Ative o anunciante antes de redefinir o acesso.'};throw Object.assign(new Error(messages[raw]||raw),{status:res.status});}
  return data;
 }
 async refresh(){const generation=this.authGeneration;if(!this.refreshing)this.refreshing=this.request('/auth/v1/token?grant_type=refresh_token',{auth:false,body:{refresh_token:this.session()?.refresh_token}}).then(d=>{if(generation===this.authGeneration)this.save(d);else throw Object.assign(new Error('Sessão encerrada.'),{status:401});}).catch(e=>{if(generation===this.authGeneration)this.clear();throw e}).finally(()=>{this.refreshing=null});return this.refreshing;}
 async login(email,password){const generation=this.authGeneration;const d=await this.request('/auth/v1/token?grant_type=password',{auth:false,body:{email,password}});if(generation!==this.authGeneration)throw Object.assign(new Error('Sessão encerrada.'),{status:401});this.save(d);}
 rpc(name,body={}){return this.request('/rest/v1/rpc/'+name,{body})}
 masterCall(action,body={}){return this.request('/functions/v1/master-admin',{body:{action,...body}})}
 async logout(){const pending=this.request('/auth/v1/logout',{body:{},retry:false});this.clear();await pending;}
}
// Only immutable commercial snapshots may enter the advertiser signed-preview flow.
// The server/Storage RLS must independently validate tenant and media access.
export function commercialPreviewPath(value){
 return typeof value==='string'&&
  /^commercial-ads\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?:\.(?:png|jpe?g|webp|gif|mp4|mov|webm|m4v))?$/.test(value)
  ?value:null;
}
// Preview-only compatibility utilities. ESM itself still requires a compatible browser.
const previewGenerations=new WeakMap();
function replacePreview(slot,element){
 if(typeof slot.replaceChildren==='function'){
  if(element)slot.replaceChildren(element);else slot.replaceChildren();
 }else{
  // Element.replaceChildren was introduced later than DOM appendChild/removeChild.
  while(slot.firstChild)slot.removeChild(slot.firstChild);
  if(element)slot.appendChild(element);
 }
}
function failedPreview(slot,generation){
 if(previewGenerations.get(slot)!==generation||slot.isConnected===false)return;
 replacePreview(slot);
 slot.insertAdjacentHTML('beforeend','<small>Prévia indisponível no momento.</small>');
}
export async function loadThumbnails(root,data,api,isAuthorized=()=>true){
 for(const rev of data.revisions||[]){
  // A prior session, dashboard or campaign refresh must not issue new preview requests.
  if(!isAuthorized())return;
  // Only opaque revision identifiers are expected, never CSS selectors supplied by users.
  if(!rev||typeof rev.id!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(rev.id))continue;
  const slot=root.querySelector('[data-revision="'+rev.id+'"]');
  if(!slot)continue;
  // Autorefresh only updates metrics. An already loaded image/video
  // must never be fetched/signed again until the revision itself changes.
  if(slot.querySelector('img,video'))continue;
  // Each request owns only the version of this visible slot it started for.
  // A slow signed URL or late media error can never replace a newer preview.
  const generation=(previewGenerations.get(slot)||0)+1;
  previewGenerations.set(slot,generation);
  const current=()=>isAuthorized()&&previewGenerations.get(slot)===generation&&slot.isConnected!==false;
  const path=commercialPreviewPath(rev.storage_path);
  if(!path){failedPreview(slot,generation);continue;}
  const signedPath='/storage/v1/object/sign/vision-media/'+path.split('/').map(encodeURIComponent).join('/');
  try{
   const signed=await api.request(signedPath,{body:{expiresIn:60}});
   if(!current())continue;
   const raw=signed?.signedURL||signed?.signedUrl;
   if(typeof raw!=='string'||!raw){failedPreview(slot,generation);continue;}
   const origin=new URL(api.config.supabaseUrl).origin;
   const url=new URL(raw.startsWith('/object/')?'/storage/v1'+raw:raw,origin);
   if(url.origin!==origin||url.pathname!==signedPath){failedPreview(slot,generation);continue;}
   const video=rev.media_type==='video';
   const el=document.createElement(video?'video':'img');
   el.alt=rev.name||'Prévia comercial';
   if(video){
    el.controls=true;el.preload='metadata';el.playsInline=true;
    // Unsupported codecs must fail without leaving a dead preview element.
    if(typeof el.canPlayType==='function'&&!el.canPlayType('video/mp4')){
     failedPreview(slot,generation);continue;
    }
   }
   el.onerror=()=>{
    if(!current()||(typeof slot.contains==='function'&&!slot.contains(el)))return;
    failedPreview(slot,generation);
   };
   if(!current())continue;
   replacePreview(slot,el);
   el.src=url.href;
  }catch{
   if(current())failedPreview(slot,generation);
  }
 }
}
