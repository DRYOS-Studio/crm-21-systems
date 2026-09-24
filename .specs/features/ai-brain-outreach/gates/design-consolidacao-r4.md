# Fase 2 — fool-gate r4 (autorizada pelo Rafael) + consolidação → design r5

**fool-gate r4: FAIL** (2 BLOCKER, 10 WARN). Gate sem Bash (leitura). TLC concorda com os 2.

| # | Achado | Verificado pelo TLC | Resolução (r5) |
|---|---|---|---|
| B1 | §4.1 passo 9 comita optout sem `p_desligar` ⇒ com agente off a conversa fica `optout` com IA ligada; religar o agente volta a vender | leitura `design.md` r4 §4.1 passo 9 × §3.1 (`ai_enabled and not p_desligar`) | RPC: `p_optout` sempre desliga; passo 9 usa o mesmo ramo optout de §4.2 |
| B2 | `dry_run` da UI com `s` grava `confirmed_at` sem prova de que a Uazapi manda o `s` ⇒ 401 em todo inbound e disparo liberado cego | leitura `design.md` r4 §4.1 passo 1; `ConfigDrawer.tsx:305-313` (diagnóstico roda mesmo com `set_webhook` falhando) | só evento `messages` real confirma; `dry_run`/`test`/`connection` nunca |

## WARNs — decisão
- W1 **medido e fechado**: `20260924000000` aplicada inteira em prod (índices, check, unique antigo removido, nullable) — `repair` seguro.
- W2 incorporado: rotação em 2 fases (`rotate_begin` → Uazapi → `rotate_commit`) + `secret_prev` por 10 min.
- W3 incorporado: `mark_uncertain` grava `sent_at = now()` no timeout; fluxo não chama `mark_sent` depois; outbound gravada.
- W4 incorporado: cadência do `incerto` aplicada por `proximoToque` (TS) via `mark_uncertain`; SQL não reimplementa AC-B9.
- W5 incorporado: RPC devolve só o secret; URL por helper único fora do banco.
- W6 incorporado: todo uso de `webhookUrl` (`ConfigDrawer.tsx:393,306,441,616`) substituído; status de confirmação na UI.
- W7 incorporado na spec (AC-D1): `CLAUDE.md:199-201,304,341`, `INSTALL.md:120-122`; prova por `grep` do padrão da URL.
- W8 incorporado: assinatura do RPC com `flipped_optout`; ADR-04/ADR-11 atualizados.
- W9/W10 incorporados sem exceção: despedida segue AC-A5c mesmo com agente off/takeover (exceção removida).
