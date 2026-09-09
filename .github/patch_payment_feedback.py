from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)

# app.js
p = Path('app.js')
s = p.read_text()
old = """  function toast(title, message = '', type = 'success', timeout = 3500) {\n    const root = $('#toast-root');\n"""
new = """  function toast(title, message = '', type = 'success', timeout = 3500) {\n    if (type === 'success' && title !== 'Salvo com sucesso' && /(salv|criad|atualiz|adicion|enviad|paread|programad|atribu|reordenad|substitu|configurad|alterad)/i.test(String(title))) {\n      message = message ? `${title}. ${message}` : title;\n      title = 'Salvo com sucesso';\n    }\n    const root = $('#toast-root');\n"""
s = replace_once(s, old, new, 'app toast feedback')
old = """    const link = $('#access-whatsapp');\n    if (phone) {\n      link.href = `https://wa.me/${phone}?text=${encodeURIComponent(message || 'Olá! Preciso de ajuda com meu acesso à Vision Mídia Digital.')}`;\n      link.classList.remove('hidden');\n    } else link.classList.add('hidden');\n    if ('Notification' in window && Notification.permission === 'granted') notifyAccessState(reason);\n"""
new = """    const link = $('#access-whatsapp');\n    if (phone) {\n      link.href = `https://wa.me/${phone}?text=${encodeURIComponent(message || 'Olá! Preciso de ajuda com meu acesso à Vision Mídia Digital.')}`;\n      link.classList.remove('hidden');\n    } else link.classList.add('hidden');\n    const payLink = $('#access-payment');\n    const paymentUrl = String(state.subscription?.payment_url || '').trim();\n    const paymentNeeded = !['paid','waived'].includes(state.subscription?.payment_status || 'pending');\n    if (payLink && paymentUrl && paymentNeeded) {\n      payLink.href = paymentUrl;\n      payLink.classList.remove('hidden');\n    } else if (payLink) {\n      payLink.removeAttribute('href');\n      payLink.classList.add('hidden');\n    }\n    if ('Notification' in window && Notification.permission === 'granted') notifyAccessState(reason);\n"""
s = replace_once(s, old, new, 'access payment link')
p.write_text(s)

# index.html
p = Path('index.html')
s = p.read_text()
old = """      <div class=\"access-actions\">\n        <a id=\"access-whatsapp\" class=\"button primary full hidden\" href=\"#\" target=\"_blank\" rel=\"noopener\">Falar com suporte no WhatsApp</a>\n"""
new = """      <div class=\"access-actions\">\n        <a id=\"access-payment\" class=\"button primary full hidden\" target=\"_blank\" rel=\"noopener\">Pagar agora • Mercado Pago</a>\n        <a id=\"access-whatsapp\" class=\"button ghost full hidden\" href=\"#\" target=\"_blank\" rel=\"noopener\">Falar com suporte no WhatsApp</a>\n"""
s = replace_once(s, old, new, 'access payment button')
p.write_text(s)

# master.html
p = Path('master.html')
s = p.read_text()
old = """      <div class=\"form-grid two\"><label>Situação do pagamento<select id=\"me-payment-status\"><option value=\"pending\">Pendente</option><option value=\"paid\">Pago</option><option value=\"overdue\">Vencido</option><option value=\"waived\">Liberado manualmente</option></select></label><label>Vencimento<input id=\"me-due-date\" type=\"date\" /></label></div>\n      <div class=\"form-grid two\"><label>Preço manual mensal (R$)<input id=\"me-manual-price\" inputmode=\"decimal\" placeholder=\"Vazio = preço do plano\" /></label><label>Observação de cobrança<input id=\"me-billing-notes\" maxlength=\"500\" /></label></div>\n"""
new = """      <div class=\"form-grid two\"><label>Situação do pagamento<select id=\"me-payment-status\"><option value=\"pending\">Pendente</option><option value=\"paid\">Pago</option><option value=\"overdue\">Vencido</option><option value=\"waived\">Liberado manualmente</option></select></label><label>Vencimento<input id=\"me-due-date\" type=\"date\" /></label></div>\n      <label>Link de pagamento Mercado Pago<input id=\"me-payment-url\" type=\"url\" maxlength=\"1200\" placeholder=\"https://...\" /><small>Enquanto a integração automática não estiver conectada, cole aqui o link de cobrança deste cliente. Ele verá o botão “Pagar agora”.</small></label>\n      <div class=\"dialog-actions compact-actions\"><button id=\"me-mark-paid\" class=\"button ghost\" type=\"button\">Confirmar pagamento e liberar</button></div>\n      <div class=\"form-grid two\"><label>Preço manual mensal (R$)<input id=\"me-manual-price\" inputmode=\"decimal\" placeholder=\"Vazio = preço do plano\" /></label><label>Observação de cobrança<input id=\"me-billing-notes\" maxlength=\"500\" /></label></div>\n"""
s = replace_once(s, old, new, 'master payment fields')
p.write_text(s)

