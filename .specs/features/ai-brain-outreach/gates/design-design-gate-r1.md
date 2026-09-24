# Fase 2 — design-gate (design, backend+frontend) — rodada 1

**Veredito: FAIL** (1 BLOCKER, 6 WARN).

| # | Achado | Verificado pelo TLC |
|---|---|---|
| B1 | Canonicalização muda o erro do insert do Extrator (outro repo, grava direto em `conversations`); design trata em 1 frase, sem prova, sem sequência de deploy | leitura `03.dryos_os_extractor/src/components/leadhunter/LeadCard.tsx:52-58` (dedupe por telefone cru), `:75-81` (insert direto), `:82-86` (erro cru no toast) |

WARNs: W1 acoplamento Extrator×schema pré-existente (dívida); W2 loading; W3 estado vazio; W4 responsivo/tema;
W5 sign-off da migração de chave; W6 redação ambígua de `deveEscalarPorConfirmacoes`.
