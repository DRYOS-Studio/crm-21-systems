# Fase 2 — encerramento

- design-gate: FAIL r1, r2 → **PASS r3**. security-gate: FAIL r1, r2 → **PASS r3**.
- fool-gate: FAIL r1; r2 morreu (429 da API); FAIL r3; FAIL r4 (autorizada além do limite). TLC concordou com todos os BLOCKERs; sem divergência para júri.
- **r5 aceita pelo Rafael sem nova rodada de gate (2026-09-24).** Risco aceito: as mudanças da r5 (optout sempre desliga no RPC; confirmação só por evento `messages` real; rotação em 2 fases; `mark_uncertain` com cadência via TS; helper único de URL) nunca foram auditadas por gate.
- AC-A0 executado (`battery/a0-groq.out`): combinação tools+json_object rejeitada (400) — ADR-01 confirmado.
- ADR-02 ajustado por medição (a0-groq-loop.out): tool_use_failed = rodada perdida, nunca legado. Mudança pós-aceite da r5, não auditada.
- ADR-14 (telas novas no DS DRYOS, mockups em https://claude.ai/artifact/PrLweS7oQpWf1tfLfrVymj): pedido do Rafael pós-aceite, não auditado por gate.