# master.js
p = Path('master.js')
s = p.read_text()
old = """  function toast(title, message='', type='success') {\n    let root = $('#master-toast-root');\n"""
new = """  function toast(title, message='', type='success') {\n    if(type==='success' && title!=='Salvo com sucesso' && /(salv|criad|atualiz|adicion|enviad|paread|programad|atribu|reordenad|substitu|configurad|alterad)/i.test(String(title))){message=message?`${title}. ${message}`:title;title='Salvo com sucesso'}\n    let root = $('#master-toast-root');\n"""
s = replace_once(s, old, new, 'master toast feedback')
old = """  async function saveCompanyRequest(body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/save-company`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return saveCompanyRequest(body,false)}return parse(res)}\n"""
new = old + """  async function savePaymentUrlRequest(companyId,paymentUrl,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/rest/v1/company_subscriptions?company_id=eq.${encodeURIComponent(companyId)}`,{method:'PATCH',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({payment_url:paymentUrl||null}),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return savePaymentUrlRequest(companyId,paymentUrl,false)}return parse(res)}\n"""
s = replace_once(s, old, new, 'payment url request')
old = """    $('#me-payment-status').value=c.subscription?.payment_status||'pending';\n    $('#me-due-date').value=c.subscription?.current_period_end?String(c.subscription.current_period_end).slice(0,10):'';\n"""
new = """    $('#me-payment-status').value=c.subscription?.payment_status||'pending';\n    $('#me-due-date').value=c.subscription?.current_period_end?String(c.subscription.current_period_end).slice(0,10):'';\n    $('#me-payment-url').value=c.subscription?.payment_url||'';\n"""
s = replace_once(s, old, new, 'open company payment url')
old = """    const companyId=$('#me-company-id').value;\n    const expectedPlanId=$('#me-plan').value;\n    if(!expectedPlanId){formStatus('#me-status','❌ Selecione um plano.','error');return}\n"""
new = """    const companyId=$('#me-company-id').value;\n    const expectedPlanId=$('#me-plan').value;\n    const paymentUrl=$('#me-payment-url').value.trim();\n    if(!expectedPlanId){formStatus('#me-status','❌ Selecione um plano.','error');return}\n    if(paymentUrl && !/^https:\\/\\/\\S+$/i.test(paymentUrl)){formStatus('#me-status','❌ Informe um link de pagamento HTTPS válido.','error');$('#me-payment-url').focus();return}\n"""
s = replace_once(s, old, new, 'save company payment validation')
old = """      if(!d?.ok || d?.subscription?.plan_id!==expectedPlanId) throw new Error('O servidor não confirmou o plano selecionado.');\n      await load();\n"""
new = """      if(!d?.ok || d?.subscription?.plan_id!==expectedPlanId) throw new Error('O servidor não confirmou o plano selecionado.');\n      await savePaymentUrlRequest(companyId,paymentUrl||null);\n      await load();\n"""
s = replace_once(s, old, new, 'save company payment persist')
insert_before = """  async function clearCompanyCache(){\n"""
helper = """  function confirmPaymentAndRelease(){\n    if(!$('#me-due-date').value){formStatus('#me-status','❌ Informe o vencimento antes de liberar o acesso.','error');$('#me-due-date').focus();return}\n    $('#me-company-status').value='active';\n    $('#me-sub-status').value='active';\n    $('#me-payment-status').value='paid';\n    formStatus('#me-status','Pagamento marcado como pago. Salvando e liberando acesso...','pending');\n    $('#master-company-form').requestSubmit();\n  }\n\n"""
s = replace_once(s, insert_before, helper + insert_before, 'confirm payment helper')
old = """$('#platform-settings-form').addEventListener('submit',savePlatformSettings); $('#me-clear-cache').addEventListener('click',clearCompanyCache); $('#master-client-search')"""
new = """$('#platform-settings-form').addEventListener('submit',savePlatformSettings); $('#me-clear-cache').addEventListener('click',clearCompanyCache); $('#me-mark-paid').addEventListener('click',confirmPaymentAndRelease); $('#master-client-search')"""
s = replace_once(s, old, new, 'bind confirm payment')
p.write_text(s)
