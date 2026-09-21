# Sobrecarga

Diário de treino: importe a ficha em PDF, registre peso e repetições de cada série e acompanhe recordes e evolução (1RM estimado). Funciona no celular como app instalável e abre sem internet.

## Como é feito

- `index.html`, `styles.css`, `app.js` — o app (JavaScript puro, sem build). `sw.js` + `manifest.webmanifest` + `icons/` o tornam instalável/offline.
- `server.js` — Express + Postgres (`pg`). Serve **só** os arquivos do site (lista em `PUBLIC_FILES`) e a API.
- `lib/ratelimit.js` — limite de tentativas de login.
- `tests/` — testes (`npm test`) e verificação pós-deploy (`npm run smoke`).
- `tools/make-icons.js` — gera os ícones (`node tools/make-icons.js`).

## Acesso (sem e-mail/senha, só códigos)

| Quem | Como entra | O que vê |
|---|---|---|
| **Admin** | código de admin | cadastra/remove professores, baixa backup, restaura versões |
| **Professor** | código próprio | só os alunos dele; pode ver a ficha, liberar aparelho, ligar no WhatsApp |
| **Aluno** | código próprio | só a própria ficha |

- Código de aluno fica **travado no primeiro aparelho** que entrar. Se trocar de celular, o aluno toca em "Pedir liberação ao professor" e o professor libera (🔓) no painel.
- 15 tentativas de código errado por IP em 10 min bloqueiam o login por um tempo.
- Os códigos de admin e do professor original vêm das variáveis `ADMIN_CODE` e `PROFESSOR_CODE` (ou são gerados e guardados na tabela `meta`).

## Variáveis de ambiente (Render)

| Nome | Para quê |
|---|---|
| `DATABASE_URL` | connection string do Postgres (Supabase, schema `sobrecarga`) |
| `ADMIN_CODE` | (opcional) fixa o código do admin |
| `PROFESSOR_CODE` | (opcional) fixa o código do professor original |

## Banco de dados — importante

As tabelas são criadas sozinhas na inicialização (`ensureTable`). **Colunas novas em tabelas que já existem** (`ALTER TABLE`) precisam de permissão que a role do app não tem em produção — rode no SQL Editor do Supabase, como admin, **antes** de publicar código que dependa delas:

```sql
ALTER TABLE sobrecarga.students ADD COLUMN IF NOT EXISTS professor_id TEXT;
ALTER TABLE sobrecarga.students ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE sobrecarga.students ADD COLUMN IF NOT EXISTS phone TEXT;
```

(Já aplicadas na produção atual.) `GET /api/health` responde 503 e diz qual coluna falta.

## Backup e recuperação de dados

O plano gratuito do Supabase **não tem backup**. Por isso o app se protege sozinho:

- **Histórico de versões:** antes de sobrescrever a ficha de um aluno, guarda a versão anterior (no máx. 1 a cada 30 min por aluno, por 30 dias). Ver versões: `GET /api/admin/history/:studentId` (header `x-admin-code`). Restaurar: `POST /api/admin/history/:studentId/restore/:versionId`.
- **Backup completo:** botão **⬇ backup** na área do admin (ou `GET /api/admin/export`) baixa um JSON com professores, alunos (com códigos) e fichas. Guarde o arquivo em local privado — ele contém os códigos de acesso.
- Sugestão: baixar um backup por semana.

## Desenvolvimento

```bash
npm install
npm test                  # testes (leitor de PDF, limite de login, sintaxe)
DATABASE_URL=... npm start
npm run smoke -- https://sobrecarga.onrender.com   # confere o site publicado depois de um deploy
```

O CI (GitHub Actions) roda `npm test` em todo push e pull request. Recomendado: em **Settings → Branches**, proteger a `master` exigindo o CI passar e uma revisão antes do merge.

### Importação de PDF

O leitor (`parseLines` em `app.js`) reconhece vários formatos: `4x10 60kg`, `3 séries de 12 repetições`, `4  8 a 12`, `peso: 25kg`, `@20kg`, `até a falha`/`MAX`, numeração (`1) Supino`), nome numa linha e dados na seguinte, e PDFs com vários dias (`TREINO A`, `Segunda-feira`…). Se uma ficha real for lida errado, adicione a linha em `tests/parser.test.js` com o resultado esperado, corrija e rode os testes.

## Deploy no Render

O banco é um projeto Supabase (não expira), configurado manualmente: cole a connection string em **Environment → `DATABASE_URL`**. O `render.yaml` só descreve o serviço web. O plano gratuito "dorme" após um tempo parado; o primeiro acesso depois pode demorar alguns segundos.
