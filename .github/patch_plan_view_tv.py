from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)

# app.js
p = Path('app.js')
s = p.read_text()

s = replace_once(
    s,
    "    editingPlaylistId: null,\n    isBusy: false,\n",
    "    editingPlaylistId: null,\n    viewingDeviceId: null,\n    isBusy: false,\n",
    'state viewingDeviceId',
)

old_public = '''  async function loadPublicConfig() {
    const data = await functionRequest('public-config', { authenticated: false, body: {} });
    state.publicConfig = data || { config: {}, plans: [] };
    const select = $('#signup-plan');
    if (select) {
      const plans = state.publicConfig.plans || [];
      select.innerHTML = plans.length
        ? '<option value="">Selecione um plano</option>' + plans.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} • ${escapeHtml(formatPlanMoney(p.monthly_price_cents))}/mês</option>`).join('')
        : '<option value="">Nenhum plano disponível</option>';
    }
    return state.publicConfig;
  }
'''
new_public = '''  async function loadPublicConfig() {
    let data = null;
    try {
      data = await functionRequest('public-config', { authenticated: false, body: {} });
    } catch (primaryError) {
      // Fallback público: os planos ativos e a configuração pública possuem RLS de leitura anon.
      try {
        const headers = { apikey: CONFIG.supabasePublishableKey, 'Content-Type': 'application/json' };
        const [plansResponse, configResponse] = await Promise.all([
          fetch(`${CONFIG.supabaseUrl}/rest/v1/plans?select=id,name,description,monthly_price_cents,max_devices,storage_limit_mb,max_users,max_campaigns,sort_order&is_active=eq.true&order=sort_order.asc`, { headers, cache: 'no-store' }),
          fetch(`${CONFIG.supabaseUrl}/rest/v1/platform_public_config?select=support_whatsapp,signup_whatsapp_message,renewal_whatsapp_message,signup_enabled&id=eq.1&limit=1`, { headers, cache: 'no-store' }),
        ]);
        if (!plansResponse.ok || !configResponse.ok) throw primaryError;
        const plans = await plansResponse.json();
        const configs = await configResponse.json();
        data = { ok: true, plans: plans || [], config: configs?.[0] || {} };
      } catch (fallbackError) {
        const select = $('#signup-plan');
        if (select) select.innerHTML = '<option value="">Não foi possível carregar os planos</option>';
        throw fallbackError;
      }
    }
    state.publicConfig = data || { config: {}, plans: [] };
    const select = $('#signup-plan');
    if (select) {
      const plans = state.publicConfig.plans || [];
      select.innerHTML = plans.length
        ? '<option value="">Selecione um plano</option>' + plans.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} • ${escapeHtml(formatPlanMoney(p.monthly_price_cents))}/mês</option>`).join('')
        : '<option value="">Nenhum plano disponível</option>';
    }
    return state.publicConfig;
  }
'''
s = replace_once(s, old_public, new_public, 'loadPublicConfig')

old_buttons = '''            <button class="small-icon-button capture-button" data-capture-device="${device.id}" title="Capturar o que está passando agora">📷 Capturar</button>
            ${['owner','admin'].includes(state.companyRole) ? `<button class="small-icon-button" data-replace-device="${device.id}" title="Trocar esta TV por uma nova sem consumir outra vaga do plano">⇄ Substituir</button>` : ''}
'''
new_buttons = '''            <button class="small-icon-button view-tv-button" data-view-device="${device.id}" title="Ver a captura atual desta TV em tamanho maior">👁 Ver TV</button>
            <button class="small-icon-button capture-button" data-capture-device="${device.id}" title="Capturar o que está passando agora">📷 Capturar</button>
            ${['owner','admin'].includes(state.companyRole) ? `<button class="small-icon-button" data-replace-device="${device.id}" title="Trocar esta TV por uma nova sem consumir outra vaga do plano">⇄ Substituir</button>` : ''}
'''
s = replace_once(s, old_buttons, new_buttons, 'device viewer button')

viewer_functions = r'''
  async function renderTvViewer(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device) return;
    state.viewingDeviceId = deviceId;
    $('#view-tv-title').textContent = device.name;
    $('#view-tv-status').textContent = `${statusLabel(effectiveDeviceStatus(device))} • ${formatLastSeen(device.last_seen_at)}`;
    const preview = $('#view-tv-preview');
    const shot = latestScreenshotForDevice(deviceId);
    if (!shot?.storage_path) {
      preview.innerHTML = '<div class="tv-viewer-empty">Ainda não há captura desta TV.<br><small>Use “Atualizar agora” para solicitar uma imagem do que está passando.</small></div>';
      $('#view-tv-captured-at').textContent = 'Sem captura disponível';
      return;
    }
    preview.innerHTML = '<div class="tv-viewer-empty">Carregando captura…</div>';
    $('#view-tv-captured-at').textContent = `Capturada em ${formatMonitorDateTime(shot.captured_at)}`;
    try {
      const url = await getSignedMediaUrl(shot.storage_path);
      if (state.viewingDeviceId !== deviceId) return;
      const img = new Image();
      img.alt = `Captura da TV ${device.name}`;
      img.src = url;
      preview.replaceChildren(img);
    } catch {
      preview.innerHTML = '<div class="tv-viewer-empty">Não foi possível abrir a captura.</div>';
    }
  }

  async function openTvViewer(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device) return;
    openDialog('view-tv-dialog');
    await renderTvViewer(deviceId);
  }

  async function refreshTvViewer() {
    const deviceId = state.viewingDeviceId;
    if (!deviceId) return;
    const button = $('#view-tv-refresh');
    setBusy(button, true, 'Atualizando...');
    try {
      await requestDeviceScreenshot(deviceId);
      await renderTvViewer(deviceId);
    } finally {
      setBusy(button, false);
    }
  }

'''
s = replace_once(s, '  async function requestDeviceScreenshot(deviceId) {\n', viewer_functions + '  async function requestDeviceScreenshot(deviceId) {\n', 'viewer functions')

