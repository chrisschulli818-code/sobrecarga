const test = require('node:test');
const assert = require('node:assert');
const { loadFunctions } = require('./helpers/load-app-functions');

const { mergeStates, countWeightedSets } = loadFunctions(['mergeStates', 'countWeightedSets']);
const plain = x => JSON.parse(JSON.stringify(x));

const ex = (id, weights) => ({ id, name: 'Ex ' + id, sets: weights.map(w => ({ weight: w, reps: 10 })) });
const session = (id, exercises, extra = {}) => ({ id, date: '2026-09-08', name: 'Treino ' + id, protocolId: 'p1', exercises, ...extra });
const proto = id => ({ id, name: 'Protocolo ' + id });

test('conta séries com carga', () => {
  assert.strictEqual(countWeightedSets({ sessions: [session('a', [ex('e', [60, 0, 70])]), session('b', [ex('f', [0])])] }), 2);
  assert.strictEqual(countWeightedSets({ sessions: [] }), 0);
  assert.strictEqual(countWeightedSets(null), 0);
});

test('cenário do bug: servidor sem cargas, aparelho com cargas -> as cargas sobrevivem', () => {
  const server = { sessions: [session('a', [ex('e', [0, 0, 0])]), session('b', [ex('f', [0])])], protocols: [proto('p1')] };
  const local = { sessions: [session('a', [ex('e', [60, 65, 70])]), session('b', [ex('f', [0])])], protocols: [proto('p1')] };
  const merged = plain(mergeStates(server, local, false));
  assert.deepStrictEqual(merged.sessions[0].exercises[0].sets.map(s => s.weight), [60, 65, 70]);
  assert.strictEqual(merged.sessions.length, 2);
  assert.strictEqual(countWeightedSets(merged), 3);
});

test('sessão que só existe no aparelho (treino antigo) é acrescentada, com o protocolo', () => {
  const server = { sessions: [session('a', [ex('e', [0])])], protocols: [proto('p1')] };
  const local = { sessions: [session('old', [ex('x', [86, 95])], { protocolId: 'p0' })], protocols: [proto('p0')] };
  const merged = plain(mergeStates(server, local, false));
  assert.deepStrictEqual(merged.sessions.map(s => s.id), ['a', 'old']);
  assert.deepStrictEqual(merged.protocols.map(p => p.id), ['p1', 'p0']);
});

test('servidor manda quando o aparelho não tem carga a mais (não sobrescreve com zero)', () => {
  const server = { sessions: [session('a', [ex('e', [80, 80])])], protocols: [] };
  const local = { sessions: [session('a', [ex('e', [0, 0])])], protocols: [] };
  assert.deepStrictEqual(plain(mergeStates(server, local, false)).sessions[0].exercises[0].sets.map(s => s.weight), [80, 80]);
});

test('sem preferLocal, uma carga já registrada no servidor não é trocada pela do aparelho', () => {
  const server = { sessions: [session('a', [ex('e', [60])])], protocols: [] };
  const local = { sessions: [session('a', [ex('e', [62])])], protocols: [] };
  assert.strictEqual(plain(mergeStates(server, local, false)).sessions[0].exercises[0].sets[0].weight, 60);
});

test('preferLocal: edição não enviada do aparelho vence (60 -> 62)', () => {
  const server = { sessions: [session('a', [ex('e', [60])])], protocols: [] };
  const local = { sessions: [session('a', [ex('e', [62])])], protocols: [] };
  assert.strictEqual(plain(mergeStates(server, local, true)).sessions[0].exercises[0].sets[0].weight, 62);
});

test('não duplica protocolos nem sessões e não altera os argumentos', () => {
  const server = { sessions: [session('a', [ex('e', [0])])], protocols: [proto('p1')] };
  const local = { sessions: [session('a', [ex('e', [50])])], protocols: [proto('p1')] };
  const before = JSON.stringify([server, local]);
  const merged = plain(mergeStates(server, local, true));
  assert.strictEqual(merged.sessions.length, 1);
  assert.strictEqual(merged.protocols.length, 1);
  assert.strictEqual(JSON.stringify([server, local]), before);
});

test('feedback do professor que só o aparelho tem não se perde', () => {
  const server = { sessions: [session('a', [ex('e', [0])])], protocols: [] };
  const local = { sessions: [session('a', [ex('e', [0])], { feedback: 'boa!' })], protocols: [] };
  assert.strictEqual(plain(mergeStates(server, local, false)).sessions[0].feedback, 'boa!');
});
