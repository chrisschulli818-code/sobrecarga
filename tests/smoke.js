// Verificação rápida DEPOIS de um deploy, contra o site publicado (só leitura):
//   node tests/smoke.js https://sobrecarga.onrender.com
// Opcional: SMOKE_PROFESSOR_CODE=XXXX confere também a lista de alunos.
const base = (process.argv[2] || process.env.BASE_URL || 'https://sobrecarga.onrender.com').replace(/\/$/, '');
let failed = 0;

async function check(name, fn) {
  try { await fn(); console.log('ok   ', name); }
  catch (e) { failed++; console.log('FALHA', name, '-', e.message); }
}
const need = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  await check('página inicial abre', async () => {
    const r = await fetch(base + '/'); need(r.status === 200, 'status ' + r.status);
    need((await r.text()).includes('Sobrecarga'), 'sem o título');
  });
  await check('esquema do banco completo (/api/health)', async () => {
    const r = await fetch(base + '/api/health'); const j = await r.json();
    need(r.status === 200 && j.ok, 'colunas faltando: ' + JSON.stringify(j.columns));
  });
  for (const p of ['/server.js', '/package.json', '/render.yaml', '/lib/ratelimit.js', '/api/bootstrap-code', '/api/bootstrap-admin-code']) {
    await check(`${p} NÃO é público`, async () => {
      const r = await fetch(base + p); need(r.status === 404, 'status ' + r.status);
    });
  }
  await check('código inválido é recusado', async () => {
    const r = await fetch(base + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'ZZZZZZ' }) });
    need(r.status === 404 || r.status === 429, 'status ' + r.status);
  });
  await check('lista de alunos exige login', async () => {
    const r = await fetch(base + '/api/students'); need(r.status === 403, 'status ' + r.status);
  });
  if (process.env.SMOKE_PROFESSOR_CODE) {
    await check('professor consegue listar alunos', async () => {
      const r = await fetch(base + '/api/students', { headers: { 'x-professor-code': process.env.SMOKE_PROFESSOR_CODE } });
      need(r.status === 200, 'status ' + r.status);
    });
  }
  console.log(failed ? `\n${failed} verificação(ões) falharam` : '\ntudo certo');
  process.exit(failed ? 1 : 0);
})();
