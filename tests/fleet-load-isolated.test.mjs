import test from 'node:test';
import assert from 'node:assert/strict';

// Deterministic offline virtual-clock simulation. No network requests.
function simulate(n, durationMs = 3600000, seed = 7391) {
  let randomSeed = seed;
  const rand = () => ((randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const counts = { manifest: 0, commands: 0, heartbeat: 0 };
  const buckets = new Uint32Array(durationMs / 1000);
  for (let tv = 0; tv < n; tv++) {
    for (const [name, period] of [['manifest', 60000], ['commands', 15000], ['heartbeat', 30000]]) {
      const phase = Math.floor(rand() * period);
      for (let t = phase; t < durationMs; t += period) {
        counts[name]++;
        buckets[Math.floor(t / 1000)]++;
      }
    }
  }
  return { counts, peakRequestsPerSecond: Math.max(...buckets), meanRequestsPerSecond: Object.values(counts).reduce((a,b)=>a+b,0)/(durationMs/1000) };
}
for (const n of [50,100,300]) {
  test(`offline simulated ${n} TVs (no production traffic)`, () => {
    const x = simulate(n);
    assert.equal(x.counts.manifest, n * 60);
    assert.equal(x.counts.commands, n * 240);
    assert.equal(x.counts.heartbeat, n * 120);
    assert.ok(x.peakRequestsPerSecond < n, 'avoid all TVs sending together');
    console.log(JSON.stringify({tvs:n,...x}));
  });
}
