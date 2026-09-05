const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '8mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function ensureTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}
ensureTable().catch(err => console.error('Falha ao preparar o banco:', err));

app.get('/api/state', async (req, res) => {
  try {
    const r = await pool.query('SELECT data FROM app_state WHERE id = $1', ['default']);
    res.json(r.rows[0] ? r.rows[0].data : { sessions: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.put('/api/state', async (req, res) => {
  const data = req.body;
  if (!data || !Array.isArray(data.sessions)) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  try {
    await pool.query(
      `INSERT INTO app_state (id, data, updated_at) VALUES ('default', $1, now())
       ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`,
      [data]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/photos', async (req, res) => {
  const { data, mime } = req.body || {};
  if (!data || !mime || !mime.startsWith('image/')) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  try {
    const id = crypto.randomUUID();
    const buf = Buffer.from(data, 'base64');
    await pool.query('INSERT INTO photos (id, mime, data) VALUES ($1, $2, $3)', [id, mime, buf]);
    res.json({ id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/photos/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT mime, data FROM photos WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).end();
    res.set('Content-Type', r.rows[0].mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(r.rows[0].data);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.delete('/api/photos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM photos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/recognize-food', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: 'not_configured', message: 'Reconhecimento por foto não está configurado neste servidor (falta ANTHROPIC_API_KEY).' });
  }
  const { data, mime } = req.body || {};
  if (!data || !mime || !mime.startsWith('image/')) {
    return res.status(400).json({ error: 'invalid_body' });
  }
  try {
    const prompt = `Você está olhando uma foto de comida/refeição. Identifique cada alimento visível e estime, para o que está na foto (não por 100g, e sim a porção real que aparece):
- name: nome do alimento em português
- grams: peso estimado em gramas da porção visível
- kcal: calorias estimadas dessa porção
- protein: proteína em gramas dessa porção
- carbs: carboidratos em gramas dessa porção
- fat: gordura em gramas dessa porção

Responda APENAS com um JSON válido no formato:
{"items":[{"name":"...", "grams":0, "kcal":0, "protein":0, "carbs":0, "fat":0}]}
Sem nenhum texto antes ou depois do JSON. Se não conseguir identificar nada, responda {"items":[]}.`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Anthropic API error:', apiRes.status, errText);
      return res.status(502).json({ error: 'ai_error', message: 'Falha ao consultar a IA de reconhecimento.' });
    }

    const apiData = await apiRes.json();
    const text = (apiData.content || []).map(b => b.text || '').join('').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ items: [] });
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return res.json({ items: [] });
    }
    const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 15).map(it => ({
      name: String(it.name || 'Alimento').slice(0, 80),
      grams: Number(it.grams) || 0,
      kcal: Number(it.kcal) || 0,
      protein: Number(it.protein) || 0,
      carbs: Number(it.carbs) || 0,
      fat: Number(it.fat) || 0
    })) : [];
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  }
});

app.use(express.static(__dirname));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Sobrecarga rodando na porta ' + port));
