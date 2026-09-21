const test = require('node:test');
const assert = require('node:assert');
const { loadFunctions } = require('./helpers/load-app-functions');

const { parseLines, splitIntoDayGroups, isWorkoutHeadingLine } =
  loadFunctions(['parseLines', 'splitIntoDayGroups', 'isWorkoutHeadingLine']);

// Objetos criados dentro do vm têm outro protótipo; compara como JSON puro.
const plain = x => JSON.parse(JSON.stringify(x));

// [linha da ficha, resultado esperado]. Formatos de fichas de academia reais
// (não há PDF de teste do usuário; esta lista cresce a cada ficha que falhar).
const CASES = [
  ['Supino reto 4x10 60kg', { name: 'Supino reto', sets: 4, reps: 10, weight: 60, target: '' }],
  ['Supino reto - 3 séries de 12 repetições', { name: 'Supino reto', sets: 3, reps: 12, weight: 0, target: '' }],
  ['Agachamento    4    8 a 12', { name: 'Agachamento', sets: 4, reps: 12, weight: 0, target: '8 a 12' }],
  ['Rosca direta | 3x12 | 15kg', { name: 'Rosca direta', sets: 3, reps: 12, weight: 15, target: '' }],
  ['Leg press: 4 séries x 10 reps - 80kg', { name: 'Leg press', sets: 4, reps: 10, weight: 80, target: '' }],
  ['Puxada alta  3  10-12', { name: 'Puxada alta', sets: 3, reps: 12, weight: 0, target: '10 a 12' }],
  ['Remada baixa    MAX', { name: 'Remada baixa', sets: 1, reps: 10, weight: 0, target: 'Máx' }],
  ['Elevação lateral 3 x 15 @ 8kg', { name: 'Elevação lateral', sets: 3, reps: 15, weight: 8, target: '' }],
  ['Cadeira extensora   peso: 25kg   4x12', { name: 'Cadeira extensora', sets: 4, reps: 12, weight: 25, target: '' }],
  ['Stiff até a falha', { name: 'Stiff', sets: 1, reps: 10, weight: 0, target: 'Máx' }],
  ['Triceps corda 4x15 20 kg', { name: 'Triceps corda', sets: 4, reps: 15, weight: 20, target: '' }],
  ['Abdominal 3x20', { name: 'Abdominal', sets: 3, reps: 20, weight: 0, target: '' }],
  // corrigidos depois de testar formatos variados:
  ['1) Supino inclinado 4 x 8-10', { name: 'Supino inclinado', sets: 4, reps: 10, weight: 0, target: '8 a 10' }],
  ['2. Remada 3x12', { name: 'Remada', sets: 3, reps: 12, weight: 0, target: '' }],
  ['3 - Leg press 4x10 80kg', { name: 'Leg press', sets: 4, reps: 10, weight: 80, target: '' }],
  ['Crucifixo 3x12 (carga 14kg)', { name: 'Crucifixo', sets: 3, reps: 12, weight: 14, target: '' }],
  ['Rosca Scott 3 x 10 a 12 rep', { name: 'Rosca Scott', sets: 3, reps: 12, weight: 0, target: '10 a 12' }],
  ['Barra fixa 4 séries até a falha', { name: 'Barra fixa', sets: 4, reps: 10, weight: 0, target: 'Máx' }],
  ['Abdominal 3 séries 15-20', { name: 'Abdominal', sets: 3, reps: 20, weight: 0, target: '15 a 20' }]
];

for (const [line, expected] of CASES) {
  test(`parseLines: ${line}`, () => {
    assert.deepStrictEqual(plain(parseLines([line])), [expected]);
  });
}

test('nome numa linha e dados na seguinte', () => {
  assert.deepStrictEqual(plain(parseLines(['Supino reto', '4x10 60kg'])), [
    { name: 'Supino reto', sets: 4, reps: 10, weight: 60, target: '' }
  ]);
});

test('cabeçalhos de tabela não viram exercício', () => {
  const rows = parseLines(['Exercício', 'Séries', 'Reps', 'Supino 4x10']);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Supino');
});

test('nunca devolve mais de 60 linhas', () => {
  const many = Array.from({ length: 100 }, (_, i) => `Exercício ${i} 3x10`);
  assert.strictEqual(parseLines(many).length, 60);
});

test('divide PDF com vários dias em uma sessão por dia', () => {
  const groups = splitIntoDayGroups([
    'FICHA DE TREINO - JOÃO',
    'TREINO A - PEITO E TRÍCEPS', 'Supino reto 4x10 60kg', 'Tríceps corda 3x12',
    'TREINO B - COSTAS E BÍCEPS', 'Puxada alta 4x10 50kg',
    'Segunda-feira', 'Agachamento 4x10'
  ], 'ficha');
  assert.deepStrictEqual(plain(groups.map(g => g.title)), ['TREINO A - PEITO E TRÍCEPS', 'TREINO B - COSTAS E BÍCEPS', 'Segunda-feira']);
});

test('sem títulos de dia: uma sessão só, com o nome do arquivo', () => {
  const groups = splitIntoDayGroups(['Supino 4x10', 'Remada 4x10'], 'minha-ficha');
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].title, 'minha-ficha');
});

test('reconhece títulos de treino', () => {
  for (const t of ['TREINO A', 'Treino 2 - Terça', 'DIA 1', 'Sexta-feira', 'PEITO E TRÍCEPS']) assert.ok(isWorkoutHeadingLine(t), t);
  for (const t of ['Supino reto 4x10', 'Rosca direta 3x12 15kg']) assert.ok(!isWorkoutHeadingLine(t), t);
});
