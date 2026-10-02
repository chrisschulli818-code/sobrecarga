// Resumo de cada aluno para o painel de acompanhamento do professor:
// quando treinou por último, frequência, recordes recentes e carga caindo.
// "Treino feito" = sessão com pelo menos uma série com carga anotada.

const DAY = 86400000;
const isoDay = d => d.toISOString().slice(0, 10);
const epley = (w, r) => (w > 0 && r > 0 ? w * (1 + r / 30) : 0);

function mondayOf(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return isoDay(d);
}

function summarizeActivity(data, now) {
  now = now || new Date();
  const today = isoDay(now);
  const monday = mondayOf(now);
  const sundayEnd = isoDay(new Date(Date.parse(monday + 'T00:00:00Z') + 6 * DAY));
  const ago = n => isoDay(new Date(Date.parse(today + 'T00:00:00Z') - n * DAY));
  const sessions = (data && Array.isArray(data.sessions)) ? data.sessions.filter(s => s && typeof s.date === 'string') : [];
  const isDone = s => Array.isArray(s.exercises) && s.exercises.some(e => e && Array.isArray(e.sets) && e.sets.some(t => t && t.weight > 0));
  const done = sessions.filter(isDone);
  const dates = done.map(s => s.date).sort();

  // Melhor 1RM estimado de cada exercício em cada sessão, em ordem de data.
  const byEx = {};
  done.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(s => {
    s.exercises.forEach(e => {
      if (!e || !e.name) return;
      const top = Math.max(0, ...((e.sets || []).map(t => epley(t && t.weight, t && t.reps))));
      if (!(top > 0)) return;
      const key = String(e.name).trim().toLowerCase();
      (byEx[key] = byEx[key] || { name: String(e.name).trim(), pts: [] }).pts.push({ date: s.date, rm: top });
    });
  });
  const records = [], drops = [];
  Object.values(byEx).forEach(({ name, pts }) => {
    if (pts.length < 2) return;
    const last = pts[pts.length - 1];
    if (last.date < ago(30)) return;
    const prevBest = Math.max(...pts.slice(0, -1).map(p => p.rm));
    if (last.rm > prevBest) records.push(name);
    else if (last.rm < prevBest * 0.9) drops.push(name);
  });

  return {
    lastTrainedAt: dates.length ? dates[dates.length - 1] : null,
    weekDone: done.filter(s => s.date >= monday && s.date <= sundayEnd).length,
    weekPlanned: sessions.filter(s => s.date >= monday && s.date <= sundayEnd).length,
    done28: done.filter(s => s.date >= ago(27) && s.date <= today).length,
    sessionsTotal: sessions.length,
    records30: records.sort(),
    loadDrops: drops.sort()
  };
}

module.exports = { summarizeActivity };
