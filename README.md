# Sobrecarga

Diário de treino: importe PDFs, edite séries de reps e peso, e acompanhe a evolução do rendimento por exercício (1RM estimado, ramificado por série).

Backend Node/Express (`server.js`) servindo o app (`index.html`) e uma API (`/api/state`) que lê e grava num banco Postgres — assim os dados sincronizam entre celular, computador etc. O navegador ainda guarda uma cópia em `localStorage` como cache local (funciona offline; sincroniza quando volta a conexão).

## Deploy no Render

Este repositório vem com `render.yaml` (Blueprint) que cria o serviço web **e** o banco Postgres juntos:

1. Se já existir um Static Site antigo chamado `sobrecarga`, apague-o antes (Settings → Delete) para liberar o nome.
2. **New +** → **Blueprint**
3. Selecione este repositório e confirme — o Render cria o banco `sobrecarga-db` e o serviço web `sobrecarga`, já conectados via `DATABASE_URL`.
