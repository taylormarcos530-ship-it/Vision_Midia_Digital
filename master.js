(() => {
  'use strict';
  const CONFIG = window.VISION_CONFIG;
  const SESSION_KEY = 'vision_midia_session_v1';
  const state = { session: null, role: null, data: null, platformConfig: null, view: 'dashboard', selectedCompanyId: null };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function toast(title, message='', type='success') {
    let root = $('#master-toast-root');
    const dialog = $('dialog[open]');
    if (dialog) {
      let localRoot = dialog.querySelector('.dialog-toast-root');
      if (!localRoot) {
        localRoot = document.createElement('div');
        localRoot.className = 'dialog-toast-root';
        localRoot.setAttribute('aria-live','polite');
        dialog.appendChild(localRoot);
      }
      root = localRoot;
    }
    const el = document.createElement('div'); el.className = `toast ${type}`;
    el.innerHTML = `<strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ''}`;
    root.appendChild(el); setTimeout(() => el.remove(), 4200);
  }
  function formStatus(selector, message='', type='') {
    const el = $(selector);
    if (!el) return;
    el.textContent = message;
    el.className = `form-status ${type}`.trim();
    el.classList.toggle('hidden', !message);
  }
  function busy(btn, yes, text='Salvando...') {
    if (!btn) return;
    if (yes) { btn.dataset.old = btn.textContent; btn.textContent = text; btn.disabled = true; }
    else { btn.textContent = btn.dataset.old || btn.textContent; btn.disabled = false; }
  }
  const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents||0)/100);
  function bytes(n) { n=Number(n||0); if(n<1024) return `${n} B`; const u=['KB','MB','GB','TB']; let v=n/1024,i=0; while(v>=1024&&i<u.length-1){v/=1024;i++} return `${v.toFixed(v>=10?1:2)} ${u[i]}`; }
  function dt(v){ if(!v) return '—'; try{return new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v))}catch{return '—'} }
  function numOrBlank(v){ return v === null || v === undefined ? '' : v; }
  function reaisToCents(v){ const t=String(v||'').trim().replace(/\./g,'').replace(',','.'); if(!t) return null; const n=Number(t); return Number.isFinite(n)?Math.round(n*100):null; }
  function saveSession(s){ state.session=s; if(s) localStorage.setItem(SESSION_KEY,JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); }
  function savedSession(){ try{const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null'); return s?.access_token&&s?.refresh_token?s:null}catch{return null} }
  async function parse(res){ const t=await res.text(); let d=null; try{d=t?JSON.parse(t):null}catch{d=t}; if(!res.ok){const e=new Error(d?.error_description||d?.message||d?.error||`HTTP ${res.status}`); e.status=res.status; throw e} return d; }
  async function auth(path, body){ return parse(await fetch(`${CONFIG.supabaseUrl}/auth/v1${path}`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)})); }
  async function refresh(){ if(!state.session?.refresh_token) return null; const d=await auth('/token?grant_type=refresh_token',{refresh_token:state.session.refresh_token}); saveSession(d); return d; }
  async function master(body, retry=true){ const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/master-admin`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}); if(res.status===401&&retry&&state.session?.refresh_token){await refresh(); return master(body,false)} return parse(res); }
  async function savePlanRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/save-plan`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return savePlanRequest(body,false)}return parse(res)}
  async function saveCompanyRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/save-company`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return saveCompanyRequest(body,false)}return parse(res)}
  async function platformSettingsRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/platform-settings`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return platformSettingsRequest(body,false)}return parse(res)}

  function show(id){ ['master-auth','master-denied','master-shell'].forEach(x => $(`#${x}`).classList.toggle('hidden',x!==id)); }
  function setConn(ok){ const el=$('#master-connection'); el.className=`pill ${ok?'online':'offline'}`; el.textContent=ok?'● Conectado':'● Sem conexão'; }
  function setView(view){ state.view=view; const map={dashboard:['PLATAFORMA','Dashboard SaaS'],clients:['CONTAS','Clientes'],plans:['COMERCIAL','Planos'],audit:['SEGURANÇA','Auditoria']}; $$('.master-view').forEach(x=>x.classList.add('hidden')); $(`#master-view-${view}`)?.classList.remove('hidden'); $$('[data-master-view]').forEach(x=>x.classList.toggle('active',x.dataset.masterView===view)); $('#master-kicker').textContent=map[view]?.[0]||''; $('#master-title').textContent=map[view]?.[1]||''; }
  function planById(id){ return state.data?.plans?.find(p=>p.id===id)||null; }
  function companyById(id){ return state.data?.companies?.find(c=>c.id===id)||null; }
  function limitValue(c,key){ const o=c.subscription?.limit_overrides||{}; if(o[key]!==undefined&&o[key]!==null&&o[key]!=='') return Number(o[key]); return c.plan?.[key]??null; }
  function statusText(v){ return ({active:'Ativa',suspended:'Suspensa',trialing:'Teste',pending_approval:'Aguardando aprovação',past_due:'Pagamento pendente',cancelled:'Cancelada',pending:'Pendente',paid:'Pago',overdue:'Vencido',waived:'Liberado'})[v]||v||'Sem assinatura'; }

  function renderMetrics(){
    const m=state.data.metrics||{};
    const maxCompanies=Number(m.max_companies||6);
    const companies=Number(m.companies||0);
    const capacityMb=Number(m.storage_capacity_mb||1024);
    const reservedMb=Number(m.storage_reserved_mb||0);
    const usedBytes=Number(m.storage_bytes||0);
    const allocatableMb=Math.max(0,capacityMb-reservedMb);
    $('#mm-companies').textContent=`${companies} / ${maxCompanies}`;
    $('#mm-companies-detail').textContent=`${m.active_companies||0} ativos • ${Math.max(0,maxCompanies-companies)} vaga(s)`;
    $('#mm-mrr').textContent=money(m.mrr_cents);
    $('#mm-users').textContent=m.users||0;
    $('#mm-devices').textContent=m.devices||0;
    $('#mm-devices-detail').textContent=`${m.online_devices||0} online`;
    $('#mm-storage').textContent=`${bytes(usedBytes)} / ${capacityMb.toLocaleString('pt-BR')} MB`;
    $('#mm-storage-detail').textContent=`${reservedMb.toLocaleString('pt-BR')} MB reservados • ${allocatableMb.toLocaleString('pt-BR')} MB disponíveis para limites`;
    $$('[data-open-client]').forEach(btn=>{
      const full=companies>=maxCompanies;
      btn.disabled=full;
      btn.title=full?`Limite de ${maxCompanies} clientes atingido`:'';
    });
  }
  function renderDashboard(){ const companies=(state.data.companies||[]).slice(0,6); $('#master-dashboard-clients').innerHTML=companies.length?companies.map(c=>`<div class="mini-row"><div><strong>${esc(c.name)}</strong><small>${esc(c.owner?.email||'')}</small></div><div><span>${esc(c.plan?.name||'Sem plano')}</span><small>${esc(statusText(c.subscription?.status||c.status))}</small></div></div>`).join(''):'<div class="empty">Nenhum cliente.</div>'; const audits=(state.data.audits||[]).slice(0,6); $('#master-dashboard-audit').innerHTML=audits.length?audits.map(a=>`<div class="mini-row"><div><strong>${esc(a.action)}</strong><small>${esc(companyById(a.company_id)?.name||'Plataforma')}</small></div><span>${esc(dt(a.created_at))}</span></div>`).join(''):'<div class="empty">Sem ações registradas.</div>'; }
  function renderClients(){
    const q=($('#master-client-search')?.value||'').toLowerCase();
    const f=$('#master-client-filter')?.value||'';
    const all=state.data.companies||[];
    const rows=all.filter(c=>{
      const matchesStatus=!f||c.status===f||c.subscription?.status===f||c.subscription?.payment_status===f;
      return matchesStatus&&(!q||c.name.toLowerCase().includes(q)||(c.owner?.email||'').toLowerCase().includes(q));
    });
    $('#master-clients-empty').classList.toggle('hidden',rows.length>0);
    $('#master-clients-list').innerHTML=rows.map(c=>{
      const subStatus=c.subscription?.status||'—';
      const maxD=limitValue(c,'max_devices'), maxU=limitValue(c,'max_users'), maxS=limitValue(c,'storage_limit_mb'), maxC=limitValue(c,'max_campaigns');
      const due=c.subscription?.current_period_end?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'}).format(new Date(c.subscription.current_period_end)):'Sem vencimento';
      return `<article class="client-card"><div class="client-top"><div class="client-title"><div class="client-avatar">${esc(c.name.charAt(0).toUpperCase())}</div><div><strong>${esc(c.name)}</strong><small>${esc(c.owner?.email||'Sem e-mail')} • ${esc(c.plan?.name||'Sem plano')} • vence ${esc(due)}</small></div></div><div><span class="status ${esc(c.status)}">${esc(statusText(c.status))}</span> <span class="status ${esc(subStatus)}">${esc(statusText(subStatus))}</span> <span class="status ${esc(c.subscription?.payment_status||'pending')}">${esc(statusText(c.subscription?.payment_status||'pending'))}</span></div></div><div class="client-usage"><div><span>TVs</span><strong>${c.usage.devices}${maxD===null?'':` / ${maxD}`}</strong></div><div><span>Usuários</span><strong>${c.usage.users}${maxU===null?'':` / ${maxU}`}</strong></div><div><span>Storage</span><strong>${esc(bytes(c.usage.storage_bytes))}${maxS===null?'':` / ${esc(bytes(maxS*1024*1024))}`}</strong></div><div><span>Campanhas</span><strong>${c.usage.campaigns}${maxC===null?'':` / ${maxC}`}</strong></div></div><div class="client-actions"><button class="small-button" data-manage-company="${c.id}">Gerenciar conta</button><button class="small-button" data-company-users="${c.id}">Usuários (${c.members.length})</button><button class="small-button" data-toggle-company="${c.id}" data-next-status="${c.status==='active'?'suspended':'active'}">${c.status==='active'?'Suspender':'Reativar'}</button></div></article>`;
    }).join('');
  }
  function renderPlans(){ const plans=state.data.plans||[]; $('#master-plans-grid').innerHTML=plans.map(p=>`<article class="plan-card"><div class="client-top"><div><strong>${esc(p.name)}</strong><small>${esc(p.is_active?'Disponível':'Inativo')}</small></div><span class="status ${p.is_active?'active':'suspended'}">${p.is_active?'Ativo':'Inativo'}</span></div><div class="plan-price">${esc(money(p.monthly_price_cents))}<small>/mês</small></div><p>${esc(p.description||'')}</p><ul><li>${p.max_devices??'∞'} TV(s)</li><li>${p.storage_limit_mb==null?'Ilimitado':`${p.storage_limit_mb} MB`} de mídia</li><li>${p.max_users??'∞'} usuário(s)</li><li>${p.max_campaigns??'∞'} campanha(s)</li></ul><div class="client-actions"><button class="small-button" data-edit-plan="${p.id}">Editar plano</button></div></article>`).join(''); $('#open-plan-button').classList.toggle('hidden',state.role!=='super_admin'); }

  function renderPlatformSettings(){
    const c=state.platformConfig||{};
    if(!$('#platform-settings-form'))return;
    $('#ps-whatsapp').value=c.support_whatsapp||'';
    $('#ps-signup-message').value=c.signup_whatsapp_message||'';
    $('#ps-renewal-message').value=c.renewal_whatsapp_message||'';
    $('#ps-signup-enabled').checked=c.signup_enabled!==false;
  }
  function renderAudit(){ const rows=state.data.audits||[]; $('#master-audit-body').innerHTML=rows.map(a=>`<tr><td>${esc(dt(a.created_at))}</td><td><strong>${esc(a.action)}</strong></td><td>${esc(companyById(a.company_id)?.name||'—')}</td><td>${esc(JSON.stringify(a.details||{}).slice(0,220))}</td></tr>`).join(''); }
  function render(){ renderMetrics(); renderDashboard(); renderClients(); renderPlans(); renderPlatformSettings(); renderAudit(); }

  async function load(){ try{setConn(true); const [d,p]=await Promise.all([master({action:'dashboard'}),platformSettingsRequest({action:'get'})]); state.data=d; state.platformConfig=p?.config||{}; render();}catch(e){setConn(false); toast('Falha ao carregar Master',e.message,'error');throw e} }
  async function enter(){ try{const who=await master({action:'whoami'}); state.role=who.role; $('#master-role-label').textContent=who.role==='super_admin'?'Super Master':who.role; $('#master-email-label').textContent=who.email||''; show('master-shell'); setView('dashboard'); await load();}catch(e){ if(e.status===403)show('master-denied'); else throw e; } }
  async function login(ev){ev.preventDefault();const b=$('#master-login-submit');busy(b,true,'Entrando...');try{const d=await auth('/token?grant_type=password',{email:$('#master-login-email').value.trim(),password:$('#master-login-password').value});saveSession(d);await enter();toast('Acesso Master liberado');}catch(e){toast('Não foi possível entrar',e.message,'error')}finally{busy(b,false)}}
  function logout(){saveSession(null);state.data=null;state.role=null;show('master-auth')}
  function openDialog(id){const d=$(`#${id}`); if(d?.showModal)d.showModal()}
  function closeDialog(id){const d=$(`#${id}`); if(d?.close)d.close()}
  function fillPlanSelects(){ const opts=(state.data.plans||[]).filter(p=>p.is_active).map(p=>`<option value="${p.id}">${esc(p.name)} • ${esc(money(p.monthly_price_cents))}</option>`).join(''); $('#mc-plan').innerHTML=opts; $('#me-plan').innerHTML=(state.data.plans||[]).map(p=>`<option value="${p.id}">${esc(p.name)}${p.is_active?'':' (inativo)'}</option>`).join(''); }
  function openNewClient(){
    const m=state.data?.metrics||{};
    const max=Number(m.max_companies||6);
    if(Number(m.companies||0)>=max){toast('Limite de clientes atingido',`A plataforma está em ${max}/${max} clientes. Para cadastrar outro, libere capacidade ou altere a infraestrutura.`,'error');return}
    fillPlanSelects(); $('#master-client-form').reset(); $('#mc-trial-days').value='7'; openDialog('master-client-dialog');
  }
  async function createClient(ev){ev.preventDefault();const b=$('#mc-save');busy(b,true,'Criando...');try{const d=await master({action:'create_client',company_name:$('#mc-company-name').value.trim(),owner_name:$('#mc-owner-name').value.trim(),owner_email:$('#mc-owner-email').value.trim(),plan_id:$('#mc-plan').value,trial_days:Number($('#mc-trial-days').value||0),temporary_password:$('#mc-temp-password').value});closeDialog('master-client-dialog');toast('Cliente criado',d.delivery==='invite'?'Convite enviado por e-mail.':d.delivery==='temporary_password'?'Acesso criado com senha temporária.':'Usuário existente vinculado.');await load();}catch(e){const msg=/platform_client_limit_reached/i.test(String(e.message))?'O limite de 6 clientes desta infraestrutura foi atingido.':e.message;toast('Erro ao criar cliente',msg,'error')}finally{busy(b,false)}}
  function openCompany(id){
    const c=companyById(id); if(!c)return;
    fillPlanSelects(); formStatus('#me-status');
    $('#me-company-id').value=c.id; $('#me-company-title').textContent=c.name; $('#me-company-name').value=c.name; $('#me-company-status').value=c.status;
    $('#me-plan').value=c.subscription?.plan_id||''; $('#me-sub-status').value=c.subscription?.status||'pending_approval';
    $('#me-payment-status').value=c.subscription?.payment_status||'pending';
    $('#me-due-date').value=c.subscription?.current_period_end?String(c.subscription.current_period_end).slice(0,10):'';
    $('#me-manual-price').value=c.subscription?.manual_price_cents==null?'':(Number(c.subscription.manual_price_cents)/100).toFixed(2).replace('.',',');
    $('#me-billing-notes').value=c.subscription?.billing_notes||'';
    const o=c.subscription?.limit_overrides||{}; $('#me-max-devices').value=numOrBlank(o.max_devices); $('#me-storage-mb').value=numOrBlank(o.storage_limit_mb); $('#me-max-users').value=numOrBlank(o.max_users); $('#me-max-campaigns').value=numOrBlank(o.max_campaigns);
    const settings=c.settings||{}; $('#me-player-audio').checked=settings.player_audio_enabled!==false; $('#me-player-autostart').checked=settings.player_autostart_enabled!==false;
    openDialog('master-company-dialog');
  }
  function overrideObj(){ const o={}; [['max_devices','#me-max-devices'],['storage_limit_mb','#me-storage-mb'],['max_users','#me-max-users'],['max_campaigns','#me-max-campaigns']].forEach(([k,s])=>{const v=$(s).value.trim();if(v!=='')o[k]=Number(v)}); return o; }
  async function saveCompany(ev){
    ev.preventDefault();
    const b=$('#me-save');
    const companyId=$('#me-company-id').value;
    const expectedPlanId=$('#me-plan').value;
    if(!expectedPlanId){formStatus('#me-status','❌ Selecione um plano.','error');return}
    busy(b,true,'Salvando...');
    formStatus('#me-status','Salvando alterações...','pending');
    try{
      const d=await saveCompanyRequest({
        company_id:companyId,
        company_name:$('#me-company-name').value.trim(),
        company_status:$('#me-company-status').value,
        plan_id:expectedPlanId,
        subscription_status:$('#me-sub-status').value,
        payment_status:$('#me-payment-status').value,
        due_date:$('#me-due-date').value||null,
        manual_price_cents:reaisToCents($('#me-manual-price').value),
        limit_overrides:overrideObj(),
        billing_notes:$('#me-billing-notes').value.trim(),
        player_audio_enabled:$('#me-player-audio').checked,
        player_autostart_enabled:$('#me-player-autostart').checked
      });
      if(!d?.ok || d?.subscription?.plan_id!==expectedPlanId) throw new Error('O servidor não confirmou o plano selecionado.');
      await load();
      const persisted=companyById(companyId);
      if(persisted?.subscription?.plan_id!==expectedPlanId) throw new Error('O plano foi salvo, mas a confirmação do painel não corresponde.');
      const planName=d?.plan?.name||planById(expectedPlanId)?.name||'selecionado';
      formStatus('#me-status',`✅ Salvo com sucesso. Plano ${planName} aplicado.`,'success');
      toast('Salvo com sucesso',`Plano ${planName} e dados da assinatura atualizados.`);
    }catch(e){
      const raw=String(e?.message||'Erro ao salvar');
      const msg=/platform_storage_allocation_exceeded/i.test(raw)
        ? 'A soma dos limites de armazenamento dos clientes não pode ultrapassar 1.024 MB. Reduza o limite deste ou de outro cliente.'
        : raw;
      formStatus('#me-status',`❌ ${msg}`,'error');
      toast('Erro ao salvar',msg,'error');
    }finally{busy(b,false)}
  }
  async function toggleCompany(id,next){const c=companyById(id);if(!c)return;if(!confirm(`${next==='suspended'?'Suspender':'Reativar'} a conta “${c.name}”?`))return;try{await master({action:'update_company',company_id:id,company_status:next,subscription_status:next==='suspended'?'suspended':'active'});toast(next==='suspended'?'Conta suspensa':'Conta reativada');await load()}catch(e){toast('Não foi possível alterar a conta',e.message,'error')}}
  function openUsers(id){const c=companyById(id);if(!c)return;state.selectedCompanyId=id;$('#mu-company-id').value=id;$('#mu-company-title').textContent=`Usuários • ${c.name}`;renderUsers(c);$('#master-add-user-form').reset();openDialog('master-users-dialog')}
  function renderUsers(c){$('#master-users-list').innerHTML=c.members.map(m=>`<div class="user-row"><div><strong>${esc(m.user?.display_name||m.user?.email||'Usuário')}</strong><small>${esc(m.user?.email||'')} • ${m.role==='owner'?'Proprietário':m.role} • ${m.status}</small></div>${m.role==='owner'?'<span class="status active">Protegido</span>':`<button class="small-button" data-toggle-member="${m.id}" data-next-member="${m.status==='active'?'disabled':'active'}">${m.status==='active'?'Desativar':'Ativar'}</button>`}${state.role==='super_admin'?`<button class="small-button" data-reset-user="${m.user_id}">Nova senha</button>`:''}</div>`).join('')}
  async function addUser(ev){ev.preventDefault();const b=$('#mu-add');busy(b,true,'Adicionando...');try{const d=await master({action:'add_user',company_id:$('#mu-company-id').value,email:$('#mu-email').value.trim(),display_name:$('#mu-name').value.trim(),role:$('#mu-role').value,temporary_password:$('#mu-password').value});toast('Usuário adicionado',d.delivery==='invite'?'Convite enviado.':d.delivery==='temporary_password'?'Senha temporária criada.':'Usuário existente vinculado.');await load();openUsers($('#mu-company-id').value)}catch(e){toast('Erro ao adicionar usuário',e.message,'error')}finally{busy(b,false)}}
  async function toggleMember(id,status){try{await master({action:'update_member',member_id:id,status});toast('Usuário atualizado');const cid=$('#mu-company-id').value;await load();openUsers(cid)}catch(e){toast('Erro ao atualizar usuário',e.message,'error')}}
  async function resetUser(id){const pw=prompt('Digite uma nova senha temporária com pelo menos 8 caracteres:');if(!pw)return;if(pw.length<8){toast('Senha muito curta','Use pelo menos 8 caracteres.','error');return}try{await master({action:'set_user_password',user_id:id,temporary_password:pw});toast('Senha temporária atualizada')}catch(e){toast('Erro ao redefinir senha',e.message,'error')}}
  function planStatus(message='',type=''){formStatus('#mp-status',message,type)}
  function planIntOrNull(selector){const v=$(selector).value.trim();return v===''?null:Number(v)}
  function friendlyPlanError(error){const m=String(error?.message||'Erro desconhecido');if(/super_admin_required/i.test(m))return 'Sua sessão não tem permissão de Super Master.';if(/plan_slug_already_exists|plans_slug_key|duplicate key.*slug/i.test(m))return 'Já existe um plano com esse slug.';if(/invalid_plan_slug/i.test(m))return 'O slug deve usar apenas letras minúsculas, números e hífen.';if(/invalid_plan_name/i.test(m))return 'Informe um nome de plano válido.';if(/invalid_plan_price/i.test(m))return 'Informe um preço mensal válido.';if(/plan_not_found/i.test(m))return 'Este plano não foi encontrado. Atualize a página e tente novamente.';if(/plan_save_failed|plan_save_unexpected_error/i.test(m))return 'Não foi possível salvar o plano no servidor. Tente novamente.';return m}
  function openPlan(id=null){ if(state.role!=='super_admin'){toast('Somente o Super Master pode editar planos.','','error');return} const p=id?planById(id):null; $('#master-plan-form').reset(); planStatus(); $('#mp-id').value=p?.id||''; $('#mp-title').textContent=p?'Editar plano':'Novo plano'; $('#mp-name').value=p?.name||''; $('#mp-slug').value=p?.slug||''; $('#mp-description').value=p?.description||''; $('#mp-price').value=p?(p.monthly_price_cents/100).toFixed(2).replace('.',','):''; $('#mp-order').value=p?.sort_order||0; $('#mp-devices').value=numOrBlank(p?.max_devices); $('#mp-storage').value=numOrBlank(p?.storage_limit_mb); $('#mp-users').value=numOrBlank(p?.max_users); $('#mp-campaigns').value=numOrBlank(p?.max_campaigns); $('#mp-active').checked=p?.is_active!==false; openDialog('master-plan-dialog'); }
  function validatePlanForm(){
    const required=[['#mp-name','Nome'],['#mp-slug','Slug'],['#mp-description','Descrição'],['#mp-price','Preço mensal'],['#mp-order','Ordem'],['#mp-devices','TVs'],['#mp-storage','Armazenamento MB'],['#mp-users','Usuários'],['#mp-campaigns','Campanhas']];
    const missing=required.filter(([selector])=>String($(selector)?.value??'').trim()==='');
    if(missing.length){planStatus(`❌ Preencha todos os campos obrigatórios. Falta: ${missing.map(([,label])=>label).join(', ')}.`,'error');$(missing[0][0])?.focus();return null}
    const name=$('#mp-name').value.trim(),slug=$('#mp-slug').value.trim(),description=$('#mp-description').value.trim();
    const price=reaisToCents($('#mp-price').value),sortOrder=Number($('#mp-order').value),maxDevices=Number($('#mp-devices').value),storageMb=Number($('#mp-storage').value),maxUsers=Number($('#mp-users').value),maxCampaigns=Number($('#mp-campaigns').value);
    if(name.length<2){planStatus('❌ Informe um nome de plano válido.','error');$('#mp-name').focus();return null}
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)){planStatus('❌ O slug deve usar apenas letras minúsculas, números e hífen.','error');$('#mp-slug').focus();return null}
    if(description.length<2){planStatus('❌ Preencha a descrição do plano.','error');$('#mp-description').focus();return null}
    if(price===null||price<0){planStatus('❌ Informe um preço mensal válido.','error');$('#mp-price').focus();return null}
    if(!Number.isInteger(sortOrder)||sortOrder<0){planStatus('❌ Informe uma ordem válida.','error');$('#mp-order').focus();return null}
    if(!Number.isInteger(maxDevices)||maxDevices<0){planStatus('❌ Informe a quantidade de TVs.','error');$('#mp-devices').focus();return null}
    if(!Number.isInteger(storageMb)||storageMb<0){planStatus('❌ Informe o armazenamento em MB.','error');$('#mp-storage').focus();return null}
    if(!Number.isInteger(maxUsers)||maxUsers<1){planStatus('❌ O plano deve permitir pelo menos 1 usuário.','error');$('#mp-users').focus();return null}
    if(!Number.isInteger(maxCampaigns)||maxCampaigns<0){planStatus('❌ Informe a quantidade de campanhas.','error');$('#mp-campaigns').focus();return null}
    return {id:$('#mp-id').value||null,name,slug,description,monthly_price_cents:price,max_devices:maxDevices,storage_limit_mb:storageMb,max_users:maxUsers,max_campaigns:maxCampaigns,is_active:$('#mp-active').checked,sort_order:sortOrder};
  }
  async function savePlan(ev){
    ev.preventDefault();
    const payload=validatePlanForm();
    if(!payload)return;
    const b=$('#mp-save');
    busy(b,true,'Salvando...');
    planStatus('Salvando...','pending');
    try{
      const result=await savePlanRequest(payload);
      if(!result?.ok||!result?.plan?.id)throw new Error('O servidor não confirmou o salvamento do plano.');
      $('#mp-id').value=result.plan.id;
      $('#mp-title').textContent='Editar plano';
      planStatus('✅ Salvo com sucesso. As alterações foram aplicadas.','success');
      toast('Salvo com sucesso',`Plano ${result.plan.name||payload.name} atualizado.`);
      await load().catch(e=>toast('Plano salvo, mas a lista não atualizou',e.message,'error'));
    }catch(e){
      const msg=friendlyPlanError(e);
      planStatus(`❌ Erro ao salvar: ${msg}`,'error');
      toast('Erro ao salvar plano',msg,'error');
    }finally{busy(b,false)}
  }


  async function savePlatformSettings(ev){
    ev.preventDefault(); const b=$('#ps-save'); busy(b,true,'Salvando...'); formStatus('#ps-status','Salvando...','pending');
    try{const d=await platformSettingsRequest({action:'update',support_whatsapp:$('#ps-whatsapp').value,signup_whatsapp_message:$('#ps-signup-message').value.trim(),renewal_whatsapp_message:$('#ps-renewal-message').value.trim(),signup_enabled:$('#ps-signup-enabled').checked});state.platformConfig=d.config||{};renderPlatformSettings();formStatus('#ps-status','✅ Configurações salvas.','success');toast('Salvo com sucesso','Cadastro público e WhatsApp atualizados.')}catch(e){formStatus('#ps-status',`❌ ${e.message}`,'error');toast('Erro ao salvar configurações',e.message,'error')}finally{busy(b,false)}
  }

  async function clearCompanyCache(){
    const id=$('#me-company-id').value; if(!id)return;
    const b=$('#me-clear-cache'); busy(b,true,'Solicitando...');
    try{await saveCompanyRequest({company_id:id,company_name:$('#me-company-name').value.trim(),company_status:$('#me-company-status').value,plan_id:$('#me-plan').value,subscription_status:$('#me-sub-status').value,payment_status:$('#me-payment-status').value,due_date:$('#me-due-date').value||null,manual_price_cents:reaisToCents($('#me-manual-price').value),limit_overrides:overrideObj(),billing_notes:$('#me-billing-notes').value.trim(),player_audio_enabled:$('#me-player-audio').checked,player_autostart_enabled:$('#me-player-autostart').checked,clear_cache:true});formStatus('#me-status','✅ Limpeza de cache enviada. As TVs baixarão novamente as mídias na próxima sincronização.','success');toast('Comando enviado','Cache da conta será renovado.');await load()}catch(e){formStatus('#me-status',`❌ ${e.message}`,'error')}finally{busy(b,false)}
  }
  function bind(){ $('#master-login-form').addEventListener('submit',login); $('#master-logout').addEventListener('click',logout); $('#master-denied-logout').addEventListener('click',logout); $('#master-refresh').addEventListener('click',()=>load().catch(()=>{})); $$('[data-master-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.masterView))); $$('[data-go-master]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.goMaster))); $$('[data-open-client]').forEach(b=>b.addEventListener('click',openNewClient)); $('#open-plan-button').addEventListener('click',()=>openPlan()); $('#master-client-form').addEventListener('submit',createClient); $('#master-company-form').addEventListener('submit',saveCompany); $('#master-add-user-form').addEventListener('submit',addUser); $('#master-plan-form').addEventListener('submit',savePlan); $('#platform-settings-form').addEventListener('submit',savePlatformSettings); $('#me-clear-cache').addEventListener('click',clearCompanyCache); $('#master-client-search').addEventListener('input',renderClients); $('#master-client-filter').addEventListener('change',renderClients); $$('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog(b.dataset.close))); document.addEventListener('click',ev=>{const b=ev.target.closest('button');if(!b)return;if(b.dataset.manageCompany)openCompany(b.dataset.manageCompany);if(b.dataset.companyUsers)openUsers(b.dataset.companyUsers);if(b.dataset.toggleCompany)toggleCompany(b.dataset.toggleCompany,b.dataset.nextStatus);if(b.dataset.editPlan)openPlan(b.dataset.editPlan);if(b.dataset.toggleMember)toggleMember(b.dataset.toggleMember,b.dataset.nextMember);if(b.dataset.resetUser)resetUser(b.dataset.resetUser)}); window.addEventListener('online',()=>setConn(true)); window.addEventListener('offline',()=>setConn(false)); }

  async function boot(){ bind(); if(!CONFIG?.supabaseUrl||!CONFIG?.supabasePublishableKey){show('master-denied');return} const s=savedSession(); if(!s){show('master-auth');return} saveSession(s); try{await enter()}catch(e){saveSession(null);show('master-auth');toast('Sessão expirada','Entre novamente.','error')} }
  boot();
})();
