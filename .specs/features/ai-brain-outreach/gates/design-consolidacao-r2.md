# Fase 2 — consolidação da rodada 2 → design r3

fool-gate r2: **morreu** (limite de uso da API, 429) ⇒ tratado como FAIL pelo protocolo (fail-closed); re-spawn sobre a r3.

## BLOCKERs (4) → resolução
| Gate | # | Resolução (design r3) |
|---|---|---|
| security | B1 secret entregue por `manage-instance` sem auth | ADR-11 reescrito; secret em `private.instance_webhook_secrets` + RPCs; `set_webhook`/`get_webhooks` com `auth.getUser()` + dono; URL montada no servidor; `s` redigido (§3.1, §6) |
| security | B2 `prospects` sem RLS | §3.0: RLS + policy em **toda** tabela nova; AC-U3 com CRUD cruzado (§8) |
| design | B1 Extrator chama RPC que ainda não existe | Extrator só trata 23505; sem RPC; ordem de deploy deixa de importar para a correção (§3.2) |
| design | B2 `canon_phone` exposto sem grant/contradição ADR-06 | some com o B1: `canon_phone` não é chamado pelo client; §3.0 regra de revoke/grant em toda função |

## WARNs — decisão
- sec W1 incorporado: secret fora de `whatsapp_instances` (grant de tabela `q7_init.sql:104` anularia revoke por coluna).
- sec W2 incorporado: frase corrigida; `run-outreach` exige webhook confirmado (§4.1, §4.4).
- sec W3 incorporado: `s` redigido em resposta e log de `manage-instance` (§6).
- sec W4 incorporado: revoke + grant `service_role` em toda função nova; teste S (§3.0, §8 AC-U3).
- sec W5 incorporado: `searchParams.has('s')`, vazio ⇒ 401; `unique` no schema (§3.1, §4.1).
- sec W6 incorporado: limite de 5000 no batch (§3.2).
- design W1 incorporado: erro do `save_openers` inline (§6).
- design W2 aceito: dívida Extrator×schema (sem RPC nova, não aprofunda mais).
- TLC (achado próprio): PostgREST não expõe `private` ⇒ RPCs de acesso ao secret (§3.1).
- → Rafael: `manage-instance` inteiro sem auth e com fallback ao token global (pré-existente, fora de escopo).
