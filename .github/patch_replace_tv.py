from pathlib import Path


def rep(text, old, new, label):
    if old not in text:
        raise SystemExit(f'MISSING {label}')
    return text.replace(old, new, 1)

# app.js
p=Path('app.js'); s=p.read_text(encoding='utf-8')
s=rep(s,
"restRequest('devices', { query: `select=*&company_id=eq.${companyId}&order=created_at.desc` }),",
"restRequest('devices', { query: `select=*&company_id=eq.${companyId}&retired_at=is.null&order=created_at.desc` }),",
'device active filter')
s=rep(s,
'''            <button class="small-icon-button capture-button" data-capture-device="${device.id}" title="Capturar o que está passando agora">📷 Capturar</button>
            <button class="small-icon-button" data-edit-device="${device.id}" title="Editar">✎</button>''',
'''            <button class="small-icon-button capture-button" data-capture-device="${device.id}" title="Capturar o que está passando agora">📷 Capturar</button>
            <button class="small-icon-button" data-replace-device="${device.id}" title="Trocar esta TV por uma nova sem consumir outra vaga do plano">⇄ Substituir</button>
            <button class="small-icon-button" data-edit-device="${device.id}" title="Editar">✎</button>''',
'client replace button')
marker='''  async function handleAssignPlaylist(deviceId, playlistId) {'''
insert='''  function openReplaceDeviceDialog(deviceId) {
    const device = state.devices.find(d => d.id === deviceId);
    if (!device) return;
    $('#replace-device-old-id').value = device.id;
    $('#replace-device-old-name').textContent = device.name;
    $('#replace-device-code').value = '';
    $('#replace-device-name').value = device.name;
    $('#replace-device-orientation').value = device.orientation || 'auto';
    openDialog('replace-device-dialog');
    setTimeout(() => $('#replace-device-code')?.focus(), 50);
  }

  async function handleReplaceDevice(event) {
    event.preventDefault();
    const button = $('#replace-device-save');
    const oldDeviceId = $('#replace-device-old-id').value;
    const code = $('#replace-device-code').value.replace(/\\D/g, '');
    const name = $('#replace-device-name').value.trim();
    if (!oldDeviceId || code.length !== 6 || !name) {
      toast('Confira os dados', 'Informe os 6 dígitos da nova TV e um nome para ela.', 'error');
      return;
    }
    setBusy(button, true, 'Substituindo...');
    try {
      await functionRequest('replace-device', {
        body: {
          company_id: state.company.id,
          old_device_id: oldDeviceId,
          code,
          name,
          orientation: $('#replace-device-orientation').value,
        },
      });
      closeDialog('replace-device-dialog');
      $('#replace-device-form').reset();
      toast('TV substituída com sucesso', 'A vaga do plano foi mantida e a programação foi transferida para a nova TV.');
      await loadAllData();
    } catch (error) {
      toast('Não foi possível substituir a TV', error.message, 'error');
    } finally { setBusy(button, false); }
  }

'''
s=rep(s, marker, insert+marker, 'client replace functions')
s=rep(s,
"    $('#pair-device-form').addEventListener('submit', handlePairDevice);\n    $('#device-form').addEventListener('submit', handleSaveDevice);",
"    $('#pair-device-form').addEventListener('submit', handlePairDevice);\n    $('#replace-device-form').addEventListener('submit', handleReplaceDevice);\n    $('#device-form').addEventListener('submit', handleSaveDevice);",
'client replace bind')
s=rep(s,
'''      const editDevice = event.target.closest('[data-edit-device]');
      if (editDevice) return openEditDeviceDialog(editDevice.dataset.editDevice);''',
'''      const replaceDevice = event.target.closest('[data-replace-device]');
      if (replaceDevice) return openReplaceDeviceDialog(replaceDevice.dataset.replaceDevice);
      const editDevice = event.target.closest('[data-edit-device]');
      if (editDevice) return openEditDeviceDialog(editDevice.dataset.editDevice);''',
'client replace click')
p.write_text(s, encoding='utf-8')

