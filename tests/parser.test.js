const test = require('node:test');
const assert = require('node:assert');
const { loadFunctions } = require('./helpers/load-app-functions');

const { parseLines, splitIntoDayGroups, isWorkoutHeadingLine, isTableHeaderLine, stripHeaderTail, parseTablePage, tableRowToExercise } =
  loadFunctions(['parseLines', 'splitIntoDayGroups', 'isWorkoutHeadingLine', 'isStrongWorkoutHeading', 'isTableHeaderLine', 'stripHeaderTail', 'isDataOnlyLine', 'splitByDayColumn', 'isTableHeaderWord', 'tableColumnType', 'tableCellText', 'parseTablePage', 'tableRowToExercise', 'cleanTarget', 'parseRepsTarget']);

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

test('cabeçalho do PDF antes do primeiro treino não vira um dia', () => {
  const groups = splitIntoDayGroups(['FICHA DE TREINO - Ana', 'Treino A', 'Supino 4x10', 'Treino B', 'Remada 4x10'], 'f');
  assert.deepStrictEqual(plain(groups.map(g => g.title)), ['Treino A', 'Treino B']);
});

test('nome em CAIXA ALTA com os dados na linha seguinte não é título de dia', () => {
  const groups = splitIntoDayGroups(['SEGUNDA-FEIRA — PEITO', '1. SUPINO RETO', '4 séries x 8 a 12 repetições', 'QUARTA-FEIRA — COSTAS', '1. PUXADA', '4 séries x 10 repetições'], 'f');
  assert.strictEqual(groups.length, 2);
  const rows = parseLines(groups[0].lines);
  assert.deepStrictEqual(plain(rows), [{ name: 'SUPINO RETO', sets: 4, reps: 12, weight: 0, target: '8 a 12' }]);
});

test('coluna "Dia" repetida em cada linha separa os treinos', () => {
  const groups = splitIntoDayGroups(['Planilha', 'Dia Exercício Séries Reps', 'A Supino 4 10', 'A Crucifixo 3 12', 'B Puxada 4 10', 'B Remada 4 8', 'C Agachamento 4 8'], 'f');
  assert.deepStrictEqual(plain(groups.map(g => g.title)), ['Treino A', 'Treino B', 'Treino C']);
  assert.strictEqual(groups[0].lines.length, 2);
});

test('linha de cabeçalho de tabela é ignorada e sai do título do dia', () => {
  assert.ok(isTableHeaderLine('EXERCÍCIO SÉRIES REPS CARGA'));
  assert.ok(!isTableHeaderLine('Supino reto'));
  assert.strictEqual(stripHeaderTail('TREINO A - SUPERIOR 1 Séries x Reps Observação'), 'TREINO A - SUPERIOR 1');
});

test('tempo de descanso não vira série nem carga', () => {
  assert.deepStrictEqual(plain(parseLines(['Supino reto 4 8-10 60 kg 90s'])), [{ name: 'Supino reto', sets: 4, reps: 10, weight: 60, target: '8 a 10' }]);
  assert.deepStrictEqual(plain(parseLines(['Crucifixo 3 12-15 60s'])), [{ name: 'Crucifixo', sets: 3, reps: 15, weight: 0, target: '12 a 15' }]);
  assert.deepStrictEqual(plain(parseLines(['Remada 4x10 descanso 2 min'])), [{ name: 'Remada', sets: 4, reps: 10, weight: 0, target: '' }]);
});

test('títulos "A - PEITO" separam o dia', () => {
  assert.ok(isWorkoutHeadingLine('A - PEITO'));
  assert.ok(!isWorkoutHeadingLine('Aluno: Ana'));
});

test('tabela por posição: células quebradas em várias linhas, reps e cadência', () => {
  const it = (x, y, str, h = 9) => ({ x, y, w: str.length * 4, h, str });
  const items = [
    it(65, 769, 'DIA 1 (SEGUNDA-FEIRA): PEITO', 14), it(312, 767, 'FOCO: PEITORAL', 8), it(65, 749, '& COSTAS I', 14),
    it(58, 670, 'EXERCÍCIO', 8), it(212, 670, 'AQUECIMENTO', 8), it(289, 676, 'SÉRIE DE TRABALHO', 8), it(289, 664, '(0 RIR)', 8),
    it(397, 670, 'REPS', 8), it(433, 670, 'CADÊNCIA', 8), it(490, 670, 'DESCANSO', 8),
    it(289, 641, '1 Série (Falha'), it(58, 635, '1. Peck Deck (Voador Máquina)'), it(212, 635, '1 a 2 séries'), it(397, 635, '6 - 10'), it(433, 635, '4-1-X-2'), it(490, 635, '2 min'), it(289, 628, 'Absoluta)'),
    it(58, 606, '2. Supino Inclinado /'), it(289, 606, '1 Série (Falha'), it(212, 600, '1 a 2 séries'), it(397, 600, '6 - 8'), it(433, 600, '4-1-X-0'), it(58, 593, 'Smith (30°)'), it(289, 593, 'Pause)'),
    it(51, 560, 'JUSTIFICATIVA ANATÔMICA', 13), it(397, 540, '3')
  ];
  const tables = plain(parseTablePage(items));
  assert.strictEqual(tables.length, 1);
  assert.strictEqual(tables[0].title, 'DIA 1 (SEGUNDA-FEIRA): PEITO & COSTAS I');
  assert.strictEqual(tables[0].rows.length, 2);
  assert.deepStrictEqual(plain(tables[0].rows.map(tableRowToExercise)), [
    { name: 'Peck Deck (Voador Máquina)', sets: 1, reps: 10, weight: 0, target: '6 a 10 · 4-1-X-2' },
    { name: 'Supino Inclinado / Smith (30°)', sets: 1, reps: 8, weight: 0, target: '6 a 8 · 4-1-X-0' }
  ]);
});
