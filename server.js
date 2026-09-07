const express = require('express');
const path = require('path');
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
  // A dieta foi removida do app; a tabela de fotos existia só para ela.
  await pool.query('DROP TABLE IF EXISTS photos');
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

app.use(express.static(__dirname));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Sobrecarga rodando na porta ' + port));
