const test = require('node:test');
const assert = require('node:assert');
const { loadFunctions } = require('./helpers/load-app-functions');

const { energyKcal, computeSessionEnergy } = loadFunctions(['energyKcal', 'computeSessionEnergy']);

test('kcal cresce com peso e repetições', () => {
  // 60 kg × 10 reps × 9,81 × 0,5 m ÷ 20% ÷ 4184 J/kcal ≈ 3,52 kcal
  assert.ok(Math.abs(energyKcal(60, 10) - 3.517) < 0.01);
  assert.ok(Math.abs(energyKcal(120, 10) - 2 * energyKcal(60, 10)) < 1e-9);
  assert.ok(Math.abs(energyKcal(60, 20) - 2 * energyKcal(60, 10)) < 1e-9);
});

test('série sem carga ou sem repetições não conta', () => {
  assert.strictEqual(energyKcal(0, 10), 0);
  assert.strictEqual(energyKcal(50, 0), 0);
  assert.strictEqual(energyKcal(undefined, 8), 0);
  assert.strictEqual(energyKcal('abc', 8), 0);
});

test('soma por treino, ignora treinos vazios e ordena por data', () => {
  const sessions = [
    { id: 'b', name: 'B', date: '2026-09-10', exercises: [{ sets: [{ weight: 50, reps: 10 }, { weight: 0, reps: 10 }] }] },
    { id: 'a', name: 'A', date: '2026-09-08', exercises: [{ sets: [{ weight: 60, reps: 10 }] }, { sets: [{ weight: 60, reps: 10 }] }] },
    { id: 'c', name: 'C', date: '2026-09-12', exercises: [{ sets: [{ weight: 0, reps: 12 }] }] }
  ];
  const out = computeSessionEnergy(sessions);
  assert.deepStrictEqual(out.map(x => x.id), ['a', 'b']);
  assert.ok(Math.abs(out[0].kcal - 2 * energyKcal(60, 10)) < 1e-9);
  assert.ok(Math.abs(out[1].kcal - energyKcal(50, 10)) < 1e-9);
});
