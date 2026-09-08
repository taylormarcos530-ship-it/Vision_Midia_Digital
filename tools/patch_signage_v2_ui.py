from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'{label}: target not found')
    return text.replace(old, new, 1)

# ---------------- index.html ----------------
p = Path('index.html')
s = p.read_text()

s = replace_once(
    s,
    '<button class="nav-item" data-view="campaigns"><span>◷</span> Programação</button>',
    '<button class="nav-item hidden" data-view="campaigns"><span>◷</span> Programação avançada</button>',
    'hide legacy campaigns nav',
)

branding_panel = r'''
          <article class="panel player-branding-panel">
            <div class="panel-header">
              <div><span class="eyebrow">PLAYER / TV BOX</span><h3>Tela de instalação e vinculação</h3></div>
              <small>Configuração exclusiva desta empresa</small>
            </div>
            <div class="branding-layout">
              <div id="player-branding-preview" class="branding-preview">
                <div class="branding-preview-placeholder">V</div>
                <strong id="branding-preview-title">Vision Player</strong>
                <span id="branding-preview-message">Instale o Player e vincule a TV pelo código.</span>
              </div>
              <form id="player-branding-form" class="branding-form">
                <label>Título da tela de vinculação
                  <input id="branding-title" type="text" maxlength="120" placeholder="Ex.: Mercado Central" />
                </label>
                <label>Mensagem
                  <input id="branding-message" type="text" maxlength="240" placeholder="Ex.: Digite o código no painel para vincular esta TV." />
                </label>
                <label>Imagem de fundo / capa
                  <input id="branding-file" type="file" accept="image/jpeg,image/png,image/webp" />
                </label>
                <div class="branding-code-box">
                  <span>Código interno da instalação</span>
                  <strong id="branding-setup-code">Será gerado ao salvar</strong>
                </div>
                <label>Link personalizado do Player
                  <div class="copy-line"><input id="branding-player-url" type="text" readonly /><button id="branding-copy-url" class="small-icon-button" type="button">Copiar</button></div>
                </label>
                <div class="branding-actions"><button id="branding-open-player" class="button ghost" type="button">Abrir Player</button><button id="branding-save" class="button primary" type="submit">Salvar tela</button></div>
                <p class="form-hint">A imagem e os textos pertencem somente a esta conta. O Player continuará exibindo o código de 6 dígitos para vincular a TV.</p>
              </form>
            </div>
          </article>
'''

s = replace_once(
    s,
    '          <div id="devices-grid" class="cards-grid"></div>',
    branding_panel + '          <div id="devices-grid" class="cards-grid"></div>',
    'insert branding panel',
)

playlist_dialog_pattern = re.compile(r'  <dialog id="playlist-items-dialog" class="app-dialog large-dialog">.*?</dialog>\n\n\n\n  <dialog id="campaign-dialog"', re.S)
playlist_dialog = r'''  <dialog id="playlist-items-dialog" class="app-dialog extra-large-dialog">
    <div class="dialog-body playlist-dialog-body">
      <div class="dialog-header">
        <div><span class="eyebrow">PLAYLIST E PROGRAMAÇÃO</span><h3 id="playlist-items-title">Playlist</h3><p class="dialog-subtitle">Arraste para ordenar no computador ou use as setas no celular. Selecione várias mídias para editar juntas.</p></div>
        <button class="icon-button" data-close-dialog="playlist-items-dialog" type="button">×</button>
      </div>

      <div class="playlist-bulk-toolbar">
        <label class="selection-check"><input id="playlist-select-all" type="checkbox" /> Selecionar todas</label>
        <strong id="playlist-selected-count">0 selecionadas</strong>
        <button class="small-icon-button" id="playlist-bulk-schedule" type="button">◷ Programar</button>
        <button class="small-icon-button" id="playlist-bulk-enable" type="button">Ativar</button>
        <button class="small-icon-button" id="playlist-bulk-disable" type="button">Desativar</button>
        <select id="playlist-bulk-replace-media"><option value="">Substituir por...</option></select>
        <button class="small-icon-button" id="playlist-bulk-replace" type="button">Substituir</button>
        <button class="small-icon-button danger-inline" id="playlist-bulk-delete" type="button">Excluir</button>
      </div>

      <div class="playlist-editor-grid compact-playlist-editor">
        <div>
          <h4>Sequência de reprodução</h4>
          <div id="playlist-items-list" class="sortable-list compact-sortable-list"></div>
          <div id="playlist-items-empty" class="mini-empty hidden">Ainda não há mídias nesta playlist.</div>
        </div>
        <div>
          <h4>Biblioteca</h4>
          <div id="playlist-media-picker" class="media-picker compact-media-picker"></div>
          <div id="playlist-media-empty" class="mini-empty hidden">Envie uma mídia primeiro.</div>
        </div>
      </div>
      <div class="dialog-actions">
        <button class="button primary" data-close-dialog="playlist-items-dialog" type="button">Concluir</button>
      </div>
    </div>
  </dialog>

  <dialog id="playlist-schedule-dialog" class="app-dialog">
    <form id="playlist-schedule-form" class="dialog-body" method="dialog">
      <div class="dialog-header"><div><span class="eyebrow">PROGRAMAÇÃO</span><h3>Quando estas mídias aparecem?</h3><p class="dialog-subtitle"><span id="playlist-schedule-count">1 mídia</span> selecionada(s).</p></div><button class="icon-button" data-close-dialog="playlist-schedule-dialog" type="button">×</button></div>
      <label class="switch-line"><input id="playlist-schedule-enabled" type="checkbox" checked /> Usar programação para as mídias selecionadas</label>
      <div class="form-grid two schedule-date-fields">
        <label>Data inicial <input id="playlist-schedule-start-date" type="date" /></label>
        <label>Data final <input id="playlist-schedule-end-date" type="date" /></label>
      </div>
      <label class="switch-line"><input id="playlist-schedule-all-day" type="checkbox" checked /> Dia inteiro</label>
      <div id="playlist-schedule-time-fields" class="form-grid two hidden">
        <label>Hora inicial <input id="playlist-schedule-start-time" type="time" /></label>
        <label>Hora final <input id="playlist-schedule-end-time" type="time" /></label>
      </div>
      <fieldset class="weekday-fieldset"><legend>Dias da semana</legend><div class="weekday-grid">
        <label><input type="checkbox" data-playlist-weekday="1" checked /> Seg</label>
        <label><input type="checkbox" data-playlist-weekday="2" checked /> Ter</label>
        <label><input type="checkbox" data-playlist-weekday="3" checked /> Qua</label>
        <label><input type="checkbox" data-playlist-weekday="4" checked /> Qui</label>
        <label><input type="checkbox" data-playlist-weekday="5" checked /> Sex</label>
        <label><input type="checkbox" data-playlist-weekday="6" checked /> Sáb</label>
        <label><input type="checkbox" data-playlist-weekday="0" checked /> Dom</label>
      </div></fieldset>
      <div id="playlist-schedule-status" class="form-status hidden" role="status" aria-live="polite"></div>
      <div class="dialog-actions"><button id="playlist-schedule-clear" class="button ghost" type="button">Remover programação</button><button class="button ghost" data-close-dialog="playlist-schedule-dialog" type="button">Cancelar</button><button id="playlist-schedule-save" class="button primary" type="submit">Aplicar programação</button></div>
    </form>
  </dialog>



  <dialog id="campaign-dialog"'''
