const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'player.js'), 'utf8');
const start = source.indexOf('  const BACKGROUND_POLL_INTERVALS = Object.freeze(');
const end = source.indexOf('  function replaceNodeChildren(', start);

function harness() {
  assert.ok(start >= 0 && end > start, 'background scheduler must exist');
  let now = 1_000_000;
  const context = vm.createContext({
    state: { deviceToken: 'test-device-token' },
    navigator: { onLine: true },
    Date: { now: () => now },
    isAccessError: (error) => error?.accessDenied === true,
  });
  vm.runInContext(source.slice(start, end) +
    '\nthis.policy = { runBackgroundPoll, backgroundPollState, BACKGROUND_POLL_INTERVALS };', context);
  return {
    policy: context.policy,
    setTime(value) { now = value; },
    now() { return now; },
    setOnline(value) { context.navigator.onLine = value; },
    clearToken() { context.state.deviceToken = null; },
  };
}

test('normal polling intervals lower repeated calls without touching local expiry checks', () => {
  const { policy } = harness();
  assert.equal(policy.BACKGROUND_POLL_INTERVALS.heartbeat, 120_000);
  assert.equal(policy.BACKGROUND_POLL_INTERVALS.manifest, 120_000);
  assert.equal(policy.BACKGROUND_POLL_INTERVALS.commands, 45_000);
  assert.match(source, /state\.accessTimer = setInterval\(\(\) => enforceLocalAccess\(\), 1000\)/);
  assert.match(source, /if \(state\.manifest && !localAccessExpired\(\)\) ensurePlaybackLoop\(\)/);
});

test('background polling is single-flight across jobs', async () => {
  const { policy } = harness();
  let release;
  const active = policy.runBackgroundPoll(() => new Promise((resolve) => { release = resolve; }));
  assert.equal(policy.backgroundPollState.inFlight, true);
  let secondTaskCalls = 0;
  assert.equal(await policy.runBackgroundPoll(() => { secondTaskCalls++; }), false);
  assert.equal(secondTaskCalls, 0);
  release();
  assert.equal(await active, true);
  assert.equal(policy.backgroundPollState.inFlight, false);
});

test('transient server errors trigger exponential cooldown and suppress further requests', async () => {
  const h = harness();
  const { policy } = h;
  const fail = () => Promise.reject({ status: 504 });
  assert.equal(await policy.runBackgroundPoll(fail), false);
  const firstDelay = policy.backgroundPollState.retryAt - h.now();
  assert.ok(firstDelay >= 15_000 && firstDelay < 18_000);
  let skippedCalls = 0;
  assert.equal(await policy.runBackgroundPoll(() => { skippedCalls++; }), false);
  assert.equal(skippedCalls, 0);
  h.setTime(policy.backgroundPollState.retryAt + 1);
  assert.equal(await policy.runBackgroundPoll(fail), false);
  const secondDelay = policy.backgroundPollState.retryAt - h.now();
  assert.ok(secondDelay >= 30_000 && secondDelay < 33_000);
});

test('repeated failures are capped near five minutes and success clears cooldown', async () => {
  const h = harness();
  const { policy } = h;
  for (let n = 0; n < 9; n++) {
    assert.equal(await policy.runBackgroundPoll(() => Promise.reject({ status: 522 })), false);
    const delay = policy.backgroundPollState.retryAt - h.now();
    assert.ok(delay >= 15_000 && delay < 303_000, 'bounded exponential backoff');
    h.setTime(policy.backgroundPollState.retryAt + 1);
  }
  assert.equal(policy.backgroundPollState.failures, 7);
  assert.equal(await policy.runBackgroundPoll(async () => {}), true);
  assert.equal(policy.backgroundPollState.failures, 0);
  assert.equal(policy.backgroundPollState.retryAt, 0);
});

test('auth errors, offline mode and absent token do not create retry storms', async () => {
  const h = harness();
  const { policy } = h;
  assert.equal(await policy.runBackgroundPoll(() => Promise.reject({ status: 401 })), false);
  assert.equal(policy.backgroundPollState.retryAt, 0);
  assert.equal(await policy.runBackgroundPoll(() => Promise.reject({ status: 403, accessDenied: true })), false);
  assert.equal(policy.backgroundPollState.retryAt, 0);
  h.setOnline(false);
  assert.equal(await policy.runBackgroundPoll(async () => { throw Error('unexpected'); }), false);
  h.setOnline(true);
  h.clearToken();
  assert.equal(await policy.runBackgroundPoll(async () => { throw Error('unexpected'); }), false);
});

test('pairing also backs off after errors without changing valid linking flow', () => {
  assert.match(source, /let temporaryFailures = 0;/);
  assert.match(source, /temporaryFailures = Math\.min\(5, temporaryFailures \+ 1\)/);
  assert.match(source, /Math\.min\(30_000, 3_000 \* 2 \*\* \(temporaryFailures - 1\)\)/);
  assert.match(source, /if \(result\.status === 'issued' && result\.device_token\)/);
});
