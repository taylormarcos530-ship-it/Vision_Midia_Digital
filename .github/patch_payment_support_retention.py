from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'anchor_not_found:{path}:{old[:60]}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def regex_once(path, pattern, replacement):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    text2, n = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f'regex_anchor_not_found:{path}')
    p.write_text(text2, encoding='utf-8')

# 1) Acesso: recarrega configuração pública (WhatsApp) e dá feedback real.
replace_once(
    'app.js',
    "    $('#access-refresh').addEventListener('click', () => enterAuthenticatedApp().catch(error => toast('Falha ao verificar acesso', error.message, 'error')));",
    """    $('#access-refresh').addEventListener('click', async () => {
      const button = $('#access-refresh');
      setBusy(button, true, 'Verificando...');
      try {
        await loadPublicConfig();
        await enterAuthenticatedApp();
        const stillBlocked = !$('#access-screen').classList.contains('hidden');
        if (stillBlocked) toast('Acesso ainda não liberado', 'Os dados foram atualizados. Se houver WhatsApp de suporte configurado, o botão já aparece abaixo.', 'error');
        else toast('Acesso liberado', 'Seu painel já está disponível.');
      } catch (error) {
        toast('Falha ao verificar acesso', error.message, 'error');
      } finally {
        setBusy(button, false);
      }
    });"""
)

# 2) Upload: compactação WEBP antes de enviar e limpeza de upload inválido.
replace_once(
    'payment-ui.js',
    "  const MAX_BYTES = 8 * 1024 * 1024;\n  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);",
    "  const MAX_BYTES = 8 * 1024 * 1024;\n  const MAX_SOURCE_BYTES = 20 * 1024 * 1024;\n  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);"
)

helper = r'''
  async function deleteObject(path, retry = true) {
    const session = readSession();
    const response = await fetch(`${CONFIG.supabaseUrl}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: {
        apikey: CONFIG.supabasePublishableKey,
        Authorization: `Bearer ${session?.access_token || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [path] }),
    });
    if (response.status === 401 && retry && session?.refresh_token) {
      await refreshSession();
      return deleteObject(path, false);
    }
    return parse(response);
  }

  function canvasToWebp(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível compactar a imagem.')), 'image/webp', quality);
    });
  }

  async function compressReceiptImage(file) {
    if (!file.type.startsWith('image/')) return file;
    if (file.size > MAX_SOURCE_BYTES) throw new Error('A imagem original deve ter no máximo 20 MB.');
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Não foi possível ler a imagem do comprovante.'));
        img.src = url;
      });
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) throw new Error('Imagem do comprovante inválida.');
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Seu navegador não conseguiu preparar a imagem.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      let blob = await canvasToWebp(canvas, 0.76);
      if (blob.size > MAX_BYTES) blob = await canvasToWebp(canvas, 0.58);
      if (blob.size > MAX_BYTES) throw new Error('A imagem continuou acima de 8 MB mesmo após a compactação.');
      const base = (file.name || 'comprovante').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100) || 'comprovante';
      return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: Date.now() });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
'''
replace_once('payment-ui.js', "  function notice(title, message = '', type = 'success') {", helper + "\n  function notice(title, message = '', type = 'success') {")