s = replace_once(
    s,
    "    $('#pair-device-form').addEventListener('submit', handlePairDevice);\n    $('#replace-device-form').addEventListener('submit', handleReplaceDevice);\n",
    "    $('#pair-device-form').addEventListener('submit', handlePairDevice);\n    $('#view-tv-refresh').addEventListener('click', refreshTvViewer);\n    $('#replace-device-form').addEventListener('submit', handleReplaceDevice);\n",
    'viewer refresh bind',
)

s = replace_once(
    s,
    "      const captureDevice = event.target.closest('[data-capture-device]');\n      if (captureDevice) return requestDeviceScreenshot(captureDevice.dataset.captureDevice);\n",
    "      const viewDevice = event.target.closest('[data-view-device]');\n      if (viewDevice) return openTvViewer(viewDevice.dataset.viewDevice);\n      const captureDevice = event.target.closest('[data-capture-device]');\n      if (captureDevice) return requestDeviceScreenshot(captureDevice.dataset.captureDevice);\n",
    'viewer click handler',
)

s = replace_once(
    s,
    "    $('#playlist-items-dialog').addEventListener('close', () => { state.editingPlaylistId = null; state.selectedPlaylistItemIds = new Set(); });\n",
    "    $('#view-tv-dialog').addEventListener('close', () => { state.viewingDeviceId = null; });\n    $('#playlist-items-dialog').addEventListener('close', () => { state.editingPlaylistId = null; state.selectedPlaylistItemIds = new Set(); });\n",
    'viewer close reset',
)

p.write_text(s)

# index.html
p = Path('index.html')
s = p.read_text()
viewer_dialog = r'''
  <dialog id="view-tv-dialog" class="app-dialog large-dialog">
    <div class="dialog-body tv-viewer-dialog-body">
      <div class="dialog-header">
        <div><span class="eyebrow">VISUALIZAÇÃO DA TV</span><h3 id="view-tv-title">TV</h3><p id="view-tv-status" class="dialog-subtitle">—</p></div>
        <button class="icon-button" data-close-dialog="view-tv-dialog" type="button">×</button>
      </div>
      <div id="view-tv-preview" class="tv-viewer-preview"><div class="tv-viewer-empty">Carregando…</div></div>
      <div class="tv-viewer-footer">
        <small id="view-tv-captured-at">Sem captura disponível</small>
        <button id="view-tv-refresh" class="button primary" type="button">📷 Atualizar agora</button>
      </div>
      <p class="form-hint">A visualização usa uma captura enviada pelo Vision Player. Não é transmissão de vídeo ao vivo; o botão Atualizar agora solicita uma nova imagem da tela.</p>
    </div>
  </dialog>

'''
s = replace_once(s, '  <dialog id="replace-device-dialog" class="app-dialog">\n', viewer_dialog + '  <dialog id="replace-device-dialog" class="app-dialog">\n', 'viewer dialog')
p.write_text(s)

# styles.css
p = Path('styles.css')
s = p.read_text()
marker = '/* TV_VIEWER_V1 */'
if marker not in s:
    s += r'''

/* TV_VIEWER_V1 */
.view-tv-button { min-width: 82px; }
.tv-viewer-dialog-body { max-height: 92vh; overflow: auto; }
.tv-viewer-preview { width: 100%; aspect-ratio: 16 / 9; min-height: 240px; display: grid; place-items: center; overflow: hidden; background: #000; border: 1px solid var(--line); border-radius: 16px; }
.tv-viewer-preview img { width: 100%; height: 100%; object-fit: contain; display: block; background: #000; }
.tv-viewer-empty { color: var(--muted); text-align: center; padding: 24px; }
.tv-viewer-empty small { display: inline-block; margin-top: 7px; }
.tv-viewer-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
.tv-viewer-footer small { color: var(--muted); }
@media (max-width: 640px) {
  .tv-viewer-preview { min-height: 180px; border-radius: 12px; }
  .tv-viewer-footer .button { width: 100%; }
}
'''
p.write_text(s)
