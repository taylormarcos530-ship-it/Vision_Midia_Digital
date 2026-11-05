// Vision V2 experimental, pure queue logic. No network, credentials or production access.
export const MAX_PENDING = 10000;
export const MAX_BATCH = 50;
export const BASE_RETRY_MS = 15000;
export const MAX_RETRY_MS = 300000;
export function validateReceipt(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  if (typeof x.event_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(x.event_id)) return false;
  if (typeof x.media_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(x.media_id)) return false;
  if (typeof x.played_at !== 'string' || !Number.isFinite(Date.parse(x.played_at))) return false;
  if (typeof x.completed !== 'boolean') return false;
  return typeof x.duration_seconds === 'number' && Number.isFinite(x.duration_seconds) && x.duration_seconds >= 0 && x.duration_seconds <= 86400;
}
export function enqueue(queue, receipt, max = MAX_PENDING) {
  if (!Array.isArray(queue) || !validateReceipt(receipt)) throw new TypeError('invalid queue or receipt');
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('invalid capacity');
  if (queue.some(x => x.event_id === receipt.event_id)) return {queue, accepted:false, reason:'duplicate'};
  if (queue.length >= max) return {queue, accepted:false, reason:'capacity'};
  return {queue:[...queue, Object.freeze({...receipt})], accepted:true};
}
export function nextBatch(queue, size = MAX_BATCH) {
  if (!Array.isArray(queue) || !Number.isSafeInteger(size) || size < 1 || size > MAX_BATCH) throw new RangeError('invalid batch');
  return queue.slice(0,size);
}
export function acknowledge(queue, ids) {
  if (!Array.isArray(queue) || !Array.isArray(ids)) throw new TypeError('invalid acknowledgment');
  const known = new Set(queue.map(x=>x.event_id));
  if (ids.some(id=>!known.has(id))) throw new Error('unknown acknowledgment');
  const ack = new Set(ids);
  return queue.filter(x=>!ack.has(x.event_id));
}
export function retryDelay(failures, jitter = 0.5) {
  if (!Number.isSafeInteger(failures) || failures < 0 || typeof jitter !== 'number' || jitter < 0 || jitter > 1) throw new RangeError('invalid retry');
  return Math.round(Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(failures,20)) * (0.75 + 0.5*jitter));
}
