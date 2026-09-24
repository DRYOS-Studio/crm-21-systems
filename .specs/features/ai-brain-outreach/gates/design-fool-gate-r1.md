# Fase 2 — fool-gate (design) — rodada 1

**Veredito: FAIL** (5 BLOCKER, 17 WARN). Gate sem Bash (leitura).

| # | Achado | Verificado pelo TLC |
|---|---|---|
| B1 | Regra de parada por **estado** (`optout && !flipped_optout`) cala para sempre conversa com optout religada pelo humano; `ai_stage` "optout (novo)" ambíguo quebra AC-A19 ou AC-A20 | leitura `design.md` r1 §4.2 e §3.1 (`brain_commit_turn`) |
| B2 | Despedida do optout sem gate de transição ⇒ "pare" + "PARE!" = 2 despedidas | leitura `design.md` r1 §4.2 ramo optout |
| B3 | Espaçamento medido na reserva; texto de toque 2/3 gerado depois ⇒ 2 envios < intervalo; mesmo prospect re-escolhível | leitura `design.md` r1 §3.3 `outreach_reserve`, §4.4 |
| B4 | `{empresa}` na D8 é a empresa de quem envia; design preenche com `prospects.company`; não existe campo com o nome da empresa do tenant | leitura `spec.md:58-62`, `q7_init.sql:162-172` (sem coluna de nome da empresa) |
| B5 | Sem ordem de rollout: função antes da migration perde todo inbound (insert sem checagem de erro); migration antes da função deixa backlog `processed_at NULL` virar janela | leitura `whatsapp-webhook/index.ts:324-330`; `CLAUDE.md:162-166` (instalação aplica só o init) |

WARNs e decisão: ver `design-consolidacao-r1.md`.
