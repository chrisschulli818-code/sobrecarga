const test = require('node:test');
const assert = require('node:assert');
const { summarizeActivity } = require('../lib/activity');
const { sanitizeTemplate, expandTemplate, mondayOf } = require('../lib/templates');

const NOW = new Date('2026-10-01T15:00:00Z'); // quinta-feira
const sess = (id, date, w, name = 'Supino', reps = 10) => ({ id, date, name: 'T', exercises: [{ id: id + 'e', name, sets: [{ weight: w, reps }] }] });

test('acompanhamento: último treino, semana e 28 dias', () => {
  const r = summarizeActivity({ sessions: [sess('a', '2026-09-10', 50), sess('b', '2026-09-30', 52), sess('c', '2026-10-01', 0), sess('d', '2026-08-01', 40)] }, NOW);
  assert.strictEqual(r.lastTrainedAt, '2026-09-30');
  assert.strictEqual(r.weekDone, 1);            // semana de 28/09: só o de 30/09 tem carga
  assert.strictEqual(r.weekPlanned, 2);         // 30/09 e 01/10 estão na semana
  assert.strictEqual(r.done28, 2);              // 10/09 e 30/09 (01/08 fica de fora)
  assert.strictEqual(r.sessionsTotal, 4);
});

test('acompanhamento: recorde, carga caindo e quem nunca treinou', () => {
  const up = summarizeActivity({ sessions: [sess('a', '2026-09-10', 50), sess('b', '2026-09-30', 55)] }, NOW);
  assert.deepStrictEqual(up.records30, ['Supino']);
  assert.deepStrictEqual(up.loadDrops, []);
  const down = summarizeActivity({ sessions: [sess('a', '2026-09-10', 60), sess('b', '2026-09-30', 50)] }, NOW);
  assert.deepStrictEqual(down.loadDrops, ['Supino']);
  assert.deepStrictEqual(down.records30, []);
  const small = summarizeActivity({ sessions: [sess('a', '2026-09-10', 60), sess('b', '2026-09-30', 57)] }, NOW);
  assert.deepStrictEqual(small.loadDrops, [], 'queda pequena (<10%) não alerta');
  const stale = summarizeActivity({ sessions: [sess('a', '2026-07-10', 50), sess('b', '2026-07-20', 55)] }, NOW);
  assert.deepStrictEqual(stale.records30, [], 'recorde antigo (+30 dias) não conta');
  const none = summarizeActivity(null, NOW);
  assert.strictEqual(none.lastTrainedAt, null);
  assert.strictEqual(none.done28, 0);
  assert.deepStrictEqual(summarizeActivity({ sessions: [null, { date: 5 }, {}] }, NOW).records30, [], 'dados estranhos não derrubam');
});

const tpl = { name: 'ABC', weeks: 2, days: [
  { name: 'A', offset: 0, exercises: [{ name: 'Supino', sets: [{ reps: 10, target: '8 a 12', weight: 40 }, { reps: 10, target: '8 a 12' }] }] },
  { name: 'B', offset: 2, exercises: [{ name: 'Remada', sets: [{ reps: 12, target: '' }] }] }
] };

test('modelo: valida, limita e descarta o que é lixo', () => {
  assert.strictEqual(sanitizeTemplate({ name: '', days: tpl.days }), null);
  assert.strictEqual(sanitizeTemplate({ name: 'x', days: [] }), null);
  assert.strictEqual(sanitizeTemplate({ name: 'x', days: [{ name: 'A', exercises: [{ name: '', sets: [{}] }] }] }), null, 'exercício sem nome some, e sem exercício não há modelo');
  const t = sanitizeTemplate({ name: ' Meu  modelo ', weeks: 999, days: [{ name: 'A', offset: 99, exercises: [{ name: 'Supino', sets: [{ reps: 9999, target: 'x'.repeat(50), weight: '42,5' }, { weight: -3 }], extra: 1 }] }], x: 1 });
  assert.strictEqual(t.name, 'Meu modelo');
  assert.strictEqual(t.weeks, 52);
  assert.strictEqual(t.days[0].offset, 6);
  assert.strictEqual(t.days[0].exercises[0].sets[0].reps, 100);
  assert.strictEqual(t.days[0].exercises[0].sets[0].target.length, 20);
  assert.strictEqual(t.days[0].exercises[0].sets[0].weight, 42.5);
  assert.strictEqual(t.days[0].exercises[0].sets[1].weight, 0);
  assert.strictEqual(t.x, undefined);
});

test('modelo: expande em semanas, a partir da segunda-feira da data escolhida', () => {
  assert.strictEqual(mondayOf('2026-10-01'), '2026-09-28');
  assert.strictEqual(mondayOf('2026-10-04'), '2026-09-28'); // domingo ainda é da semana que começou na segunda
  assert.strictEqual(mondayOf('2026-10-05'), '2026-10-05');
  const e = expandTemplate(tpl, '2026-10-01', 2, '2026-10-01');
  assert.strictEqual(e.sessions.length, 4);
  assert.deepStrictEqual(e.sessions.map(s => s.date), ['2026-09-28', '2026-09-30', '2026-10-05', '2026-10-07']);
  assert.ok(e.sessions.every(s => s.protocolId === e.protocol.id));
  assert.strictEqual(e.protocol.name, 'ABC');
  const set0 = e.sessions[0].exercises[0].sets[0];
  assert.strictEqual(set0.weight, 0, 'sem carga anotada');
  assert.strictEqual(set0.target, '8 a 12 · 40kg', 'carga sugerida vai no alvo');
  assert.strictEqual(e.sessions[0].exercises[0].sets[1].target, '8 a 12');
  assert.strictEqual(e.sessions[1].exercises[0].sets[0].target, '');
  const ids = new Set(); e.sessions.forEach(s => { ids.add(s.id); s.exercises.forEach(x => ids.add(x.id)); });
  assert.strictEqual(ids.size, 4 + 4, 'ids únicos');
  assert.strictEqual(expandTemplate(tpl, 'ontem', 2), null);
  assert.strictEqual(expandTemplate(tpl, '2026-10-05', 500).sessions.length, 2 * 52, 'limite de 52 semanas');
});
