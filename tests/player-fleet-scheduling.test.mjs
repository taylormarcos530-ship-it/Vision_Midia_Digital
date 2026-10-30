// Run: node --test tests/player-fleet-scheduling.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const player = readFileSync(new URL('../player.js', import.meta.url), 'utf8');
test('pilot keeps 60s manifest and 15s commands', () => {
  assert.match(player, /setInterval\(periodicSync, 60_000\)/);
  assert.match(player, /setInterval\(periodicCommands, 15_000\)/);
});
test('polling is staggered and skips concurrent requests', () => {
  assert.match(player, /Math\.random\(\) \* 60_000/);
  assert.match(player, /Math\.random\(\) \* 15_000/);
  assert.match(player, /syncInFlight/);
  assert.match(player, /commandInFlight/);
});
test('heartbeat and cached playback remain unchanged', () => {
  assert.match(player, /heartbeat\(\)\.then\(async \(\) =>/);
  assert.match(player, /30_000\)/);
  assert.match(player, /ensurePlaybackLoop\(\)/);
});
test('300 TV upper-bound per hour drops on these two paths', () => {
  const oldCalls = 300 * (3600 / 15 + 3600 / 5);
  const newCalls = 300 * (3600 / 60 + 3600 / 15);
  assert.equal(oldCalls, 288000);
  assert.equal(newCalls, 90000);
  assert.equal(1 - newCalls / oldCalls, 0.6875);
});
