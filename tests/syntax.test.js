const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

test('server.js e sw.js compilam', () => {
  for (const f of ['server.js', 'sw.js', 'lib/ratelimit.js', 'lib/firebase-mirror.js', 'tools/encode-firebase-key.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, f)]);
  }
});

test('app.js compila e o index.html carrega app.js e styles.css', () => {
  assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(root, 'app.js'), 'utf8')));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="/app.js"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="/styles.css">'));
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('');
  assert.ok(inline.length < 2000, 'script inline grande voltou pro index.html');
  assert.ok(!/<style>/.test(html), 'CSS inline voltou pro index.html');
});

test('manifest é JSON válido e aponta pra ícones que existem', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const icon of m.icons) assert.ok(fs.existsSync(path.join(root, icon.src.replace(/^\//, ''))), icon.src);
});

test('nenhum endpoint de recuperação de código voltou', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(!/bootstrap-(admin-)?code/.test(server));
});
