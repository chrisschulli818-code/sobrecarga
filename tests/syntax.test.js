const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

test('server.js e sw.js compilam', () => {
  for (const f of ['server.js', 'sw.js', 'lib/ratelimit.js']) {
    execFileSync(process.execPath, ['--check', path.join(root, f)]);
  }
});

test('todos os <script> inline do index.html compilam', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(blocks.length > 0);
  blocks.forEach((code, i) => assert.doesNotThrow(() => new Function(code), `script #${i}`));
});

test('manifest é JSON válido e aponta pra ícones que existem', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const icon of m.icons) assert.ok(fs.existsSync(path.join(root, icon.src.replace(/^\//, ''))), icon.src);
});

test('nenhum endpoint de recuperação de código voltou', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(!/bootstrap-(admin-)?code/.test(server));
});
