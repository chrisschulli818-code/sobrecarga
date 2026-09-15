const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '8mb' }));

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
  await pool.query(`CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

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

  // Migração: a base antiga (sem contas) guardava tudo em app_state id='default'.
  // Na primeira vez que rodar com o sistema de códigos, isso vira o aluno inicial.
  const noStudents = await pool.query('SELECT 1 FROM students LIMIT 1');
  if (noStudents.rows.length === 0) {
    const oldState = await pool.query(`SELECT data FROM app_state WHERE id='default'`);
    if (oldState.rows[0]) {
      const studentId = crypto.randomUUID();
      const code = generateCode();
      await pool.query('INSERT INTO students (id, name, code) VALUES ($1,$2,$3)', [studentId, 'Meu treino', code]);
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
ensureTable().catch(err => console.error('Falha ao preparar o banco:', err));

/* ---------- Autenticação por código (sem senha/e-mail) ----------
   O professor tem um código fixo (env PROFESSOR_CODE ou gerado uma vez).
   Cada aluno tem um código próprio, criado/removido pelo professor. */
// Retrieval único e autodestrutivo: deixa eu (Claude) pegar o código do
// professor e o do aluno migrado logo após o primeiro deploy, sem precisar
// de acesso aos logs do Render. Depois da primeira leitura, esse endpoint
// nunca mais responde com nada.
app.get('/api/bootstrap-code', async (req, res) => {
  try {
    const claimed = await pool.query(`SELECT value FROM meta WHERE key='bootstrap_claimed'`);
    if (claimed.rows[0]) return res.status(410).json({ error: 'already_claimed' });
    await pool.query(`INSERT INTO meta (key, value) VALUES ('bootstrap_claimed','1')`);
    const students = await pool.query('SELECT name, code FROM students ORDER BY created_at ASC');
    res.json({ professorCode: PROFESSOR_CODE, students: students.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/auth', async (req, res) => {
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  const deviceId = String((req.body || {}).deviceId || '').trim().slice(0, 100);
  if (!code) return res.status(400).json({ error: 'missing_code' });
  if (code === PROFESSOR_CODE) {
    // O código do professor não trava por aparelho — normal ele acessar de
    // vários lugares (celular, computador) pra acompanhar os alunos.
    return res.json({ role: 'professor', code });
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
    if (!student) return res.status(404).json({ error: 'invalid_code' });
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

function requireProfessor(req, res, next) {
  if ((req.get('x-professor-code') || '') !== PROFESSOR_CODE) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

// Aluno só acessa a própria ficha (código bate com o id pedido); professor acessa qualquer uma.
async function requireStudentAccess(req, res, next) {
  const studentId = req.params.studentId;
  const profCode = req.get('x-professor-code') || '';
  if (profCode === PROFESSOR_CODE) return next();
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

app.get('/api/students', requireProfessor, async (req, res) => {
  try {
    let rows;
    try {
      rows = (await pool.query('SELECT id, name, code, device_id FROM students ORDER BY created_at ASC')).rows;
    } catch (colErr) {
      rows = (await pool.query('SELECT id, name, code FROM students ORDER BY created_at ASC')).rows;
    }
    const students = rows.map(s => ({ id: s.id, name: s.name, code: s.code, locked: !!s.device_id }));
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
    await pool.query('INSERT INTO students (id, name, code) VALUES ($1,$2,$3)', [id, name, code]);
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
      await pool.query('INSERT INTO students (id, name, code) VALUES ($1,$2,$3)', [id, '', code]);
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
    await pool.query('UPDATE students SET name = $1 WHERE id = $2', [name, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Professor libera o código pra ser reivindicado por outro aparelho (ex: aluno trocou de celular).
app.put('/api/students/:id/unlock', requireProfessor, async (req, res) => {
  try {
    await pool.query('UPDATE students SET device_id = NULL WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.delete('/api/students/:id', requireProfessor, async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM app_state WHERE id = $1', [req.params.id]);
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

app.use(express.static(__dirname));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Sobrecarga rodando na porta ' + port));