new_submit = r'''  async function submitReceipt() {
    const input = $('#pix-receipt-file');
    const button = $('#pix-receipt-submit');
    const file = input?.files?.[0];
    const companyId = localStorage.getItem(COMPANY_KEY) || '';
    const session = readSession();
    const userId = session?.user?.id || '';
    let uploadedPath = '';

    if (!companyId || !userId) return setMessage('Sua sessão não está pronta. Atualize a página e tente novamente.', 'error');
    if (!file) return setMessage('Selecione a imagem ou PDF do comprovante.', 'error');
    if (!ALLOWED.has(file.type)) return setMessage('Formato inválido. Use JPG, PNG, WEBP ou PDF.', 'error');
    if (file.size <= 0) return setMessage('O arquivo do comprovante está vazio.', 'error');
    if (file.type === 'application/pdf' && file.size > MAX_BYTES) return setMessage('O PDF deve ter no máximo 8 MB.', 'error');

    button.disabled = true;
    button.dataset.oldText = button.textContent;
    try {
      let uploadFile = file;
      if (file.type.startsWith('image/')) {
        button.textContent = 'Compactando...';
        setMessage('Compactando a imagem para WEBP...', 'pending');
        uploadFile = await compressReceiptImage(file);
      }
      if (uploadFile.size <= 0 || uploadFile.size > MAX_BYTES) throw new Error('O comprovante deve ter no máximo 8 MB após a compactação.');

      const safe = (uploadFile.name || 'comprovante').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120);
      uploadedPath = `${companyId}/receipts/${userId}/${crypto.randomUUID()}-${safe}`;
      button.textContent = 'Enviando...';
      setMessage(uploadFile.type === 'image/webp' ? 'Imagem compactada. Enviando comprovante...' : 'Enviando comprovante...', 'pending');
      await uploadObject(uploadedPath, uploadFile);
      await receiptRequest({
        action: 'submit',
        company_id: companyId,
        storage_path: uploadedPath,
        original_name: file.name,
        mime_type: uploadFile.type,
        size_bytes: uploadFile.size,
      });
      uploadedPath = '';
      input.value = '';
      setMessage('Comprovante enviado. Aguardando confirmação do Master.', 'success');
      notice('Salvo com sucesso', file.type.startsWith('image/') ? 'Imagem compactada em WEBP e enviada para análise.' : 'Comprovante enviado para análise.');
      await loadPix();
    } catch (error) {
      if (uploadedPath && Number(error?.status || 0) > 0 && Number(error.status) < 500) {
        deleteObject(uploadedPath).catch(() => {});
      }
      const friendly = /payment_already_settled/i.test(error.message)
        ? 'Este pagamento já foi confirmado.'
        : /pix_not_configured/i.test(error.message)
          ? 'O PIX ainda não foi configurado para esta assinatura.'
          : error.message;
      setMessage(`Não foi possível enviar: ${friendly}`, 'error');
      notice('Erro ao enviar comprovante', friendly, 'error');
    } finally {
      button.disabled = false;
      button.textContent = button.dataset.oldText || 'Enviar comprovante';
    }
  }

  function bind()'''
regex_once('payment-ui.js', r"  async function submitReceipt\(\) \{.*?\n  \}\n\n  function bind\(\)", new_submit)

# Texto visível do limite/compactação.
replace_once(
    'index.html',
    '              <small>JPG, PNG, WEBP ou PDF • máximo 8 MB.</small>',
    '              <small>Imagens são compactadas automaticamente para WEBP • PDF até 8 MB.</small>'
)

# 3) Master: histórico continua mesmo quando o arquivo expira.
replace_once(
    'master-payment.js',
    "    $('#me-receipt-file-name').textContent = currentReceipt.original_name || 'Comprovante';",
    """    $('#me-receipt-file-name').textContent = currentReceipt.original_name || 'Comprovante';
    const fileExpired = Boolean(currentReceipt.file_deleted_at);
    const viewButton = $('#me-receipt-view');
    if (viewButton) {
      viewButton.disabled = fileExpired;
      viewButton.textContent = fileExpired ? 'Arquivo removido' : 'Ver comprovante';
      viewButton.title = fileExpired ? 'O arquivo foi eliminado após o prazo de retenção; o histórico do pagamento foi mantido.' : '';
    }"""
)
regex_once(
    'master-payment.js',
    r"    const review = \$\('#me-receipt-review-note'\);\n    if \(review\) \{.*?\n    \}\n    const pending = currentReceipt.status === 'pending';",
    r'''    const review = $('#me-receipt-review-note');
    if (review) {
      const retention = currentReceipt.file_deleted_at
        ? ` Arquivo removido em ${dateTime(currentReceipt.file_deleted_at)}; histórico preservado.`
        : currentReceipt.purge_after
          ? ` O arquivo será removido automaticamente em ${dateTime(currentReceipt.purge_after)}; o histórico continuará salvo.`
          : '';
      review.textContent = (currentReceipt.status === 'rejected' && currentReceipt.review_notes
        ? `Motivo: ${currentReceipt.review_notes}`
        : currentReceipt.status === 'approved'
          ? `Confirmado em ${dateTime(currentReceipt.reviewed_at)}.`
          : 'O envio do comprovante não libera o acesso até a confirmação do Master.') + retention;
    }
    const pending = currentReceipt.status === 'pending';'''
)
replace_once(
    'master-payment.js',
    "  async function viewReceipt() {\n    if (!currentReceipt?.id) return;",
    """  async function viewReceipt() {
    if (!currentReceipt?.id) return;
    if (currentReceipt.file_deleted_at) {
      statusMessage('O arquivo deste comprovante já foi removido pelo prazo de retenção de 30 dias. O histórico do pagamento permanece salvo.', 'success');
      return;
    }"""
)

print('payment_support_retention_patch_ok')
