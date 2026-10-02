const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createLimiter } = require('./lib/ratelimit');
const { initFromEnv: initFirebaseMirror } = require('./lib/firebase-mirror');
const { youtubeId, exerciseKey, KEY_RE } = require('./lib/videos');
const Assessment = require('./lib/assessment');
const { summarizeActivity } = require('./lib/activity');
const { sanitizeTemplate, expandTemplate } = require('./lib/templates');

const app = express();
// O Render fica atrás de um proxy: sem isso req.ip seria sempre o do proxy e
// o limite de tentativas valeria pro site inteiro em vez de por pessoa.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Em produção (Render) manda tudo pra HTTPS. Sem isso, um código digitado numa
// rede aberta passaria em texto puro. Localmente (sem RENDER/NODE_ENV) não mexe.
const FORCE_HTTPS = !!process.env.RENDER || process.env.NODE_ENV === 'production';
app.use((req, res, next) => {
  if (FORCE_HTTPS && !req.secure) {
    return res.redirect(301, 'https://' + req.get('host') + req.originalUrl);
  }
  next();
});

// Content-Security-Policy: só scripts do próprio site e das 3 bibliotecas de
// CDN que o app usa (pdf.js, jsPDF, jspdf-autotable), sem script inline — então
// mesmo que algum texto de usuário escapasse do escape de HTML, não executaria.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://i.ytimg.com",
  "connect-src 'self' https://cdnjs.cloudflare.com",
  "worker-src 'self' blob: https://cdnjs.cloudflare.com",
  "manifest-src 'self'",
  // Só o player do YouTube em modo sem cookies (vídeos de execução).
  "frame-src https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  });
  next();
});
// A ficha inteira de um aluno tem alguns KB; 2 MB é folga de sobra.
app.use(express.json({ limit: '2mb' }));

// Chutar códigos: 15 falhas por IP a cada 10 min bloqueia (vale pro login e
// pro pedido de liberação, que também aceita um código sem autenticação).
const authLimiter = createLimiter({ max: 15, windowMs: 10 * 60 * 1000 });
setInterval(() => authLimiter.sweep(), 10 * 60 * 1000).unref();
// Teto geral da API por IP (600 requisições/min): segura abuso/raspagem sem
// atrapalhar quem só treina (a sincronização é ~1 requisição por edição).
const apiLimiter = createLimiter({ max: 600, windowMs: 60 * 1000 });
setInterval(() => apiLimiter.sweep(), 60 * 1000).unref();

// Comparação de segredos em tempo constante (não vaza, pelo tempo de resposta,
// quantos caracteres do código estavam certos).
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

// Formatos aceitos (tudo que vem do cliente é validado antes de tocar no banco).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Z0-9_-]{4,32}$/;
function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

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
  // Gráfico de gasto de energia (kcal): só aparece pra quem o admin liberar.
  // kind='professor' libera todos os alunos daquele professor; kind='student'
  // libera um aluno só. Tabela nova (e não coluna nova) porque ALTER TABLE não
  // tem permissão em produção.
  await pool.query(`CREATE TABLE IF NOT EXISTS energy_access (
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, target_id)
  )`);
  // Segurança em nível de linha, como defesa extra: o dono da tabela (o app)
  // continua acessando normalmente, mas qualquer outra role que ganhe acesso
  // por engano (ex.: a API pública do Supabase) enxerga zero linhas.
  // Vídeos de execução (links do YouTube, guardados só pelo id). scope='global'
  // é a biblioteca do admin (owner_id ''); scope='professor' são os vídeos de
  // um professor (owner_id = id dele), que valem por cima da biblioteca para
  // os alunos dele. exercise_key = nome normalizado (lib/videos.js).
  await pool.query(`CREATE TABLE IF NOT EXISTS exercise_videos (
    scope TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    exercise_key TEXT NOT NULL,
    name TEXT NOT NULL,
    youtube_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, owner_id, exercise_key)
  )`);
  // Avaliação física: anamnese/perfil (1 por aluno) e as avaliações datadas.
  // O conteúdo vai em JSONB (lib/assessment.js valida e recalcula tudo).
  await pool.query(`CREATE TABLE IF NOT EXISTS student_profiles (
    student_id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS assessments (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    assessed_on TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS assessments_student_idx ON assessments (student_id, assessed_on DESC)`);
  // Avisos do professor (student_ids NULL = todos os alunos dele) e modelos de treino.
  await pool.query(`CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    professor_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    student_ids JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS announcements_prof_idx ON announcements (professor_id, created_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS workout_templates (
    id TEXT PRIMARY KEY,
    professor_id TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  for (const t of ['professors', 'app_state_history', 'unlock_requests', 'energy_access', 'exercise_videos',
    'student_profiles', 'assessments', 'announcements', 'workout_templates']) {
    try { await pool.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`); }
    catch (err) { console.error(`Não consegui ativar RLS em ${t}:`, err.message); }
  }
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
// Cópia de segurança no Firebase (Firestore). Só liga se FIREBASE_SERVICE_ACCOUNT_B64
// (ou FIREBASE_SERVICE_ACCOUNT) estiver definida; qualquer falha aqui é só registrada
// e nunca atrapalha o app.
let mirror = null;
try { mirror = initFirebaseMirror(process.env, (...a) => console.error(...a)); }
catch (err) { console.error('Não consegui iniciar o espelho Firebase:', err.message); }
if (mirror) console.log('Espelho Firebase ligado.');

