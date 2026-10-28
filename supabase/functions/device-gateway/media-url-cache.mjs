// A bounded, per-Edge-isolate cache for media URLs already authorized by device-gateway.
// It does not cache device authentication, subscription status, manifests, or permissions.
// Supabase signed URLs remain valid for six hours, but we reuse them for only 30 minutes.
// Cache entries are tenant- and asset-scoped and expire early; a changed asset.updated_at
// changes its cache key. The cache is intentionally ephemeral, never a persistence layer.
export function createMediaSignedUrlResolver({
  reuseMs = 30 * 60 * 1000,
  signedUrlSeconds = 6 * 60 * 60,
  maxEntries = 256,
  clock = Date.now,
} = {}) {
  if (!Number.isFinite(reuseMs) || reuseMs <= 0 || reuseMs >= signedUrlSeconds * 1000) {
    throw new Error('Signed URL cache must expire before the signed URL');
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('Invalid cache capacity');

  const cached = new Map();
  const pending = new Map();

  return async function signedUrlForAsset(admin, companyId, asset) {
    if (!companyId || !asset?.id || !asset?.storage_path) {
      throw new Error('Cannot sign an asset without a tenant, id, and path');
    }
    // Avoid reusing a URL across tenants, replacements, or modified asset records.
    const key = JSON.stringify([companyId, asset.id, asset.storage_path, asset.updated_at ?? null]);
    const now = clock();
    const saved = cached.get(key);
    if (saved && saved.expiresAt > now) {
      cached.delete(key); // LRU refresh; evict the least recently used entry first.
      cached.set(key, saved);
      return { data: { signedUrl: saved.url }, error: null };
    }
    if (saved) cached.delete(key);
    if (pending.has(key)) return pending.get(key);

    const job = (async () => {
      const result = await admin.storage.from('vision-media')
        .createSignedUrl(asset.storage_path, signedUrlSeconds);
      if (!result.error && typeof result.data?.signedUrl === 'string' && result.data.signedUrl) {
        cached.set(key, { url: result.data.signedUrl, expiresAt: clock() + reuseMs });
        while (cached.size > maxEntries) cached.delete(cached.keys().next().value);
      }
      return result; // Preserve the original SDK response and error semantics.
    })();

    pending.set(key, job);
    try {
      return await job;
    } finally {
      if (pending.get(key) === job) pending.delete(key);
    }
  };
}