if not playlist_dialog_pattern.search(s):
    raise SystemExit('playlist dialog block not found')
s = playlist_dialog_pattern.sub(playlist_dialog, s, count=1)

# Report placeholder values: never flash synthetic zeros while data is loading.
for old, new in [
    ('<strong id="report-started">0</strong>', '<strong id="report-started">—</strong>'),
    ('<strong id="report-completed">0</strong>', '<strong id="report-completed">—</strong>'),
    ('<strong id="report-completion-rate">0%</strong>', '<strong id="report-completion-rate">—</strong>'),
    ('<strong id="report-total-time">0 min</strong>', '<strong id="report-total-time">—</strong>'),
    ('<strong id="report-device-count">0</strong>', '<strong id="report-device-count">—</strong>'),
    ('<strong id="report-media-count">0</strong>', '<strong id="report-media-count">—</strong>'),
]:
    s = replace_once(s, old, new, f'report placeholder {old}')

p.write_text(s)

# ---------------- styles.css ----------------
p = Path('styles.css')
s = p.read_text()
marker = '/* SIGNAGE_V2_UI */'
if marker not in s:
    s += r'''

/* SIGNAGE_V2_UI */
.player-branding-panel { min-height: 0; margin-bottom: 18px; }
.branding-layout { display: grid; grid-template-columns: minmax(260px,.8fr) minmax(320px,1.2fr); gap: 18px; align-items: stretch; }
.branding-preview { min-height: 260px; border-radius: 16px; border: 1px solid var(--line); background: radial-gradient(circle at 20% 0%, #17335f, #08111f 58%, #02050a); background-size: cover; background-position: center; display: grid; place-content: center; justify-items: center; text-align: center; padding: 26px; overflow: hidden; position: relative; }
.branding-preview::after { content:""; position:absolute; inset:0; background:linear-gradient(to bottom,rgba(0,0,0,.05),rgba(0,0,0,.35)); pointer-events:none; }
.branding-preview > * { position: relative; z-index: 1; }
.branding-preview-placeholder { width: 58px; height: 58px; display:grid; place-items:center; border-radius:16px; background:linear-gradient(145deg,var(--blue),#6e5cff); font-size:28px; font-weight:900; margin-bottom:14px; }
.branding-preview strong { font-size: 22px; }
.branding-preview span { color:#d5deed; margin-top:8px; max-width:430px; }
.branding-form { display:grid; gap:12px; align-content:start; }
.branding-code-box { border:1px solid var(--line); background:var(--surface-2); border-radius:12px; padding:12px; }
.branding-code-box span,.branding-code-box strong { display:block; }
.branding-code-box span { color:var(--muted); font-size:11px; }
.branding-code-box strong { margin-top:5px; font-family:ui-monospace,monospace; word-break:break-all; }
.copy-line { display:grid; grid-template-columns:1fr auto; gap:8px; }
.branding-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }

.device-screen.has-screenshot { padding:0; }
.device-screen.has-screenshot::after { display:none; }
.device-screen img { width:100%; height:100%; object-fit:contain; background:#000; display:block; }
.screenshot-meta { font-size:10px; color:var(--muted); margin-top:-7px; margin-bottom:10px; }
.capture-button { min-width:100px; }

.media-list-compact { display:grid; gap:8px; }
.media-row-compact { display:grid; grid-template-columns:72px minmax(0,1fr) auto; gap:12px; align-items:center; border:1px solid var(--line); background:var(--surface); border-radius:13px; padding:9px; min-width:0; }
.media-row-compact .media-preview { width:72px; height:72px; min-height:72px; margin:0; border-radius:10px; }
.media-row-compact .media-body { min-width:0; padding:0; }
.media-row-compact .media-body strong { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.media-row-compact .media-body small { display:block; color:var(--muted); margin-top:4px; }
.media-row-compact .media-actions { margin:0; display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }

.extra-large-dialog { width:min(1180px,96vw); }
.playlist-dialog-body { max-height:92vh; overflow:auto; }
.dialog-subtitle { margin:5px 0 0; color:var(--muted); font-size:12px; font-weight:500; }
.playlist-bulk-toolbar { position:sticky; top:0; z-index:4; display:flex; align-items:center; gap:7px; flex-wrap:wrap; padding:10px; margin:0 0 12px; background:rgba(13,23,40,.96); border:1px solid var(--line); border-radius:12px; backdrop-filter:blur(12px); }
.playlist-bulk-toolbar strong { margin-right:auto; font-size:12px; }
.playlist-bulk-toolbar select { width:auto; min-width:170px; padding:7px 9px; }
.selection-check { display:flex; grid-template-columns:none; align-items:center; gap:7px; font-size:12px; }
.selection-check input { width:auto; }
.danger-inline { color:#ff93a1; border-color:rgba(255,99,119,.3); }
.compact-playlist-editor { grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr); }
.compact-sortable-list { gap:7px; }
.playlist-item-row { grid-template-columns:auto auto 58px minmax(130px,1fr) auto auto; gap:8px; padding:8px; min-width:0; touch-action:pan-y; }
.playlist-item-row.dragging { opacity:.45; border-color:var(--blue); }
.playlist-item-row.drag-over { outline:2px solid var(--blue); outline-offset:2px; }
.playlist-select-box { width:auto; }
.drag-handle { cursor:grab; color:#7789a5; font-size:18px; user-select:none; padding:5px; }
.drag-handle:active { cursor:grabbing; }
.playlist-thumb { width:58px; height:58px; min-width:58px; border-radius:9px; }
.playlist-item-copy { min-width:0; }
.playlist-item-copy strong { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.playlist-item-copy small { display:block; color:var(--muted); font-size:10px; margin-top:3px; }
.playlist-item-meta { display:flex; gap:5px; flex-wrap:wrap; margin-top:5px; }
.schedule-chip,.enabled-chip { display:inline-flex; align-items:center; border-radius:999px; padding:3px 7px; font-size:9px; font-weight:800; background:#172641; color:#b8c7db; }
.schedule-chip.active { background:rgba(79,124,255,.14); color:#a9bfff; }
.enabled-chip.off { background:rgba(255,99,119,.1); color:#ff93a1; }
.playlist-inline-actions { display:flex; gap:5px; flex-wrap:wrap; justify-content:flex-end; }
.playlist-duration-mini { display:flex; align-items:center; gap:4px; font-size:10px; color:var(--muted); }
.playlist-duration-mini input { width:64px; padding:6px; }
.compact-media-picker { max-height:58vh; overflow:auto; }
.compact-media-picker .picker-row { padding:7px; }
.weekday-fieldset { border:1px solid var(--line); border-radius:12px; padding:12px; }
.weekday-fieldset legend { color:#c6d0e0; font-size:12px; font-weight:800; padding:0 5px; }
.weekday-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
.weekday-grid label { display:flex; align-items:center; justify-content:center; gap:5px; border:1px solid var(--line); border-radius:9px; padding:8px 5px; background:var(--surface-2); font-size:11px; }
.weekday-grid input { width:auto; }
.form-status { border-radius:10px; padding:10px 12px; font-size:12px; }
.form-status.success { background:rgba(37,208,167,.1); color:#7fe7cd; border:1px solid rgba(37,208,167,.2); }
.form-status.error { background:rgba(255,99,119,.1); color:#ff9cab; border:1px solid rgba(255,99,119,.2); }
.form-status.pending { background:rgba(79,124,255,.1); color:#adc0ff; border:1px solid rgba(79,124,255,.2); }

/* Relatório: nunca força largura da página; tabelas rolam dentro do cartão. */
.report-content,.report-grid,.report-panel,.report-filters,.table-scroll { min-width:0; max-width:100%; }
.table-scroll { width:100%; overflow-x:auto; overscroll-behavior-inline:contain; -webkit-overflow-scrolling:touch; }
.report-table { width:max-content; min-width:100%; }
.report-toolbar { min-width:0; }
.report-actions { max-width:100%; }

@media (max-width: 900px) {
  .branding-layout { grid-template-columns:1fr; }
  .compact-playlist-editor { grid-template-columns:1fr; }
  .playlist-item-row { grid-template-columns:auto auto 54px minmax(0,1fr); }
  .playlist-item-row .playlist-duration-mini,.playlist-item-row .playlist-inline-actions { grid-column:4; justify-content:flex-start; }
  .weekday-grid { grid-template-columns:repeat(4,1fr); }
  .report-toolbar { align-items:stretch; }
  .report-actions { width:100%; display:grid; grid-template-columns:1fr; }
  .report-actions .button { width:100%; }
}
@media (max-width: 600px) {
  body { overflow-x:hidden; }
  .content-area { width:100%; max-width:100vw; overflow-x:hidden; padding-inline:14px; }
  .media-row-compact { grid-template-columns:58px minmax(0,1fr); }
  .media-row-compact .media-preview { width:58px; height:58px; min-height:58px; }
  .media-row-compact .media-actions { grid-column:2; justify-content:flex-start; }
  .playlist-bulk-toolbar { position:static; }
  .playlist-bulk-toolbar select { width:100%; }
  .playlist-item-row { grid-template-columns:auto auto 50px minmax(0,1fr); }
  .playlist-thumb { width:50px; height:50px; min-width:50px; }
  .weekday-grid { grid-template-columns:repeat(3,1fr); }
  .report-metrics { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
  .report-panel { padding:12px; }
}
'''
p.write_text(s)