async function runMirrorSync(force) {
  if (!mirror) return null;
  const counts = await mirror.syncAll(pool);
  const snapshot = await mirror.dailySnapshot(pool, { force: !!force });
  return { counts, snapshot };
}
let mirrorTimer = null;
function scheduleMirrorSync() {
  if (!mirror) return;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => runMirrorSync().catch(() => {}), 20 * 1000);
}
setInterval(() => { if (mirror) runMirrorSync().catch(() => {}); }, 6 * 60 * 60 * 1000).unref();

whenReady().then(() => { if (mirror) runMirrorSync().catch(() => {}); }).catch(() => {});
app.use('/api', (req, res, next) => {
  apiLimiter.fail(req.ip);
  if (apiLimiter.blocked(req.ip)) {
    res.set('Retry-After', String(apiLimiter.retryAfterSec(req.ip)));
    return res.status(429).json({ error: 'too_many_requests' });
  }
  next();
});
app.use('/api', (req, res, next) => {
  if (mirror && req.method !== 'GET' && !req.path.startsWith('/state/')) {
    res.on('finish', () => { if (res.statusCode < 400) scheduleMirrorSync(); });
  }
  next();
});
app.use('/api', async (req, res, next) => {
  try { await whenReady(); next(); }
  catch (e) { res.status(503).json({ error: 'starting' }); }
});

