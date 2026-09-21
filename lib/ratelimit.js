// Limitador simples em memória: conta tentativas FALHAS por chave (IP) numa
// janela de tempo. Não conta sucessos de propósito — senão quem tem um código
// válido zeraria o contador e poderia continuar chutando os dos outros.
function createLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map(); // chave -> [timestamps]

  function recent(key) {
    const cutoff = now() - windowMs;
    const list = (hits.get(key) || []).filter(t => t > cutoff);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  }

  return {
    blocked(key) { return recent(key).length >= max; },
    fail(key) { const list = recent(key); list.push(now()); hits.set(key, list); },
    retryAfterSec(key) {
      const list = recent(key);
      if (list.length < max) return 0;
      return Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000));
    },
    sweep() { for (const key of [...hits.keys()]) recent(key); },
    size() { return hits.size; }
  };
}

module.exports = { createLimiter };