# ---------------- app.js ----------------
p = Path('app.js')
s = p.read_text()

s = replace_once(
    s,
    "    deviceEvents: [],\n    report: null,",
    "    deviceEvents: [],\n    deviceScreenshots: [],\n    playerBranding: null,\n    selectedPlaylistItemIds: new Set(),\n    scheduleTargetItemIds: [],\n    draggingPlaylistItemId: null,\n    report: null,",
    'state additions',
)

s = replace_once(
    s,
    "      state.deviceEvents = deviceEvents || [];\n      renderAll();",
    "      state.deviceEvents = deviceEvents || [];\n      const [screenshots, brandingRows] = await Promise.all([\n        restRequest('device_screenshots', { query: `select=*&company_id=eq.${companyId}&order=captured_at.desc&limit=80` }),\n        restRequest('company_player_branding', { query: `select=*&company_id=eq.${companyId}&limit=1` }),\n      ]);\n      state.deviceScreenshots = screenshots || [];\n      state.playerBranding = brandingRows?.[0] || null;\n      renderAll();",
    'load screenshots and branding',
)

s = replace_once(s, "    renderDevices();\n    renderMonitoring();", "    renderDevices();\n    renderPlayerBranding();\n    renderMonitoring();", 'render branding')

# Replace renderDevices entirely.
pattern = re.compile(r"  function renderDevices\(\) \{.*?\n  \}\n\n  function deviceHasActiveIssue", re.S)
new_render_devices = r'''  function latestScreenshotForDevice(deviceId) {
    return state.deviceScreenshots.find(row => row.device_id === deviceId) || null;
  }

  function renderDevices() {
    const grid = $('#devices-grid');
    const empty = $('#devices-empty');
    const has = state.devices.length > 0;
    empty.classList.toggle('hidden', has);
    grid.classList.toggle('hidden', !has);
    if (!has) { grid.innerHTML = ''; return; }

    grid.innerHTML = state.devices.map(device => {
      const status = effectiveDeviceStatus(device);
      const assignment = state.deviceAssignments.find(a => a.device_id === device.id);
      const shot = latestScreenshotForDevice(device.id);
      const options = state.playlists.map(playlist => `<option value="${playlist.id}" ${assignment?.playlist_id === playlist.id ? 'selected' : ''}>${escapeHtml(playlist.name)}</option>`).join('');
      return `
      <article class="device-card">
        <div class="device-card-head">
          <div class="device-card-title"><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(platformLabel(device.platform))}</span></div>
          <div class="card-menu">
            <button class="small-icon-button capture-button" data-capture-device="${device.id}" title="Capturar o que está passando agora">📷 Capturar</button>
            <button class="small-icon-button" data-edit-device="${device.id}" title="Editar">✎</button>
            <button class="small-icon-button" data-delete-device="${device.id}" title="Excluir">×</button>
          </div>
        </div>
        <div class="device-screen ${shot ? 'has-screenshot' : ''}" data-device-screenshot="${device.id}" data-screenshot-path="${escapeHtml(shot?.storage_path || '')}">${shot ? '<span>Carregando captura…</span>' : '▣'}</div>
        ${shot ? `<div class="screenshot-meta">Última captura: ${escapeHtml(formatMonitorDateTime(shot.captured_at))}</div>` : ''}
        <div class="device-meta">
          <span class="status-dot ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>
          <span>${escapeHtml(orientationLabel(device.orientation))}</span>
        </div>
        <div class="device-last-seen">${escapeHtml(formatLastSeen(device.last_seen_at))}${device.app_version ? ` • ${escapeHtml(device.app_version)}` : ''}</div>
        <label class="device-assignment">Playlist padrão
          <select data-device-playlist="${device.id}" ${state.playlists.length ? '' : 'disabled'}>
            <option value="">${state.playlists.length ? 'Nenhuma playlist' : 'Crie uma playlist primeiro'}</option>
            ${options}
          </select>
        </label>
      </article>`;
    }).join('');
    hydrateDeviceScreenshots();
  }

  async function hydrateDeviceScreenshots() {
    for (const shot of state.deviceScreenshots) {
      const target = $(`[data-device-screenshot="${CSS.escape(shot.device_id)}"]`);
      if (!target || target.dataset.loaded === '1' || !shot.storage_path) continue;
      try {
        const url = await getSignedMediaUrl(shot.storage_path);
        const img = new Image();
        img.alt = 'Captura da TV';
        img.src = url;
        target.replaceChildren(img);
        target.dataset.loaded = '1';
      } catch { target.textContent = 'Captura indisponível'; }
    }
  }

  async function requestDeviceScreenshot(deviceId) {
    const device = state.devices.find(item => item.id === deviceId);
    if (!device) return;
    try {
      const rows = await restRequest('device_commands', {
        method: 'POST',
        body: { company_id: state.company.id, device_id: deviceId, command_type: 'screenshot', requested_by: state.user.id },
        prefer: 'return=representation',
      });
      const command = rows?.[0];
      if (!command?.id) throw new Error('O servidor não confirmou o pedido de captura.');
      toast('Captura solicitada', `${device.name}: aguardando o Player responder.`);
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1800));
        const result = await restRequest('device_commands', { query: `select=id,status,error_message&company_id=eq.${encodeURIComponent(state.company.id)}&id=eq.${encodeURIComponent(command.id)}&limit=1` });
        const row = result?.[0];
        if (row?.status === 'completed') {
          await loadAllData();
          toast('Captura concluída', `A imagem atual da ${device.name} foi recebida.`);
          return;
        }
        if (row?.status === 'failed') throw new Error(row.error_message || 'O Player não conseguiu capturar a tela.');
      }
      toast('Captura ainda pendente', 'A TV pode estar offline. O pedido ficará aguardando o Player.', 'error', 6000);
    } catch (error) { toast('Erro ao capturar TV', error.message, 'error', 6000); }
  }

  function renderPlayerBranding() {
    const b = state.playerBranding;
    const title = b?.title || state.company?.name || 'Vision Player';
    const message = b?.message || 'Instale o Player e vincule a TV pelo código.';
    if ($('#branding-title')) $('#branding-title').value = b?.title || '';
    if ($('#branding-message')) $('#branding-message').value = b?.message || '';
    if ($('#branding-preview-title')) $('#branding-preview-title').textContent = title;
    if ($('#branding-preview-message')) $('#branding-preview-message').textContent = message;
    if ($('#branding-setup-code')) $('#branding-setup-code').textContent = b?.setup_code || 'Será gerado ao salvar';
    const playerUrl = b?.setup_code ? `${location.origin}/player.html?setup=${encodeURIComponent(b.setup_code)}` : `${location.origin}/player.html`;
    if ($('#branding-player-url')) $('#branding-player-url').value = playerUrl;
    const preview = $('#player-branding-preview');
    if (preview) { preview.style.backgroundImage = ''; preview.dataset.loaded = ''; }
    hydratePlayerBrandingPreview();
  }

  async function hydratePlayerBrandingPreview() {
    const preview = $('#player-branding-preview');
    if (!preview || !state.playerBranding?.splash_path || preview.dataset.loaded === '1') return;
    try {
      const url = await getSignedMediaUrl(state.playerBranding.splash_path);
      preview.style.backgroundImage = `linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.45)),url("${url}")`;
      preview.dataset.loaded = '1';
    } catch { /* generic preview remains */ }
  }

  async function savePlayerBranding(event) {
    event.preventDefault();
    const button = $('#branding-save');
    const file = $('#branding-file')?.files?.[0] || null;
    let newPath = null;
    let oldPath = state.playerBranding?.splash_path || null;
    setBusy(button, true, 'Salvando...');
    try {
      if (file) {
        const optimized = await optimizeImageForUpload(file);
        const upload = optimized.file;
        const safeName = optimized.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100);
        newPath = `${state.company.id}/branding/${crypto.randomUUID()}-${safeName}`;
        const encodedPath = newPath.split('/').map(encodeURIComponent).join('/');
        await storageRequest(`/object/${CONFIG.storageBucket}/${encodedPath}`, { body: upload, contentType: upload.type || 'image/webp', extraHeaders: { 'x-upsert': 'false' } });
      }
      const payload = {
        company_id: state.company.id,
        title: $('#branding-title').value.trim() || null,
        message: $('#branding-message').value.trim() || null,
        splash_path: newPath || oldPath,
        updated_by: state.user.id,
      };
      let rows;
      if (state.playerBranding) {
        rows = await restRequest('company_player_branding', { method: 'PATCH', query: `company_id=eq.${encodeURIComponent(state.company.id)}`, body: payload, prefer: 'return=representation' });
      } else {
        rows = await restRequest('company_player_branding', { method: 'POST', body: payload, prefer: 'return=representation' });
      }
      state.playerBranding = rows?.[0] || state.playerBranding;
      if (!state.playerBranding) throw new Error('A configuração foi enviada, mas não retornou do servidor.');
      if (newPath && oldPath && oldPath !== newPath) {
        storageRequest(`/object/${CONFIG.storageBucket}`, { method: 'DELETE', body: { prefixes: [oldPath] } }).catch(() => {});
      }
      $('#branding-file').value = '';
      renderPlayerBranding();
      toast('Salvo com sucesso', 'Tela de instalação do Player atualizada.');
    } catch (error) {
      if (newPath) storageRequest(`/object/${CONFIG.storageBucket}`, { method: 'DELETE', body: { prefixes: [newPath] } }).catch(() => {});
      toast('Erro ao salvar tela do Player', error.message, 'error', 6000);
    } finally { setBusy(button, false); }
  }

  function deviceHasActiveIssue'''
