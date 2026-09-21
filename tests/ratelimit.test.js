const test = require('node:test');
const assert = require('node:assert');
const { createLimiter } = require('../lib/ratelimit');

test('bloqueia depois de max falhas e libera quando a janela passa', () => {
  let t = 1000;
  const l = createLimiter({ max: 3, windowMs: 60000, now: () => t });
  assert.strictEqual(l.blocked('ip'), false);
  l.fail('ip'); l.fail('ip');
  assert.strictEqual(l.blocked('ip'), false);
  l.fail('ip');
  assert.strictEqual(l.blocked('ip'), true);
  assert.ok(l.retryAfterSec('ip') > 0);
  t += 60001;
  assert.strictEqual(l.blocked('ip'), false);
  assert.strictEqual(l.retryAfterSec('ip'), 0);
});

test('chaves diferentes não se afetam', () => {
  const l = createLimiter({ max: 1, windowMs: 1000 });
  l.fail('a');
  assert.strictEqual(l.blocked('a'), true);
  assert.strictEqual(l.blocked('b'), false);
});

test('sweep remove chaves expiradas', () => {
  let t = 0;
  const l = createLimiter({ max: 2, windowMs: 10, now: () => t });
  l.fail('a'); l.fail('b');
  t = 100;
  l.sweep();
  assert.strictEqual(l.size(), 0);
});
