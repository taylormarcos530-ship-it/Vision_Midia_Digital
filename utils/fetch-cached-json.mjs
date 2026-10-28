/* Vision: reusable offline-safe JSON fetch. No production integration by default. */
export async function fetchCachedJson(url, {
  cacheKey,
  ttlMs = 3 * 60 * 60 * 1000,
  timeoutMs = 10000,
  validate = value => value !== null && typeof value === 'object',
  storage = globalThis.localStorage,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!cacheKey) throw new Error('cacheKey is required');
  const read = () => {
    try {
      const item = JSON.parse(storage.getItem(cacheKey) || 'null');
      return item && validate(item.value) && Number.isFinite(item.savedAt) ? item : null;
    } catch { return null; }
  };
  const cached = read();
  const now = Date.now();
  if (cached && now - cached.savedAt >= 0 && now - cached.savedAt < ttlMs) {
    return { value: cached.value, source: 'cache', stale: false };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const value = await response.json();
    if (!validate(value)) throw new Error('Invalid response data');
    try { storage.setItem(cacheKey, JSON.stringify({ value, savedAt: Date.now() })); } catch {}
    return { value, source: 'network', stale: false };
  } catch (error) {
    if (cached) return { value: cached.value, source: 'cache', stale: true };
    return { value: null, source: 'unavailable', stale: true, error: String(error?.message || error) };
  } finally {
    clearTimeout(timeout);
  }
}