if not pattern.search(s):
    raise SystemExit('renderDevices block not found')
s = pattern.sub(new_render_devices, s, count=1)

# Compact media library.
pattern = re.compile(r"  function renderMedia\(\) \{.*?\n  \}\n\n  function renderPlaylists", re.S)
new_render_media = r'''  function renderMedia() {
    const grid = $('#media-grid');
    const empty = $('#media-empty');
    const has = state.media.length > 0;
    empty.classList.toggle('hidden', has);
    grid.classList.toggle('hidden', !has);
    grid.className = 'media-list-compact';
    if (!has) { grid.innerHTML = ''; return; }

    grid.innerHTML = state.media.map(media => {
      const used = state.playlistItems.filter(item => item.media_id === media.id).length;
      return `
      <article class="media-row-compact" data-media-card="${media.id}">
        <div class="media-preview" data-media-preview="${media.id}"><span>${media.media_type === 'video' ? '▶' : '▧'}</span><span class="media-type-tag">${escapeHtml(media.media_type)}</span></div>
        <div class="media-body"><strong title="${escapeHtml(media.name)}">${escapeHtml(media.name)}</strong><small>${escapeHtml(formatBytes(media.size_bytes))}${media.width && media.height ? ` • ${media.width}×${media.height}` : ''}${media.duration_seconds ? ` • ${escapeHtml(formatDuration(media.duration_seconds))}` : ''} • em ${used} item(ns) de playlist</small></div>
        <div class="media-actions"><button class="small-icon-button" data-open-media="${media.id}">Visualizar</button><button class="small-icon-button" data-delete-media="${media.id}">Excluir</button></div>
      </article>`;
    }).join('');

    state.media.filter(m => m.storage_path && ['image','video'].includes(m.media_type)).forEach(async media => {
      try {
        const url = await getSignedMediaUrl(media.storage_path);
        const preview = $(`[data-media-preview="${CSS.escape(media.id)}"]`);
        if (!preview || !url) return;
        if (media.media_type === 'image') { const img = document.createElement('img'); img.loading='lazy'; img.alt=media.name; img.src=url; preview.prepend(img); }
        else { const video=document.createElement('video'); video.muted=true; video.preload='metadata'; video.playsInline=true; video.src=url; preview.prepend(video); }
      } catch { /* placeholder */ }
    });
  }

  function renderPlaylists'''
