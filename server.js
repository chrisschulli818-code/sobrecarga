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

app.use(express.static(__dirname));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Sobrecarga rodando na porta ' + port));
