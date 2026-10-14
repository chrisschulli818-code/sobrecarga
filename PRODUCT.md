# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Alunos de academia que registram o treino no celular, de pé, entre as séries (pressa, mão suada, tela pequena). Professores/coaches que acompanham vários alunos, montam fichas e fazem avaliação física, no celular ou no computador. O administrador (dono) gerencia professores e liberações.

## Product Purpose
Diário de treino em português: o aluno importa a ficha em PDF (separada em dias automaticamente), registra peso e repetições de cada série e acompanha recordes, evolução (1RM estimado) e gasto de energia (kcal). Sucesso é o aluno registrar o treino inteiro sem atrito e o professor enxergar quem treina, quem parou e quem perdeu carga.

## Positioning
Sobrecarga progressiva de verdade, ligada ao professor: a ficha em PDF vira treino, o registro vira recorde ou alerta de queda de carga, e o professor vê tudo, monta fichas, aplica avaliação física com PDF e manda avisos. Funciona como app instalável, inclusive offline na academia.

## Operating Context
Uso na academia, no celular (PWA instalável, abre sem internet). Fichas chegam como PDF de formatos variados (listas, tabelas, protocolos como Heavy Duty). Professor usa painel de acompanhamento, avaliação física (IMC, Pollock 7 dobras) e exporta PDFs. Deploy no Render a partir da `master`; dados em Postgres (Supabase).

## Capabilities and Constraints
- Contas por código (admin, professor, aluno); sem recuperação de código.
- Importação de PDF no navegador (pdf.js), 4 semanas de sessões por protocolo; edição manual da ficha.
- Recordes, 1RM, energia em kcal (liberada pelo admin), vídeos de execução (YouTube), avaliação física com PDF, avisos e modelos de ficha para turmas.
- Single-page vanilla JS (`app.js`, `index.html`, `styles.css`), sem framework nem build; precisa continuar leve e funcionar offline.
- Idiomas pt/en. Textos em português são a base.

## Brand Commitments
Nome "Sobrecarga". O verde `#3b703d` do visual atual NÃO é compromisso de marca: o usuário pediu para substituir o visual por completo.

## Evidence on Hand
Sem depoimentos, clientes ou métricas reais; não inventar. Existe conteúdo real de fichas (Protocolo Heavy Duty) e dados de teste sintéticos.

## Product Principles
- Registrar uma série deve levar segundos, com uma mão.
- O número importante (carga, reps, recorde) sempre domina o texto.
- O professor enxerga o que exige ação antes do que é só informação.
- Funciona mal-conectado e instalado, como ferramenta de academia, não como site.

## Accessibility & Inclusion
Leitura sob luz forte de academia e com pressa; alvos de toque grandes; contraste alto. Sem requisito formal além disso.
