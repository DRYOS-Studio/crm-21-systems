# Fase 2 — security-gate (design) — rodada 2

**Veredito: FAIL** (2 BLOCKER, 6 WARN). Gate sem Bash (leitura).

| # | Achado | Verificado pelo TLC |
|---|---|---|
| B1 | Secret do ADR-11 anexado/devolvido por `manage-instance`, que não autentica o chamador (anon key basta), usa `webhook_url` do body e cai no token global | leitura `manage-instance/index.ts:23-60` (sem `getUser`, fallback global `:48-59`), `:262` (`webhook_url` do body), `:293-313` (`get_webhooks` devolve o corpo da Uazapi) |
| B2 | `prospects` sem RLS/policy exigida no design; §3.0 sem regra "RLS em toda tabela nova" | leitura `design.md` r2 §3.0/§3.3 |

WARNs: W1 revoke por coluna inócuo com grant de tabela (`q7_init.sql:104`); W2 frase "todo efeito exige autenticado" falsa
(upsert/insert/triggers antes da bifurcação); W3 `s` em log de `manage-instance`; W4 revoke/grant em toda RPC com `p_user`;
W5 índice único do secret no schema + `?s=` vazio = 401; W6 limite de tamanho em `canon_phone_input_batch`.