# index.html
p=Path('index.html'); s=p.read_text(encoding='utf-8')
dialog='''
  <dialog id="replace-device-dialog" class="app-dialog">
    <form id="replace-device-form" class="dialog-body">
      <div class="dialog-header">
        <div><span class="eyebrow">SUBSTITUIR TV</span><h3>Trocar dispositivo</h3></div>
        <button class="icon-button" data-close-dialog="replace-device-dialog" type="button">×</button>
      </div>
      <input id="replace-device-old-id" type="hidden" />
      <div class="pair-help">
        <strong>TV atual: <span id="replace-device-old-name">—</span></strong>
        <span>Abra o Vision Player na nova TV e informe o código de 6 dígitos. A TV antiga só será desativada depois que a nova for vinculada com sucesso.</span>
        <span>A playlist padrão e as programações direcionadas serão transferidas automaticamente. A troca reutiliza a mesma vaga do plano.</span>
      </div>
      <label>Código exibido na nova TV
        <input id="replace-device-code" class="pair-code-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required placeholder="000000" />
      </label>
      <label>Nome da nova TV
        <input id="replace-device-name" type="text" maxlength="120" required placeholder="Ex.: TV Recepção" />
      </label>
      <label>Orientação
        <select id="replace-device-orientation"><option value="auto">Automática</option><option value="landscape">Horizontal</option><option value="portrait">Vertical</option></select>
      </label>
      <div class="dialog-actions">
        <button class="button ghost" data-close-dialog="replace-device-dialog" type="button">Cancelar</button>
        <button id="replace-device-save" class="button primary" type="submit">Substituir TV</button>
      </div>
    </form>
  </dialog>

'''
s=rep(s, '  <dialog id="device-dialog" class="app-dialog">', dialog+'  <dialog id="device-dialog" class="app-dialog">', 'client replace dialog')
p.write_text(s, encoding='utf-8')

# master.html
p=Path('master.html'); s=p.read_text(encoding='utf-8')
master_dialog='''
  <dialog id="master-replace-device-dialog" class="master-dialog">
    <form id="master-replace-device-form" class="dialog-body">
      <div class="dialog-head"><div><small>DISPOSITIVO</small><h3 id="mr-title">Substituir TV do cliente</h3></div><button type="button" class="icon-button" data-close="master-replace-device-dialog">×</button></div>
      <input id="mr-company-id" type="hidden" />
      <label>TV que será substituída<select id="mr-old-device" required></select></label>
      <p id="mr-plan-slot" class="helper">A substituição reutiliza a vaga atual do plano.</p>
      <label>Código da nova TV<input id="mr-code" class="pair-code-input" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required placeholder="000000" /></label>
      <label>Nome da nova TV<input id="mr-name" maxlength="120" required /></label>
      <label>Orientação<select id="mr-orientation"><option value="auto">Automática</option><option value="landscape">Horizontal</option><option value="portrait">Vertical</option></select></label>
      <p class="helper">A TV antiga só será desativada quando a nova for vinculada com sucesso. Playlist e programações direcionadas serão transferidas.</p>
      <div id="mr-status" class="form-status hidden" role="status" aria-live="polite"></div>
      <div class="dialog-actions"><button type="button" class="button ghost" data-close="master-replace-device-dialog">Cancelar</button><button id="mr-save" class="button primary" type="submit">Substituir TV</button></div>
    </form>
  </dialog>

'''
s=rep(s, '  <dialog id="master-users-dialog" class="master-dialog large">', master_dialog+'  <dialog id="master-users-dialog" class="master-dialog large">', 'master replace dialog')
p.write_text(s, encoding='utf-8')

