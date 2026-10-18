/**
 * Vision Menu Digital — pure integration contract (NOT a network API).
 * No imports from the production panel, Player, Supabase, APK or campaign code.
 */
export const MAX_ITEMS = 300;
export const PAGE_SIZE = 8;
export const MODES = Object.freeze(['normal', 'menu_only', 'interleave']);
export const MENU_TEMPLATE = 'butcher-01';
export const ALLOWED_INTERVALS = Object.freeze([5, 10, 15]);
export const WRITER_ROLES = new Set(['owner', 'admin', 'operator']);
export const ALL_ROLES = new Set(['owner', 'admin', 'operator', 'viewer']);

export class MenuContractError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new MenuContractError(code); };
const cleanText = (value, max, field) => {
  if (typeof value !== 'string') fail(`invalid_${field}`);
  const result = value.trim().replace(/\s+/g, ' ');
  if (!result || result.length > max || /[\u0000-\u001f]/.test(result)) fail(`invalid_${field}`);
  return result;
};
const exactKeys = (value, allowed, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) fail(`invalid_${field}`);
};
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function cleanMenuDraft(raw) {
  exactKeys(raw, ['storeName','templateKey','intervalSeconds','logoAssetId','videoAssetId','products'], 'draft');
  if (raw.templateKey !== MENU_TEMPLATE) fail('invalid_template');
  if (!ALLOWED_INTERVALS.includes(raw.intervalSeconds)) fail('invalid_interval');
  if (!Array.isArray(raw.products) || raw.products.length > MAX_ITEMS) fail('invalid_product_count');
  if (raw.logoAssetId !== null && !isUuid(raw.logoAssetId)) fail('invalid_logo_id');
  if (raw.videoAssetId !== null && !isUuid(raw.videoAssetId)) fail('invalid_video_id');
  const seen = new Set();
  const products = raw.products.map((p, position) => {
    exactKeys(p, ['id','name','priceCents','enabled'], 'product');
    if (!isUuid(p.id) || seen.has(p.id)) fail('duplicate_or_invalid_product_id');
    seen.add(p.id);
    if (!Number.isSafeInteger(p.priceCents) || p.priceCents < 0 || p.priceCents > 99999999) fail('invalid_price');
    if (typeof p.enabled !== 'boolean') fail('invalid_enabled');
    return { id:p.id, position, name:cleanText(p.name, 48, 'name'), priceCents:p.priceCents, enabled:p.enabled };
  });
  return {
    templateKey: MENU_TEMPLATE,
    storeName: cleanText(raw.storeName, 120, 'store_name'),
    intervalSeconds:raw.intervalSeconds,
    logoAssetId:raw.logoAssetId,
    videoAssetId:raw.videoAssetId,
    products,
  };
}

export function assertActor(actor, companyId, { write = true } = {}) {
  if (!actor || actor.userId == null || !isUuid(actor.userId)) fail('unauthenticated');
  if (actor.companyId !== companyId || !ALL_ROLES.has(actor.role)) fail('company_access_denied');
  if (actor.active !== true || actor.companyWritable !== true) fail('company_access_blocked');
  if (write && !WRITER_ROLES.has(actor.role)) fail('write_access_denied');
}

export function assertTenantMedia({ companyId, draft, media }) {
  for (const [id, type] of [[draft.logoAssetId,'image'],[draft.videoAssetId,'video']]) {
    if (id === null) continue;
    const asset = media.find(m => m.id === id && m.companyId === companyId && m.type === type && m.status === 'ready' && m.privateStored === true);
    if (!asset) fail(`${type}_asset_not_allowed`);
  }
}

export function getPreviewRows(snapshot, group = 0) {
  const active = snapshot.products.filter(p=>p.enabled);
  const pages = Math.max(1, Math.ceil(active.length / PAGE_SIZE));
  if (!Number.isInteger(group)) fail('invalid_page');
  const index = ((group % pages) + pages) % pages;
  return active.slice(index * PAGE_SIZE, index * PAGE_SIZE + PAGE_SIZE);
}
