const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, res => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function withServer(fn) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(port), DATABASE_URL: '' };
  delete env.RENDER; delete env.NODE_ENV;
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      try { await get(port, '/'); break; } catch (e) { await new Promise(r => setTimeout(r, 150)); }
    }
    await fn(port);
  } finally { child.kill(); }
}

test('cabeçalhos de segurança presentes e sem x-powered-by', async () => {
  await withServer(async port => {
    const r = await get(port, '/');
    assert.strictEqual(r.status, 200);
    const csp = r.headers['content-security-policy'] || '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self' https:\/\/cdnjs\.cloudflare\.com/);
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'script inline não pode ser liberado');
    assert.ok(!/script-src[^;]*'unsafe-eval'/.test(csp));
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(r.headers['strict-transport-security'] || '', /max-age=/);
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(r.headers['x-frame-options'], 'DENY');
    assert.ok(!r.headers['x-powered-by']);
  });
});

test('só os arquivos do site são públicos', async () => {
  await withServer(async port => {
    for (const p of ['/', '/app.js', '/styles.css', '/sw.js', '/manifest.webmanifest', '/icons/icon-192.png']) {
      assert.strictEqual((await get(port, p)).status, 200, p);
    }
    for (const p of ['/server.js', '/package.json', '/package-lock.json', '/render.yaml', '/README.md',
      '/lib/ratelimit.js', '/tests/smoke.js', '/.gitignore', '/.git/config', '/node_modules/express/package.json', '/..%2fserver.js']) {
      assert.notStrictEqual((await get(port, p)).status, 200, `${p} não pode ser público`);
    }
  });
});

test('index.html não tem script nem estilo inline (CSP sem unsafe-inline em script)', () => {
  const html = read('index.html');
  const inlineJs = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1].trim()).filter(Boolean);
  assert.strictEqual(inlineJs.length, 0);
  assert.ok(!/\son(click|error|load|change|input|submit)\s*=/i.test(html), 'handler inline no HTML');
  assert.ok(!/javascript:/i.test(html));
});

test('todo SQL do servidor é parametrizado (sem interpolar valores)', () => {
  const server = read('server.js');
  const bad = [];
  server.split('\n').forEach((line, i) => {
    // interpolação ${...} dentro de uma query só é aceita na lista fixa de tabelas do RLS
    if (/pool\.query\(`[^`]*\$\{/.test(line) && !/ENABLE ROW LEVEL SECURITY/.test(line)) bad.push(i + 1);
  });
  assert.deepStrictEqual(bad, []);
  assert.ok(!/\bquery\(\s*['"][^'"]*['"]\s*\+/.test(server), 'concatenação de string em query');
});

test('nome de arquivo do PDF é escapado antes de ir pro innerHTML', () => {
  const app = read('app.js');
  assert.ok(!/innerHTML\s*=\s*`[^`]*\$\{file\.name\}/.test(app));
});

test('nenhum segredo nos arquivos versionados', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(f => f && !/\.(png|ico)$/.test(f) && f !== 'package-lock.json' && !f.startsWith('tests/security.test.js'));
  const patterns = [
    [/postgres(ql)?:\/\/[^\s'"]+:[^\s'"@]+@/i, 'connection string com senha'],
    [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, 'JWT (chave do Supabase?)'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
    [/(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/, 'chave de API'],
    [/(api[_-]?key|secret|passw(or)?d|token)\s*[:=]\s*['"][A-Za-z0-9/+_-]{16,}['"]/i, 'segredo literal']
  ];
  const hits = [];
  for (const f of files) {
    let text; try { text = read(f); } catch (e) { continue; }
    for (const [re, what] of patterns) if (re.test(text)) hits.push(`${f}: ${what}`);
  }
  assert.deepStrictEqual(hits, []);
});
