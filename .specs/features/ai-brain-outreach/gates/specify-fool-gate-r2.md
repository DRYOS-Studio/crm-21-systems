# Fase 1 — fool-gate (spec) — rodada 2

**Veredito: FAIL** (3 BLOCKER, 9 WARN). Artefato: `spec.md` r2 + `battery/battery-r2.out`. Gate sem Bash (leitura).

## BLOCKERs e resolução

| # | Achado | Verificado pelo TLC | Resolução na r3 |
|---|---|---|---|
| B1 | Corpus negativo de 4 frases mata só 3 de 18 padrões; "edição mínima" passa A5+A5n e mantém `me tira`, `não me envi`, `spam`, `perdeu meu tempo`, `stop`, `tira meu` | **Execução**: 7/7 falsos positivos confirmados no rascunho ("me tira uma dúvida", "vocês não me enviaram o orçamento", "o email caiu no spam", "tira meu nome da nota…", "pode parar o carro…", "você perdeu meu tempo… vamos fechar"; humano: "me passa pra mim o valor") | A5n 4→12 frases, A4n 1→4; `M14` (edição mínima na janela) e `M16` (humano original na janela) morrem; `sonda-corpus.mjs` prova que os corpora são satisfazíveis juntos |
| B2 | Janela D5 só testada para humano; optout correto sobre histórico inteiro passava | leitura `tests.mjs` | AC-A5w; `M15` (edição mínima no histórico) morre |
| B3 | Turno concorrente desfaz optout/escala (sem lock; original evita via `maiorId`, `fluxo.js:135-137`, conferido) | leitura `fluxo.js:130-137`, `whatsapp-webhook/index.ts:207-212,333` | AC-A20 (optout/takeover monotônicos, releitura antes de enviar, contador atômico, aviso idempotente); AC-A13 reescrito |

## WARNs — decisão

- W1 incorporado (D6): `optout=true` só do modelo ⇒ escala, não optout permanente.
- W2 incorporado: AC-A3o (promessa só nas bolhas que saem) — EXEC-LACUNA no rascunho (`brain.ts:309` conta antes do corte).
- W3 **escalado ao Rafael** (Q-R1): conversas inseridas pelo Extrator (`03.dryos_os_extractor/src/components/leadhunter/LeadCard.tsx:75-81`, conferido) — estágio inicial e se AC-B2 as descarta.
- W4: D1 segue pendente do Rafael; bloqueia o Design, não a Specify.
- W5 incorporado: AC-C3 com valor esperado por caso; regra só para número sem DDI.
- W6 incorporado: AC-B6 exige `outreach_daily_cap >= 1` (check no banco).
- W7 aceito: reimportação é barrada por AC-B2 (conversa existente); B14 para a cadência.
- W8 incorporado: AC-A5d (follow-up checa optout no envio).
- W9 incorporado: A4n 4 frases.
