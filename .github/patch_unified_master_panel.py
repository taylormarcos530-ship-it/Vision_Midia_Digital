from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'anchor_not_found:{label}:{path}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def append_once(path, marker, block):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if marker in text:
        return
    p.write_text(text.rstrip() + '\n\n' + block.strip() + '\n', encoding='utf-8')


# 1) Operational panel: clearly distinguish both dashboards and expose SaaS navigation only through saas-shell.js.
replace_once(
    'index.html',
    '<button class="nav-item active" data-view="dashboard"><span>▦</span> Dashboard</button>',
    '<button class="nav-item active" data-view="dashboard"><span>▦</span> Dashboard Operacional</button>',
    'operational-dashboard-label',
)

replace_once(
    'index.html',
    '        <button class="nav-item" data-view="reports"><span>▤</span> Relatórios</button>\n      </nav>',
    '''        <button class="nav-item" data-view="reports"><span>▤</span> Relatórios</button>
        <div id="saas-admin-nav" class="saas-admin-nav hidden" aria-label="Administração SaaS">
          <span class="nav-section-label">ADMINISTRAÇÃO SAAS</span>
          <button class="nav-item" data-saas-view="dashboard"><span>▦</span> Dashboard SaaS</button>
          <button class="nav-item" data-saas-view="clients"><span>▣</span> Clientes</button>
          <button class="nav-item" data-saas-view="plans"><span>◇</span> Planos</button>
          <button class="nav-item" data-saas-view="audit"><span>≡</span> Auditoria</button>
        </div>
      </nav>''',
    'saas-nav-group',
)

replace_once(
    'index.html',
    '        <button id="access-refresh" class="button ghost full" type="button">Verificar liberação</button>',
    '''        <button id="access-refresh" class="button ghost full" type="button">Verificar liberação</button>
        <div id="access-refresh-status" class="access-refresh-status hidden" role="status" aria-live="polite"></div>''',
    'access-refresh-status',
)

main_end = '''          </div>
        </section>
      </div>
    </main>
  </div>

  <div id="modal-backdrop"'''
main_end_new = '''          </div>
        </section>

        <section id="view-saas-admin" class="view-section saas-admin-view hidden">
          <div id="saas-master-loading" class="saas-master-loading">Carregando administração SaaS…</div>
          <iframe id="saas-master-frame" class="saas-master-frame" title="Administração SaaS da Vision Mídia Digital"></iframe>
        </section>
      </div>
    </main>
  </div>

  <div id="modal-backdrop"'''
replace_once('index.html', main_end, main_end_new, 'saas-iframe-section')

replace_once(
    'index.html',
    '  <script src="./payment-ui.js" defer></script>\n</body>',
    '  <script src="./payment-ui.js" defer></script>\n  <script src="./saas-shell.js" defer></script>\n</body>',
    'saas-shell-script',
)

# 2) Make Verificar liberação always produce visible feedback.
p = Path('app.js')
text = p.read_text(encoding='utf-8')
text = text.replace("dashboard: ['VISÃO GERAL', 'Dashboard'],", "dashboard: ['VISÃO GERAL', 'Dashboard Operacional'],", 1)
pattern = re.compile(r"    \$\('#access-refresh'\)\.addEventListener\('click', async \(\) => \{.*?\n    \}\);\n    \$\('#access-logout'\)", re.S)
replacement = r'''    $('#access-refresh').addEventListener('click', async () => {
      const button = $('#access-refresh');
      const status = $('#access-refresh-status');
      const setStatus = (message = '', type = '') => {
        if (!status) return;
        status.textContent = message;
        status.className = `access-refresh-status ${type}`.trim();
        status.classList.toggle('hidden', !message);
      };
      setBusy(button, true, 'Verificando...');
      setStatus('Consultando sua assinatura e as configurações de suporte…', 'pending');
      try {
        await loadPublicConfig();
        await enterAuthenticatedApp();
        const stillBlocked = !$('#access-screen').classList.contains('hidden');
        if (stillBlocked) {
          const reason = accessReason();
          setStatus(reason?.message || 'Seu acesso ainda está aguardando liberação do administrador.', 'pending');
          toast('Acesso ainda não liberado', 'Consulta concluída. Seus dados e o WhatsApp de suporte foram atualizados.', 'error');
        } else {
          setStatus('Acesso liberado. Abrindo seu painel…', 'success');
          toast('Acesso liberado', 'Seu painel já está disponível.');
        }
      } catch (error) {
        setStatus(`Não foi possível verificar agora: ${error.message}`, 'error');
        toast('Falha ao verificar acesso', error.message, 'error');
      } finally {
        setBusy(button, false);
      }
    });
    $('#access-logout')'''
text2, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'access_refresh_handler_count:{count}')
p.write_text(text2, encoding='utf-8')

# 3) Embedded Master keeps all existing SaaS functionality, but removes the duplicated Master chrome inside the operational shell.
replace_once(
    'master.html',
    '  <script src="./master-payment.js" defer></script>\n</body>',
    '  <script src="./master-payment.js" defer></script>\n  <script src="./master-embed.js" defer></script>\n</body>',
    'master-embed-script',
)

append_once('styles.css', '/* UNIFIED_MASTER_PANEL */', r'''
/* UNIFIED_MASTER_PANEL */
.saas-admin-nav{display:grid;gap:7px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.saas-admin-nav.hidden{display:none!important}.nav-section-label{padding:0 12px 4px;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.12em}
.saas-admin-view{min-height:calc(100vh - 145px)}.saas-master-frame{display:block;width:100%;height:calc(100vh - 145px);min-height:620px;border:0;border-radius:18px;background:var(--surface)}
.saas-master-loading{position:absolute;opacity:0;pointer-events:none}.access-refresh-status{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface-2);color:var(--muted);font-size:12px;text-align:left}
.access-refresh-status.pending{border-color:#67552a;color:#f4ce7a}.access-refresh-status.success{border-color:#275944;color:#7ee0b8}.access-refresh-status.error{border-color:#6a3340;color:#ff9daa}
@media(max-width:760px){.saas-master-frame{height:calc(100vh - 132px);min-height:560px;border-radius:12px}.nav-section-label{padding-left:10px}}
''')

append_once('master.css', '/* MASTER_EMBED_MODE */', r'''
/* MASTER_EMBED_MODE */
body.master-embedded{background:#080c17;overflow:auto}
body.master-embedded .master-shell{display:block;min-height:100vh}
body.master-embedded .master-sidebar,body.master-embedded .master-topbar{display:none!important}
body.master-embedded .master-main{min-width:0;width:100%}
body.master-embedded .master-content{max-width:none;margin:0;padding:20px}
body.master-embedded .hero{margin-top:0}
body.master-embedded #master-auth,body.master-embedded #master-denied{min-height:100vh}
@media(max-width:720px){body.master-embedded .master-content{padding:12px}}
''')

print('unified_master_panel_patch_ok')
