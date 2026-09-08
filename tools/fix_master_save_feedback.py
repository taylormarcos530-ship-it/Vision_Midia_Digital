from pathlib import Path

# Targeted patch: Master company plan persistence + visible save feedback.
p = Path('master.js')
s = p.read_text()

old = """  function toast(title, message='', type='success') {\n    const el = document.createElement('div'); el.className = `toast ${type}`;\n    el.innerHTML = `<strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ''}`;\n    $('#master-toast-root').appendChild(el); setTimeout(() => el.remove(), 4200);\n  }\n"""
new = """  function toast(title, message='', type='success') {\n    let root = $('#master-toast-root');\n    const dialog = $('dialog[open]');\n    if (dialog) {\n      let localRoot = dialog.querySelector('.dialog-toast-root');\n      if (!localRoot) {\n        localRoot = document.createElement('div');\n        localRoot.className = 'dialog-toast-root';\n        localRoot.setAttribute('aria-live','polite');\n        dialog.appendChild(localRoot);\n      }\n      root = localRoot;\n    }\n    const el = document.createElement('div'); el.className = `toast ${type}`;\n    el.innerHTML = `<strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ''}`;\n    root.appendChild(el); setTimeout(() => el.remove(), 4200);\n  }\n  function formStatus(selector, message='', type='') {\n    const el = $(selector);\n    if (!el) return;\n    el.textContent = message;\n    el.className = `form-status ${type}`.trim();\n    el.classList.toggle('hidden', !message);\n  }\n"""
if old not in s:
    raise SystemExit('toast block not found')
s = s.replace(old, new, 1)

needle = "  async function savePlanRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/save-plan`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return savePlanRequest(body,false)}return parse(res)}\n"
insert = needle + "  async function saveCompanyRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/save-company`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return saveCompanyRequest(body,false)}return parse(res)}\n"
if needle not in s:
    raise SystemExit('savePlanRequest block not found')
s = s.replace(needle, insert, 1)

old_open = "  function openCompany(id){ const c=companyById(id); if(!c)return; fillPlanSelects(); $('#me-company-id').value=c.id; $('#me-company-title').textContent=c.name; $('#me-company-name').value=c.name; $('#me-company-status').value=c.status; $('#me-plan').value=c.subscription?.plan_id||''; $('#me-sub-status').value=c.subscription?.status||'active'; $('#me-manual-price').value=c.subscription?.manual_price_cents==null?'':(Number(c.subscription.manual_price_cents)/100).toFixed(2).replace('.',','); $('#me-billing-notes').value=c.subscription?.billing_notes||''; const o=c.subscription?.limit_overrides||{}; $('#me-max-devices').value=numOrBlank(o.max_devices); $('#me-storage-mb').value=numOrBlank(o.storage_limit_mb); $('#me-max-users').value=numOrBlank(o.max_users); $('#me-max-campaigns').value=numOrBlank(o.max_campaigns); openDialog('master-company-dialog'); }\n"
new_open = "  function openCompany(id){ const c=companyById(id); if(!c)return; fillPlanSelects(); formStatus('#me-status'); $('#me-company-id').value=c.id; $('#me-company-title').textContent=c.name; $('#me-company-name').value=c.name; $('#me-company-status').value=c.status; $('#me-plan').value=c.subscription?.plan_id||''; $('#me-sub-status').value=c.subscription?.status||'active'; $('#me-manual-price').value=c.subscription?.manual_price_cents==null?'':(Number(c.subscription.manual_price_cents)/100).toFixed(2).replace('.',','); $('#me-billing-notes').value=c.subscription?.billing_notes||''; const o=c.subscription?.limit_overrides||{}; $('#me-max-devices').value=numOrBlank(o.max_devices); $('#me-storage-mb').value=numOrBlank(o.storage_limit_mb); $('#me-max-users').value=numOrBlank(o.max_users); $('#me-max-campaigns').value=numOrBlank(o.max_campaigns); openDialog('master-company-dialog'); }\n"
if old_open not in s:
    raise SystemExit('openCompany block not found')
s = s.replace(old_open, new_open, 1)

old_save = "  async function saveCompany(ev){ev.preventDefault();const b=$('#me-save');busy(b,true);try{await master({action:'update_company',company_id:$('#me-company-id').value,company_name:$('#me-company-name').value.trim(),company_status:$('#me-company-status').value,plan_id:$('#me-plan').value||null,subscription_status:$('#me-sub-status').value,manual_price_cents:reaisToCents($('#me-manual-price').value),limit_overrides:overrideObj(),billing_notes:$('#me-billing-notes').value.trim()});closeDialog('master-company-dialog');toast('Conta atualizada');await load();}catch(e){toast('Erro ao atualizar',e.message,'error')}finally{busy(b,false)}}\n"
new_save = """  async function saveCompany(ev){
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
        manual_price_cents:reaisToCents($('#me-manual-price').value),
        limit_overrides:overrideObj(),
        billing_notes:$('#me-billing-notes').value.trim()
      });
      if(!d?.ok || d?.subscription?.plan_id!==expectedPlanId) throw new Error('O servidor não confirmou o plano selecionado.');
      await load();
      const persisted=companyById(companyId);
      if(persisted?.subscription?.plan_id!==expectedPlanId) throw new Error('O plano foi salvo, mas a confirmação do painel não corresponde.');
      const planName=d?.plan?.name||planById(expectedPlanId)?.name||'selecionado';
      formStatus('#me-status',`✅ Salvo com sucesso. Plano ${planName} aplicado.`,'success');
      toast('Salvo com sucesso',`Plano ${planName} e dados da assinatura atualizados.`);
    }catch(e){
      formStatus('#me-status',`❌ ${e.message}`,'error');
      toast('Erro ao salvar',e.message,'error');
    }finally{busy(b,false)}
  }
"""
if old_save not in s:
    raise SystemExit('saveCompany block not found')
s = s.replace(old_save, new_save, 1)

old_plan_status = "  function planStatus(message='',type=''){const el=$('#mp-status');if(!el)return;el.textContent=message;el.className=`form-status ${type}`.trim();el.classList.toggle('hidden',!message)}\n"
if old_plan_status in s:
    s = s.replace(old_plan_status, "  function planStatus(message='',type=''){formStatus('#mp-status',message,type)}\n", 1)

p.write_text(s)

# Add visible status inside the company dialog.
p = Path('master.html')
h = p.read_text()
if 'id="me-status"' not in h:
    old_html = '<div class="danger-note">Suspender a empresa ou assinatura bloqueia novas operações e o player deixa de receber conteúdo.</div>\n      <div class="dialog-actions">'
    new_html = '<div class="danger-note">Suspender a empresa ou assinatura bloqueia novas operações e o player deixa de receber conteúdo.</div>\n      <div id="me-status" class="form-status hidden" role="status" aria-live="polite"></div>\n      <div class="dialog-actions">'
    if old_html not in h:
        raise SystemExit('master company dialog insertion point not found')
    h = h.replace(old_html, new_html, 1)
p.write_text(h)

# Toasts inside native dialogs need their own top-layer container.
p = Path('master.css')
c = p.read_text()
if '.dialog-toast-root{' not in c:
    c += '\n.dialog-toast-root{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:grid;gap:9px;pointer-events:none}.dialog-toast-root .toast{pointer-events:auto}\n'
p.write_text(c)
