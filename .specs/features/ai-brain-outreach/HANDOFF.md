# Handoff — Fase 4 (Implement+Validate), em andamento

**Prompt pra nova sessão (cwd = repo Q7):**

> `/dryos-pipeline` Fase 4 da feature `.specs/features/ai-brain-outreach/`.
> T1–T24 feitos (T3 ainda parcial: `?s=` real não capturado). Próxima: **T28**
> (`outreach.ts` puro) ou T25 (auth do `manage-instance`).

## Estado

- Fases 1–3 fechadas (`spec.md` r4, `design.md` r5, `tasks.md`).
- **Fase C**: T9–T17 FEITOS.
- **Fase D**: T18–T24 FEITOS. T24 = Extrator trata 23505 por índice (sem RPC).
- T3 PARCIAL: `message.messageid` identificado; `?s=` no round-trip da Uazapi ainda não medido.
- `main` Q7 em `4d1eb2a` já publicado; T20–T23 neste commit.
- Extrator T24 em commit próprio.

## Acabou de fechar

| Task | Verify |
|---|---|
| T23 envio `wa_phone` | playwright E: `number === 551199999999` (12) |
| T24 Extrator 23505 | playwright E: 12 dígitos ⇒ "já está no CRM"; email ⇒ "email já cadastrado em outro contato" |

## Próximo

**T28** (`outreach.ts` puro) ou T25 (auth do `manage-instance`). T38 rollout em prod.
