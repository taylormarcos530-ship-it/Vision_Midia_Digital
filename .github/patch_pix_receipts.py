from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'anchor_not_found:{path}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def append_once(path, marker, block):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if marker in text:
        return
    p.write_text(text.rstrip() + '\n\n' + block.strip() + '\n', encoding='utf-8')


# Client access screen: keep Mercado Pago and add PIX / receipt UI.
index_payment = '''        <a id="access-payment" class="button primary full hidden" target="_blank" rel="noopener">Pagar agora • Mercado Pago</a>'''
index_payment_new = index_payment + '''
        <div id="access-pix-card" class="pix-payment-card hidden">
          <div class="pix-payment-head">
            <div><span class="eyebrow">PAGAMENTO ALTERNATIVO</span><h3>Pagamento por PIX</h3></div>
            <strong id="pix-amount">R$ 0,00</strong>
          </div>
          <div id="pix-qr" class="pix-qr" aria-label="QR Code PIX"></div>
          <label class="pix-field">PIX Copia e Cola
            <div class="pix-copy-line"><input id="pix-copy-code" type="text" readonly /><button id="pix-copy-button" class="button ghost" type="button">Copiar PIX</button></div>
          </label>
          <div class="pix-key-line"><span>Chave PIX</span><strong id="pix-key-display">—</strong></div>
          <div class="pix-receipt-box">
            <label>Comprovante de pagamento
              <input id="pix-receipt-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" />
              <small>JPG, PNG, WEBP ou PDF • máximo 8 MB.</small>
            </label>
            <button id="pix-receipt-submit" class="button primary full" type="button">Enviar comprovante</button>
            <div id="pix-receipt-status" class="pix-receipt-status hidden" role="status" aria-live="polite"></div>
          </div>
          <p class="form-hint">O envio do comprovante não libera o sistema automaticamente. O pagamento será confirmado pelo Master.</p>
        </div>'''
replace_once('index.html', index_payment, index_payment_new)

replace_once(
    'index.html',
    '  <script src="./app.js" defer></script>',
    '  <script src="./app.js" defer></script>\n  <script src="./payment-ui.js" defer></script>'
)

# Master: add PIX configuration and receipt review without moving existing fields.
master_payment = '''      <label>Link de pagamento Mercado Pago<input id="me-payment-url" type="url" maxlength="1200" placeholder="https://..." /><small>Enquanto a integração automática não estiver conectada, cole aqui o link de cobrança deste cliente. Ele verá o botão “Pagar agora”.</small></label>'''
master_payment_new = master_payment + '''
      <div class="limit-box pix-master-box">
        <strong>Pagamento por PIX <small>(opcional)</small></strong>
        <div class="form-grid two">
          <label>Tipo da chave PIX<select id="me-pix-key-type"><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="random">Chave aleatória</option><option value="other">Outra</option></select></label>
          <label>Chave PIX<input id="me-pix-key" maxlength="77" placeholder="Informe a chave PIX" /></label>
        </div>
        <div class="form-grid two">
          <label>Nome do recebedor<input id="me-pix-name" maxlength="25" placeholder="Nome que aparecerá no PIX" /></label>
          <label>Cidade do recebedor<input id="me-pix-city" maxlength="15" placeholder="Ex.: ANAPOLIS" /></label>
        </div>
        <small>Quando a chave estiver configurada, o cliente verá QR Code, PIX Copia e Cola e a opção de enviar comprovante.</small>
      </div>
      <div id="me-receipt-box" class="limit-box receipt-master-box hidden">
        <div class="receipt-master-head"><strong>Comprovante enviado pelo cliente</strong><span id="me-receipt-state" class="status pending">Aguardando análise</span></div>
        <div class="receipt-master-meta">
          <div><span>Enviado</span><strong id="me-receipt-date">—</strong></div>
          <div><span>Valor</span><strong id="me-receipt-amount">—</strong></div>
          <div><span>Arquivo</span><strong id="me-receipt-file-name">—</strong></div>
        </div>
        <p id="me-receipt-review-note" class="helper">O envio do comprovante não libera o acesso até a confirmação do Master.</p>
        <div class="dialog-actions compact-actions">
          <button id="me-receipt-view" class="button ghost" type="button">Ver comprovante</button>
          <button id="me-receipt-reject" class="button ghost" type="button">Recusar comprovante</button>
          <button id="me-receipt-approve" class="button primary" type="button">Aprovar e liberar</button>
        </div>
        <div id="me-receipt-preview" class="receipt-preview hidden">
          <img id="me-receipt-image" class="hidden" alt="Comprovante de pagamento" />
          <iframe id="me-receipt-pdf" class="hidden" title="Comprovante de pagamento em PDF"></iframe>
        </div>
      </div>'''