if not pattern.search(s):
    raise SystemExit('renderMedia block not found')
s = pattern.sub(new_render_media, s, count=1)

# Playlist editor with compact rows, selection, schedule and drag support.
pattern = re.compile(r"  function renderPlaylistEditor\(\) \{.*?\n  \}\n\n  async function hydratePlaylistPreviews", re.S)
new_playlist_editor = r'''  function playlistItemScheduleLabel(item) {
    if (!item?.schedule_enabled) return 'Sempre';
    const days = Array.isArray(item.weekdays) ? item.weekdays.map(Number).sort((a,b)=>a-b) : [0,1,2,3,4,5,6];
    const dayText = days.length === 7 ? 'Todos os dias' : days.map(day => WEEKDAY_NAMES[day]).filter(Boolean).join(', ');
    const timeText = item.start_time && item.end_time ? `${normalizeTime(item.start_time)}–${normalizeTime(item.end_time)}` : 'dia inteiro';
    const dateText = item.start_date || item.end_date ? `${item.start_date ? formatDateShort(item.start_date) : 'agora'} → ${item.end_date ? formatDateShort(item.end_date) : 'sem fim'}` : '';
    return [dayText, timeText, dateText].filter(Boolean).join(' • ');
  }

  function syncPlaylistBulkUi() {
    const selected = state.selectedPlaylistItemIds;
    const count = selected.size;
    const countEl = $('#playlist-selected-count');
    if (countEl) countEl.textContent = `${count} selecionada${count === 1 ? '' : 's'}`;
    const items = state.playlistItems.filter(i => i.playlist_id === state.editingPlaylistId);
    const all = $('#playlist-select-all');
    if (all) { all.checked = items.length > 0 && count === items.length; all.indeterminate = count > 0 && count < items.length; }
    ['#playlist-bulk-schedule','#playlist-bulk-enable','#playlist-bulk-disable','#playlist-bulk-replace','#playlist-bulk-delete'].forEach(selector => { const el=$(selector); if(el) el.disabled=count===0; });
  }

  function renderPlaylistEditor() {
    const playlist = state.playlists.find(p => p.id === state.editingPlaylistId);
    if (!playlist) return;
    $('#playlist-items-title').textContent = playlist.name;
    const items = state.playlistItems.filter(i => i.playlist_id === playlist.id).sort((a,b) => a.position - b.position);
    const validIds = new Set(items.map(item => item.id));
    state.selectedPlaylistItemIds = new Set([...state.selectedPlaylistItemIds].filter(id => validIds.has(id)));
    const mediaById = Object.fromEntries(state.media.map(m => [m.id, m]));

    const list = $('#playlist-items-list');
    $('#playlist-items-empty').classList.toggle('hidden', items.length > 0);
    list.innerHTML = items.map((item, index) => {
      const media = mediaById[item.media_id];
      const isImage = media?.media_type === 'image';
      const seconds = Math.max(1, Math.round(Number(item.duration_override_seconds || media?.duration_seconds || 10)));
      const checked = state.selectedPlaylistItemIds.has(item.id);
      return `
        <div class="sortable-row playlist-item-row" draggable="true" data-playlist-drag-item="${item.id}">
          <input class="playlist-select-box" type="checkbox" data-select-playlist-item="${item.id}" ${checked ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(media?.name || 'mídia')}" />
          <span class="drag-handle" title="Arrastar para ordenar">⋮⋮</span>
          <div class="playlist-thumb" data-playlist-media-preview="${media?.id || ''}"><span>${media?.media_type === 'video' ? '▶' : '▧'}</span></div>
          <div class="playlist-item-copy"><strong>${index + 1}. ${escapeHtml(media?.name || 'Mídia removida')}</strong><small>${escapeHtml(media?.media_type || '')}${media?.width && media?.height ? ` • ${media.width}×${media.height}` : ''}</small><div class="playlist-item-meta"><span class="enabled-chip ${item.enabled ? '' : 'off'}">${item.enabled ? 'Ativa' : 'Desativada'}</span><span class="schedule-chip ${item.schedule_enabled ? 'active' : ''}">${escapeHtml(playlistItemScheduleLabel(item))}</span></div></div>
          ${isImage ? `<label class="playlist-duration-mini">Tempo <input type="number" min="1" max="86400" step="1" value="${seconds}" data-item-duration-input="${item.id}" /> s <button class="small-icon-button" type="button" data-save-item-duration="${item.id}">Salvar</button></label>` : `<span class="playlist-video-duration">${media?.duration_seconds ? escapeHtml(formatDuration(media.duration_seconds)) : 'Vídeo'}</span>`}
          <div class="playlist-inline-actions"><button class="small-icon-button" type="button" data-edit-item-schedule="${item.id}">◷</button><button class="small-icon-button" type="button" data-toggle-item-enabled="${item.id}" title="${item.enabled ? 'Desativar' : 'Ativar'}">${item.enabled ? '⏸' : '▶'}</button><button class="small-icon-button" type="button" data-move-item="${item.id}" data-direction="up" ${index===0?'disabled':''}>↑</button><button class="small-icon-button" type="button" data-move-item="${item.id}" data-direction="down" ${index===items.length-1?'disabled':''}>↓</button><button class="small-icon-button" type="button" data-remove-item="${item.id}">×</button></div>
        </div>`;
    }).join('');

    const picker = $('#playlist-media-picker');
    $('#playlist-media-empty').classList.toggle('hidden', state.media.length > 0);
    const included = new Map(items.map((item,index) => [item.media_id,index + 1]));
    picker.innerHTML = state.media.map(media => { const order=included.get(media.id); return `<div class="picker-row ${order?'already-selected':''}"><div class="playlist-thumb" data-playlist-media-preview="${media.id}"><span>${media.media_type==='video'?'▶':'▧'}</span></div><div class="grow"><strong>${escapeHtml(media.name)}</strong><small>${escapeHtml(media.media_type)} • ${escapeHtml(formatBytes(media.size_bytes))}</small><span class="playlist-selection-state ${order?'selected':''}">${order?`Já adicionada • ordem ${order}`:'Ainda não selecionada'}</span></div><button class="small-icon-button picker-add-button" data-add-media-to-playlist="${media.id}" ${order?'disabled':''}>${order?'Adicionada':'+ Adicionar'}</button></div>`; }).join('');

    const replace = $('#playlist-bulk-replace-media');
    if (replace) replace.innerHTML = '<option value="">Substituir por...</option>' + state.media.map(media => `<option value="${media.id}">${escapeHtml(media.name)}</option>`).join('');
    syncPlaylistBulkUi();
    hydratePlaylistPreviews();
  }

  async function hydratePlaylistPreviews'''
