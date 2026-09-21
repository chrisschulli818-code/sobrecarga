const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createLimiter } = require('./lib/ratelimit');

const app = express();
// O Render fica atrás de um proxy: sem isso req.ip seria sempre o do proxy e
// o limite de tentativas valeria pro site inteiro em vez de por pessoa.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin'
  });
  next();
});
app.use(express.json({ limit: '8mb' }));

// Chutar códigos: 15 falhas por IP a cada 10 min bloqueia (vale pro login e
// pro pedido de liberação, que também aceita um código sem autenticação).
const authLimiter = createLimiter({ max: 15, windowMs: 10 * 60 * 1000 });
setInterval(() => authLimiter.sweep(), 10 * 60 * 1000).unref();

// O banco (Supabase) é compartilhado com outros apps do usuário; todas as
// tabelas do Sobrecarga vivem isoladas no schema "sobrecarga", nunca em public.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  options: '-c search_path=sobrecarga'
});

// Código curto e fácil de digitar/ditar (sem 0/O/1/I, que se confundem).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(len){
  let s = '';
  for(let i=0;i<(len||6);i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

let PROFESSOR_CODE = null;
let ADMIN_CODE = null;

async function ensureTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  // Cada professor tem sua própria turma de alunos; o admin cadastra os
  // professores e pode navegar pelo painel de qualquer um deles.
  await pool.query(`CREATE TABLE IF NOT EXISTS professors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  try {
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS professor_id TEXT`);
  } catch (err) {
    console.error('Não consegui adicionar a coluna professor_id (alunos ficarão sem dono até isso ser corrigido):', err.message);
  }
  // device_id: trava o código de aluno no primeiro aparelho que logar com ele
  // (evita duas pessoas usando o mesmo código ao mesmo tempo e sobrescrevendo
  // os dados uma da outra). Coluna adicionada depois — por isso o ADD COLUMN
  // separado, pra não quebrar quem já tinha a tabela criada. Em try/catch
  // próprio: se a role do banco não puder alterar a tabela (aconteceu em
  // produção — "must be owner of table students"), isso NÃO pode travar o
  // resto do ensureTable (login/código do professor dependem do que vem
  // depois), então só avisa no log e segue.
  try {
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS device_id TEXT`);
  } catch (err) {
    console.error('Não consegui adicionar a coluna device_id (trava por aparelho ficará desativada):', err.message);
  }
  // telefone do aluno (opcional) — usado só pra gerar o link de WhatsApp no
  // painel do professor, mesma lógica defensiva do device_id acima.
  try {
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS phone TEXT`);
  } catch (err) {
    console.error('Não consegui adicionar a coluna phone (link de WhatsApp ficará desativado):', err.message);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  // Histórico de versões da ficha de cada aluno: uma cópia do estado ANTES de
  // ser sobrescrito (no máx. 1 a cada 30 min por aluno). Foi um bug de
  // sobrescrita que já apagou treinos; isso permite voltar atrás.
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state_history (
    id BIGSERIAL PRIMARY KEY,
    student_id TEXT NOT NULL,
    data JSONB NOT NULL,
    taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS app_state_history_student_idx ON app_state_history (student_id, taken_at DESC)`);
  // Aluno travado em outro aparelho pede liberação; o professor vê no painel.
  await pool.query(`CREATE TABLE IF NOT EXISTS unlock_requests (
    student_id TEXT PRIMARY KEY,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pruneHistory();

  // Código do professor: a variável de ambiente sempre manda; sem ela, usa o
  // que já foi gerado antes (persistido), ou gera um novo na primeira vez.
  const envCode = (process.env.PROFESSOR_CODE || '').trim();
  const stored = await pool.query(`SELECT value FROM meta WHERE key='professor_code'`);
  if (envCode) {
    PROFESSOR_CODE = envCode;
    await pool.query(
      `INSERT INTO meta (key, value) VALUES ('professor_code', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [envCode]
    );
  } else if (stored.rows[0]) {
    PROFESSOR_CODE = stored.rows[0].value;
  } else {
    PROFESSOR_CODE = generateCode(8);
    await pool.query(`INSERT INTO meta (key, value) VALUES ('professor_code', $1)`, [PROFESSOR_CODE]);
  }
  console.log('Código do professor:', PROFESSOR_CODE);

  // Código do admin: mesma lógica do professor acima (env var manda; senão
  // persiste o gerado). O admin cadastra os professores e pode navegar pelo
  // painel de qualquer um deles.
  const envAdminCode = (process.env.ADMIN_CODE || '').trim();
  const storedAdmin = await pool.query(`SELECT value FROM meta WHERE key='admin_code'`);
  if (envAdminCode) {
    ADMIN_CODE = envAdminCode;
    await pool.query(
      `INSERT INTO meta (key, value) VALUES ('admin_code', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [envAdminCode]
    );
  } else if (storedAdmin.rows[0]) {
    ADMIN_CODE = storedAdmin.rows[0].value;
  } else {
    ADMIN_CODE = generateCode(8);
    await pool.query(`INSERT INTO meta (key, value) VALUES ('admin_code', $1)`, [ADMIN_CODE]);
  }
  console.log('Código do admin:', ADMIN_CODE);

  // Migração: antes só existia um professor (PROFESSOR_CODE). Agora cada
  // professor é uma linha em "professors" e alunos pertencem a um deles.
  // Na primeira vez que isso roda, cria esse professor legado com o código
  // que já estava em uso, e transfere pra ele todo aluno ainda sem dono —
  // assim quem já usava o código antigo continua acessando exatamente os
  // mesmos alunos, sem precisar fazer nada.
  let legacyProfessorId = null;
  try {
    const legacyMeta = await pool.query(`SELECT value FROM meta WHERE key='legacy_professor_id'`);
    legacyProfessorId = legacyMeta.rows[0] && legacyMeta.rows[0].value;
    if (legacyProfessorId) {
      // Mantém o código do professor legado sincronizado com PROFESSOR_CODE
      // (caso a env var mude depois).
      await pool.query('UPDATE professors SET code = $1 WHERE id = $2', [PROFESSOR_CODE, legacyProfessorId]);
    } else {
      legacyProfessorId = crypto.randomUUID();
      await pool.query(
        'INSERT INTO professors (id, name, code) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING',
        [legacyProfessorId, 'Professor', PROFESSOR_CODE]
      );
      await pool.query(
        `INSERT INTO meta (key, value) VALUES ('legacy_professor_id', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [legacyProfessorId]
      );
    }
    await pool.query('UPDATE students SET professor_id = $1 WHERE professor_id IS NULL', [legacyProfessorId]);
  } catch (err) {
    console.error('Não consegui migrar o professor legado (alunos antigos podem ficar sem dono):', err.message);
  }

  // Migração: a base antiga (sem contas) guardava tudo em app_state id='default'.
  // Na primeira vez que rodar com o sistema de códigos, isso vira o aluno inicial.
  const noStudents = await pool.query('SELECT 1 FROM students LIMIT 1');
  if (noStudents.rows.length === 0) {
    const oldState = await pool.query(`SELECT data FROM app_state WHERE id='default'`);
    if (oldState.rows[0]) {
      const studentId = crypto.randomUUID();
      const code = generateCode();
      await pool.query('INSERT INTO students (id, name, code, professor_id) VALUES ($1,$2,$3,$4)', [studentId, 'Meu treino', code, legacyProfessorId]);
      await pool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()`,
        [studentId, oldState.rows[0].data]
      );
      await pool.query(`DELETE FROM app_state WHERE id='default'`);
      console.log('Dados antigos migrados para o aluno "Meu treino" — código:', code);
    }
  }
}
async function pruneHistory() {
  try {
    await pool.query(`DELETE FROM app_state_history WHERE taken_at < now() - interval '30 days'`);
  } catch (err) {
    console.error('Falha ao limpar histórico antigo:', err.message);
  }
}
setInterval(pruneHistory, 6 * 60 * 60 * 1000).unref();

// Só atende a API depois de o banco estar preparado (antes, um login logo
// após o servidor acordar podia falhar). Se falhar, tenta de novo na próxima.
let readyPromise = null;
function whenReady() {
  if (!readyPromise) {
    readyPromise = ensureTable().catch(err => {
      console.error('Falha ao preparar o banco:', err);
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}
whenReady().catch(() => {});
app.use('/api', async (req, res, next) => {
  try { await whenReady(); next(); }
  catch (e) { res.status(503).json({ error: 'starting' }); }
});

/* ---------- Autenticação por código (sem senha/e-mail) ----------
   O professor tem um código fixo (env PROFESSOR_CODE ou gerado uma vez).
   Cada aluno tem um código próprio, criado/removido pelo professor. */
app.post('/api/auth', async (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  const deviceId = String((req.body || {}).deviceId || '').trim().slice(0, 100);
  if (!code) return res.status(400).json({ error: 'missing_code' });
  if (authLimiter.blocked(req.ip)) {
    res.set('Retry-After', String(authLimiter.retryAfterSec(req.ip)));
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  if (code === ADMIN_CODE) {
    // O admin não é dono de alunos — ele cadastra professores e navega pelo
    // painel de qualquer um deles usando o código de cada professor.
    return res.json({ role: 'admin', code });
  }
  try {
    const profRow = await pool.query('SELECT id, name FROM professors WHERE code = $1', [code]);
    if (profRow.rows[0]) {
      // O código do professor não trava por aparelho — normal ele acessar de
      // vários lugares (celular, computador) pra acompanhar os alunos.
      return res.json({ role: 'professor', code, professorId: profRow.rows[0].id, name: profRow.rows[0].name });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'db_error' });
  }
  try {
    // Se a coluna device_id não existir ainda (ex.: role do banco sem
    // permissão pra ALTER TABLE em produção), cai pra uma consulta sem ela
    // em vez de derrubar o login inteiro — a trava por aparelho fica
    // desativada até a coluna existir, mas o acesso continua funcionando.
    let student;
    try {
      const r = await pool.query('SELECT id, name, device_id FROM students WHERE code = $1', [code]);
      student = r.rows[0];
    } catch (colErr) {
      const r = await pool.query('SELECT id, name FROM students WHERE code = $1', [code]);
      student = r.rows[0];
    }
    if (!student) {
      authLimiter.fail(req.ip);
      return res.status(404).json({ error: 'invalid_code' });
    }
    if (student.device_id && deviceId && student.device_id !== deviceId) {
      // Código já reivindicado por outro aparelho — recusa pra não deixar
      // duas pessoas editando a mesma ficha ao mesmo tempo.
      return res.status(409).json({ error: 'device_locked' });
    }
    if (!student.device_id && deviceId) {
      pool.query('UPDATE students SET device_id = $1 WHERE id = $2', [deviceId, student.id]).catch(()=>{});
    }
    const needsName = !student.name || !student.name.trim();
    return res.json({ role: 'student', studentId: student.id, name: student.name, needsName, code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Aluno travado em outro aparelho pede pro professor liberar. Não exige login
// (ele justamente não consegue entrar), então usa o mesmo limite de tentativas
// e nunca revela se o código existe.
app.post('/api/unlock-request', async (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'missing_code' });
  if (authLimiter.blocked(req.ip)) return res.status(429).json({ error: 'too_many_attempts' });
  try {
    const r = await pool.query('SELECT id FROM students WHERE code = $1', [code]);
    if (!r.rows[0]) { authLimiter.fail(req.ip); return res.json({ ok: true }); }
    await pool.query(
      `INSERT INTO unlock_requests (student_id) VALUES ($1)
       ON CONFLICT (student_id) DO UPDATE SET requested_at = now()`,
      [r.rows[0].id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

function requireAdmin(req, res, next) {
  if ((req.get('x-admin-code') || '') !== ADMIN_CODE) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

// Identifica o professor pelo código enviado no header e anexa req.professorId
// — todas as rotas de aluno abaixo ficam restritas à turma desse professor.
// O admin "navega como" um professor simplesmente usando o código real dele
// (que só o admin consegue ver na própria lista de professores).
async function requireProfessor(req, res, next) {
  const code = req.get('x-professor-code') || '';
  if (!code) return res.status(403).json({ error: 'forbidden' });
  try {
    const r = await pool.query('SELECT id FROM professors WHERE code = $1', [code]);
    if (!r.rows[0]) return res.status(403).json({ error: 'forbidden' });
    req.professorId = r.rows[0].id;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
}

// Aluno só acessa a própria ficha (código bate com o id pedido); professor
// só acessa alunos da própria turma (professor_id bate com o id pedido).
async function requireStudentAccess(req, res, next) {
  const studentId = req.params.studentId;
  const profCode = req.get('x-professor-code') || '';
  if (profCode) {
    try {
      const r = await pool.query(
        'SELECT 1 FROM students s JOIN professors p ON p.id = s.professor_id WHERE s.id = $1 AND p.code = $2',
        [studentId, profCode]
      );
      if (r.rows[0]) return next();
      return res.status(403).json({ error: 'forbidden' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'db_error' });
    }
  }
  const studentCode = (req.get('x-student-code') || '').trim().toUpperCase();
  try {
    const r = await pool.query('SELECT 1 FROM students WHERE id = $1 AND code = $2', [studentId, studentCode]);
    if (r.rows[0]) return next();
    res.status(403).json({ error: 'forbidden' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
}

// Admin cadastra os professores; cada um recebe um código próprio (mesma
// mecânica dos códigos de aluno).
app.get('/api/admin/professors', requireAdmin, async (req, res) => {
  try {
    const rows = (await pool.query(`
      SELECT p.id, p.name, p.code, COUNT(s.id)::int AS student_count
      FROM professors p
      LEFT JOIN students s ON s.professor_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at ASC
    `)).rows;
    res.json(rows.map(r => ({ id: r.id, name: r.name, code: r.code, studentCount: r.student_count })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/admin/professors', requireAdmin, async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'missing_name' });
  try {
    const id = crypto.randomUUID();
    let code;
    for (let tries = 0; tries < 8; tries++) {
      code = generateCode(8);
      const clash = await pool.query('SELECT 1 FROM professors WHERE code = $1', [code]);
      if (!clash.rows[0]) break;
    }
    await pool.query('INSERT INTO professors (id, name, code) VALUES ($1,$2,$3)', [id, name, code]);
    res.json({ id, name, code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Resumo de atividade pro painel do professor: última vez que treinou (sessão
// com alguma carga registrada) e quantos treinos fez nesta semana.
function summarizeActivity(data) {
  const sessions = (data && Array.isArray(data.sessions)) ? data.sessions : [];
  const done = sessions.filter(x => x && Array.isArray(x.exercises) &&
    x.exercises.some(e => e && Array.isArray(e.sets) && e.sets.some(t => t && t.weight > 0)));
  const dates = done.map(x => x.date).filter(Boolean).sort();
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  const mondayIso = monday.toISOString().slice(0, 10);
  return {
    lastTrainedAt: dates.length ? dates[dates.length - 1] : null,
    weekDone: done.filter(x => x.date >= mondayIso).length,
    sessionsTotal: sessions.length
  };
}

app.get('/api/students', requireProfessor, async (req, res) => {
  try {
    let rows;
    try {
      rows = (await pool.query(`SELECT s.id, s.name, s.code, s.device_id, s.phone, a.data,
          (u.student_id IS NOT NULL) AS unlock_requested
        FROM students s
        LEFT JOIN app_state a ON a.id = s.id
        LEFT JOIN unlock_requests u ON u.student_id = s.id
        WHERE s.professor_id = $1 ORDER BY s.created_at ASC`, [req.professorId])).rows;
    } catch (colErr) {
      rows = (await pool.query('SELECT id, name, code FROM students WHERE professor_id = $1 ORDER BY created_at ASC', [req.professorId])).rows;
    }
    const students = rows.map(s => ({
      id: s.id, name: s.name, code: s.code, locked: !!s.device_id, phone: s.phone || '',
      unlockRequested: !!s.unlock_requested,
      ...summarizeActivity(s.data)
    }));
    res.json(students);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/students', requireProfessor, async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'missing_name' });
  try {
    const id = crypto.randomUUID();
    let code;
    for (let tries = 0; tries < 8; tries++) {
      code = generateCode();
      const clash = await pool.query('SELECT 1 FROM students WHERE code = $1', [code]);
      if (!clash.rows[0]) break;
    }
    await pool.query('INSERT INTO students (id, name, code, professor_id) VALUES ($1,$2,$3,$4)', [id, name, code, req.professorId]);
    await pool.query(`INSERT INTO app_state (id, data) VALUES ($1, $2)`, [id, { sessions: [], protocols: [] }]);
    res.json({ id, name, code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Gera vários códigos de uma vez, sem nome — pra distribuir aleatoriamente e
// deixar cada aluno colocar o próprio nome no primeiro acesso (needsName).
app.post('/api/students/bulk', requireProfessor, async (req, res) => {
  const count = Math.min(50, Math.max(1, parseInt((req.body || {}).count, 10) || 10));
  try {
    const created = [];
    for (let i = 0; i < count; i++) {
      const id = crypto.randomUUID();
      let code;
      for (let tries = 0; tries < 8; tries++) {
        code = generateCode();
        const clash = await pool.query('SELECT 1 FROM students WHERE code = $1', [code]);
        if (!clash.rows[0]) break;
      }
      await pool.query('INSERT INTO students (id, name, code, professor_id) VALUES ($1,$2,$3,$4)', [id, '', code, req.professorId]);
      await pool.query(`INSERT INTO app_state (id, data) VALUES ($1, $2)`, [id, { sessions: [], protocols: [] }]);
      created.push({ id, code });
    }
    res.json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// O próprio aluno define o nome no primeiro acesso (ou o professor corrige depois).
// Nota: a rota usa :studentId (não :id) porque requireStudentAccess lê esse
// nome de parâmetro especificamente — foi assim que um 403 apareceu aqui antes.
app.put('/api/students/:studentId/name', requireStudentAccess, async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'missing_name' });
  try {
    await pool.query('UPDATE students SET name = $1 WHERE id = $2', [name, req.params.studentId]);
    res.json({ ok: true, name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.put('/api/students/:id', requireProfessor, async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'missing_name' });
  try {
    await pool.query('UPDATE students SET name = $1 WHERE id = $2 AND professor_id = $3', [name, req.params.id, req.professorId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Professor libera o código pra ser reivindicado por outro aparelho (ex: aluno trocou de celular).
app.put('/api/students/:id/unlock', requireProfessor, async (req, res) => {
  try {
    const r = await pool.query('UPDATE students SET device_id = NULL WHERE id = $1 AND professor_id = $2 RETURNING id', [req.params.id, req.professorId]);
    if (r.rows[0]) await pool.query('DELETE FROM unlock_requests WHERE student_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Professor cadastra/edita o telefone do aluno, usado só pra montar o link do WhatsApp no painel.
app.put('/api/students/:id/phone', requireProfessor, async (req, res) => {
  const phone = String((req.body || {}).phone || '').replace(/\D/g, '').slice(0, 20);
  try {
    await pool.query('UPDATE students SET phone = $1 WHERE id = $2 AND professor_id = $3', [phone, req.params.id, req.professorId]);
    res.json({ ok: true, phone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.delete('/api/students/:id', requireProfessor, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM students WHERE id = $1 AND professor_id = $2 RETURNING id', [req.params.id, req.professorId]);
    // Só apaga os dados se o aluno era mesmo deste professor (antes apagava a
    // ficha de qualquer id informado).
    if (r.rows[0]) {
      await pool.query('DELETE FROM app_state WHERE id = $1', [req.params.id]);
      await pool.query('DELETE FROM app_state_history WHERE student_id = $1', [req.params.id]);
      await pool.query('DELETE FROM unlock_requests WHERE student_id = $1', [req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/state/:studentId', requireStudentAccess, async (req, res) => {
  try {
    const r = await pool.query('SELECT data FROM app_state WHERE id = $1', [req.params.studentId]);
    res.json(r.rows[0] ? r.rows[0].data : { sessions: [], protocols: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.put('/api/state/:studentId', requireStudentAccess, async (req, res) => {
  const data = req.body;
  if (!data || !Array.isArray(data.sessions)) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  try {
    try {
      await pool.query(
        `INSERT INTO app_state_history (student_id, data)
         SELECT id, data FROM app_state WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM app_state_history h WHERE h.student_id = $1 AND h.taken_at > now() - interval '30 minutes')`,
        [req.params.studentId]
      );
    } catch (histErr) {
      console.error('Falha ao guardar histórico (o salvamento segue):', histErr.message);
    }
    await pool.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()`,
      [req.params.studentId, data]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Remove um professor. Se ele tem alunos, precisa dizer pra quem transferir
// (?transferTo=<id de outro professor>) — nunca deixa aluno sem dono.
app.delete('/api/admin/professors/:id', requireAdmin, async (req, res) => {
  try {
    const own = await pool.query('SELECT COUNT(*)::int AS n FROM students WHERE professor_id = $1', [req.params.id]);
    if (own.rows[0].n > 0) {
      const to = String(req.query.transferTo || '');
      if (!to || to === req.params.id) return res.status(409).json({ error: 'has_students', students: own.rows[0].n });
      const dest = await pool.query('SELECT 1 FROM professors WHERE id = $1', [to]);
      if (!dest.rows[0]) return res.status(400).json({ error: 'invalid_transfer' });
      await pool.query('UPDATE students SET professor_id = $1 WHERE professor_id = $2', [to, req.params.id]);
    }
    await pool.query('DELETE FROM professors WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Backup completo em JSON (professores, alunos com códigos e fichas).
app.get('/api/admin/export', requireAdmin, async (req, res) => {
  try {
    const professors = (await pool.query('SELECT id, name, code, created_at FROM professors ORDER BY created_at')).rows;
    const students = (await pool.query('SELECT id, name, code, professor_id, phone, created_at FROM students ORDER BY created_at')).rows;
    const states = (await pool.query('SELECT id, data, updated_at FROM app_state ORDER BY id')).rows;
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="sobrecarga-backup-${stamp}.json"`);
    res.json({ exportedAt: new Date().toISOString(), professors, students, states });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Versões guardadas da ficha de um aluno (mais recentes primeiro) e restauração.
app.get('/api/admin/history/:studentId', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, taken_at, jsonb_array_length(COALESCE(data->'sessions','[]'::jsonb)) AS sessions
       FROM app_state_history WHERE student_id = $1 ORDER BY taken_at DESC LIMIT 100`,
      [req.params.studentId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/admin/history/:studentId/restore/:versionId', requireAdmin, async (req, res) => {
  try {
    const v = await pool.query('SELECT data FROM app_state_history WHERE id = $1 AND student_id = $2', [req.params.versionId, req.params.studentId]);
    if (!v.rows[0]) return res.status(404).json({ error: 'not_found' });
    // Guarda o estado atual antes, pra a restauração também poder ser desfeita.
    await pool.query('INSERT INTO app_state_history (student_id, data) SELECT id, data FROM app_state WHERE id = $1', [req.params.studentId]);
    await pool.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()`,
      [req.params.studentId, v.rows[0].data]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Estado do servidor e do esquema, sem nenhum dado sensível — serve pra
// monitorar e pra descobrir cedo uma coluna faltando (foi o que derrubou o
// painel duas vezes). 503 se algo essencial faltar.
app.get('/api/health', async (req, res) => {
  const out = { ok: true, columns: {} };
  try {
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'sobrecarga' AND table_name = 'students'`
    );
    const have = new Set(cols.rows.map(c => c.column_name));
    for (const c of ['professor_id', 'device_id', 'phone']) {
      out.columns[c] = have.has(c);
      if (!have.has(c)) out.ok = false;
    }
  } catch (err) {
    return res.status(503).json({ ok: false, error: 'db_unreachable' });
  }
  res.status(out.ok ? 200 : 503).json(out);
});

// Serve só o que é do site — antes servia a pasta inteira, inclusive
// server.js e package.json.
const PUBLIC_FILES = new Set([
  'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'sw.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
]);
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const file = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  if (!PUBLIC_FILES.has(file)) return next();
  // Página, scripts e service worker sempre revalidam (ETag), pra um deploy novo chegar na hora.
  if (/\.(html|js|css)$/.test(file)) res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, file));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Sobrecarga rodando na porta ' + port));
