const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { youtubeId, exerciseKey } = require('../lib/videos');
const { loadFunctions } = require('./helpers/load-app-functions');

const app = loadFunctions(['exerciseKey', 'baseExerciseKey', 'findVideo']);

test('aceita os formatos de link do YouTube e guarda só o id', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`
  ]) assert.strictEqual(youtubeId(url), id, url);
});

test('recusa o que não é vídeo do YouTube', () => {
  for (const bad of [
    '', null, 'abc', 'https://vimeo.com/123456',
    'https://evil.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>',
    'javascript:alert(1)',
    'https://www.instagram.com/reel/abc/'
  ]) assert.strictEqual(youtubeId(bad), null, String(bad));
});

test('nome do exercício vira a mesma chave no servidor e no app', () => {
  for (const name of ['Supino reto (barra)', 'Elevação Lateral', '  AGACHAMENTO   livre ', 'Remada unilateral — halter', 'Crucifixo invertido 45°']) {
    assert.strictEqual(app.exerciseKey(name), exerciseKey(name), name);
  }
  assert.strictEqual(exerciseKey('Elevação Lateral'), 'elevacao lateral');
  assert.strictEqual(exerciseKey('Supino reto (barra)'), 'supino reto barra');
});

test('acha o vídeo pelo nome, com ou sem o que está entre parênteses', () => {
  const map = {
    'supino reto barra': { name: 'Supino reto (barra)', youtubeId: 'AAAAAAAAAAA' },
    'elevacao lateral': { name: 'Elevação lateral', youtubeId: 'BBBBBBBBBBB' }
  };
  assert.strictEqual(app.findVideo(map, 'Supino Reto (barra)').youtubeId, 'AAAAAAAAAAA');
  assert.strictEqual(app.findVideo(map, 'supino reto').youtubeId, 'AAAAAAAAAAA');
  assert.strictEqual(app.findVideo(map, 'Elevação lateral (halteres)').youtubeId, 'BBBBBBBBBBB');
  assert.strictEqual(app.findVideo(map, 'Agachamento'), null);
  assert.strictEqual(app.findVideo(map, ''), null);
});

test('CSP libera só o player sem cookies do YouTube', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /"frame-src https:\/\/www\.youtube-nocookie\.com"/);
  assert.match(server, /"frame-ancestors 'none'"/);
});
