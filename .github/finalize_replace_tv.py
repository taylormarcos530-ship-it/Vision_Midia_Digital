from pathlib import Path

def rep(s,o,n,l):
    if o not in s: raise SystemExit('MISSING '+l)
    return s.replace(o,n,1)

p=Path('app.js'); s=p.read_text(encoding='utf-8')
s=rep(s,'    publicConfig: null,\n    devices:', '    publicConfig: null,\n    companyRole: null,\n    devices:', 'companyRole state')
s=rep(s,
'''    const rows = await restRequest('company_subscriptions', {
      query: `select=*&company_id=eq.${encodeURIComponent(state.company.id)}&limit=1`,
    });
    state.subscription = rows?.[0] || null;''',
'''    const [rows, memberRows] = await Promise.all([
      restRequest('company_subscriptions', { query: `select=*&company_id=eq.${encodeURIComponent(state.company.id)}&limit=1` }),
      restRequest('company_members', { query: `select=role,status&company_id=eq.${encodeURIComponent(state.company.id)}&user_id=eq.${encodeURIComponent(state.user.id)}&limit=1` }),
    ]);
    state.subscription = rows?.[0] || null;
    state.companyRole = memberRows?.[0]?.status === 'active' ? memberRows[0].role : null;''', 'load company role')
s=rep(s,
'''            <button class="small-icon-button" data-replace-device="${device.id}" title="Trocar esta TV por uma nova sem consumir outra vaga do plano">⇄ Substituir</button>''',
'''            ${['owner','admin'].includes(state.companyRole) ? `<button class="small-icon-button" data-replace-device="${device.id}" title="Trocar esta TV por uma nova sem consumir outra vaga do plano">⇄ Substituir</button>` : ''}''', 'hide replace by role')
p.write_text(s,encoding='utf-8')

p=Path('master.js'); s=p.read_text(encoding='utf-8')
s=rep(s,
'''${c.usage.devices?`<button class="small-button" data-replace-company-device="${c.id}">Substituir TV</button>`:''}''',
'''${c.usage.devices&&['super_admin','admin'].includes(state.role)?`<button class="small-button" data-replace-company-device="${c.id}">Substituir TV</button>`:''}''', 'master role')
p.write_text(s,encoding='utf-8')

p=Path('supabase/functions/replace-device/index.ts'); s=p.read_text(encoding='utf-8')
s=rep(s,"const companyAllowed=member?.status==='active'&&['owner','admin','operator'].includes(member.role)","const companyAllowed=member?.status==='active'&&['owner','admin'].includes(member.role)",'endpoint role')
p.write_text(s,encoding='utf-8')
print('FINALIZE_OK')