if not pattern.search(s):
    raise SystemExit('playlist editor block not found')
s = pattern.sub(new_playlist_editor, s, count=1)

s = replace_once(
    s,
    "  function openPlaylistEditor(id) {\n    state.editingPlaylistId = id;\n    renderPlaylistEditor();",
    "  function openPlaylistEditor(id) {\n    state.editingPlaylistId = id;\n    state.selectedPlaylistItemIds = new Set();\n    renderPlaylistEditor();",
    'open playlist selection reset',
)

# Add playlist bulk/schedule helpers before removePlaylistItem.
insert_marker = "  async function removePlaylistItem(itemId) {\n"
helpers = r'''  function playlistScheduleStatus(message='', type='') {
    const el = $('#playlist-schedule-status');
    if (!el) return;
    el.textContent = message;
    el.className = `form-status ${type}`.trim();
    el.classList.toggle('hidden', !message);
  }

  function selectedPlaylistItems() {
    return state.playlistItems.filter(item => item.playlist_id === state.editingPlaylistId && state.selectedPlaylistItemIds.has(item.id));
  }

  function openPlaylistScheduleDialog(ids) {
    const targetIds = Array.isArray(ids) ? ids : [...state.selectedPlaylistItemIds];
    if (!targetIds.length) return toast('Selecione uma mídia', 'Marque uma ou mais mídias da playlist para programar.', 'error');
    state.scheduleTargetItemIds = targetIds;
    const first = state.playlistItems.find(item => item.id === targetIds[0]);
    $('#playlist-schedule-count').textContent = `${targetIds.length} mídia${targetIds.length===1?'':'s'}`;
    $('#playlist-schedule-enabled').checked = first?.schedule_enabled !== false;
    $('#playlist-schedule-start-date').value = first?.start_date || '';
    $('#playlist-schedule-end-date').value = first?.end_date || '';
    $('#playlist-schedule-start-time').value = normalizeTime(first?.start_time || '');
    $('#playlist-schedule-end-time').value = normalizeTime(first?.end_time || '');
    const allDay = !(first?.start_time && first?.end_time);
    $('#playlist-schedule-all-day').checked = allDay;
    const days = new Set((Array.isArray(first?.weekdays) ? first.weekdays : [0,1,2,3,4,5,6]).map(Number));
    $$('[data-playlist-weekday]').forEach(input => { input.checked = days.has(Number(input.dataset.playlistWeekday)); });
    playlistScheduleStatus();
    syncPlaylistScheduleFormVisibility();
    openDialog('playlist-schedule-dialog');
  }

  function syncPlaylistScheduleFormVisibility() {
    const enabled = $('#playlist-schedule-enabled')?.checked !== false;
    const allDay = $('#playlist-schedule-all-day')?.checked !== false;
    $$('.schedule-date-fields input').forEach(input => input.disabled = !enabled);
    $('#playlist-schedule-all-day').disabled = !enabled;
    $$('[data-playlist-weekday]').forEach(input => input.disabled = !enabled);
    $('#playlist-schedule-time-fields').classList.toggle('hidden', !enabled || allDay);
  }

  async function applyPlaylistSchedule(event) {
    event.preventDefault();
    const ids = state.scheduleTargetItemIds.filter(Boolean);
    if (!ids.length) return;
    const enabled = $('#playlist-schedule-enabled').checked;
    const allDay = $('#playlist-schedule-all-day').checked;
    const weekdays = $$('[data-playlist-weekday]').filter(input => input.checked).map(input => Number(input.dataset.playlistWeekday));
    const startDate = $('#playlist-schedule-start-date').value || null;
    const endDate = $('#playlist-schedule-end-date').value || null;
    const startTime = enabled && !allDay ? ($('#playlist-schedule-start-time').value || null) : null;
    const endTime = enabled && !allDay ? ($('#playlist-schedule-end-time').value || null) : null;
    if (enabled && !weekdays.length) return playlistScheduleStatus('❌ Selecione pelo menos um dia da semana.', 'error');
    if (startDate && endDate && endDate < startDate) return playlistScheduleStatus('❌ A data final não pode ser anterior à inicial.', 'error');
    if (enabled && !allDay && (!startTime || !endTime)) return playlistScheduleStatus('❌ Informe a hora inicial e final.', 'error');
    const button = $('#playlist-schedule-save');
    setBusy(button, true, 'Aplicando...');
    playlistScheduleStatus('Salvando programação...', 'pending');
    try {
      const payload = { schedule_enabled: enabled, start_date: enabled ? startDate : null, end_date: enabled ? endDate : null, start_time: enabled ? startTime : null, end_time: enabled ? endTime : null, weekdays: enabled ? weekdays : [0,1,2,3,4,5,6] };
      await Promise.all(ids.map(id => restRequest('playlist_items', { method:'PATCH', query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`, body:payload, prefer:'return=minimal' })));
      await loadAllData();
      playlistScheduleStatus('✅ Programação salva com sucesso.', 'success');
      toast('Programação salva', `${ids.length} mídia(s) atualizada(s).`);
      setTimeout(() => closeDialog('playlist-schedule-dialog'), 650);
    } catch (error) { playlistScheduleStatus(`❌ ${error.message}`, 'error'); toast('Erro ao programar mídias', error.message, 'error'); }
    finally { setBusy(button, false); }
  }

  async function clearPlaylistSchedule() {
    const ids = state.scheduleTargetItemIds.filter(Boolean);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map(id => restRequest('playlist_items', { method:'PATCH', query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`, body:{schedule_enabled:false,start_date:null,end_date:null,start_time:null,end_time:null,weekdays:[0,1,2,3,4,5,6]}, prefer:'return=minimal' })));
      await loadAllData();
      closeDialog('playlist-schedule-dialog');
      toast('Programação removida', 'As mídias voltaram a ficar disponíveis sempre.');
    } catch (error) { playlistScheduleStatus(`❌ ${error.message}`, 'error'); }
  }

  async function setSelectedPlaylistEnabled(enabled) {
    const ids = [...state.selectedPlaylistItemIds];
    if (!ids.length) return;
    try {
      await Promise.all(ids.map(id => restRequest('playlist_items',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,body:{enabled},prefer:'return=minimal'})));
      await loadAllData();
      toast(enabled ? 'Mídias ativadas' : 'Mídias desativadas', `${ids.length} item(ns) atualizado(s).`);
    } catch (error) { toast('Erro ao atualizar mídias', error.message, 'error'); }
  }

  async function togglePlaylistItemEnabled(itemId) {
    const item = state.playlistItems.find(row => row.id === itemId);
    if (!item) return;
    state.selectedPlaylistItemIds = new Set([itemId]);
    await setSelectedPlaylistEnabled(!item.enabled);
  }

  async function replaceSelectedPlaylistMedia() {
    const mediaId = $('#playlist-bulk-replace-media')?.value || '';
    const ids = [...state.selectedPlaylistItemIds];
    if (!ids.length) return toast('Selecione uma mídia', '', 'error');
    if (!mediaId) return toast('Escolha a substituição', 'Selecione a nova mídia no campo “Substituir por”.', 'error');
    const media = state.media.find(row => row.id === mediaId);
    if (!media) return;
    if (!confirm(`Substituir ${ids.length} item(ns) por “${media.name}”?`)) return;
    try {
      await Promise.all(ids.map(id => restRequest('playlist_items',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,body:{media_id:mediaId,duration_override_seconds:media.media_type==='image'?10:null},prefer:'return=minimal'})));
      await loadAllData();
      toast('Mídias substituídas', `${ids.length} item(ns) atualizado(s).`);
    } catch (error) { toast('Erro ao substituir', error.message, 'error'); }
  }

  async function deleteSelectedPlaylistItems() {
    const ids = [...state.selectedPlaylistItemIds];
    if (!ids.length || !confirm(`Excluir ${ids.length} item(ns) desta playlist?`)) return;
    try {
      await Promise.all(ids.map(id => restRequest('playlist_items',{method:'DELETE',query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`})));
      state.selectedPlaylistItemIds = new Set();
      await loadAllData();
      toast('Itens removidos', `${ids.length} mídia(s) removida(s) da sequência.`);
    } catch (error) { toast('Erro ao excluir itens', error.message, 'error'); }
  }

  async function persistPlaylistOrder(orderedIds) {
    if (!orderedIds?.length) return;
    try {
      await Promise.all(orderedIds.map((id,index) => restRequest('playlist_items',{method:'PATCH',query:`id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(state.company.id)}`,body:{position:index},prefer:'return=minimal'})));
      orderedIds.forEach((id,index)=>{const item=state.playlistItems.find(row=>row.id===id);if(item)item.position=index;});
      renderPlaylistEditor();
      toast('Ordem atualizada');
    } catch (error) { toast('Erro ao reordenar', error.message, 'error'); await loadAllData().catch(()=>{}); }
  }

'''
if insert_marker not in s:
    raise SystemExit('removePlaylistItem marker not found')
