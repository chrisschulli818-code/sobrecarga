// Modelos de treino do professor: a divisão de uma semana (dias, exercícios,
// séries com alvo de reps e carga sugerida) que pode ser enviada para vários
// alunos. Ao enviar, vira um protocolo novo na ficha de cada aluno, com a
// divisão repetida por N semanas a partir da data escolhida.

const crypto = require('crypto');

const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Só o que um modelo precisa; tudo validado e com limites.
function sanitizeTemplate(input) {
  const i = input || {};
  const name = text(i.name, 60);
  const days = (Array.isArray(i.days) ? i.days : []).slice(0, 14).map(d => ({
    name: text(d && d.name, 60) || 'Treino',
    offset: int(d && d.offset, 0, 6, 0),
    exercises: (Array.isArray(d && d.exercises) ? d.exercises : []).slice(0, 30).map(e => ({
      name: text(e && e.name, 80),
      sets: (Array.isArray(e && e.sets) ? e.sets : []).slice(0, 12).map(s => ({
        reps: int(s && s.reps, 0, 100, 10),
        target: text(s && s.target, 20),
        weight: (() => { const w = parseFloat(String(s && s.weight != null ? s.weight : '').replace(',', '.')); return Number.isFinite(w) && w > 0 && w < 1000 ? Math.round(w * 4) / 4 : 0; })()
      }))
    })).filter(e => e.name && e.sets.length)
  })).filter(d => d.exercises.length);
  if (!name || !days.length) return null;
  return { name, weeks: int(i.weeks, 1, 52, 4), days };
}

const uid = () => crypto.randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || crypto.randomUUID().slice(0, 8);

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Segunda-feira da semana de uma data (offset 0 do modelo = segunda).
function mondayOf(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

// Gera o protocolo e as sessões a partir da semana de startDate (sem carga
// anotada: a carga do modelo vai como "sugerida", no campo target, para o
// aluno preencher ao treinar).
function expandTemplate(tpl, startDate, weeks, todayIso) {
  if (!ISO.test(String(startDate || ''))) return null;
  startDate = mondayOf(startDate);
  const n = int(weeks, 1, 52, tpl.weeks || 4);
  const protocol = { id: uid(), name: tpl.name, createdAt: todayIso || new Date().toISOString().slice(0, 10) };
  const sessions = [];
  for (let w = 0; w < n; w++) {
    tpl.days.forEach(day => {
      sessions.push({
        id: uid(),
        protocolId: protocol.id,
        date: addDays(startDate, 7 * w + day.offset),
        name: day.name,
        exercises: day.exercises.map(e => ({
          id: uid(),
          name: e.name,
          sets: e.sets.map(s => ({
            reps: s.reps,
            weight: 0,
            target: s.target + (s.weight ? `${s.target ? ' · ' : ''}${String(s.weight).replace('.', ',')}kg` : '')
          }))
        }))
      });
    });
  }
  return { protocol, sessions };
}

module.exports = { sanitizeTemplate, expandTemplate, addDays, mondayOf };
