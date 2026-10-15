export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const number=value=>new Intl.NumberFormat('pt-BR').format(Number(value)||0);
export const date=value=>value?value.slice(0,10).split('-').reverse().join('/'):'—';
export const time=value=>value?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value)):'Nenhuma exibição registrada';
export function campaignState(c,today){const days=Math.max(0,Math.round((Date.parse(c.end_date+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000)+1);return {label:c.status==='draft'?'Rascunho':c.status==='paused'?'Pausada':c.end_date<today?'Encerrada':c.start_date>today?'Agendada':'Ativa',days};}
export function campaignSummary(data,id){const rows=(data.daily||[]).filter(r=>r.campaign_id===id);const points={},days={};let total=0,today=0,last=null;for(const r of rows){const n=Number(r.completed_count)||0;total+=n;if(r.day===data.today)today+=n;points[r.device_id]=(points[r.device_id]||0)+n;days[r.day]=(days[r.day]||0)+n;if(r.last_completed_at&&(!last||r.last_completed_at>last))last=r.last_completed_at;}return {total,today,last,points,days};}
const deliveryLabels={pending_player_check:'Aguardando confirmação da TV',no_base_playlist:'TV sem playlist disponível',shuffle_preserved:'Modo aleatório preservado; anúncio não inserido',single_preserved:'Modo de mídia única preservado; anúncio não inserido',scheduled_base_preserved:'Agenda da playlist preservada; anúncio não inserido',legacy_player:'Player sem suporte à validade do anúncio',timezone_preserved:'Fuso do ponto não suportado nesta etapa',no_active_campaign:'Sem anúncio elegível neste momento',manifest_ready:'Anúncio incluído na programação',media_unavailable:'Uma ou mais mídias comerciais indisponíveis'};
export function renderCampaigns(data,showDelivery=false){return (data.campaigns||[]).map(c=>{const s=campaignSummary(data,c.id),status=campaignState(c,data.today);const targets=(data.targets||[]).filter(t=>t.campaign_id===c.id);const revision=(data.revisions||[]).find(r=>r.id===c.current_revision_id);return `<article class="campaign"><div class="campaign-head"><div><span class="eyebrow">CAMPANHA</span><h2>${esc(c.name)}</h2></div><span class="badge ${status.label==='Ativa'?'active':''}">${esc(status.label)}</span></div><div class="campaign-body"><div class="creative" data-revision="${esc(c.current_revision_id)}"><span>▶</span><strong>${esc(revision?.name||'Mídia não disponível')}</strong><small>Prévia da propaganda</small></div><div class="metrics"><div><span>Exibições hoje</span><strong>${number(s.today)}</strong></div><div><span>Total de exibições</span><strong>${number(s.total)}</strong></div><div class="last"><span>Última exibição registrada</span><b>${esc(time(s.last))}</b></div></div></div><div class="period"><span>Início <b>${date(c.start_date)}</b></span><span>Vencimento <b>${date(c.end_date)}</b></span><span>Dias restantes <b>${number(status.days)}</b></span></div><h3>Seus pontos de divulgação</h3><div class="points">${targets.map(t=>`<div class="point"><div><strong>${esc(t.point_name)}</strong><small>${esc(t.device_name)}${t.active?'':' · vínculo encerrado'}</small><small>Última conexão: ${t.last_seen_at?esc(time(t.last_seen_at)):'sem registro'}</small>${showDelivery?`<small>Programação: ${esc(deliveryLabels[t.delivery_status]||deliveryLabels.pending_player_check)}</small>`:''}</div><span class="badge ${t.online?'active':''}">TV ${t.online?'ONLINE':'OFFLINE'}</span><b>${number(s.points[t.device_id])}<small>exibições</small></b></div>`).join('')||'<p>Nenhum ponto vinculado.</p>'}</div><details><summary>Histórico diário</summary><div class="table-scroll"><table><thead><tr><th>Dia</th><th>Exibições concluídas</th></tr></thead><tbody>${Object.entries(s.days).sort(([a],[b])=>b.localeCompare(a)).map(([day,n])=>`<tr><td>${date(day)}</td><td>${number(n)}</td></tr>`).join('')||'<tr><td colspan="2">Ainda não há reproduções registradas.</td></tr>'}</tbody></table></div></details></article>`;}).join('')||'<div class="empty"><h2>Sua publicidade, acompanhada de perto.</h2><p>Quando a Vision vincular uma campanha ao seu cadastro, ela aparecerá aqui.</p></div>';}
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
export async function loadThumbnails(root,data,api){
 for(const rev of data.revisions||[]){
  if(!rev||typeof rev.id!=='string'||!rev.id)continue;
  const slot=root.querySelector('[data-revision="'+CSS.escape(rev.id)+'"]');
  if(!slot)continue;
  const path=commercialPreviewPath(rev.storage_path);
  if(!path)continue; // Do not sign original customer media or arbitrary Storage keys.
  const signedPath='/storage/v1/object/sign/vision-media/'+path.split('/').map(encodeURIComponent).join('/');
  try{
   const signed=await api.request(signedPath,{body:{expiresIn:60}});
   const raw=signed?.signedURL||signed?.signedUrl;
   if(typeof raw!=='string'||!raw)continue;
   const origin=new URL(api.config.supabaseUrl).origin;
   const url=new URL(raw.startsWith('/object/')?'/storage/v1'+raw:raw,origin);
   // Verify the signed resource matches the requested commercial copy, not just the host.
   if(url.origin!==origin||url.pathname!==signedPath)continue;
   const el=document.createElement(rev.media_type==='video'?'video':'img');
   el.src=url.href;el.alt=rev.name||'Prévia comercial';
   if(rev.media_type==='video'){el.controls=true;el.preload='metadata';el.playsInline=true;}
   slot.replaceChildren(el);
  }catch{slot.insertAdjacentHTML('beforeend','<small>Prévia indisponível no momento.</small>')}
 }
}
