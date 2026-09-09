(() => {
  'use strict';

  const CONFIG = window.VISION_CONFIG;
  const SESSION_KEY = 'vision_midia_session_v1';
  let activeCompanyId = null;
  let currentReceipt = null;
  let lastMasterStatus = null;

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

  async function edge(name, body, retry = true) {
    const session = readSession();
    const response = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${name}`, {
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
      return edge(name, body, false);
    }
    return parse(response);
  }

  function statusMessage(message = '', type = '') {
    const el = $('#me-status');
    if (!el) return;
    el.textContent = message;
    el.className = `form-status ${type}`.trim();
    el.classList.toggle('hidden', !message);
  }

  function toast(title, message = '', type = 'success') {
    const root = $('#master-toast-root');
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

  function resetPreview() {
    const box = $('#me-receipt-preview');
    const img = $('#me-receipt-image');
    const pdf = $('#me-receipt-pdf');
    if (box) box.classList.add('hidden');
    if (img) { img.classList.add('hidden'); img.removeAttribute('src'); }
    if (pdf) { pdf.classList.add('hidden'); pdf.removeAttribute('src'); }
  }

  function renderReceipt(data) {
    lastMasterStatus = data || null;
    currentReceipt = data?.receipt || null;
    const box = $('#me-receipt-box');
    if (!box) return;
    resetPreview();
    if (!currentReceipt) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const labels = { pending: 'Aguardando análise', approved: 'Aprovado', rejected: 'Recusado' };
    $('#me-receipt-state').textContent = labels[currentReceipt.status] || currentReceipt.status || '—';
    $('#me-receipt-date').textContent = dateTime(currentReceipt.submitted_at);
    $('#me-receipt-amount').textContent = money(currentReceipt.amount_cents ?? data.amount_cents);
    $('#me-receipt-file-name').textContent = currentReceipt.original_name || 'Comprovante';
    const fileExpired = Boolean(currentReceipt.file_deleted_at);
    const viewButton = $('#me-receipt-view');
    if (viewButton) {
      viewButton.disabled = fileExpired;
      viewButton.textContent = fileExpired ? 'Arquivo removido' : 'Ver comprovante';
      viewButton.title = fileExpired ? 'O arquivo foi eliminado após o prazo de retenção; o histórico do pagamento foi mantido.' : '';
    }
    const review = $('#me-receipt-review-note');
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
    const pending = currentReceipt.status === 'pending';
    $('#me-receipt-approve')?.classList.toggle('hidden', !pending);
    $('#me-receipt-reject')?.classList.toggle('hidden', !pending);
  }

  async function loadCompanyPayment() {
    const dialog = $('#master-company-dialog');
    const companyId = $('#me-company-id')?.value || '';
    if (!dialog?.open || !companyId) return;
    activeCompanyId = companyId;
    try {
      const [dashboard, receiptStatus] = await Promise.all([
        edge('master-admin', { action: 'dashboard' }),
        edge('payment-receipt', { action: 'master_status', company_id: companyId }),
      ]);
      if (activeCompanyId !== companyId) return;
      const company = (dashboard?.companies || []).find((c) => c.id === companyId);
      const sub = company?.subscription || {};
      $('#me-pix-key-type').value = sub.pix_key_type || 'other';
      $('#me-pix-key').value = sub.pix_key || '';
      $('#me-pix-name').value = sub.pix_receiver_name || '';
      $('#me-pix-city').value = sub.pix_receiver_city || '';
      renderReceipt(receiptStatus);
    } catch (error) {
      console.warn('Pagamento Master:', error);
      statusMessage(`❌ Não foi possível carregar os dados de pagamento: ${error.message}`, 'error');
    }
  }

  function validatePix(event) {
    const key = $('#me-pix-key')?.value.trim() || '';
    if (!key) return;
    const name = $('#me-pix-name')?.value.trim() || '';
    const city = $('#me-pix-city')?.value.trim() || '';
    const bytes = new TextEncoder().encode(key).length;
    if (bytes > 77) {
      event.preventDefault();
      event.stopImmediatePropagation();
      statusMessage('❌ A chave PIX está acima do limite permitido para o QR Code. Use no máximo 77 bytes.', 'error');
      $('#me-pix-key')?.focus();
      return;
    }
    if (!name || !city) {
      event.preventDefault();
      event.stopImmediatePropagation();
      statusMessage('❌ Para usar PIX, informe o nome do recebedor e a cidade.', 'error');
      (!name ? $('#me-pix-name') : $('#me-pix-city'))?.focus();
    }
  }

  async function viewReceipt() {
    if (!currentReceipt?.id) return;
    if (currentReceipt.file_deleted_at) {
      statusMessage('O arquivo deste comprovante já foi removido pelo prazo de retenção de 30 dias. O histórico do pagamento permanece salvo.', 'success');
      return;
    }
    const button = $('#me-receipt-view');
    if (button) { button.disabled = true; button.textContent = 'Abrindo...'; }
    try {
      const data = await edge('payment-receipt', { action: 'master_signed_url', receipt_id: currentReceipt.id });
      if (!data?.url) throw new Error('Não foi possível gerar a visualização temporária.');
      const box = $('#me-receipt-preview');
      const img = $('#me-receipt-image');
      const pdf = $('#me-receipt-pdf');
      box?.classList.remove('hidden');
      if (String(data.mime_type || '').startsWith('image/')) {
        img.src = data.url;
        img.classList.remove('hidden');
        pdf?.classList.add('hidden');
      } else {
        pdf.src = data.url;
        pdf.classList.remove('hidden');
        img?.classList.add('hidden');
      }
    } catch (error) {
      statusMessage(`❌ Não foi possível abrir o comprovante: ${error.message}`, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Ver comprovante'; }
    }
  }

  async function approveReceipt() {
    if (!currentReceipt?.id || !activeCompanyId) return;
    const due = $('#me-due-date')?.value || '';
    if (!due) {
      statusMessage('❌ Informe e salve o vencimento antes de aprovar o comprovante.', 'error');
      $('#me-due-date')?.focus();
      return;
    }
    if (!lastMasterStatus?.current_period_end || String(lastMasterStatus.current_period_end).slice(0, 10) !== due) {
      statusMessage('❌ Salve as alterações da assinatura antes de aprovar o comprovante.', 'error');
      $('#me-save')?.focus();
      return;
    }
    if (!confirm('Confirmar este comprovante e liberar o acesso do cliente?')) return;
    const button = $('#me-receipt-approve');
    if (button) { button.disabled = true; button.textContent = 'Confirmando...'; }
    try {
      await edge('payment-receipt', { action: 'master_review', receipt_id: currentReceipt.id, decision: 'approved' });
      $('#me-company-status').value = 'active';
      $('#me-sub-status').value = 'active';
      $('#me-payment-status').value = 'paid';
      statusMessage('✅ Pagamento aprovado e acesso liberado.', 'success');
      toast('Salvo com sucesso', 'Comprovante aprovado e acesso liberado.');
      $('#master-refresh')?.click();
      await loadCompanyPayment();
    } catch (error) {
      const message = /due_date_required/i.test(error.message)
        ? 'Informe e salve o vencimento antes de aprovar.'
        : /due_date_expired/i.test(error.message)
          ? 'O vencimento salvo já expirou. Atualize e salve uma nova data antes de aprovar.'
          : error.message;
      statusMessage(`❌ ${message}`, 'error');
      toast('Erro ao confirmar pagamento', message, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Aprovar e liberar'; }
    }
  }

  async function rejectReceipt() {
    if (!currentReceipt?.id) return;
    const reason = prompt('Motivo da recusa (opcional):', '') ?? null;
    if (reason === null) return;
    const button = $('#me-receipt-reject');
    if (button) { button.disabled = true; button.textContent = 'Recusando...'; }
    try {
      await edge('payment-receipt', { action: 'master_review', receipt_id: currentReceipt.id, decision: 'rejected', notes: reason.trim() });
      statusMessage('✅ Comprovante recusado. O cliente poderá enviar outro.', 'success');
      toast('Salvo com sucesso', 'Comprovante recusado.');
      await loadCompanyPayment();
    } catch (error) {
      statusMessage(`❌ Não foi possível recusar: ${error.message}`, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Recusar comprovante'; }
    }
  }

  function bind() {
    $('#master-company-form')?.addEventListener('submit', validatePix, true);
    $('#me-receipt-view')?.addEventListener('click', viewReceipt);
    $('#me-receipt-approve')?.addEventListener('click', approveReceipt);
    $('#me-receipt-reject')?.addEventListener('click', rejectReceipt);
    const dialog = $('#master-company-dialog');
    if (dialog) {
      new MutationObserver(() => {
        if (dialog.open) setTimeout(loadCompanyPayment, 40);
        else { activeCompanyId = null; currentReceipt = null; lastMasterStatus = null; resetPreview(); }
      }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
