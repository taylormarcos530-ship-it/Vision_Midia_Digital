'use strict';

// QA SIMULADO: sem banco, rede ou TV real. Em producao, fila+contador
// precisam ser duraveis em uma UNICA transacao; watermark precisa de
// lock de linha no PostgreSQL e transacao com o resumo diario.
class DurableDeviceQueue {
  constructor(state) {
    this.s = state;
    if (!state.streamId || !state.deviceId || !Array.isArray(state.pending) ||
        !Number.isSafeInteger(state.nextSequence) || !Number.isSafeInteger(state.confirmed) ||
        state.nextSequence < 1 || state.confirmed < 0 || state.nextSequence <= state.confirmed)
      throw Error('invalid_state_repair_required');
  }
  enqueue(event, { failStorage = false } = {}) {
    if (failStorage) throw Error('storage_full');
    const seq = this.s.nextSequence;
    if (!Number.isSafeInteger(seq) || seq < 1) throw Error('invalid_sequence');
    const copy = structuredClone(this.s);
    copy.pending.push({ ...structuredClone(event), sequence: seq });
    copy.nextSequence = seq + 1;
    Object.assign(this.s, copy); // simulacao de transacao duravel
    return seq;
  }
  batch(limit = 50) { return structuredClone(this.s.pending.slice(0, limit)); }
  acknowledge(watermark) {
    if (!Number.isSafeInteger(watermark) || watermark < this.s.confirmed) throw Error('invalid_ack');
    if (watermark > this.s.nextSequence - 1) throw Error('ack_beyond_sent');
    const copy = structuredClone(this.s);
    copy.confirmed = watermark;
    copy.pending = copy.pending.filter(e => e.sequence > watermark);
    Object.assign(this.s, copy);
  }
}
function deviceState(deviceId, streamId) {
  return { deviceId, streamId, nextSequence: 1, confirmed: 0, pending: [] };
}

class SequenceServer {
  constructor() {
    this.devices = new Map();
    this.summaries = new Map();
    this.locks = new Map();
  }
  register(deviceId, token, streamId) {
    if (this.devices.has(deviceId)) throw Error('already_registered');
    this.devices.set(deviceId, { token, streamId, watermark: 0 });
  }
  async receive(deviceId, token, streamId, events, fault) {
    const preceding = this.locks.get(deviceId) || Promise.resolve();
    let release;
    const queued = new Promise(resolve => { release = resolve; });
    this.locks.set(deviceId, queued);
    await preceding;
    try { return this._receive(deviceId, token, streamId, events, fault); }
    finally { release(); if (this.locks.get(deviceId) === queued) this.locks.delete(deviceId); }
  }
  _receive(deviceId, token, streamId, events, fault) {
    const d = this.devices.get(deviceId);
    if (!d || d.token !== token) throw Error('unauthorized');
    if (d.streamId !== streamId) throw Error('stale_stream_repair_required');
    if (!Array.isArray(events) || events.length < 1 || events.length > 50) throw Error('invalid_batch');
    if (fault === 'before_commit') throw Error('server_unavailable');

    let previous = -1;
    for (const e of events) {
      if (!Number.isSafeInteger(e.sequence) || e.sequence < 1 || e.sequence <= previous)
        throw Error('unordered_sequence');
      if (typeof e.mediaId !== 'string' || !e.mediaId || typeof e.completed !== 'boolean' ||
          !Number.isFinite(e.durationSeconds) || e.durationSeconds < 0 || e.durationSeconds > 3600 ||
          typeof e.playedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(e.playedAt) ||
          !Number.isFinite(Date.parse(e.playedAt))) throw Error('invalid_event');
      previous = e.sequence;
    }
    const oldWatermark = d.watermark;
    let next = oldWatermark + 1;
    const fresh = [];
    let duplicates = 0;
    for (const e of events) {
      if (e.sequence <= oldWatermark) { duplicates++; continue; }
      if (e.sequence !== next) throw Error('sequence_gap_retry_from_' + next);
      fresh.push(e);
      next++;
    }
    const revised = new Map(this.summaries);
    for (const e of fresh) {
      // TODO: timezone da empresa e correcao de relogio 1970.
      const key = [deviceId, e.playedAt.slice(0, 10), e.mediaId].join('|');
      const old = revised.get(key) || { starts: 0, completes: 0, seconds: 0 };
      revised.set(key, {
        starts: old.starts + 1,
        completes: old.completes + Number(e.completed),
        seconds: old.seconds + e.durationSeconds
      });
    }
    this.summaries = revised;
    d.watermark = next - 1;
    const ack = { ack: d.watermark, accepted: fresh.length, duplicates, needFrom: d.watermark + 1 };
    if (fault === 'after_commit_before_ack') throw Error('lost_response');
    return ack;
  }
  total() {
    return [...this.summaries.values()].reduce((n, row) => n + row.starts, 0);
  }
}
module.exports = { DurableDeviceQueue, SequenceServer, deviceState };
