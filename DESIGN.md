# Design

## Mundo visual: código das anilhas
O azul da anilha de 20 kg é o casco do app (cabeçalho, botões, seleção). Amarelo, verde e vermelho
das anilhas só carregam significado: recorde (`--record`), feito (`--plate-10`/`--up`), carga caindo (`--down`).
Claro por padrão (luz forte de academia, tom de giz `--bg`); escuro segue o celular (`prefers-color-scheme`).

## Tipografia
Barlow (texto) e Barlow Condensed (números, títulos e rótulos em caixa alta), via `--font-ui` e `--font-num`.
Números sempre tabulares.

## Assinatura
Na tela de registrar série, em exercícios de barra livre, a carga digitada é desenhada como as anilhas de
cada lado da barra (`platesFor`, `isBarbellExercise` em `app.js`). Máquinas, halteres, polias e Smith não mostram.

## Tokens
`styles.css`, bloco `:root` e a seção "Código das anilhas" no fim do arquivo.

## Painel do professor
Triagem primeiro. O topo é o casco azul; as ferramentas ficam em abas fixas (Alunos, Modelos, Avisos, Vídeos).
Cada aluno ganha uma anilha de estado: vermelha = carga caindo, amarela = parado, verde = treinando, cinza = ainda não treinou.
Os indicadores que exigem ação ficam com o número na cor da anilha. A avaliação física, o editor de modelo e o envio
usam o mesmo cabeçalho azul.

## Vocabulário (use sempre estes nomes)
- **Ficha** (antes "protocolo"): o conjunto de treinos e semanas de um período. **Ficha pronta** (antes "modelo"): ficha montada pelo professor para enviar a vários alunos.
- **Treino** (antes "sessão"): um dia de treino, como "Treino A".
- **Meta** (antes "alvo"): faixa de repetições da ficha.
- **Força máxima estimada** (antes "1RM"), **Total levantado** (antes "volume"), **Calorias gastas** (antes "energia"), **Evolução** (antes "rendimento"), **Ficha de saúde** (antes "anamnese").
- **Sem treinar há 7+ dias** (antes "parados"), **Perdendo carga** (antes "carga caindo").
Botões e rótulos em frase normal, não em caixa alta; a fonte condensada fica para números e títulos.

## Organização
O app tem 4 áreas, iguais no celular (abas embaixo) e no computador (abas no topo):
**Início** (treino de hoje, semana, avisos), **Treinos** (meus treinos, importar ficha em PDF, montar pelo músculo),
**Progresso** (total levantado, calorias, evolução) e **Perfil** (avaliação física, relatório em PDF, idioma).
O painel do professor segue a mesma ideia: Alunos, Fichas prontas, Avisos, Vídeos.