replace_once('master.html', master_payment, master_payment_new)

replace_once(
    'master.html',
    '  <script src="./master.js" defer></script>',
    '  <script src="./master.js" defer></script>\n  <script src="./master-payment.js" defer></script>'
)

# Only add the PIX fields to the existing secure save-company payload.
replace_once(
    'master.js',
    "        payment_url:paymentUrl||null,\n        player_audio_enabled:$('#me-player-audio').checked,",
    "        payment_url:paymentUrl||null,\n        pix_key:$('#me-pix-key')?.value.trim()||null,\n        pix_key_type:$('#me-pix-key-type')?.value||null,\n        pix_receiver_name:$('#me-pix-name')?.value.trim()||null,\n        pix_receiver_city:$('#me-pix-city')?.value.trim()||null,\n        player_audio_enabled:$('#me-player-audio').checked,"
)

append_once('styles.css', '/* PIX_RECEIPTS_UI */', r'''
/* PIX_RECEIPTS_UI */
.pix-payment-card{display:grid;gap:14px;width:100%;margin-top:4px;padding:18px;border:1px solid var(--line);border-radius:16px;background:var(--surface-2)}
.pix-payment-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;text-align:left}.pix-payment-head h3{margin:4px 0 0}.pix-payment-head>strong{font-size:20px;white-space:nowrap}.pix-qr{width:min(260px,100%);margin:auto;padding:10px;background:#fff;border-radius:14px}.pix-qr svg{display:block;width:100%;height:auto}.pix-field,.pix-receipt-box label{display:grid;gap:7px;text-align:left}.pix-copy-line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.pix-copy-line input{min-width:0}.pix-key-line{display:flex;justify-content:space-between;gap:14px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;text-align:left}.pix-key-line span{color:var(--muted)}.pix-key-line strong{overflow-wrap:anywhere;text-align:right}.pix-receipt-box{display:grid;gap:10px;padding-top:12px;border-top:1px solid var(--line)}.pix-receipt-status{padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:12px;text-align:left}.pix-receipt-status.pending{border-color:#67552a}.pix-receipt-status.success{border-color:#275944}.pix-receipt-status.error{border-color:#6a3340}
@media(max-width:620px){.pix-payment-head{flex-direction:column}.pix-copy-line{grid-template-columns:1fr}.pix-copy-line .button{width:100%}.pix-key-line{flex-direction:column}.pix-key-line strong{text-align:left}}
''')

append_once('master.css', '/* PIX_RECEIPTS_MASTER */', r'''
/* PIX_RECEIPTS_MASTER */
.pix-master-box>small{color:#8192ae}.receipt-master-box{gap:14px}.receipt-master-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.receipt-master-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.receipt-master-meta>div{padding:10px;border-radius:10px;background:#101a2b}.receipt-master-meta span{display:block;color:#7486a3;font-size:10px;text-transform:uppercase}.receipt-master-meta strong{display:block;margin-top:3px;font-size:12px;overflow-wrap:anywhere}.receipt-preview{display:grid;place-items:center;min-height:180px;border:1px solid #263652;border-radius:12px;background:#080d18;overflow:hidden}.receipt-preview img{display:block;max-width:100%;max-height:65vh;object-fit:contain}.receipt-preview iframe{width:100%;height:60vh;border:0;background:#fff}
@media(max-width:720px){.receipt-master-head{align-items:flex-start;flex-direction:column}.receipt-master-meta{grid-template-columns:1fr}.receipt-master-box .dialog-actions{position:static;display:grid;grid-template-columns:1fr;background:transparent}.receipt-master-box .dialog-actions .button{width:100%}}
''')

print('pix_receipts_patch_ok')
