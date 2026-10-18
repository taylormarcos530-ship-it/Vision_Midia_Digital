import { SAMPLE_PRODUCTS } from './fixtures/products.mjs';

export const PAGE_SIZE = 8;
export const INTERVALS = Object.freeze([5, 10, 15]);
export const DEFAULT_STORE_KEY = 'vision-menu-lab-demo-v1';

export function normalizeName(name) {
  const value = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!value || value.length > 48) throw new RangeError('Nome: 1 a 48 caracteres');
  return value;
}

export function parsePrice(value) {
  const str = String(value ?? '').trim();
  if (!/^(?:\d{1,6}(?:[.,]\d{1,2})?)$/.test(str)) throw new RangeError('Preço inválido');
  const [integer, decimals = ''] = str.replace(',', '.').split('.');
  const cents = Number(integer) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 99999999) throw new RangeError('Preço fora do limite');
  return cents;
}

export function formatPrice(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('Preço inválido');
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function copyProduct(p) {
  return { id: p.id, name: normalizeName(p.name), priceCents: p.priceCents, enabled: p.enabled !== false };
}

export function createState(products = SAMPLE_PRODUCTS) {
  return { products: products.map(copyProduct), intervalSeconds: 10, pageIndex: 0, storeName: 'Casa de Carnes Bom Sabor' };
}

export function visibleGroups(products, pageSize = PAGE_SIZE) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('Tamanho inválido');
  const active = products.filter(p => p.enabled);
  const groups = [];
  for (let i = 0; i < active.length; i += pageSize) groups.push(active.slice(i, i + pageSize));
  return groups.length ? groups : [[]];
}

export function currentProducts(state) {
  const groups = visibleGroups(state.products);
  return groups[((state.pageIndex % groups.length) + groups.length) % groups.length];
}

export function nextPage(state) {
  const groups = visibleGroups(state.products);
  return { ...state, pageIndex: (state.pageIndex + 1) % groups.length };
}

export function setIntervalSeconds(state, seconds) {
  const interval = Number(seconds);
  if (!INTERVALS.includes(interval)) throw new RangeError('Intervalo não permitido');
  return { ...state, intervalSeconds: interval };
}

export function addProduct(state, { name, priceCents, id }) {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > 99999999) throw new RangeError('Preço inválido');
  if (!id || state.products.some(p => p.id === id)) throw new Error('ID duplicado ou ausente');
  return { ...state, products: [...state.products, { id, name: normalizeName(name), priceCents, enabled: true }] };
}

export function editProduct(state, id, patch) {
  if (!state.products.some(p => p.id === id)) throw new Error('Produto não encontrado');
  const products = state.products.map(p => {
    if (p.id !== id) return p;
    const updated = { ...p };
    if ('name' in patch) updated.name = normalizeName(patch.name);
    if ('priceCents' in patch) {
      if (!Number.isSafeInteger(patch.priceCents) || patch.priceCents < 0 || patch.priceCents > 99999999) throw new RangeError('Preço inválido');
      updated.priceCents = patch.priceCents;
    }
    if ('enabled' in patch) updated.enabled = patch.enabled === true;
    return updated;
  });
  return { ...state, pageIndex: 0, products };
}

export function deleteProduct(state, id) {
  return { ...state, pageIndex: 0, products: state.products.filter(p => p.id !== id) };
}

export function moveProduct(state, id, delta) {
  const products = [...state.products];
  const from = products.findIndex(p => p.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= products.length) return state;
  [products[from], products[to]] = [products[to], products[from]];
  return { ...state, pageIndex: 0, products };
}

export function parseSavedState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.products) || raw.products.length > 300) throw new Error('Rascunho inválido');
  const ids = new Set();
  const state = createState([]);
  for (const p of raw.products) {
    if (typeof p.id !== 'string' || p.id.length > 90 || ids.has(p.id)) throw new Error('ID inválido');
    ids.add(p.id);
    state.products.push(copyProduct(p));
    const cents = p.priceCents;
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > 99999999) throw new Error('Preço inválido');
  }
  state.intervalSeconds = INTERVALS.includes(raw.intervalSeconds) ? raw.intervalSeconds : 10;
  state.storeName = normalizeName(raw.storeName || state.storeName);
  return state;
}
