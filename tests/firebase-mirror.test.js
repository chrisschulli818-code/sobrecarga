const test = require('node:test');
const assert = require('node:assert');
const { createMirror, loadCredentials, weightedSets } = require('../lib/firebase-mirror');

// Firestore mínimo em memória: só o que o espelho usa.
function fakeDb() {
  const store = new Map();
  const depth = p => p.split('/').length;
  const ref = path => ({
    id: path.split('/').pop(), path,
    set: async (d, o) => { store.set(path, o && o.merge ? { ...(store.get(path) || {}), ...d } : d); },
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    collection: name => col(path + '/' + name)
  });
  const col = path => ({
    doc: id => ref(path + '/' + id),
    listDocuments: async () => [...new Set([...store.keys()]
      .filter(k => k.startsWith(path + '/'))
      .map(k => k.split('/').slice(0, depth(path) + 1).join('/')))].map(ref)
  });
  return {
    store,
    collection: name => col(name),
    recursiveDelete: async r => { for (const k of [...store.keys()]) if (k === r.path || k.startsWith(r.path + '/')) store.delete(k); }
  };
}

function fakePool({ students = [], professors = [], states = [] } = {}) {
  return { query: async sql => ({ rows: /FROM students/.test(sql) ? students : /FROM professors/.test(sql) ? professors : states }) };
}

const state = (w) => ({ protocols: [], sessions: [{ id: 's', exercises: [{ id: 'e', sets: [{ weight: w, reps: 10 }, { weight: 0, reps: 10 }] }] }] });
const at = iso => () => new Date(iso);

test('mirrorState grava a ficha como JSON com contagens', async () => {
  const db = fakeDb();
  const m = createMirror(db, { now: at('2026-09-21T12:00:00Z') });
  await m.mirrorState('a1', state(60));
  const doc = db.store.get('states/a1');
  assert.strictEqual(doc.sessions, 1);
  assert.strictEqual(doc.weightedSets, 1);
  assert.deepStrictEqual(JSON.parse(doc.json), state(60));
});

test('syncAll copia alunos, professores e fichas e marca removidos (sem apagar)', async () => {
  const db = fakeDb();
  db.store.set('students/gone', { id: 'gone', name: 'Removido', code: 'ZZZZZZ' });
  const m = createMirror(db, { now: at('2026-09-21T12:00:00Z') });
  const counts = await m.syncAll(fakePool({
    students: [{ id: 's1', name: 'Ana', code: 'AAAAAA', professor_id: 'p1', phone: '5511', created_at: '2026-09-01' }],
    professors: [{ id: 'p1', name: 'Prof', code: 'PPPPPPPP', created_at: '2026-09-01' }],
    states: [{ id: 's1', data: state(50) }]
  }));
  assert.deepStrictEqual(counts, { students: 1, professors: 1, states: 1 });
  assert.strictEqual(db.store.get('students/s1').name, 'Ana');
  assert.strictEqual(db.store.get('students/s1').professorId, 'p1');
  assert.strictEqual(db.store.get('professors/p1').code, 'PPPPPPPP');
  assert.strictEqual(db.store.get('states/s1').weightedSets, 1);
  assert.ok(db.store.get('students/gone').deletedAt, 'quem sumiu do Postgres é marcado');
  assert.strictEqual(db.store.get('students/gone').name, 'Removido', 'e continua no backup');
  assert.strictEqual(db.store.get('students/s1').deletedAt, null);
});

test('dailySnapshot: cria uma vez por dia, força quando pedido e apaga com mais de 30 dias', async () => {
  const db = fakeDb();
  db.store.set('backups/2026-07-01', { day: '2026-07-01' });
  db.store.set('backups/2026-07-01/states/x', { studentId: 'x' });
  db.store.set('backups/2026-09-10', { day: '2026-09-10' });
  const m = createMirror(db, { now: at('2026-09-21T12:00:00Z') });
  const pool = fakePool({ states: [{ id: 's1', data: state(50) }] });

  const first = await m.dailySnapshot(pool);
  assert.strictEqual(first.skipped, false);
  assert.ok(db.store.has('backups/2026-09-21'));
  assert.ok(db.store.has('backups/2026-09-21/states/s1'));
  assert.ok(!db.store.has('backups/2026-07-01'), 'apagou o antigo');
  assert.ok(!db.store.has('backups/2026-07-01/states/x'), 'apagou também a subcoleção');
  assert.ok(db.store.has('backups/2026-09-10'), 'manteve o recente');

  assert.strictEqual((await m.dailySnapshot(pool)).skipped, true);
  assert.strictEqual((await m.dailySnapshot(pool, { force: true })).skipped, false);
});

test('falha do Firebase é registrada no status e propagada (o servidor ignora)', async () => {
  const bad = { collection: () => ({ doc: () => ({ set: async () => { throw new Error('sem permissão'); } }) }) };
  const m = createMirror(bad, {});
  await assert.rejects(() => m.mirrorState('a', state(1)), /sem permissão/);
  assert.match(m.status().lastError, /sem permissão/);
});

test('ficha grande demais para o Firestore é recusada, não cortada', async () => {
  const m = createMirror(fakeDb(), {});
  const huge = { protocols: [], sessions: [{ id: 's', blob: 'x'.repeat(950 * 1024) }] };
  await assert.rejects(() => m.mirrorState('a', huge), /grande demais/);
});

test('credenciais: aceita JSON puro e base64; rejeita lixo e JSON incompleto', () => {
  const cred = { project_id: 'p', client_email: 'a@b.iam.gserviceaccount.com', private_key: 'k' };
  assert.deepStrictEqual(loadCredentials({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(cred) }), cred);
  assert.deepStrictEqual(loadCredentials({ FIREBASE_SERVICE_ACCOUNT_B64: Buffer.from(JSON.stringify(cred)).toString('base64') }), cred);
  assert.strictEqual(loadCredentials({}), null);
  assert.strictEqual(loadCredentials({ FIREBASE_SERVICE_ACCOUNT: 'não é json' }), null);
  assert.strictEqual(loadCredentials({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'p' }) }), null);
});

test('weightedSets ignora dados malformados', () => {
  assert.strictEqual(weightedSets(null), 0);
  assert.strictEqual(weightedSets({ sessions: [null, { exercises: [null, { sets: [null, { weight: 5 }] }] }] }), 1);
});
