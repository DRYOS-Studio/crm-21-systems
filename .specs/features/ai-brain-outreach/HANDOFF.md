# Handoff — Fase 4 (Implement+Validate), em andamento

**Prompt pra nova sessão (cwd = repo Q7):**

> `/dryos-pipeline` Fase 4 da feature `.specs/features/ai-brain-outreach/`.
> T1–T19 + T22 feitos (T3 ainda parcial: `?s=` real não capturado). Próxima: **T20**
> (base de conhecimento) ou T21 / T23. Paralelos: T24 / T28.

## Estado

- Fases 1–3 fechadas (`spec.md` r4, `design.md` r5, `tasks.md`).
- **Fase C**: T9–T17 FEITOS. T15 ligou o webhook real; T16 ligou `run-followups`; T17 autenticou `set_webhook`/`get_webhooks`.
- **Fase D**: T18 FEITO. T19 FEITO — ConfigDrawer "Seu negócio". T22 FEITO — `types.ts`.
- T3 PARCIAL: `message.messageid` identificado; `?s=` no round-trip da Uazapi ainda não medido.
- Nada commitado (só commitar se o Rafael pedir).

## Acabou de fechar

| Task | Verify |
|---|---|
| T15 `handle.ts` | `tests/handler/webhook.test.mjs` 9/9 |
| T16 `run-followups` | `tests/handler/followups.test.mjs` 4/4 |
| T17 `manage-instance` | `tests/handler/manage-instance.test.mjs` 3/3 |
| T18 `.dryos` | `npm run build` limpo; `/` antes×depois PNG byte-igual |
| T22 `types.ts` | `npx tsc --noEmit -p tsconfig.app.json` limpo |
| T19 ConfigDrawer negócio | playwright E: AC-U1 + inválido não salva |

Suíte: `node --import ./tests/_harness/register.mjs --test tests/_harness/ tests/db/ tests/handler/ tests/unit/` → **59/59** (T18 é só CSS/UI).

## Pegadinha nova (T15)

`node --test` roda arquivos H em paralelo no mesmo processo. O `fetch-stub` global
fazia um arquivo roubar o stub do outro. Agora é `AsyncLocalStorage` em
`tests/_harness/fetch-stub.mjs`. Evento `test` sem `s` continua sem abrir client (T1).

## Próximo

**T20** (deps T4+T18+T22 feitas): ConfigDrawer base de conhecimento.
Também livres: T21 (webhook com secret), T23 (envio `wa_phone`).
Paralelos: T24 (Extrator 23505 — **sobe em prod antes de T7**), T28 (`outreach.ts` puro).
E local: `env.ts` aceita `http://127.0.0.1` para o Vite apontar no Supabase local.