# master.js
p=Path('master.js'); s=p.read_text(encoding='utf-8')
s=rep(s,
"  const state = { session: null, role: null, data: null, platformConfig: null, view: 'dashboard', selectedCompanyId: null };",
"  const state = { session: null, role: null, data: null, platformConfig: null, view: 'dashboard', selectedCompanyId: null, replaceDevices: [] };",
'master state')
helper="""  async function edgeRequest(name,body,retry=true){const res=await fetch(`${CONFIG.supabaseUrl}/functions/v1/${name}`,{method:'POST',headers:{apikey:CONFIG.supabasePublishableKey,Authorization:`Bearer ${state.session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify(body||{}),cache:'no-store'});if(res.status===401&&retry&&state.session?.refresh_token){await refresh();return edgeRequest(name,body,false)}return parse(res)}\n"""
s=rep(s, "  async function platformSettingsRequest(body,retry=true){", helper+"  async function platformSettingsRequest(body,retry=true){", 'master edge helper')
s=rep(s,
'''<button class="small-button" data-company-users="${c.id}">Usuários (${c.members.length})</button><button class="small-button" data-toggle-company="${c.id}" data-next-status="${c.status==='active'?'suspended':'active'}">''',
'''<button class="small-button" data-company-users="${c.id}">Usuários (${c.members.length})</button>${c.usage.devices?`<button class="small-button" data-replace-company-device="${c.id}">Substituir TV</button>`:''}<button class="small-button" data-toggle-company="${c.id}" data-next-status="${c.status==='active'?'suspended':'active'}">''',
'master client button')
marker='''  function openUsers(id){'''
insert='''  async function openMasterReplaceDevice(companyId){
    const c=companyById(companyId); if(!c)return;
    formStatus('#mr-status');
    try{
      const d=await edgeRequest('master-company-devices',{company_id:companyId});
      const devices=d?.devices||[];
      if(!devices.length){toast('Nenhuma TV ativa','Este cliente não possui TV disponível para substituição.','error');return}
      state.replaceDevices=devices;
      $('#mr-company-id').value=companyId;
      $('#mr-title').textContent=`Substituir TV • ${c.name}`;
      $('#mr-old-device').innerHTML=devices.map(x=>`<option value="${x.id}">${esc(x.name)} • ${esc(x.platform||'TV')}</option>`).join('');
      const first=devices[0]; $('#mr-name').value=first.name; $('#mr-orientation').value=first.orientation||'auto'; $('#mr-code').value='';
      $('#mr-plan-slot').textContent=`TVs ativas: ${devices.length}${d.max_devices==null?'':` / ${d.max_devices}`} • a substituição mantém a mesma quantidade.`;
      openDialog('master-replace-device-dialog');
      setTimeout(()=>$('#mr-code')?.focus(),50);
    }catch(e){toast('Não foi possível carregar as TVs',e.message,'error')}
  }
  function syncMasterReplacementDevice(){const d=state.replaceDevices.find(x=>x.id===$('#mr-old-device').value);if(!d)return;$('#mr-name').value=d.name;$('#mr-orientation').value=d.orientation||'auto'}
  async function replaceMasterDevice(ev){
    ev.preventDefault(); const b=$('#mr-save'); const code=$('#mr-code').value.replace(/\\D/g,''); const oldId=$('#mr-old-device').value; const name=$('#mr-name').value.trim();
    if(!oldId||code.length!==6||!name){formStatus('#mr-status','❌ Informe a TV atual, o código de 6 dígitos e o nome da nova TV.','error');return}
    busy(b,true,'Substituindo...'); formStatus('#mr-status','Substituindo TV...','pending');
    try{await edgeRequest('replace-device',{company_id:$('#mr-company-id').value,old_device_id:oldId,code,name,orientation:$('#mr-orientation').value});formStatus('#mr-status','✅ TV substituída com sucesso.','success');toast('TV substituída','A vaga do plano e a programação foram preservadas.');await load();setTimeout(()=>closeDialog('master-replace-device-dialog'),700)}catch(e){formStatus('#mr-status',`❌ ${e.message}`,'error');toast('Erro ao substituir TV',e.message,'error')}finally{busy(b,false)}
  }
'''
s=rep(s, marker, insert+marker, 'master replace functions')
s=rep(s,
"$('#master-plan-form').addEventListener('submit',savePlan); $('#platform-settings-form').addEventListener('submit',savePlatformSettings);",
"$('#master-plan-form').addEventListener('submit',savePlan); $('#master-replace-device-form').addEventListener('submit',replaceMasterDevice); $('#mr-old-device').addEventListener('change',syncMasterReplacementDevice); $('#platform-settings-form').addEventListener('submit',savePlatformSettings);",
'master replace bind')
s=rep(s,
"if(b.dataset.companyUsers)openUsers(b.dataset.companyUsers);if(b.dataset.toggleCompany)",
"if(b.dataset.companyUsers)openUsers(b.dataset.companyUsers);if(b.dataset.replaceCompanyDevice)openMasterReplaceDevice(b.dataset.replaceCompanyDevice);if(b.dataset.toggleCompany)",
'master replace click')
p.write_text(s, encoding='utf-8')

# master-admin: active/current TVs only in dashboard metrics and company usage
p=Path('supabase/functions/master-admin/index.ts'); s=p.read_text(encoding='utf-8')
s=rep(s,
"a.from('devices').select('id,company_id,last_seen_at')",
"a.from('devices').select('id,company_id,last_seen_at').is('retired_at',null)",
'master active TV filter')
p.write_text(s, encoding='utf-8')

print('PATCH_OK')
