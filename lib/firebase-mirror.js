// Cópia de segurança no Firestore (Firebase). O Postgres/Supabase continua
// sendo o banco principal; isto só ESPELHA os dados num lugar fora dele.
//
// Nada aqui pode derrubar o app: se as credenciais não existirem ou o Firebase
// falhar, o app segue normal (só registra o erro). Sem FIREBASE_SERVICE_ACCOUNT*
// no ambiente, o espelhamento fica desligado.
//
// Coleções (a ficha vai como texto JSON num campo, pra fugir das restrições de
// tipos do Firestore e do limite de aninhamento):
//   states/{alunoId}                 última versão da ficha
//   students/{alunoId}               cadastro do aluno (deletedAt se foi removido)
//   professors/{id}                  cadastro do professor
//   backups/{AAAA-MM-DD}             um instantâneo por dia...
//   backups/{AAAA-MM-DD}/states/{id} ...com a ficha de cada aluno naquele dia

const KEEP_DAYS = 30;
const MAX_JSON_BYTES = 900 * 1024; // documento do Firestore tem teto de 1 MiB

function loadCredentials(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_B64
    ? Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
    : env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const cred = JSON.parse(raw);
    if (!cred.project_id || !cred.client_email || !cred.private_key) return null;
    return cred;
  } catch (e) {
    return null;
  }
}

function weightedSets(data) {
  return ((data && data.sessions) || []).reduce((n, s) =>
    n + ((s && s.exercises) || []).reduce((m, e) => m + ((e && e.sets) || []).filter(t => t && t.weight > 0).length, 0), 0);
}

function stateDoc(studentId, data, now) {
  const json = JSON.stringify(data || { sessions: [], protocols: [] });
  if (Buffer.byteLength(json) > MAX_JSON_BYTES) throw new Error(`ficha de ${studentId} grande demais para o Firestore`);
  return {
    studentId,
    json,
    sessions: ((data && data.sessions) || []).length,
    weightedSets: weightedSets(data),
    mirroredAt: now()
  };
}

const dayKey = d => d.toISOString().slice(0, 10);

function createMirror(db, opts = {}) {
  const now = opts.now || (() => new Date());
  const log = opts.log || (() => {});
  const status = { enabled: true, lastSyncAt: null, lastSnapshotDay: null, lastError: null, counts: {} };

  async function guard(fn) {
    try { return await fn(); }
    catch (err) { status.lastError = String(err && err.message || err).slice(0, 300); log('espelho Firebase falhou:', status.lastError); throw err; }
  }

  return {
    status: () => ({ ...status }),

    // Grava a ficha logo depois de cada salvamento do aluno.
    mirrorState: (studentId, data) => guard(async () => {
      await db.collection('states').doc(studentId).set(stateDoc(studentId, data, now));
    }),

    // Cadastros (alunos e professores) + marca quem foi removido.
    syncAll: pool => guard(async () => {
      const students = (await pool.query('SELECT id, name, code, professor_id, phone, created_at FROM students ORDER BY created_at')).rows;
      const professors = (await pool.query('SELECT id, name, code, created_at FROM professors ORDER BY created_at')).rows;
      const states = (await pool.query('SELECT id, data FROM app_state')).rows;

      for (const s of students) {
        await db.collection('students').doc(s.id).set({
          id: s.id, name: s.name, code: s.code, professorId: s.professor_id || null,
          phone: s.phone || '', createdAt: s.created_at, deletedAt: null, mirroredAt: now()
        });
      }
      for (const p of professors) {
        await db.collection('professors').doc(p.id).set({ id: p.id, name: p.name, code: p.code, createdAt: p.created_at, deletedAt: null, mirroredAt: now() });
      }
      for (const st of states) await db.collection('states').doc(st.id).set(stateDoc(st.id, st.data, now));

      // Quem sumiu do Postgres continua no backup, só marcado como removido —
      // é o que permite recuperar um aluno apagado por engano.
      const live = { students: new Set(students.map(s => s.id)), professors: new Set(professors.map(p => p.id)) };
      for (const col of ['students', 'professors']) {
        for (const ref of await db.collection(col).listDocuments()) {
          if (!live[col].has(ref.id)) await ref.set({ deletedAt: now() }, { merge: true });
        }
      }
      status.lastSyncAt = now().toISOString();
      status.counts = { students: students.length, professors: professors.length, states: states.length };
      status.lastError = null;
      return status.counts;
    }),

    // Um instantâneo por dia (e apaga os com mais de KEEP_DAYS).
    dailySnapshot: (pool, { force = false } = {}) => guard(async () => {
      const today = dayKey(now());
      const ref = db.collection('backups').doc(today);
      if (!force && (await ref.get()).exists) { status.lastSnapshotDay = today; return { skipped: true, day: today }; }
      const states = (await pool.query('SELECT id, data FROM app_state')).rows;
      for (const st of states) await ref.collection('states').doc(st.id).set(stateDoc(st.id, st.data, now));
      await ref.set({ day: today, takenAt: now(), states: states.length });
      const limit = new Date(now().getTime() - KEEP_DAYS * 86400000);
      for (const old of await db.collection('backups').listDocuments()) {
        if (old.id < dayKey(limit)) await db.recursiveDelete(old);
      }
      status.lastSnapshotDay = today;
      return { skipped: false, day: today, states: states.length };
    })
  };
}

// Só liga se houver credencial; carrega o SDK sob demanda (não pesa quando desligado).
function initFromEnv(env, log) {
  const cred = loadCredentials(env);
  if (!cred) return null;
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = getApps().find(a => a.name === 'sobrecarga-mirror') || initializeApp({ credential: cert(cred) }, 'sobrecarga-mirror');
  return createMirror(getFirestore(app), { log });
}

module.exports = { createMirror, initFromEnv, loadCredentials, weightedSets, stateDoc };
