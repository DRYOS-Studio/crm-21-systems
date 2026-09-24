# Fase 2 — design-gate (design) — rodada 2

**Veredito: FAIL** (2 BLOCKER, 2 WARN).

| # | Achado | Verificado pelo TLC |
|---|---|---|
| B1 | Rollout manda o Extrator (passo 1) chamar `rpc canon_phone`, que só nasce na migration do passo 3 ⇒ "Enviar para CRM" quebra na janela | leitura `design.md` r2 §3.2 "Dependência de deploy cross-repo" × §9 passos 1/3; `grep canon_phone supabase/migrations` só no rascunho de design |
| B2 | ADR-06 diz que só `canon_phone_input` é RPC de UI; §3.2 expõe `canon_phone` ao Extrator sem grant declarado | leitura `adr.md` ADR-06 × `design.md` §3.2 |

WARNs: W1 mensagem/local do erro de `save_openers` (AC-B22) não especificados na UI; W2 dívida Extrator×schema aprofundada pela RPC.
