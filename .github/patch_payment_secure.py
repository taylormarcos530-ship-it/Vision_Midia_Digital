from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)

# master.js
p=Path('master.js')
s=p.read_text()
old="""    if(type==='success' && title!=='Salvo com sucesso' && /(salv|criad|atualiz|adicion|enviad|paread|programad|atribu|reordenad|substitu|configurad|alterad)/i.test(String(title))){message=message?`${title}. ${message}`:title;title='Salvo com sucesso'}
"""
new="""    const writeFeedback=/(salv|criad|atualiz|adicion|enviad|paread|programad|atribu|reordenad|substitu|configurad|alterad)/i.test(String(title));
    const readOnlyRefresh=/^(Relatório|Monitoramento|Status|Captura).*atualiz/i.test(String(title));
    if(type==='success' && title!=='Salvo com sucesso' && writeFeedback && !readOnlyRefresh){message=message?`${title}. ${message}`:title;title='Salvo com sucesso'}
"""
s=replace_once(s,old,new,'master toast classifier')
old="""  async function savePaymentUrlRequest(companyId,paymentUrl,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/rest/v1/company_subscriptions?company_id=eq.${encodeURIComponent(companyId)}`,{method:'PATCH',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({payment_url:paymentUrl||null}),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return savePaymentUrlRequest(companyId,paymentUrl,false)}return parse(res)}
"""
s=replace_once(s,old,'','remove direct payment url request')
old="""        billing_notes:$('#me-billing-notes').value.trim(),
        player_audio_enabled:$('#me-player-audio').checked,
"""
new="""        billing_notes:$('#me-billing-notes').value.trim(),
        payment_url:paymentUrl||null,
        player_audio_enabled:$('#me-player-audio').checked,
"""
s=replace_once(s,old,new,'send payment url to save-company')
old="""      await savePaymentUrlRequest(companyId,paymentUrl||null);
"""
s=replace_once(s,old,'','remove second persistence request')
p.write_text(s)

# app.js: keep standard save feedback, but do not label read-only refreshes as saved.
p=Path('app.js')
s=p.read_text()
old="""    if (type === 'success' && title !== 'Salvo com sucesso' && /(salv|criad|atualiz|adicion|enviad|paread|programad|atribu|reordenad|substitu|configurad|alterad)/i.test(String(title))) {
      message = message ? `${title}. ${message}` : title;
      title = 'Salvo com sucesso';
    }
"""
new="""    const writeFeedback = /(salv|criad|atualiz|adicion|enviad|paread|programad|atribu|reordenad|substitu|configurad|alterad)/i.test(String(title));
    const readOnlyRefresh = /^(Relatório|Monitoramento|Status|Captura).*atualiz/i.test(String(title));
    if (type === 'success' && title !== 'Salvo com sucesso' && writeFeedback && !readOnlyRefresh) {
      message = message ? `${title}. ${message}` : title;
      title = 'Salvo com sucesso';
    }
"""
s=replace_once(s,old,new,'app toast classifier')
p.write_text(s)
