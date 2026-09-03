# Sobrecarga

Diário de treino: importe PDFs, edite séries de reps e peso, e acompanhe a evolução do rendimento por exercício (1RM estimado, ramificado por série).

Site estático de arquivo único (`index.html`). Sem build, sem backend — os dados ficam salvos no `localStorage` do navegador de quem acessa.

## Deploy no Render

Este repositório já vem com `render.yaml` (Blueprint). No Render:

1. **New +** → **Blueprint**
2. Selecione este repositório
3. Confirme — o Render detecta o `render.yaml` e cria o site estático automaticamente

Ou manualmente: **New +** → **Static Site** → selecione o repositório → Build Command vazio → Publish Directory `.`
