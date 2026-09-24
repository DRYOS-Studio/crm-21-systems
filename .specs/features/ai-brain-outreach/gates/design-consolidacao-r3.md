# Fase 2 — consolidação da rodada 3 → design r4

Rodada 3: design-gate **PASS**, security-gate **PASS**, fool-gate **FAIL** (2 BLOCKER, 13 WARN).
Limite de re-execuções atingido pelos três. TLC **concorda** com os 2 BLOCKERs (sem divergência de mérito ⇒ sem júri).
A r4 **não foi auditada por gate** — escalado ao Rafael.

## BLOCKERs → resolução (design r4)
| # | Achado | Verificado pelo TLC | Resolução |
|---|---|---|---|
| fool B1 | Optout depois de escalada: sem despedida (gate só por `flipped_off`) ou nunca registrado (claim com IA desligada ⇒ `ok()` sem regra de saída) | leitura `design.md` r3 §4.1 passo 7, §4.2 | `flipped_optout`; despedida com `flipped_optout \|\| flipped_off`; regra de saída roda sobre o claim com IA desligada (§4.1 passo 9). Revoga o "fool r1 W1 aceito" |
| fool B2 | Instância confirmada + URL sem `s` copiada pela UI/docs ⇒ 401 em todo inbound | leitura `ConfigDrawer.tsx:393-410`, `INSTALL.md:242-246,271` | RPC `my_webhook_url` (dono vê o próprio secret); UI copia/diagnostica por ela; docs na lista do AC-D1 (spec) |

## WARNs — decisão
- fool W1 incorporado: 2º ramo do `case` só com `not ai_enabled`.
- fool W2 incorporado: `n` inclui a promessa do turno nos dois chamadores; H de AC-A3 no `turno.ts`.
- fool W3 incorporado: `incerto` grava `sent_at`; contagem por `coalesce(sent_at, reserved_at)`; `mark_sent` idempotente sobre `incerto`; `day_stats` conta `incerto`.
- fool W4 incorporado: timeout do envio ⇒ `outreach_mark_uncertain`, não release.
- fool W5 incorporado: variação com `{empresa}` sem `company_name` é inválida no disparo; placeholder = regra de AC-B21.
- fool W6 incorporado: `add column` sem default ⇒ backfill ⇒ `set default now()`.
- fool W7 incorporado: preflight com nome certo, chave vazia excluída, query de "sem identificador".
- fool W8 incorporado: `dry_run` pela URL com `s`.
- fool W9 incorporado: plano B por path; rotação do secret.
- fool W10 incorporado: filtro do dono só no modo novo; legado intocado.
- fool W11 incorporado: Extrator distingue 23505 de telefone × email.
- fool W12 incorporado: rodízio por `outreach_last_tick_at`.
- fool W13 incorporado: `:144-145` e `montarToque1` reescritos citando AC por id.
- security r3 W1/W3 registrados no ADR-11 (limites conhecidos); W2 incorporado (rotação); W4-W8 incorporados (§3.1, §3.3, §4.2, §4.3).
- security r3 W9 → Rafael: `run-followups` sem auth passa a gastar Groq no modo novo (pré-existente).
- design r3 W3 → Fase 3 (critério da task de `Prospeccao.tsx`); W1/W2/W4 aceitos (dívida/pré-existente/Out of Scope).

## Decisões do Rafael (2026-09-24)
1. Rodada 4 do fool-gate autorizada (além do limite).
2. `supabase migration repair --status applied 20260924000000` em prod: autorizado **na hora do deploy** (§9 passo 0).
3. Leitura da chave Groq do tenant para AC-A0: autorizada; bloqueada pelo classificador do auto mode ⇒ o Rafael roda `battery/a0-groq.mjs`.
4. Cota Groq esgotada ⇒ escala para humano (D4 como está). Fecha fool r1 W5.
5. `manage-instance` e `run-followups` sem auth: task separada, antes do P3.
