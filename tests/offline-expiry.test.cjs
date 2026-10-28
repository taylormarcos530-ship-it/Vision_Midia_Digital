const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync('player.js', 'utf8');

function fn(name) {
  const start = src.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name + ' missing');
  return src.slice(start, src.indexOf('\n  }', start) + 4);
}

const bootClockGrace = /const BOOT_CLOCK_GRACE_MS = ([\d_ *]+);/.exec(src);
assert.ok(bootClockGrace, 'boot grace missing');
const fixedClock = 10 * 60_000;
assert.equal(bootClockGrace[1].replaceAll(' ', ''), '10*60_000');
const issued = Date.parse('2026-10-28T11:40:00.000Z');
const deadline = issued + 24 * 60 * 60 * 1000;
const manifest = {
  generated_at: new Date(issued).toISOString(),
  device: { access_expires_at: new Date(deadline).toISOString() },
};
const c = vm.createContext({ BOOT_CLOCK_GRACE_MS: fixedClock });
vm.runInContext(fn('evaluateCachedAuthorization'), c);
function access(value, wallClock, uptime = 1000, anchor = null) {
  return c.evaluateCachedAuthorization(value, wallClock, uptime, anchor, 0);
}

test('old cache without authorization cannot play offline', () => {
  assert.equal(access({ device: {} }, issued), 'expired');
});
test('invalid offline deadline fails closed', () => {
  assert.equal(access({ generated_at: 'invalid', device: { access_expires_at: 'invalid' } }, issued), 'expired');
});
test('valid lease permits playback until its expiry', () => {
  assert.equal(access(manifest, issued + 1000), 'valid');
  assert.equal(access(manifest, deadline), 'expired');
});
test('clock behind cached server timestamp permits bounded restart cache', () => {
  const clock = Date.parse('2020-01-01T00:00:00.000Z');
  assert.equal(access(manifest, clock), 'clock-grace');
  assert.equal(access(manifest, clock, fixedClock + 1), 'clock-unverified');
});
test('trusted server time recovers playback and enforces expiry', () => {
  const clock = Date.parse('2020-01-01T00:00:00.000Z');
  assert.equal(access(manifest, clock, 2000, { serverTimeMs: issued, monotonicMs: 1000 }), 'valid');
  assert.equal(access(manifest, clock, 24 * 60 * 60 * 1000 + 1000,
    { serverTimeMs: issued, monotonicMs: 1000 }), 'expired');
});
test('expired authorization cannot start playback loop', () => {
  let starts = 0;
  const sandbox = vm.createContext({
    state: { running: false },
    enforceLocalAccess: () => true,
    playbackLoop: () => { starts++; return Promise.resolve(); },
    console,
  });
  vm.runInContext(fn('ensurePlaybackLoop'), sandbox);
  sandbox.ensurePlaybackLoop();
  assert.equal(starts, 0);
});
test('a real server 403 always overrides the clock-grace cache', () => {
  const index = src.indexOf('  function enforceLocalAccess()');
  assert.ok(index >= 0);
  const code = src.slice(index, src.indexOf('\n  }', index) + 4);
  assert.match(code, /if \(state\.serverAccessDenied\) return true/);
  assert.match(src, /state\.serverAccessDenied = true;\s*showAccessBlocked\(error\)/);
});
test('the player retries time validation without requiring manual verification', () => {
  assert.match(src, /state\.clockRecoveryTimer = setInterval\(/);
  assert.match(src, /void runBackgroundPoll\(syncManifest\)/);
  assert.match(src, /state\.clockAnchor = \{ serverTimeMs: Date\.parse\(manifest\.generated_at\)/);
});

const gateway = fs.readFileSync('supabase/functions/device-gateway/index.ts', 'utf8');
function gatewayFn(name) {
  const start = gateway.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' missing');
  return gateway.slice(start, gateway.indexOf('\n}', start) + 2);
}
test('server limits offline permission to paid deadline or 24 hours', () => {
  const context = vm.createContext({ Date });
  vm.runInContext(gatewayFn('offlineAccessDeadline'), context);
  const now = Date.parse('2026-10-08T19:00:00Z');
  assert.equal(context.offlineAccessDeadline(
    { access_expires_at: null }, { status: 'active', current_period_end: '2026-10-08T20:00:00Z' }, now
  ), '2026-10-08T20:00:00.000Z');
  assert.equal(context.offlineAccessDeadline({}, { status: 'active', current_period_end: null }, now),
    '2026-10-09T19:00:00.000Z');
  assert.equal(context.offlineAccessDeadline({}, {
    status: 'trialing', trial_ends_at: '2026-10-08T19:30:00Z'
  }, now), '2026-10-08T19:30:00.000Z');
});
test('test without a deadline is blocked by server', () => {
  const context = vm.createContext({ Date });
  vm.runInContext(gatewayFn('accountSubscriptionBlock'), context);
  assert.equal(context.accountSubscriptionBlock({
    status: 'active'
  }, { status: 'trialing', trial_ends_at: null }).reason, 'trial_expired');
});
test('server denial removes reusable saved permission', () => {
  let saved = 'old';
  const nodes = new Map();
  const state = { manifest: { device: { access_expires_at: '2099-01-01' } }, playlistNonce: 0 };
  const context = vm.createContext({
    state, Date, MANIFEST_KEY: 'm', writeJson: (k, value) => saved = value,
    clearCurrentObjectUrl() {}, replaceNodeChildren() {},
    $: selector => {
      if (!nodes.has(selector)) nodes.set(selector, {
        classList: { add() {}, remove() {} },
      });
      return nodes.get(selector);
    },
  });
  vm.runInContext(fn('showAccessBlocked'), context);
  context.showAccessBlocked({ error: 'account_suspended', reason: 'subscription_expired' });
  assert.equal(saved, null);
  assert.equal(state.manifest, null);
});
