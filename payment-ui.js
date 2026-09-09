(() => {
  'use strict';

  const CONFIG = window.VISION_CONFIG;
  const SESSION_KEY = 'vision_midia_session_v1';
  const COMPANY_KEY = 'vision_midia_company_v1';
  const BUCKET = 'payment-receipts';
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  let loading = false;

  const $ = (s) => document.querySelector(s);
  const money = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
  const dateTime = (v) => {
    if (!v) return '—';
    try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)); }
    catch { return '—'; }
  };

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }

  function saveSession(session) {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  async function parse(response) {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = text; }
    if (!response.ok) {
      const error = new Error(data?.error_description || data?.message || data?.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function refreshSession() {
    const session = readSession();
    if (!session?.refresh_token) return null;
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: CONFIG.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    const data = await parse(response);
    saveSession(data);
    return data;
  }

  async function receiptRequest(body, retry = true) {
    const session = readSession();
    const response = await fetch(`${CONFIG.supabaseUrl}/functions/v1/payment-receipt`, {
      method: 'POST',
      headers: {
        apikey: CONFIG.supabasePublishableKey,
        Authorization: `Bearer ${session?.access_token || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (response.status === 401 && retry && session?.refresh_token) {
      await refreshSession();
      return receiptRequest(body, false);
    }
    return parse(response);
  }

  async function uploadObject(path, file, retry = true) {
    const session = readSession();
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${CONFIG.supabaseUrl}/storage/v1/object/${BUCKET}/${encoded}`, {
      method: 'POST',
      headers: {
        apikey: CONFIG.supabasePublishableKey,
        Authorization: `Bearer ${session?.access_token || ''}`,
        'Content-Type': file.type,
        'x-upsert': 'false',
      },
      body: file,
    });
    if (response.status === 401 && retry && session?.refresh_token) {
      await refreshSession();
      return uploadObject(path, file, false);
    }
    return parse(response);
  }


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

  function notice(title, message = '', type = 'success') {
    const root = $('#toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const strong = document.createElement('strong');
    strong.textContent = title;
    el.appendChild(strong);
    if (message) {
      const span = document.createElement('span');
      span.textContent = message;
      el.appendChild(span);
    }
    root.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }

  function setMessage(text = '', type = '') {
    const el = $('#pix-receipt-status');
    if (!el) return;
    el.textContent = text;
    el.className = `pix-receipt-status ${type}`.trim();
    el.classList.toggle('hidden', !text);
  }

  function receiptLabel(receipt) {
    if (!receipt) return 'Nenhum comprovante enviado.';
    if (receipt.status === 'pending') return `Comprovante enviado em ${dateTime(receipt.submitted_at)}. Aguardando confirmação do Master.`;
    if (receipt.status === 'approved') return `Comprovante aprovado em ${dateTime(receipt.reviewed_at)}.`;
    if (receipt.status === 'rejected') return `Comprovante recusado${receipt.review_notes ? `: ${receipt.review_notes}` : '.'} Envie um novo comprovante.`;
    return 'Comprovante recebido.';
  }

  function render(data) {
    const card = $('#access-pix-card');
    if (!card) return;
    const paymentNeeded = !['paid', 'waived'].includes(data?.payment_status || 'pending');
    if (!paymentNeeded || !data?.pix?.enabled) {
      card.classList.add('hidden');
      return;
    }

    card.classList.remove('hidden');
    $('#pix-amount').textContent = money(data.amount_cents);
    $('#pix-key-display').textContent = data.pix.key || '—';
    $('#pix-copy-code').value = data.pix.payload || '';
    $('#pix-qr').innerHTML = data.pix.qr_svg || '';
    const receipt = data.receipt || null;
    const type = receipt?.status === 'rejected' ? 'error' : receipt?.status === 'pending' ? 'pending' : 'success';
    setMessage(receiptLabel(receipt), receipt ? type : '');
    const send = $('#pix-receipt-submit');
    if (send) send.textContent = receipt?.status === 'rejected' ? 'Enviar novo comprovante' : 'Enviar comprovante';
  }

  async function loadPix() {
    const screen = $('#access-screen');
    const card = $('#access-pix-card');
    if (!screen || !card || screen.classList.contains('hidden') || loading) return;
    const companyId = localStorage.getItem(COMPANY_KEY) || '';
    const session = readSession();
    if (!companyId || !session?.access_token) {
      card.classList.add('hidden');
      return;
    }
    loading = true;
    try {
      const data = await receiptRequest({ action: 'client_status', company_id: companyId });
      render(data);
    } catch (error) {
      card.classList.add('hidden');
      if (!/subscription_not_found|company_forbidden/i.test(String(error.message))) {
        console.warn('PIX status:', error);
      }
    } finally { loading = false; }
  }

  async function copyPix() {
    const input = $('#pix-copy-code');
    const value = input?.value || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      input.focus();
      input.select();
      document.execCommand('copy');
    }
    notice('PIX copiado', 'Cole o código no aplicativo do seu banco.');
  }

  async function submitReceipt() {
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

  function bind() {
    $('#pix-copy-button')?.addEventListener('click', copyPix);
    $('#pix-receipt-submit')?.addEventListener('click', submitReceipt);
    $('#access-refresh')?.addEventListener('click', () => setTimeout(loadPix, 700));
    const screen = $('#access-screen');
    if (screen) new MutationObserver(() => { if (!screen.classList.contains('hidden')) setTimeout(loadPix, 50); }).observe(screen, { attributes: true, attributeFilter: ['class'] });
    loadPix();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