// Todo id que chega na URL tem que ter o formato certo (uuid, ou número no
// caso de versão do histórico) — nada de texto livre indo pro banco.
app.param('id', (req, res, next, v) => UUID_RE.test(v) ? next() : res.status(400).json({ error: 'invalid_id' }));
app.param('studentId', (req, res, next, v) => UUID_RE.test(v) ? next() : res.status(400).json({ error: 'invalid_id' }));
app.param('rid', (req, res, next, v) => UUID_RE.test(v) ? next() : res.status(400).json({ error: 'invalid_id' }));
app.param('tid', (req, res, next, v) => UUID_RE.test(v) ? next() : res.status(400).json({ error: 'invalid_id' }));
app.param('aid', (req, res, next, v) => UUID_RE.test(v) ? next() : res.status(400).json({ error: 'invalid_id' }));
app.param('versionId', (req, res, next, v) => /^\d{1,12}$/.test(v) ? next() : res.status(400).json({ error: 'invalid_id' }));

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
  if (!CODE_RE.test(code)) {
    authLimiter.fail(req.ip);
    return res.status(404).json({ error: 'invalid_code' });
  }
  if (safeEqual(code, ADMIN_CODE)) {
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
  if (!CODE_RE.test(code)) { authLimiter.fail(req.ip); return res.json({ ok: true }); }
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

// Falha de credencial nos cabeçalhos também conta pro limite: senão dava pra
// chutar código de professor/admin direto na API, sem passar pelo /api/auth.
function denyCredentials(req, res) {
  authLimiter.fail(req.ip);
  return res.status(403).json({ error: 'forbidden' });
}
function credentialsBlocked(req, res) {
  if (!authLimiter.blocked(req.ip)) return false;
  res.set('Retry-After', String(authLimiter.retryAfterSec(req.ip)));
  res.status(429).json({ error: 'too_many_attempts' });
  return true;
}

function requireAdmin(req, res, next) {
  if (credentialsBlocked(req, res)) return;
  if (!safeEqual(req.get('x-admin-code') || '', ADMIN_CODE)) return denyCredentials(req, res);
  next();
}

// Identifica o professor pelo código enviado no header e anexa req.professorId
// — todas as rotas de aluno abaixo ficam restritas à turma desse professor.
// O admin "navega como" um professor simplesmente usando o código real dele
// (que só o admin consegue ver na própria lista de professores).
async function requireProfessor(req, res, next) {
  if (credentialsBlocked(req, res)) return;
  const code = (req.get('x-professor-code') || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return denyCredentials(req, res);
  try {
    const r = await pool.query('SELECT id FROM professors WHERE code = $1', [code]);
    if (!r.rows[0]) return denyCredentials(req, res);
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
  if (credentialsBlocked(req, res)) return;
  const studentId = req.params.studentId;
  const profCode = (req.get('x-professor-code') || '').trim().toUpperCase();
  if (profCode) {
    try {
      const r = await pool.query(
        'SELECT 1 FROM students s JOIN professors p ON p.id = s.professor_id WHERE s.id = $1 AND p.code = $2',
        [studentId, profCode]
      );
      if (r.rows[0]) return next();
      return denyCredentials(req, res);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'db_error' });
    }
  }
  const studentCode = (req.get('x-student-code') || '').trim().toUpperCase();
  try {
    const r = await pool.query('SELECT 1 FROM students WHERE id = $1 AND code = $2', [studentId, studentCode]);
    if (r.rows[0]) return next();
    denyCredentials(req, res);
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
    const energy = await energyEnabledSet('professor');
    res.json(rows.map(r => ({ id: r.id, name: r.name, code: r.code, studentCount: r.student_count, energy: energy.has(r.id) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/admin/professors', requireAdmin, async (req, res) => {
  const name = cleanText((req.body || {}).name, 60);
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

// Liga/desliga o gráfico de kcal de um professor inteiro (todos os alunos dele)
// ou de um aluno só. Só o admin.
async function energyEnabledSet(kind) {
  try {
    const r = await pool.query('SELECT target_id FROM energy_access WHERE kind = $1', [kind]);
    return new Set(r.rows.map(x => x.target_id));
  } catch (err) {
    console.error('Não consegui ler energy_access:', err.message);
    return new Set();
  }
}
async function setEnergyAccess(kind, id, enabled) {
  if (enabled) {
    await pool.query('INSERT INTO energy_access (kind, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [kind, id]);
  } else {
    await pool.query('DELETE FROM energy_access WHERE kind = $1 AND target_id = $2', [kind, id]);
  }
}
app.put('/api/admin/professors/:id/energy', requireAdmin, async (req, res) => {
  const enabled = (req.body || {}).enabled === true;
  try {
    const r = await pool.query('SELECT 1 FROM professors WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    await setEnergyAccess('professor', req.params.id, enabled);
    res.json({ ok: true, enabled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});
app.put('/api/admin/students/:id/energy', requireAdmin, async (req, res) => {
  const enabled = (req.body || {}).enabled === true;
  try {
    const r = await pool.query('SELECT 1 FROM students WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    await setEnergyAccess('student', req.params.id, enabled);
    res.json({ ok: true, enabled });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});
// O aluno (ou o professor olhando a ficha dele) pergunta quais extras estão liberados.
app.get('/api/features/:studentId', requireStudentAccess, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM energy_access WHERE kind = 'student' AND target_id = $1)
           OR EXISTS (SELECT 1 FROM energy_access e JOIN students s ON s.professor_id = e.target_id
                      WHERE e.kind = 'professor' AND s.id = $1) AS energy`,
      [req.params.studentId]
    );
    res.json({ energy: !!(r.rows[0] && r.rows[0].energy) });
  } catch (err) {
    console.error(err);
    res.json({ energy: false });
  }
});

/* ---------- Vídeos de execução ---------- */
const MAX_VIDEOS_PER_OWNER = 500;
async function listVideos(scope, ownerId) {
  const r = await pool.query(
    'SELECT exercise_key, name, youtube_id FROM exercise_videos WHERE scope = $1 AND owner_id = $2 ORDER BY name',
    [scope, ownerId]
  );
  return r.rows.map(v => ({ key: v.exercise_key, name: v.name, youtubeId: v.youtube_id }));
}
async function saveVideo(req, res, scope, ownerId) {
  const name = cleanText((req.body || {}).name, 80);
  const key = exerciseKey(name);
  const id = youtubeId((req.body || {}).url);
  if (!key) return res.status(400).json({ error: 'missing_name' });
  if (!id) return res.status(400).json({ error: 'invalid_url' });
  try {
    const n = await pool.query('SELECT COUNT(*)::int AS n FROM exercise_videos WHERE scope = $1 AND owner_id = $2', [scope, ownerId]);
    const exists = await pool.query('SELECT 1 FROM exercise_videos WHERE scope = $1 AND owner_id = $2 AND exercise_key = $3', [scope, ownerId, key]);
    if (!exists.rows[0] && n.rows[0].n >= MAX_VIDEOS_PER_OWNER) return res.status(409).json({ error: 'too_many' });
    await pool.query(
      `INSERT INTO exercise_videos (scope, owner_id, exercise_key, name, youtube_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (scope, owner_id, exercise_key) DO UPDATE SET name = $4, youtube_id = $5, updated_at = now()`,
      [scope, ownerId, key, name, id]
    );
    res.json({ ok: true, key, name, youtubeId: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
}
async function deleteVideo(req, res, scope, ownerId) {
  const key = String(req.query.key || '');
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'invalid_key' });
  try {
    await pool.query('DELETE FROM exercise_videos WHERE scope = $1 AND owner_id = $2 AND exercise_key = $3', [scope, ownerId, key]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
}
function sendVideoList(res, fn) {
  fn().then(v => res.json(v)).catch(err => { console.error(err); res.status(500).json({ error: 'db_error' }); });
}
// Biblioteca geral (admin).
app.get('/api/admin/videos', requireAdmin, (req, res) => sendVideoList(res, () => listVideos('global', '')));
app.put('/api/admin/videos', requireAdmin, (req, res) => saveVideo(req, res, 'global', ''));
app.delete('/api/admin/videos', requireAdmin, (req, res) => deleteVideo(req, res, 'global', ''));
// Vídeos do professor (valem por cima da biblioteca para os alunos dele).
app.get('/api/professor/videos', requireProfessor, (req, res) => sendVideoList(res, async () => ({
  global: await listVideos('global', ''), own: await listVideos('professor', req.professorId)
})));
app.put('/api/professor/videos', requireProfessor, (req, res) => saveVideo(req, res, 'professor', req.professorId));
app.delete('/api/professor/videos', requireProfessor, (req, res) => deleteVideo(req, res, 'professor', req.professorId));
// O que o aluno enxerga: biblioteca + vídeos do professor dele (estes ganham).
app.get('/api/videos/:studentId', requireStudentAccess, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT v.scope, v.exercise_key, v.name, v.youtube_id FROM exercise_videos v
       WHERE (v.scope = 'global' AND v.owner_id = '')
          OR (v.scope = 'professor' AND v.owner_id = (SELECT professor_id FROM students WHERE id = $1))`,
      [req.params.studentId]
    );
    const out = {};
    r.rows.sort((a, b) => (a.scope === 'global' ? 0 : 1) - (b.scope === 'global' ? 0 : 1))
      .forEach(v => { out[v.exercise_key] = { name: v.name, youtubeId: v.youtube_id }; });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.json({});
  }
});

/* ---------- Professor: avaliação física, avisos, modelos de treino ---------- */
// Só o professor DONO do aluno (ou o admin navegando como ele) escreve; o
// aluno só lê o que é dele. Mesma checagem de requireStudentAccess, mas
// exigindo o cabeçalho de professor.
async function requireStudentProfessor(req, res, next) {
  if (!(req.get('x-professor-code') || '').trim()) return denyCredentials(req, res);
  return requireStudentAccess(req, res, next);
}

// Avaliação física: perfil/anamnese + avaliações (mais recente primeiro).
app.get('/api/assessment/:studentId', requireStudentAccess, async (req, res) => {
  try {
    const st = await pool.query('SELECT name FROM students WHERE id = $1', [req.params.studentId]);
    const prof = await pool.query('SELECT data FROM student_profiles WHERE student_id = $1', [req.params.studentId]);
    const rows = await pool.query(
      'SELECT id, assessed_on, data FROM assessments WHERE student_id = $1 ORDER BY assessed_on DESC, created_at DESC LIMIT 200',
      [req.params.studentId]
    );
    res.json({
      name: st.rows[0] ? st.rows[0].name : '',
      profile: prof.rows[0] ? prof.rows[0].data : null,
      assessments: rows.rows.map(r => ({ id: r.id, ...r.data, date: r.assessed_on }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});
app.put('/api/assessment/:studentId/profile', requireStudentProfessor, async (req, res) => {
  const data = Assessment.sanitizeProfile(req.body);
  try {
    await pool.query(
      `INSERT INTO student_profiles (student_id, data, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (student_id) DO UPDATE SET data = $2, updated_at = now()`,
      [req.params.studentId, data]
    );
    res.json({ ok: true, profile: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});
async function saveAssessment(req, res, id) {
  try {
    const prof = await pool.query('SELECT data FROM student_profiles WHERE student_id = $1', [req.params.studentId]);
    const a = Assessment.sanitizeAssessment(req.body, prof.rows[0] ? prof.rows[0].data : {});
    if (!a.date) return res.status(400).json({ error: 'missing_date' });
    const { date, ...rest } = a;
    if (id) {
      const r = await pool.query('UPDATE assessments SET assessed_on = $1, data = $2 WHERE id = $3 AND student_id = $4 RETURNING id',
        [date, rest, id, req.params.studentId]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    } else {
      const n = await pool.query('SELECT COUNT(*)::int AS n FROM assessments WHERE student_id = $1', [req.params.studentId]);
      if (n.rows[0].n >= 200) return res.status(409).json({ error: 'too_many' });
      id = crypto.randomUUID();
      await pool.query('INSERT INTO assessments (id, student_id, assessed_on, data) VALUES ($1,$2,$3,$4)', [id, req.params.studentId, date, rest]);
    }
    res.json({ ok: true, assessment: { id, ...rest, date } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
}
app.post('/api/assessment/:studentId/records', requireStudentProfessor, (req, res) => saveAssessment(req, res, null));
app.put('/api/assessment/:studentId/records/:rid', requireStudentProfessor, (req, res) => saveAssessment(req, res, req.params.rid));
app.delete('/api/assessment/:studentId/records/:rid', requireStudentProfessor, async (req, res) => {
  try {
    await pool.query('DELETE FROM assessments WHERE id = $1 AND student_id = $2', [req.params.rid, req.params.studentId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Avisos: o professor publica (pra todos os alunos ou pra alguns) e o aluno lê.
app.get('/api/professor/announcements', requireProfessor, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, title, body, student_ids, created_at FROM announcements WHERE professor_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.professorId]
    );
    res.json(r.rows.map(a => ({ id: a.id, title: a.title, body: a.body, studentIds: a.student_ids, createdAt: a.created_at })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});
app.post('/api/professor/announcements', requireProfessor, async (req, res) => {
  const title = cleanText((req.body || {}).title, 80);
  const body = String((req.body || {}).body == null ? '' : (req.body || {}).body).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, 1000);
  if (!title || !body) return res.status(400).json({ error: 'missing_text' });
  try {
    let ids = null;
    const asked = (req.body || {}).studentIds;
    if (Array.isArray(asked)) {
      const wanted = [...new Set(asked.filter(v => typeof v === 'string' && UUID_RE.test(v)))].slice(0, 200);
      if (!wanted.length) return res.status(400).json({ error: 'no_students' });
      const own = await pool.query('SELECT id FROM students WHERE professor_id = $1 AND id = ANY($2::text[])', [req.professorId, wanted]);
      ids = own.rows.map(x => x.id);
      if (!ids.length) return res.status(400).json({ error: 'no_students' });
    }
    const n = await pool.query('SELECT COUNT(*)::int AS n FROM announcements WHERE professor_id = $1', [req.professorId]);
    if (n.rows[0].n >= 200) {
      await pool.query(`DELETE FROM announcements WHERE id IN (SELECT id FROM announcements WHERE professor_id = $1 ORDER BY created_at ASC LIMIT 20)`, [req.professorId]);
    }
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO announcements (id, professor_id, title, body, student_ids) VALUES ($1,$2,$3,$4,$5)',
      [id, req.professorId, title, body, ids ? JSON.stringify(ids) : null]);
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});
app.delete('/api/professor/announcements/:aid', requireProfessor, async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id = $1 AND professor_id = $2', [req.params.aid, req.professorId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});
app.get('/api/announcements/:studentId', requireStudentAccess, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.id, a.title, a.body, a.created_at FROM announcements a
       JOIN students s ON s.professor_id = a.professor_id
       WHERE s.id = $1 AND a.created_at > now() - interval '45 days'
         AND (a.student_ids IS NULL OR a.student_ids ? $1)
       ORDER BY a.created_at DESC LIMIT 10`,
      [req.params.studentId]
    );
    res.json(r.rows.map(a => ({ id: a.id, title: a.title, body: a.body, createdAt: a.created_at })));
  } catch (err) {
    console.error(err);
    res.json([]);
  }
});

// Modelos de treino do professor + envio pra vários alunos.
app.get('/api/professor/templates', requireProfessor, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, data FROM workout_templates WHERE professor_id = $1 ORDER BY updated_at DESC LIMIT 100', [req.professorId]);
    res.json(r.rows.map(t => ({ id: t.id, ...t.data })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});
async function saveTemplate(req, res, id) {
  const tpl = sanitizeTemplate(req.body);
  if (!tpl) return res.status(400).json({ error: 'invalid_template' });
  try {
    if (id) {
      const r = await pool.query('UPDATE workout_templates SET data = $1, updated_at = now() WHERE id = $2 AND professor_id = $3 RETURNING id', [tpl, id, req.professorId]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    } else {
      const n = await pool.query('SELECT COUNT(*)::int AS n FROM workout_templates WHERE professor_id = $1', [req.professorId]);
      if (n.rows[0].n >= 100) return res.status(409).json({ error: 'too_many' });
      id = crypto.randomUUID();
      await pool.query('INSERT INTO workout_templates (id, professor_id, data) VALUES ($1,$2,$3)', [id, req.professorId, tpl]);
    }
    res.json({ ok: true, template: { id, ...tpl } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
}
app.post('/api/professor/templates', requireProfessor, (req, res) => saveTemplate(req, res, null));
app.put('/api/professor/templates/:tid', requireProfessor, (req, res) => saveTemplate(req, res, req.params.tid));
app.delete('/api/professor/templates/:tid', requireProfessor, async (req, res) => {
  try {
    await pool.query('DELETE FROM workout_templates WHERE id = $1 AND professor_id = $2', [req.params.tid, req.professorId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});
// Envia o modelo: cria um protocolo novo (com as semanas) na ficha de cada
// aluno escolhido. Guarda antes uma versão no histórico, igual ao salvamento
// normal; o aparelho do aluno funde as sessões novas sem perder o que já tem.
app.post('/api/professor/templates/:tid/send', requireProfessor, async (req, res) => {
  const body = req.body || {};
  const wanted = [...new Set((Array.isArray(body.studentIds) ? body.studentIds : []).filter(v => typeof v === 'string' && UUID_RE.test(v)))].slice(0, 100);
  if (!wanted.length) return res.status(400).json({ error: 'no_students' });
  try {
    const t = await pool.query('SELECT data FROM workout_templates WHERE id = $1 AND professor_id = $2', [req.params.tid, req.professorId]);
    if (!t.rows[0]) return res.status(404).json({ error: 'not_found' });
    const tpl = t.rows[0].data;
    const own = await pool.query('SELECT id FROM students WHERE professor_id = $1 AND id = ANY($2::text[])', [req.professorId, wanted]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate || ''))) return res.status(400).json({ error: 'invalid_date' });
    const result = { sent: [], skipped: [] };
    for (const { id: sid } of own.rows) {
      const exp = expandTemplate(tpl, body.startDate, body.weeks, new Date().toISOString().slice(0, 10));
      const cur = await pool.query('SELECT data FROM app_state WHERE id = $1', [sid]);
      const data = (cur.rows[0] && cur.rows[0].data) || { sessions: [], protocols: [] };
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      const protocols = Array.isArray(data.protocols) ? data.protocols : [];
      if (sessions.length + exp.sessions.length > 3000 || protocols.length >= 300) { result.skipped.push(sid); continue; }
      try {
        await pool.query(
          `INSERT INTO app_state_history (student_id, data) SELECT id, data FROM app_state WHERE id = $1
           AND NOT EXISTS (SELECT 1 FROM app_state_history h WHERE h.student_id = $1 AND h.taken_at > now() - interval '30 minutes')`, [sid]);
      } catch (histErr) { console.error('Falha ao guardar histórico (o envio segue):', histErr.message); }
      const next = { sessions: sessions.concat(exp.sessions), protocols: protocols.concat([exp.protocol]) };
      await pool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES ($1,$2,now()) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()`,
        [sid, next]);
      if (mirror) mirror.mirrorState(sid, next).catch(() => {});
      result.sent.push(sid);
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

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
    const energyStudents = await energyEnabledSet('student');
    const energyAll = (await energyEnabledSet('professor')).has(req.professorId);
    const students = rows.map(s => ({
      id: s.id, name: s.name, code: s.code, locked: !!s.device_id, phone: s.phone || '',
      unlockRequested: !!s.unlock_requested,
      energy: energyAll || energyStudents.has(s.id), energyOwn: energyStudents.has(s.id),
      ...summarizeActivity(s.data)
    }));
    res.json(students);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/students', requireProfessor, async (req, res) => {
  const name = cleanText((req.body || {}).name, 60);
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
  const name = cleanText((req.body || {}).name, 60);
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
  const name = cleanText((req.body || {}).name, 60);
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
      await pool.query(`DELETE FROM energy_access WHERE kind = 'student' AND target_id = $1`, [req.params.id]).catch(() => {});
      await pool.query('DELETE FROM student_profiles WHERE student_id = $1', [req.params.id]).catch(() => {});
      await pool.query('DELETE FROM assessments WHERE student_id = $1', [req.params.id]).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Versão da ficha (updated_at em segundos, com microssegundos): o professor
// manda de volta em x-if-version e o servidor recusa o salvamento (409) se o
// aluno gravou nesse meio-tempo — assim editar a ficha nunca apaga cargas novas.
app.get('/api/state/:studentId', requireStudentAccess, async (req, res) => {
  try {
    const r = await pool.query('SELECT data, extract(epoch from updated_at)::text AS v FROM app_state WHERE id = $1', [req.params.studentId]);
    if (r.rows[0]) res.set('X-State-Version', r.rows[0].v);
    res.json(r.rows[0] ? r.rows[0].data : { sessions: [], protocols: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

// Só guarda o que o app realmente usa (sessions e protocols): qualquer outro
// campo que venha no corpo é descartado em vez de ir parar no banco.
function sanitizeState(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.sessions)) return null;
  const protocols = Array.isArray(body.protocols) ? body.protocols : [];
  if (body.sessions.length > 3000 || protocols.length > 300) return null;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!body.sessions.every(isObj) || !protocols.every(isObj)) return null;
  return { sessions: body.sessions, protocols };
}

app.put('/api/state/:studentId', requireStudentAccess, async (req, res) => {
  const data = sanitizeState(req.body);
  if (!data) {
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
    const ifVersion = (req.get('x-if-version') || '').trim();
    let w;
    if (ifVersion) {
      if (!/^\d{1,12}(\.\d{1,6})?$/.test(ifVersion)) return res.status(400).json({ error: 'invalid_version' });
      w = await pool.query(
        `UPDATE app_state SET data = $2, updated_at = now()
         WHERE id = $1 AND extract(epoch from updated_at)::text = $3
         RETURNING extract(epoch from updated_at)::text AS v`,
        [req.params.studentId, data, ifVersion]
      );
      if (!w.rows[0]) return res.status(409).json({ error: 'conflict' });
    } else {
      w = await pool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()
         RETURNING extract(epoch from updated_at)::text AS v`,
        [req.params.studentId, data]
      );
    }
    if (mirror) mirror.mirrorState(req.params.studentId, data).catch(() => {});
    res.json({ ok: true, version: w.rows[0].v });
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
      if (!UUID_RE.test(to) || to === req.params.id) return res.status(409).json({ error: 'has_students', students: own.rows[0].n });
      const dest = await pool.query('SELECT 1 FROM professors WHERE id = $1', [to]);
      if (!dest.rows[0]) return res.status(400).json({ error: 'invalid_transfer' });
      await pool.query('UPDATE students SET professor_id = $1 WHERE professor_id = $2', [to, req.params.id]);
    }
    await pool.query('DELETE FROM professors WHERE id = $1', [req.params.id]);
    await pool.query(`DELETE FROM energy_access WHERE kind = 'professor' AND target_id = $1`, [req.params.id]).catch(() => {});
    await pool.query(`DELETE FROM exercise_videos WHERE scope = 'professor' AND owner_id = $1`, [req.params.id]).catch(() => {});
    await pool.query('DELETE FROM announcements WHERE professor_id = $1', [req.params.id]).catch(() => {});
    await pool.query('DELETE FROM workout_templates WHERE professor_id = $1', [req.params.id]).catch(() => {});
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
    const energyAccess = (await pool.query('SELECT kind, target_id, enabled_at FROM energy_access').catch(() => ({ rows: [] }))).rows;
    const exerciseVideos = (await pool.query('SELECT scope, owner_id, exercise_key, name, youtube_id, updated_at FROM exercise_videos').catch(() => ({ rows: [] }))).rows;
    const studentProfiles = (await pool.query('SELECT student_id, data, updated_at FROM student_profiles').catch(() => ({ rows: [] }))).rows;
    const assessments = (await pool.query('SELECT id, student_id, assessed_on, data, created_at FROM assessments ORDER BY student_id, assessed_on').catch(() => ({ rows: [] }))).rows;
    const announcements = (await pool.query('SELECT id, professor_id, title, body, student_ids, created_at FROM announcements').catch(() => ({ rows: [] }))).rows;
    const workoutTemplates = (await pool.query('SELECT id, professor_id, data, updated_at FROM workout_templates').catch(() => ({ rows: [] }))).rows;
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="sobrecarga-backup-${stamp}.json"`);
    res.json({ exportedAt: new Date().toISOString(), professors, students, states, energyAccess, exerciseVideos, studentProfiles, assessments, announcements, workoutTemplates });
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

// Força a cópia no Firebase agora (e um instantâneo do dia) e devolve o estado.
app.post('/api/admin/firebase-sync', requireAdmin, async (req, res) => {
  if (!mirror) return res.status(409).json({ error: 'firebase_disabled' });
  try {
    const result = await runMirrorSync(true);
    res.json({ ok: true, ...result, status: mirror.status() });
  } catch (err) {
    res.status(502).json({ error: 'firebase_error', status: mirror.status() });
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
    return res.status(503).json({ ok: false });
  }
  // Quem não é admin só vê ok/não ok; o detalhe de quais colunas faltam fica pro admin.
  const isAdmin = safeEqual(req.get('x-admin-code') || '', ADMIN_CODE);
  if (isAdmin) out.firebase = mirror ? mirror.status() : { enabled: false };
  res.status(out.ok ? 200 : 503).json(isAdmin ? out : { ok: out.ok });
});

// JSON malformado ou grande demais vira 400/413 limpo; qualquer erro inesperado
// vira 500 genérico (sem stack trace nem mensagem interna na resposta).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) return res.status(400).json({ error: 'invalid_json' });
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

// Serve só o que é do site — antes servia a pasta inteira, inclusive
// server.js e package.json.
const PUBLIC_FILES = new Set([
  'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'sw.js',
  'lib/assessment.js',
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
