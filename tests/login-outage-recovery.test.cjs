const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const master = read('master.js');

function getSpan(text, begin, end) {
  const start = text.indexOf(begin);
  assert.ok(start >= 0, `missing ${begin}`);
  const stop = text.indexOf(end, start + begin.length);
  assert.ok(stop > start, `missing ${end}`);
  return text.slice(start, stop);
}

test('public login is displayed before any async public config request', () => {
  const bootstrap = getSpan(app, '  async function bootstrap() {', '  async function enterAuthenticatedApp()');
  assert.match(bootstrap, /showScreen\('auth'\);\s*loadPublicConfig\(\)\.catch/);
  assert.doesNotMatch(bootstrap, /await loadPublicConfig\(\)/);
});

test('transient backend errors preserve saved sessions in both panels', () => {
  const mainBoot = getSpan(app, '  async function bootstrap() {', '  async function enterAuthenticatedApp()');
  const masterBoot = getSpan(master, '  async function boot(){', '\n  boot();');
  assert.match(mainBoot, /if \(\[401, 403\]\.includes\(error\?\.status\)\) saveSession\(null\)/);
  assert.match(masterBoot, /if\(\[401,403\]\.includes\(e\?\.status\)\)saveSession\(null\)/);
  assert.doesNotMatch(masterBoot, /catch\(e\)\{saveSession\(null\)/);
});

test('login and authentication reads use bounded timeout, writes remain unchanged', () => {
  assert.match(app, /authRequest\(path,[\s\S]*?fetchWithTimeout\(/);
  assert.match(app, /loadPublicConfig\(\)[\s\S]*?timeoutMs: 10000/);
  assert.match(master, /async function auth\(path, body\).*fetchWithTimeout/);
  assert.match(master, /async function master\(body, retry=true\).*\['whoami','dashboard'\]/);
});

test('friendly errors identify timeout without suggesting password replacement', () => {
  const appFunctions = getSpan(app, '  function friendlyAuthError(error) {', '  async function authRequest(');
  const masterFunctions = getSpan(master, '  function friendlyLoginError(error) {', '  async function auth(');
  const context = vm.createContext({});
  vm.runInContext(appFunctions + masterFunctions + '\nthis.errors={friendlyAuthError,friendlyLoginError}', context);
  for (const name of ['friendlyAuthError','friendlyLoginError']) {
    const fn = context.errors[name];
    assert.match(fn({status:504}), /servidor/i);
    assert.match(fn({code:'VISION_REQUEST_TIMEOUT'}), /senha/i);
  }
});

test('fetch timeout aborts a hung request in both panel implementations', async () => {
  for (const file of [app, master]) {
    const functionSource = getSpan(file, '  async function fetchWithTimeout(', '  function friendly');
    const context = vm.createContext({
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: (_, opts) => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), {name:'AbortError'})));
      }),
    });
    vm.runInContext(functionSource + '\nthis.fetchWithTimeout=fetchWithTimeout;', context);
    await assert.rejects(context.fetchWithTimeout('/hung', {}, 8), err => err.code==='VISION_REQUEST_TIMEOUT');
  }
});

test('cache bust changes only login script references and leaves player binding alone', () => {
  assert.match(read('index.html'), /app\.js\?v=60-login-504-recovery/);
  assert.match(read('master.html'), /master\.js\?v=47-login-504-recovery/);
  assert.match(read('player.js'), /const DEVICE_TOKEN_KEY = 'vision_player_device_token_v1'/);
});