s = s.replace(insert_marker, helpers + insert_marker, 1)

# Report reset: no stale/synthetic values while refreshing.
report_marker = "  async function loadPlaybackReport({ quiet = false } = {}) {\n"
report_helper = r'''  function resetReportVisuals() {
    ['#report-started','#report-completed','#report-completion-rate','#report-total-time','#report-device-count','#report-media-count'].forEach(selector => { const el=$(selector); if(el) el.textContent='—'; });
    ['#report-campaigns-body','#report-devices-body','#report-media-body','#report-events-body'].forEach(selector => { const el=$(selector); if(el) el.innerHTML=''; });
    const generated=$('#report-generated-label'); if(generated) generated.textContent='Carregando somente eventos reais do Player…';
  }

'''
if report_helper.strip() not in s:
    s = replace_once(s, report_marker, report_helper + report_marker, 'report helper')
s = replace_once(
    s,
    "    state.reportLoading = true;\n    $('#report-loading')?.classList.remove('hidden');",
    "    state.reportLoading = true;\n    state.report = null;\n    resetReportVisuals();\n    $('#report-loading')?.classList.remove('hidden');",
    'report loading reset',
)

# Event bindings.
s = replace_once(s, "    $('#playlist-form').addEventListener('submit', handleCreatePlaylist);", "    $('#playlist-form').addEventListener('submit', handleCreatePlaylist);\n    $('#player-branding-form').addEventListener('submit', savePlayerBranding);\n    $('#branding-copy-url').addEventListener('click', async () => { const value=$('#branding-player-url').value; try{await navigator.clipboard.writeText(value);toast('Link copiado')}catch{$('#branding-player-url').select();document.execCommand('copy');toast('Link copiado')} });\n    $('#branding-open-player').addEventListener('click', () => window.open($('#branding-player-url').value || './player.html','_blank','noopener'));\n    $('#playlist-schedule-form').addEventListener('submit', applyPlaylistSchedule);\n    $('#playlist-schedule-clear').addEventListener('click', clearPlaylistSchedule);\n    $('#playlist-schedule-enabled').addEventListener('change', syncPlaylistScheduleFormVisibility);\n    $('#playlist-schedule-all-day').addEventListener('change', syncPlaylistScheduleFormVisibility);\n    $('#playlist-bulk-schedule').addEventListener('click', () => openPlaylistScheduleDialog());\n    $('#playlist-bulk-enable').addEventListener('click', () => setSelectedPlaylistEnabled(true));\n    $('#playlist-bulk-disable').addEventListener('click', () => setSelectedPlaylistEnabled(false));\n    $('#playlist-bulk-replace').addEventListener('click', replaceSelectedPlaylistMedia);\n    $('#playlist-bulk-delete').addEventListener('click', deleteSelectedPlaylistItems);", 'bind v2 forms')

