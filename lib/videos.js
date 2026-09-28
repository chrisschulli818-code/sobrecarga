// Vídeos de execução: só links do YouTube. O servidor guarda apenas o id do
// vídeo (11 caracteres), nunca a URL colada — assim nada além de um id
// validado vai parar no player embutido do app.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function youtubeId(input) {
  const s = String(input == null ? '' : input).trim();
  if (YT_ID.test(s)) return s;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
  }
  return id && YT_ID.test(id) ? id : null;
}

// Chave do exercício: nome sem acento, minúsculo, só letras/números. A mesma
// regra está em exerciseKey() no app.js (os testes conferem que batem).
function exerciseKey(name) {
  return String(name == null ? '' : name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

const KEY_RE = /^[a-z0-9 ]{1,80}$/;

module.exports = { youtubeId, exerciseKey, KEY_RE };
