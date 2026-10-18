import { applyTemplateRegions, TEMPLATE_01 } from './menu-template.mjs';
import {
  createState, currentProducts, nextPage, setIntervalSeconds, addProduct,
  editProduct, deleteProduct, moveProduct, parsePrice, formatPrice,
  normalizeName, parseSavedState, DEFAULT_STORE_KEY,
} from './menu-data.mjs';

const $ = id => document.getElementById(id);
const board = $('tv-canvas');
const video = $('menu-video'); // Single, permanent <video> element. Never recreated during price changes.
const videoPlaceholder = $('video-placeholder');
const productOverlay = $('tv-products');
const editorList = $('product-edit-list');
const videoInfo = $('video-info');
const slots = [];
let state = createState();
let pageTimer = null;
let currentVideoSource = '';
let ownedVideoUrl = null;
let ownedLogoUrl = null;
let activeLogoUrl = null;
let sourceChanges = 0;
let videoChanges = 0;
let pageTransitions = 0;

function notify(message, isError = false) {
  const el = $('preview-message');
  el.textContent = message;
  el.style.color = isError ? '#ff9797' : '';
}

function createLocalId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `lab-${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function setupSlots() {
  for (let i = 0; i < TEMPLATE_01.maxVisibleProducts; i++) {
    const row = make('div', 'tv-product-row');
    const name = make('span', 'tv-product-name');
    const price = make('span', 'tv-product-price');
    const currency = make('span', 'tv-currency', 'R$');
    const amount = make('span', 'tv-amount');
    const unit = make('span', 'tv-unit', '/kg');
    price.append(currency, amount, unit);
    row.append(name, price);
    productOverlay.append(row);
    slots.push({ row, name, amount });
  }
}

function renderBoardProducts() {
  const products = currentProducts(state);
  slots.forEach(({ row, name, amount }, i) => {
    const product = products[i];
    row.classList.toggle('empty', !product);
    name.textContent = product?.name || '';
    amount.textContent = product ? formatPrice(product.priceCents) : '';
  });
  $('product-count').textContent = `${state.products.filter(p => p.enabled).length} ativos`;
}

function renderEditorProducts() {
  const fragment = document.createDocumentFragment();
  for (const product of state.products) {
    const row = make('div', `product-edit-row${product.enabled ? '' : ' is-disabled'}`);
    row.dataset.productId = product.id;
    const name = make('input');
    name.type = 'text'; name.maxLength = 48; name.value = product.name; name.setAttribute('aria-label', 'Nome do produto'); name.dataset.field = 'name';
    const price = make('input');
    price.type = 'text'; price.inputMode = 'decimal'; price.value = formatPrice(product.priceCents); price.setAttribute('aria-label', 'Preço em reais'); price.dataset.field = 'price';
    const tools = make('div', 'product-tools');
    const actions = [['toggle', product.enabled ? '✓' : '○', 'Ativar ou desativar'], ['up', '↑', 'Subir'], ['down', '↓', 'Descer'], ['delete', '×', 'Excluir']];
    for (const [action, text, title] of actions) {
      const button = make('button', action === 'delete' ? 'delete-button' : '', text);
      button.type = 'button'; button.dataset.action = action; button.title = title; button.setAttribute('aria-label', title);
      tools.append(button);
    }
    row.append(name, price, tools);
    fragment.append(row);
  }
  editorList.replaceChildren(fragment);
  renderBoardProducts();
}

function resetTimer() {
  if (pageTimer !== null) clearInterval(pageTimer);
  pageTimer = setInterval(advanceProducts, state.intervalSeconds * 1000);
}

function advanceProducts() {
  const before = state.pageIndex;
  state = nextPage(state);
  pageTransitions++;
  renderBoardProducts(); // Does not touch the video, its src, or the DOM outside product rows.
  if (before !== state.pageIndex) notify('Produtos alternados; o vídeo continua sem reiniciar.');
}

function renderName() {
  $('logo-store-name').textContent = state.storeName.toLocaleUpperCase('pt-BR').replace(/^CASA DE CARNES\s*/i, '') || state.storeName;
  $('store-name').value = state.storeName;
}

function clearLogo() {
  $('logo-image').removeAttribute('src');
  $('logo-image').classList.add('hidden');
  $('logo-default').classList.remove('hidden');
  if (ownedLogoUrl) URL.revokeObjectURL(ownedLogoUrl);
  ownedLogoUrl = null;
  activeLogoUrl = null;
  $('logo-upload').value = '';
}

function setLogo(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('Use PNG, JPG ou WebP de até 5 MB.');
  }
  const url = URL.createObjectURL(file);
  const old = ownedLogoUrl;
  ownedLogoUrl = url;
  activeLogoUrl = url;
  const image = $('logo-image');
  image.src = url;
  image.classList.remove('hidden');
  $('logo-default').classList.add('hidden');
  if (old) URL.revokeObjectURL(old);
}

async function setVideoSource(source, ownedUrl = null) {
  if (source === currentVideoSource) {
    if (ownedUrl && ownedUrl !== ownedVideoUrl) URL.revokeObjectURL(ownedUrl);
    return false;
  }
  video.pause();
  if (source) video.src = source;
  else video.removeAttribute('src');
  currentVideoSource = source;
  sourceChanges++;
  videoChanges++;
  const old = ownedVideoUrl;
  ownedVideoUrl = ownedUrl;
  if (old && old !== ownedUrl) URL.revokeObjectURL(old);
  videoPlaceholder.classList.toggle('hidden', Boolean(source));
  if (source) {
    video.load();
    try {
      await video.play();
      notify('Vídeo carregado. A tabela funciona independentemente.');
    } catch {
      notify('Vídeo carregado. Toque na prévia para iniciar caso o navegador bloqueie autoplay.');
    }
  }
  return true;
}

async function pickVideoFile(file) {
  if (!file) return;
  if (!['video/mp4', 'video/webm', 'video/ogg'].includes(file.type) || file.size > 150 * 1024 * 1024) {
    throw new Error('Use MP4/WebM/Ogg de até 150 MB (somente local).');
  }
  const url = URL.createObjectURL(file);
  await setVideoSource(url, url);
  videoInfo.textContent = `${file.name} · arquivo local, sem upload`;
}

function saveDraft() {
  try {
    localStorage.setItem(DEFAULT_STORE_KEY, JSON.stringify({
      products: state.products, intervalSeconds: state.intervalSeconds, storeName: state.storeName,
    }));
    notify('Rascunho salvo neste navegador (sem Supabase).');
  } catch { notify('Não foi possível salvar neste navegador.', true); }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DEFAULT_STORE_KEY);
    if (raw) state = parseSavedState(JSON.parse(raw));
  } catch {
    state = createState();
    notify('Rascunho inválido ignorado; usando dados de teste.', true);
  }
}

function withErrorFeedback(callback) {
  try { return callback(); }
  catch (error) { notify(error?.message || 'Operação inválida', true); return null; }
}

function bindEvents() {
  editorList.addEventListener('change', event => {
    const input = event.target;
    const id = input.closest('[data-product-id]')?.dataset.productId;
    if (!id || !input.dataset.field) return;
    const changed = withErrorFeedback(() => input.dataset.field === 'name'
      ? editProduct(state, id, { name: input.value })
      : editProduct(state, id, { priceCents: parsePrice(input.value) }));
    if (changed) { state = changed; renderEditorProducts(); }
  });
  editorList.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    const id = button?.closest('[data-product-id]')?.dataset.productId;
    if (!id) return;
    const action = button.dataset.action;
    if (action === 'toggle') state = editProduct(state, id, { enabled: !state.products.find(p => p.id === id).enabled });
    else if (action === 'up') state = moveProduct(state, id, -1);
    else if (action === 'down') state = moveProduct(state, id, 1);
    else if (action === 'delete') state = deleteProduct(state, id);
    renderEditorProducts();
  });
  $('add-product-form').addEventListener('submit', event => {
    event.preventDefault();
    const changed = withErrorFeedback(() => addProduct(state, {
      id: createLocalId(), name: $('new-name').value, priceCents: parsePrice($('new-price').value),
    }));
    if (changed) { state = changed; renderEditorProducts(); event.target.reset(); }
  });
  $('interval-select').addEventListener('change', event => {
    state = setIntervalSeconds(state, event.target.value);
    resetTimer();
    notify(`Troca configurada para ${state.intervalSeconds} segundos.`);
  });
  $('store-name').addEventListener('change', event => {
    const name = withErrorFeedback(() => normalizeName(event.target.value));
    if (name) { state.storeName = name; renderName(); }
  });
  $('logo-upload').addEventListener('change', event => withErrorFeedback(() => setLogo(event.target.files?.[0])));
  $('clear-logo').addEventListener('click', clearLogo);
  $('video-upload').addEventListener('change', async event => {
    try { await pickVideoFile(event.target.files?.[0]); }
    catch (error) { notify(error.message, true); }
  });
  $('demo-video').addEventListener('click', async () => {
    await setVideoSource('./fixtures/demo.webm');
    videoInfo.textContent = 'Vídeo de teste embutido · reprodução local';
  });
  $('remove-video').addEventListener('click', async () => {
    await setVideoSource('');
    videoInfo.textContent = 'Nenhum vídeo selecionado.';
  });
  $('audio-enabled').addEventListener('change', event => { video.muted = !event.target.checked; });
  $('next-group').addEventListener('click', advanceProducts);
  $('fullscreen').addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('.preview-section').requestFullscreen();
  });
  $('save-draft').addEventListener('click', saveDraft);
  $('reset-demo').addEventListener('click', () => {
    state = createState();
    try { localStorage.removeItem(DEFAULT_STORE_KEY); } catch {}
    clearLogo(); renderEditorProducts(); renderName(); $('interval-select').value = String(state.intervalSeconds);
    resetTimer(); notify('Dados fictícios restaurados.');
  });
  video.addEventListener('error', () => { if (currentVideoSource) notify('Não foi possível reproduzir este vídeo; escolha outro formato.', true); });
  video.addEventListener('click', () => { if (video.paused && currentVideoSource) video.play().catch(() => {}); });
  window.addEventListener('beforeunload', () => {
    if (ownedVideoUrl) URL.revokeObjectURL(ownedVideoUrl);
    if (ownedLogoUrl) URL.revokeObjectURL(ownedLogoUrl);
  });
}

applyTemplateRegions(board);
setupSlots();
restoreDraft();
renderName();
renderEditorProducts();
$('interval-select').value = String(state.intervalSeconds);
bindEvents();
resetTimer();

// Read-only inspection API used exclusively by isolated browser tests.
Object.defineProperty(window, '__VISION_MENU_LAB__', {
  value: Object.freeze({
    inspect: () => ({ pageIndex: state.pageIndex, intervalSeconds: state.intervalSeconds,
      products: state.products.map(p => ({ ...p })), videoNode: video,
      videoSrc: video.getAttribute('src'), sourceChanges, videoChanges,
      pageTransitions, renderedRows: slots.filter(s => !s.row.classList.contains('empty')).length }),
    advance: advanceProducts,
  }),
});
