const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'commercial-campaign-deadline.mjs')).href;

test('commercial countdown validates real calendar dates and leap years', async () => {
  const { commercialDaysUntil, commercialDeadlineLabel } = await import(moduleUrl);
  assert.equal(commercialDaysUntil('2026-02-30', '2026-02-28'), null);
  assert.equal(commercialDaysUntil('2025-02-29', '2025-02-28'), null);
  assert.equal(commercialDaysUntil('2024-02-29', '2024-02-28'), 1);
  assert.equal(commercialDaysUntil('2026-13-01', '2026-10-29'), null);
  assert.equal(commercialDaysUntil('2026-00-01', '2026-10-29'), null);
  assert.equal(commercialDaysUntil('2026-10-29', '2026-02-30'), null);
  assert.equal(commercialDeadlineLabel('2026-02-30', '2026-02-28').state, 'unknown');
  assert.equal(commercialDeadlineLabel('2026-10-29', '2026-10-29').label, 'Vence hoje');
  assert.equal(commercialDeadlineLabel('2026-10-30', '2026-10-29').label, 'Falta 1 dia');
  assert.equal(commercialDeadlineLabel('2026-10-28', '2026-10-29').label, 'Vencida há 1 dia');
});
