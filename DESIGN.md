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