click_anchor = "      const editDevice = event.target.closest('[data-edit-device]');\n"
s = replace_once(s, click_anchor, "      const captureDevice = event.target.closest('[data-capture-device]');\n      if (captureDevice) return requestDeviceScreenshot(captureDevice.dataset.captureDevice);\n" + click_anchor, 'capture click')

s = replace_once(s, "      const saveDuration = event.target.closest('[data-save-item-duration]');\n      if (saveDuration) return savePlaylistItemDuration(saveDuration.dataset.saveItemDuration);", "      const saveDuration = event.target.closest('[data-save-item-duration]');\n      if (saveDuration) return savePlaylistItemDuration(saveDuration.dataset.saveItemDuration);\n      const editItemSchedule = event.target.closest('[data-edit-item-schedule]');\n      if (editItemSchedule) { state.selectedPlaylistItemIds = new Set([editItemSchedule.dataset.editItemSchedule]); renderPlaylistEditor(); return openPlaylistScheduleDialog([editItemSchedule.dataset.editItemSchedule]); }\n      const toggleItem = event.target.closest('[data-toggle-item-enabled]');\n      if (toggleItem) return togglePlaylistItemEnabled(toggleItem.dataset.toggleItemEnabled);", 'playlist item actions')

s = replace_once(s, "    document.addEventListener('change', event => {\n      const select = event.target.closest('[data-device-playlist]');", "    document.addEventListener('change', event => {\n      const itemCheck = event.target.closest('[data-select-playlist-item]');\n      if (itemCheck) { if(itemCheck.checked) state.selectedPlaylistItemIds.add(itemCheck.dataset.selectPlaylistItem); else state.selectedPlaylistItemIds.delete(itemCheck.dataset.selectPlaylistItem); syncPlaylistBulkUi(); return; }\n      if (event.target.id === 'playlist-select-all') { const checked=event.target.checked; const items=state.playlistItems.filter(i=>i.playlist_id===state.editingPlaylistId); state.selectedPlaylistItemIds = checked ? new Set(items.map(i=>i.id)) : new Set(); renderPlaylistEditor(); return; }\n      const select = event.target.closest('[data-device-playlist]');", 'playlist selection change')

# Drag and drop event listeners before playlist dialog close binding.
drag_code = r'''
    document.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-playlist-drag-item]');
      if (!row) return;
      state.draggingPlaylistItemId = row.dataset.playlistDragItem;
      row.classList.add('dragging');
      if (event.dataTransfer) { event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain', state.draggingPlaylistItemId); }
    });
    document.addEventListener('dragover', event => {
      const row = event.target.closest('[data-playlist-drag-item]');
      if (!row || !state.draggingPlaylistItemId) return;
      event.preventDefault();
      $$('.playlist-item-row.drag-over').forEach(el=>el.classList.remove('drag-over'));
      if (row.dataset.playlistDragItem !== state.draggingPlaylistItemId) row.classList.add('drag-over');
    });
    document.addEventListener('drop', event => {
      const row = event.target.closest('[data-playlist-drag-item]');
      if (!row || !state.draggingPlaylistItemId) return;
      event.preventDefault();
      const dragged=state.draggingPlaylistItemId,target=row.dataset.playlistDragItem;
      const ids=state.playlistItems.filter(i=>i.playlist_id===state.editingPlaylistId).sort((a,b)=>a.position-b.position).map(i=>i.id);
      const from=ids.indexOf(dragged),to=ids.indexOf(target);
      if(from>=0&&to>=0&&from!==to){ids.splice(from,1);ids.splice(to,0,dragged);persistPlaylistOrder(ids);}
      state.draggingPlaylistItemId=null;
      $$('.playlist-item-row').forEach(el=>el.classList.remove('dragging','drag-over'));
    });
    document.addEventListener('dragend', () => { state.draggingPlaylistItemId=null; $$('.playlist-item-row').forEach(el=>el.classList.remove('dragging','drag-over')); });
'''
s = replace_once(s, "    $('#playlist-items-dialog').addEventListener('close', () => { state.editingPlaylistId = null; });", drag_code + "\n    $('#playlist-items-dialog').addEventListener('close', () => { state.editingPlaylistId = null; state.selectedPlaylistItemIds = new Set(); });", 'drag handlers')

p.write_text(s)
print('signage v2 UI patch applied')
