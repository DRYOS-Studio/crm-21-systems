# Cérebro de IA + Motor de Prospecção Fria — Tasks

**Spec**: `spec.md` r4 · **Design**: `design.md` r5 (+ ADR-14) · **Status**: Approved pelo gate inline da Fase 3 (2026-09-24)
Regra: task cita AC **por id** e seção do design por §; o que o AC exige está na spec, onde a prova mora está no design §8.
Cada task de código fecha com `/code-review` + `/verify` (e `validate-gate` se UI), conforme `/dryos-pipeline` Fase 4.

## Infra de prova (vale para todas)

| Forma | Comando | Criado em |
|---|---|---|
| U — bateria node sobre arquivo de produção | `.specs/features/ai-brain-outreach/battery/run.sh` | existe; re-ancorado em T11 |
| S — SQL contra Postgres local | `node --test tests/db/` | T1 |
| H — handler em node contra Postgres local, Groq/Uazapi stubados | `node --test tests/handler/` | T1 |
| E — playwright contra `npm run dev` + local | skill `playwright-skill` | T1 |

AC-A0: **executado** na Fase 2 (`battery/a0-groq.out`, `a0-groq-loop.out`) — sem task; T12 repete o loop contra o `brain.ts` real.

Pré-requisito de máquina: Docker rodando (`supabase start`). Hoje `docker info` não respondeu — subir antes do T1.

---

## Execution Plan

```
Fase A — fundação
  T1 → T2 → T3 (M, com Rafael)

Fase B — schema P1
  T1 → T4 → T5 → T6
        T4 → T7
        T4 → T8

Fase C — cérebro
  T1 → T9  [P] ─────────────┐
  T1 → T10 → T11 ───────────┴→ T12 ─┐
  T13 [P] (independente)            │
  T5 + T12 ─────────────────────────→ T14
  T3 + T6 + T7 + T14 ───────────────→ T15 → T16 (também T12)
  T6 → T17 [P]

Fase D — UI P2 + Extrator
  T18 [P] (independente)
  T4..T7 → T22
  T17 + T18 + T22 → T19 [P]
  T4 + T18 + T22 → T20 [P]
  T6 + T17 + T18 → T21 [P]
  T7 + T22 → T23 [P]
  T24 [P] independente — sobe em prod ANTES de T7 (§9)

Fase E — P3 disparo (só depois de P1 estável)
  T17 → T25 (PR separado, antes do resto do P3)
  T7 → T26 → T27
  T1 → T28 [P]
  T12 + T27 + T28 → T29 → T30

Fase F — P4 página Prospecção
  T18 + T26 → T31 → { T32 [P], T33 [P], T34 [P], T35 [P] }

Fase G — fechamento
  T36 (doc-sync, após todo código) ; T37 (M, após T13+T29) ; T38 (rollout, após release gate)
```

---

## Fase A — fundação

### T1: Arnês S/H/E — FEITO (2026-09-24)
**What**: `supabase start` local + hooks node (`module.registerHooks`) que resolvem `npm:`/`https://deno.land/...` das edge functions para `node_modules`, shim de `Deno.env`/`EdgeRuntime.waitUntil`, stub de `fetch` para Groq/Uazapi (fail-closed, fila de respostas e atraso configurável), helper de 2 sessões `authenticated`.
**Where**: `tests/_harness/{register.mjs,deno-server-shim.mjs,edge-shim.mjs,fetch-stub.mjs,db.mjs,sessions.mjs,README.md}`, `tests/db/smoke.test.mjs`, `tests/handler/smoke.test.mjs`, `tests/_harness/{fetch-stub,sessions}.test.mjs`
**Depends on**: Docker
**Reuses**: `battery/register.mjs` (padrão de resolve hook), `@supabase/supabase-js` do `node_modules`
**Done when**:
- [x] `node --test tests/db/` passa um smoke que aplica `q7_init.sql` (idempotente) e lê as 9 tabelas
- [x] `node --test tests/handler/` importa `whatsapp-webhook` sem Deno e recebe um POST `{"event":"test"}` ⇒ 200
- [x] controle do fetch-stub: request sem entrada casada ⇒ lança (fail-closed — não existe passagem silenciosa pra rede real); prova em `tests/_harness/fetch-stub.test.mjs`, não no smoke H (o evento `test` não chama `fetch`)
- [x] controle das 2 sessões: tenant A não lê a linha semeada de B em `pipeline_stages`, nem por listagem nem por `id` direto — `tests/_harness/sessions.test.mjs`
- **Achado da task** (não estava no design): o role `postgres` do stack local do Supabase **não é superuser** (`auth.users` pertence a `supabase_auth_admin`); DDL que mexe no trigger `on_auth_user_created` como `postgres` falha com "must be owner of relation users". `db.mjs` conecta como `supabase_admin` (o role que o próprio CLI usa pra aplicar migration) — vale para T4-T8, T26.
**Verify**: `node --import ./tests/_harness/register.mjs --test tests/_harness/ tests/db/ tests/handler/ tests/unit/` → `tests 5, pass 5, fail 0` (rodado 2026-09-24, Docker 29.6.2, Supabase CLI 2.95.4, Node v26.8.1)

### T2: Webhook separado em `handle.ts` + snapshot do payload legado — FEITO (2026-09-24)
**What**: mover o corpo do `serve` para `handle(req)` exportado, `index.ts` = `serve(handle)`; **antes de qualquer outra mudança**, gravar o snapshot do body enviado à Groq no caminho legado.
**Where**: `supabase/functions/whatsapp-webhook/{index.ts,handle.ts}`, `tests/handler/legacy-payload.test.mjs`, `tests/handler/__snapshots__/legacy-groq-body.json`
**Depends on**: T1
**Done when**:
- [x] diff de comportamento zero (só move) — snapshot gravado contra o `index.ts` original, depois reconfirmado idêntico contra `handle.ts` pós-split; suíte inteira (T1+T2) 6/6
- [x] snapshot gravado para AC-A12 (tenant sem `business_context`, 20 mensagens)
- [x] mutação: adicionar `tools: []` ao body legado ⇒ teste reprova (confirmado, depois revertido antes do split)
- **Achado da task**: `whatsapp_instances.instance_token` não é `UNIQUE` no schema — um valor fixo no seed colide com linha de run anterior não limpa, e `.maybeSingle()` devolve `null` **silenciosamente** (sem erro visível) quando há mais de uma linha casando. `INSTANCE_TOKEN` do teste agora é gerado único por run (timestamp+random), como já era o padrão pro e-mail em `sessions.mjs`.
**Verify**: `node --import ./tests/_harness/register.mjs --test tests/_harness/ tests/db/ tests/handler/ tests/unit/` → `tests 6, pass 6, fail 0` (rodado 2026-09-24)

### T3: Captura real da Uazapi (M, com o Rafael) — PARCIAL (2026-09-24)
**What**: registrar numa instância de teste a URL `whatsapp-webhook?s=teste` (sem ligar a exigência), mandar 1 mensagem real, capturar do log: nome do campo de id da mensagem e se a query `s` chegou.
**Where**: `.specs/features/ai-brain-outreach/battery/uazapi-capture.out`
**Depends on**: T2 (log estruturado do payload)
**Done when**:
- [x] campo de id identificado: `message.messageid` (= `message.id` sem o prefixo `<telefone>:`) é o id
  do EVENTO; `message.content.key.ID` é o id da mensagem REFERENCIADA (numa reação, o alvo, não o
  evento) — **não confundir os dois**, ver `battery/uazapi-capture.out`. Usado em T15.
- [ ] `s` na query: **não testado ainda** — a instância real usada (decisão do Rafael, "já estava
  funcionando" > free.uazapi.com) não tinha `?s=teste` configurado na URL do webhook. Pendente:
  repetir com `?s=teste` acrescentado à URL de uma instância existente.
- **Achado real fora do escopo original**: mensagem capturada era uma REAÇÃO (👍) de emoji, não texto.
  `messageType: "ReactionMessage"` chega com `.text` preenchido e sem marcador de mídia — hoje
  `extractText()` trataria isso como mensagem de texto normal numa conversa 1:1 e acionaria resposta
  da IA a um emoji. Decisão do Rafael 2026-09-24: tratar em T15 (ver `Done when` de T15), não como
  fix isolado.
**Verify**: `battery/uazapi-capture.out` (dados pessoais redigidos, formato do payload real)

---

## Fase B — schema P1 (`20260925010000_ai_brain.sql`, `20260925020000_phone_canon.sql`)

### T4: Colunas + `private.q7_markers` + `knowledge_base` — FEITO (2026-09-24)
**What**: §3.0 e §3.1 (colunas de `agent_configs`/`conversations`/`messages`, ordem add→backfill→default de `processed_at`, backfill AC-A18b por marcador, `knowledge_base` + trigger de `topic`, RLS/grants).
**Where**: `supabase/migrations/20260925010000_ai_brain.sql`, `tests/db/ai_brain.test.mjs`
**Depends on**: T1
**Done when**:
- [x] AC-C1: aplicar 2× sem erro; e 2× depois de aplicar o rascunho antigo `20260924020000`
- [x] AC-A18b: fixture com conversa inbound-first, outbound-first e vazia ⇒ estágios certos; 2ª aplicação não rebaixa estágio avançado (mutação confirmada: tirar o filtro de direção reprova)
- [x] `processed_at` das linhas antigas = `created_at` (mutação: default no `add column` ⇒ reprova, confirmado)
- [x] AC-U2 (banco): `topic` gravado normalizado; duplicata ⇒ 23505
- **Achado**: banco local tinha drift (colunas já existiam sem migration em disco correspondente) — `supabase db reset` antes de testar, pra bater com o que prod (sem o drift) realmente vai receber.
**Verify**: `node --test tests/db/ai_brain.test.mjs` → 4/4

### T5: RPCs do turno + trigger de religar — FEITO (2026-09-24)
**What**: `brain_claim_inbound`, `brain_bump_confirmacoes`, `brain_commit_turn` (§3.1, com `flipped_off`/`flipped_optout`, optout sempre desliga, `case` de `ai_stage`), trigger `conversations_ai_reenable`; revoke/grant `service_role`.
**Where**: mesma migration, `tests/db/brain_rpcs.test.mjs`
**Depends on**: T4
**Done when**:
- [x] claim concorrente (2 conexões) devolve conjuntos disjuntos
- [x] commit: `optout`/`ai_enabled` monotônicos; `flipped_*` só na chamada que transiciona; `p_optout` sem `p_desligar` desliga (mutação confirmada: tirar `or p_optout` reprova)
- [x] AC-A19 (banco): religar zera `confirmacoes`, `descartar`→`descobrir`, `optout` intocado
- [x] RPC chamada com JWT `authenticated` ⇒ negada
**Verify**: `node --test tests/db/brain_rpcs.test.mjs` → 4/4

### T6: Secret do webhook — FEITO (2026-09-24)
**What**: `private.instance_webhook_secrets` + RPCs `webhook_secret_for`, `webhook_rotate_begin/commit`, `webhook_resolve` (com `secret_prev`), `webhook_confirm`, `webhook_is_confirmed`, `my_webhook_secret` (§3.1).
**Where**: mesma migration, `tests/db/webhook_secret.test.mjs`
**Depends on**: T5
**Done when**:
- [x] `my_webhook_secret` de instância de outro tenant ⇒ nulo/erro
- [x] `rotate_begin` sem `commit` ⇒ secret atual inalterado; após `commit`, antigo aceito até `prev_until`
- [x] `private.*` inacessível para `anon`/`authenticated`
**Verify**: `node --test tests/db/webhook_secret.test.mjs` → 3/3

### T7: Canonicalização de telefone — FEITO (2026-09-24)
**What**: `canon_phone`, `canon_phone_input`, `canon_phone_input_batch` (limite), triggers, `wa_phone`, backfill fail-closed (§3.2).
**Where**: `supabase/migrations/20260925020000_phone_canon.sql`, `tests/db/phone_canon.test.mjs`
**Depends on**: T4
**Done when**:
- [x] AC-C3: a tabela de casos da spec, executada contra as duas funções
- [x] mutações: inserir 9 em todo 12 dígitos; prefixar 55 com `+`; trigger usando `canon_phone_input` ⇒ reprovam (as 3 confirmadas)
- [x] backfill: fixture com colisão ⇒ `raise`, nada escrito; sem colisão ⇒ canonicaliza e preserva `wa_phone`
- [x] AC-C1: 2×
- **Achado real da task**: o trigger original disparava em `before insert or update` (qualquer coluna).
  O próprio passo 1 do backfill (`wa_phone = contact_phone where wa_phone is null`, que não toca
  `contact_phone`) reprocessava `contact_phone` de TODA linha tocada e batia direto no índice único
  contra dado sujo colidente — **antes** do passo 2 (a checagem de colisão) ter chance de rodar.
  Corrigido pra `before insert or update OF contact_phone` (só dispara quando a própria coluna muda).
  Vale para qualquer trigger de canonicalização futura (ex.: `prospects.phone` em T26).
**Verify**: `node --test tests/db/phone_canon.test.mjs` → 8/8

### T8: Apagar o rascunho de migration — FEITO (2026-09-24)
**What**: remover `supabase/migrations/20260924020000_ai_brain.sql` (não commitado, nunca aplicado em prod — `preflight-q1.out`).
**Depends on**: T4 (o teste de C1 sobre o rascunho já rodou)
**Done when**: [x] arquivo removido; `supabase db reset` (cadeia sem o rascunho) + `node --test tests/db/` → 20/20
**Verify**: `ls supabase/migrations` → só `20260101000000_q7_init.sql`, `20260924000000_conversations_email_optional_phone.sql`, `20260925010000_ai_brain.sql`, `20260925020000_phone_canon.sql`

---

## Fase C — cérebro

### T9: `get-ai-config.ts` — erro cru, timeout, cadeia [P] — FEITO (2026-09-24)
**What**: `GroqResult` com `status`, `code`, corpo truncado (só resposta); `AbortSignal.timeout` em `callGroqOnce` e `listChatModels`; opções `maxModels`/`exclude` em `callGroq` (ADR-02).
**Where**: `supabase/functions/_shared/get-ai-config.ts`, `tests/unit/get-ai-config.test.mjs`
**Depends on**: T1
**Done when**:
- [x] `tool_use_failed` exposto como `code`; corpo nunca contém o header de auth
- [x] `maxModels:2` limita tentativas; `exclude` tira `groq/compound*`
**Verify**: `node --test tests/unit/get-ai-config.test.mjs` → 5/5.

### T10: Regras de saída/humano por corpus [P] — FEITO, com ressalva (2026-09-24)
**What**: `pediuParaSair`/`pediuHumano` reescritas pela regra de forma (D3/D7), satisfazendo os corpora; `sonda-corpus.mjs` passa a importar do `brain.ts`.
**Where**: `supabase/functions/_shared/brain.ts` (só as duas funções)
**Depends on**: T1
**Done when**:
- [x] AC-A4, A4n, A5, A5n passam (U) — **ressalva**: "(U)" aqui só pôde ser verificado via `sonda-corpus.mjs`
      (as duas funções, isoladas, contra os 4 corpora — `battery-r5.out` linha 1: SATISFAZÍVEL). O AC-A4/AC-A5
      da bateria completa (`tests.mjs`, que exercita `runBrainTurn`) **continuam FAIL**, idêntico à baseline —
      `runBrainTurn` não chama nenhuma das duas funções (escopo de T10 é só as 2 funções, por `Where`); isso é
      o próprio propósito declarado de T11 ("janela, ordem... saída antes da IA AC-A5b"), que **depende de T10**.
      Achado por execução real (`battery-r5.out` vs `battery-r4.out`), não presumido.
- [x] M12, M13, M14 continuam mortas — [ ] **M16 virou sobrevivente** (achado por execução, não presumido:
      `battery-r5.out` vs `battery-r4.out`). M16 ("regex original, mas já escopada na janela") só era morta
      pelo falso-positivo de AC-A4n ("queria falar com vocês sobre preço") do regex ANTIGO — o próprio bug de
      forma que T10 existe para consertar. Consertado o regex, M16 fica indistinguível de uma implementação
      correta usando o critério de janela que ELA MESMA usa (heurística por posição, `lastIndexOf('assistant')`
      — não o marcador `processed_at` real de ADR-03/D5); a bateria atual não tem um caso que distinga as duas
      janelas (isso é AC-A21, ainda `PENDENTE-EXEC`). T11 já previa isto: "âncoras de mutação refeitas". Não
      enfraquecer o regex pra forçar essa mutação a morrer de novo — seria reintroduzir o bug de AC-A4n/A5n de
      propósito.
**Verify**: `battery/run.sh > battery/battery-r5.out` → na ocasião (2026-09-24, antes de T11), baseline inalterada
(AC-A4/A5/A5b/A3o/A5e seguem EXEC-LACUNA, como esperado antes de T11); `sonda-corpus.mjs` real (não duplicado) →
SATISFAZÍVEL; suíte completa (`node --test tests/_harness/ tests/db/ tests/handler/ tests/unit/`) → 30/30, sem
regressão. **`battery-r5.out` foi sobrescrito pela rodada de T11** (mesmo nome de arquivo no Verify das duas
tasks) — os números acima descrevem o resultado *na hora de T10*, não o conteúdo atual do arquivo.

### T11: `runBrainTurn` — janela, ordem, contagem — FEITO, com ressalva na numeração das mutações (2026-09-24)
**What**: parâmetro `janela`; saída antes da IA (AC-A5b); contagem de promessa após o corte (AC-A3o); optout do modelo ⇒ escala (AC-A5e/D6); `qualificacaoDoTurno` separado de `dados`; `deveEscalarPorConfirmacoes(n)` exportado com `n` incluindo a promessa (§4.2); testes passam `janela`; âncoras de mutação refeitas.
**Where**: `supabase/functions/_shared/brain.ts`, `battery/tests.mjs`, `battery/run.sh`
**Depends on**: T10
**Done when**:
- [x] baseline sem `EXEC-LACUNA` (23/23 PASS, incl. o teste novo do fix de code-review abaixo) — cobre AC-A1, A2, A2r, A2n, A3, A3n, A3o, A6, A7, A7b, A8, A9, A10, A11
      com `janela` explícita (`battery/tests.mjs`: `turn()` deriva `janela` das mensagens após o último turno
      `assistant`, mesma heurística que os cenários de AC-A4w/AC-A5w já exigiam). **AC-A4/A5/A4n/A5n/A4w/A5w/A3o/A5b/A5e
      viram PASS pela primeira vez na bateria completa** — antes só passavam via `sonda-corpus.mjs` (T10) ou
      trivialmente (nada estava com wiring).
- [x] toda mutação morta — **ressalva**: **17 mutações, não 16** (`M1..M11,M11b` = 12 + **`M12-janela-ignorada`**,
      que **substitui M12–M16** (5 mutações antigas), não as adiciona. Motivo (achado por execução, documentado em
      T10, não presumido): M14/M15 usavam um regex `__sair` própria e hardcoded, redundante com a prova real de
      `sonda-corpus.mjs`; M16 já tinha virado sobrevivente em T10 assim que o regex de forma foi corrigido — e
      agora que `janela` é um parâmetro de verdade (não mais heurística de mutação isolada), M12/M13 (escopo sobre
      `historyMessages`) e M16 (escopo "correto" mas via heurística de posição) descrevem exatamente a MESMA classe
      de mutação: "ignora o parâmetro `janela`, deriva do histórico inteiro". Consolidadas numa só, que mata em
      **AC-A4w E AC-A5w** ao mesmo tempo (a nova mutação exigida pelo `What`) — mais forte que qualquer uma das 5
      antigas isoladamente. `mut_regex.py` ficou órfão (nada mais o chama) — não apagado, só a invocação em
      `run.sh` foi removida; sinalizando aqui em vez de apagar o arquivo por conta própria.

**`/code-review` (2026-09-24) achou 1 bug real, corrigido:** no caminho de reprompt do gate NAVT, a 2ª chamada
(corrigida) substituía `r` inteiro — `qualificacaoDoTurno` descartava os campos NAVT que a 1ª tentativa já tinha
extraído se a 2ª resposta não os repetisse (e o prompt de correção pede só "UMA pergunta nova", não repetir o que
já sabe — então normalmente NÃO repete). Corrigido acumulando as duas tentativas
(`qualificacaoDoTurno = mesclarDados(qualificacaoDoTurno, r.qualificacao)` a cada chamada, nunca substituição).
Novo teste `AC-A2r qualificacao-acumula-no-reprompt` prova o fix — falha sem ele (`{}` em vez dos campos da 1ª
tentativa; confirmado rodando a versão sem fix antes de aceitar o teste como válido).
**Achado colateral do fix:** a âncora de `M10-falta-sem-merge` em `run.sh` ficou desatualizada (texto mudou de
`r.qualificacao` pra `qualificacaoDoTurno`) e o script python de mutação falhava em silêncio — sem `set -e`, o
mutante ficava idêntico ao baseline e "sobrevivia" por nunca ter sido mutado de verdade. Reancorada, e `mut()` em
`run.sh` agora aborta com `exit 1` se a âncora não bater (em vez de deixar passar sem avisar).
**Verify**: `battery/run.sh > battery/battery-r5.out` → baseline 23/23 PASS, 0 `EXEC-LACUNA`; 17/17 mutações mortas
(incl. `M12-janela-ignorada` ⇒ morre em AC-A4w **e** AC-A5w — o bullet acima), 0 sobreviventes (conferido por
script, não visual); `sonda-corpus.mjs` → SATISFAZÍVEL; suíte completa → 30/30, sem regressão.

### T12: Forma da chamada à Groq no loop (ADR-01/02) — FEITO, 3º bullet pendente do Rafael (2026-09-24)
**What**: tools sem `response_format`; resposta final parseada; shape inválido ⇒ chamada de formatação que consome rodada; `tool_use_failed` = rodada perdida; legado só com "não suporta tools".
**Where**: `supabase/functions/_shared/brain.ts` (`chamarComTools`, `pensar`)
**Depends on**: T9, T11
**Done when**:
- [x] AC-A9/A11 continuam mortas; nova mutação "envia `response_format` junto com `tools`" ⇒ teste U reprova —
      `M13-tools-com-response-format`, morta pelo novo teste `T12 payload-tools-sem-response-format` (captura os
      `opts` da 1ª chamada via `stub-groq.mjs`, que já expunha `opts` no `__script(n, msgs, opts)` — não precisou
      mudar o stub).
- [x] stub devolvendo 400 `tool_use_failed` ⇒ não vira `{tipo:'legado'}` — teste `T12 tool_use_failed-nao-vira-legado`:
      stub falha as 2 primeiras chamadas com `tool_use_failed`, sucede na 3ª (mesma rodada-loop, mesma tentativa de
      `pensar` — `continue` sem lançar); turno completa normalmente. **Adicional, não pedido explicitamente mas
      testado por simetria**: um erro EXPLÍCITO de "não suporta tools" (heurística por regex sobre a mensagem —
      nunca medida em produção, o próprio `design.md` §0 chama de "palpite") lança `ModeloSemToolsError`, uma
      classe distinguível — teste `T12 nao-suporta-tools-vira-erro-distinto`. **Não implementado**: o roteamento
      de fato pro modo legado quando esse erro escapa — isso pertence a quem CHAMA `runBrainTurn` (webhook/`turno.ts`,
      T14/T15, ainda não construídos); aqui só a classe do erro já existe pra esse chamador futuro distinguir.

**`/code-review` (2026-09-24) achou 1 bug real, corrigido:** a chamada de formatação (fallback de shape inválido)
não consumia slot do teto de rodadas — o `for` original só limitava as chamadas PRIMÁRIAS a `MAX_RODADAS_TOOL`
(4); a chamada de formatação era sempre "extra", sem checar orçamento. Pior caso: 3 rodadas de tool-call + 1
resposta com shape inválido na última ⇒ 5 chamadas HTTP numa só `chamarComTools`; `pensar` tenta até 2× ⇒ até
**10** chamadas por turno, estourando o teto de ≤8 de AC-A9 (design §5) e o próprio texto do ADR-01
("conta como rodada no teto"). Corrigido: troquei o `for (rodada...)` por `while (chamadas < MAX_RODADAS_TOOL)`
com um único contador `chamadas` que soma TODA chamada HTTP (rodada normal, `tool_use_failed` perdida, e a de
formatação); se o orçamento já acabou quando o shape vem inválido, lança direto em vez de tentar reformatar sem
orçamento. Novo teste `T12 formatacao-nao-fura-o-teto` prova o fix — falha com `calls=9` sem ele (confirmado
rodando a versão sem fix antes de aceitar o teste como válido), passa com ele.
- [ ] execução real: `a0-groq.mjs LOOP=1` contra o `brain.ts` (não só o script) com `qwen/qwen3.8-27b` converge
      (Rafael roda; saída em `battery/a0-brain.out`) — **não executado nesta sessão**: exige chave real da Groq;
      não presumido, deixado pendente e explícito, não marcado como feito.
**Verify**: `battery/run.sh > battery/battery-r5.out` → baseline 27/27 PASS, 0 `EXEC-LACUNA`; 18/18 mutações
mortas, 0 sobreviventes; `sonda-corpus.mjs` → SATISFAZÍVEL; suíte completa → 30/30, sem regressão.
`battery/a0-brain.out` — **pendente** (bullet 3 acima).

### T13: `cerebro.ts` — pós-cumprimento [P] — FEITO (2026-09-24)
**What**: instrução para a resposta ao toque 1 (AC-B24): apresentar-se, 1 pergunta de descoberta, sem reunião.
**Where**: `supabase/functions/_shared/cerebro.ts`
**Depends on**: —
**Done when**: [x] texto presente — seção `## QUANDO A CONVERSA COMEÇOU COM UM CONTATO NOSSO (etapa "abordar")`
(substituiu a seção antiga, que supunha a abordagem já feita pela IA — incompatível com D8, toque 1 = template).
Citar por AC-B24 no relatório de T37: apresentação (empresa + motivo) em até 2 bolhas, 1 pergunta de descoberta,
proibição explícita de propor reunião/diagnóstico/dia/horário nesta etapa · [x] bateria segue verde (30/30,
`battery-r5.out` sem diferença de veredito atribuível a `cerebro.ts` — o conteúdo da persona não é exercitado
pelos stubs de `tests.mjs`, só a forma do módulo).
**Verify**: `battery/run.sh` → ver `battery-r5.out`.

### T14: `turno.ts` — FEITO (2026-09-24)
**What**: fluxo §4.2 — commit por ramo, despedida por `flipped_optout || flipped_off`, releitura antes de cada bolha contra o estado do início, aviso ao dono único, intervalo entre bolhas, try/catch ⇒ escala, histórico filtrado por `user_id`, prazo do turno.
**Where**: `supabase/functions/_shared/turno.ts`, `tests/handler/turno.test.mjs`
**Depends on**: T5, T12
**Done when**:
- [x] H: AC-A5c, A13, A14 (3 variantes: modelo escala com resposta; IA falha 2x escala em silêncio pro
      lead; sem `owner_notify_phone` não quebra), A16, A3 (handler), A20, A21 (concorrência real via
      `Promise.all` de 2 chamadas de `responderTurno`, não simulada), "pare"+"PARE!" = 1 despedida, "pare"
      após escalada = optout + 1 despedida. **Adicional, não pedido explicitamente mas no `What`**: prazo
      do turno (design §5, `TURN_DEADLINE_MS=120000`, injetável em teste via `prazoTurnoMs`) — `runBrainTurn`
      corrida contra o prazo via `Promise.race`; estourou ⇒ tratado como "IA falhou" (mesmo catch ⇒ escala).
      13 testes, todos reais contra Postgres local, Groq/Uazapi stubados via `fetch-stub.mjs`.
- [x] mutações: reler só no início; incremento read-modify-write; despedida sem gate ⇒ reprovam.
      **Ressalva de execução**: a 1ª tentativa de provar "reler só no início" contra a AC-A21 original (1
      bolha só) **não reprovou** — achado por execução, não presumido: com 1 bolha, "reler uma vez" e
      "reler a cada bolha" são o mesmo código. Escrevi um teste novo e mais forte, dedicado (2 bolhas, o
      estado muda NO INTERVALO entre elas), que a mutação de fato mata — sem enfraquecer nada, sem fingir
      cobertura que não existia.
**`/code-review` (2026-09-24) achou 6 coisas, todas corrigidas** (a mais séria: `comPrazo` nunca dava
`clearTimeout` no lado perdedor do `Promise.race` — toda chamada que NÃO estourava o prazo (o caso comum)
deixava um timer de 120s pendurado; rodando a suíte completa isso travava o processo por ~122s no fim,
depois de todos os 13 testes já terem passado — achado por execução real (`node --test` ficava vivo depois
do último `✔`), não presumido; medi 3 hipóteses erradas antes de achar a causa certa, documentado como
processo, não como ruído do artefato). As outras 5: leitura de conversa engolia erro do Supabase e abortava
em silêncio (agora loga); log de falha do Uazapi vazava o corpo cru da resposta (pode ecoar telefone/texto —
PLAUSIBLE, não confirmado contra payload real da Uazapi; removido por precaução); `motivoEscalar` ficava
null quando a escalada só cruza o limiar via o bump atômico (não via o contador local do `runBrainTurn`) —
aviso ao dono saía com "não especificado" apesar do motivo real ser conhecido; `ramoEscalar` rebuscava
`getAgentConfig` mesmo com o agent já em escopo; `ramoOptout` tinha parâmetro `agent` morto (design §4.2 não
tem aviso ao dono no ramo optout).
**Verify**: `node --test tests/handler/turno.test.mjs` → 13/13, ~3s (era ~123s antes do fix do timer).
Suíte completa (`node --test tests/_harness/ tests/db/ tests/handler/ tests/unit/`) → 43/43. Bateria →
27/27 baseline, 18/18 mutações mortas. `sonda-corpus.mjs` → SATISFAZÍVEL. Sem regressão.

### T15: `handle.ts` — webhook novo — FEITO (2026-09-24)
**What**: §4.1 passos 1-10 (auth por `s`, confirmação só por `messages` real, chave canônica, filtro do dono no modo novo, `ai_stage` no insert, `external_id` + erro checado, claim, regra de saída com IA desligada, `waitUntil`).
**Where**: `supabase/functions/whatsapp-webhook/handle.ts`, `tests/handler/webhook.test.mjs`
**Depends on**: T3, T6, T7, T14
**Done when**:
- [x] H: AC-A12 (snapshot de T2 idêntico), A15, A18, A18c, AC-C3b (2 inbound quase simultâneas ⇒ 1 conversa), reenvio com mesmo `external_id` ⇒ 1 mensagem
- [x] instância confirmada sem `s` ⇒ 401; `dry_run` com `s` não confirma; `s` inválido ⇒ 401
- [x] "pare" com IA desligada na conversa ⇒ optout + IA off
- [x] `external_id`/dedupe usa `message.messageid` (id do evento) — **nunca** `message.content.key.ID`
  (id da mensagem referenciada; numa reação aponta pro alvo, não pro evento — achado real de T3,
  `battery/uazapi-capture.out`)
- [x] `messageType === "ReactionMessage"` (ou outro tipo sem texto de verdade do usuário) não aciona
  resposta da IA — hoje `extractText()` deixa passar como texto normal (achado real de T3, decisão
  do Rafael 2026-09-24: tratar aqui, não como fix isolado)
**Achado da task**: `node --test` roda arquivos H em paralelo no mesmo processo; o `fetch-stub` global
fazia um arquivo roubar o stub do outro (T14 AC-A14 flakeou só com `webhook.test.mjs` no mesmo comando).
Isolado por `AsyncLocalStorage` em `tests/_harness/fetch-stub.mjs`. Evento `test` sem `s` continua
sem abrir client (T1 smoke).
**Verify**: `node --test tests/handler/webhook.test.mjs` → 9/9. Suíte completa → 52/52.

### T16: `run-followups` — FEITO (2026-09-24)
**What**: §4.3 — `coalesce(wa_phone, contact_phone)`, instância por tenant, releitura de optout antes do envio, reengajamento no modo novo pelo `runBrainTurn`.
**Where**: `supabase/functions/run-followups/{index.ts,handle.ts}`, `tests/handler/followups.test.mjs`
**Depends on**: T12, T15
**Done when**: [x] H: AC-A17, AC-A5d (qualquer `kind`) · [x] legado inalterado
**Verify**: `node --test tests/handler/followups.test.mjs` → 4/4.

### T17: `manage-instance` — auth e URL do webhook — FEITO (2026-09-24)
**What**: `set_webhook`/`get_webhooks` com `auth.getUser()` + dono; URL por helper único (`_shared/webhook-url.ts`); rotação em 2 fases; `s` redigido em resposta e log.
**Where**: `supabase/functions/manage-instance/index.ts`, `supabase/functions/_shared/webhook-url.ts`, `tests/handler/manage-instance.test.mjs`
**Depends on**: T6
**Done when**:
- [x] sem JWT / instância de outro tenant / sem `instance_token` ⇒ erro, nenhuma chamada à Uazapi
- [x] Uazapi stub falhando no `set_webhook` ⇒ secret inalterado
- [x] resposta e log sem o valor de `s`
**Verify**: `node --test tests/handler/manage-instance.test.mjs` → 3/3.

---

## Fase D — UI P2 + Extrator

### T18: Escopo visual `.dryos` (ADR-14) — FEITO (2026-09-24)
**What**: bloco `.dryos` e `.dark .dryos` em `src/index.css` com as vars do Extrator; fontes no `index.html`; `fontFamily.display/mono` no `tailwind.config.ts`; variantes de `Badge` = Pills do DS.
**Where**: `src/index.css`, `index.html`, `tailwind.config.ts`, `src/components/ui/badge.tsx`
**Depends on**: —
**Done when**: [x] tela existente (Conversas/Kanban) sem diff visual fora do wrapper · [x] `npm run build` limpo
**Verify**: `npm run build` → limpo (1.94s). Playwright `/` (redir `/login`) antes × depois: PNG **byte-igual** (`0a35d9fb…`); tokens de `:root` inalterados (`--primary: 184 50% 50%`, Space Grotesk); probe `.dryos` ⇒ oak `144 30% 17%` / cream `60 17% 98%` / Onest.

### T19: ConfigDrawer — seção "Seu negócio" [P] — FEITO (2026-09-24)
**What**: `company_name`, `business_context`, `owner_notify_phone` via `rpc canon_phone_input` + erro inline; `saveAgent` grava os campos e dispara `set_webhook` se o modo novo ligar. Visual: artboard "Configurações" do mockup.
**Where**: `src/components/ConfigDrawer.tsx`
**Depends on**: T17, T18, T22
**Done when**: [x] E: AC-U1 · [x] número inválido não salva
**Verify**: playwright contra `npm run dev` + Supabase local → `business_context`/`company_name`/`owner_notify_phone` gravados (`5511987654321`); "abc" e "12" não escrevem. `npx tsc --noEmit -p tsconfig.app.json` limpo.

### T20: ConfigDrawer — base de conhecimento [P] — FEITO (2026-09-24)
**What**: lista, adicionar, editar, remover, estado vazio, 23505 ⇒ "tópico já existe".
**Where**: `src/components/knowledge/KnowledgeBaseSection.tsx`, usado no ConfigDrawer
**Depends on**: T4, T18, T22
**Done when**: [x] E: AC-U2
**Verify**: playwright + select `knowledge_base` → "Preços" grava `preços`; " Preços " ⇒ "tópico já existe" sem 2ª linha; edit/remove refletem no banco.

### T21: ConfigDrawer — webhook com secret [P] — FEITO (2026-09-24)
**What**: remover a constante `webhookUrl` (`ConfigDrawer.tsx:393`); todos os usos (`copyWebhook`, `runWebhookDiagnostic`, `Input` de `:616`, bodies `:306`/`:441`) pelo helper com `rpc my_webhook_secret`; status confirmado/aguardando; botão reconfigurar.
**Where**: `src/components/ConfigDrawer.tsx`, `src/lib/webhookUrl.ts`
**Depends on**: T6, T17, T18
**Done when**: [x] `grep -n "functions/v1/whatsapp-webhook" src/` = só o helper · [x] E: copiar ⇒ URL com `s`
**Verify**: `rg "functions/v1/whatsapp-webhook" src` → só `src/lib/webhookUrl.ts`. Playwright: input + clipboard = `…/whatsapp-webhook?s=<secret>`; status "aguardando 1ª mensagem". Reconfigurar manda `rotate: true`.

### T22: Regenerar `types.ts` [P] — FEITO (2026-09-24)
**What**: `supabase gen types typescript --local > src/integrations/supabase/types.ts`.
**Depends on**: T4–T7
**Done when**: [x] `npx tsc --noEmit -p tsconfig.app.json` limpo
**Verify**: o comando → exit 0. Inclui `knowledge_base`, `wa_phone`/`ai_stage`, `company_name`/`business_context`/`owner_notify_phone`, `canon_phone*`, `my_webhook_secret`, `brain_claim_inbound`.

### T23: Envio manual pelo número real [P]
**What**: `Conversas.tsx:408` envia `coalesce(wa_phone, contact_phone)`.
**Where**: `src/pages/Conversas.tsx`
**Depends on**: T7, T22
**Done when**: [x] E: conversa com `wa_phone` de 12 dígitos envia para ele
**Verify**: playwright com Uazapi stub

### T24: Extrator — 23505 por índice [P] (repo `03.dryos_os_extractor`)
**What**: `LeadCard.tsx`: 23505 de `conversations_user_phone_uidx` ⇒ estado `exists`; do índice de email ⇒ mensagem própria; sem RPC nova (§3.2). **Sobe em prod antes de T7.**
**Where**: `03.dryos_os_extractor/src/components/leadhunter/LeadCard.tsx`
**Depends on**: —
**Done when**: [x] E (repo do Extrator): lead de 12 dígitos já no CRM ⇒ "já está no CRM"; email repetido ⇒ mensagem de email
**Verify**: playwright no Extrator contra o Postgres local com T7 aplicado

---

## Fase E — P3 disparo (nasce desligado; só depois de P1 estável)

### T25: Auth de `manage-instance` (demais ações) e `run-followups` — PR separado (decisão do Rafael, 2026-09-24)
**What**: `auth.getUser()` + dono em todas as ações de `manage-instance`, sem fallback ao token global; `run-followups` com secret de cron como ADR-09.
**Where**: `supabase/functions/manage-instance/index.ts`, `supabase/functions/run-followups/index.ts`, `supabase/setup/cron.sql`
**Depends on**: T17
**Done when**: [ ] H: chamada só com anon key ⇒ recusada em toda ação · [ ] cron com secret continua disparando
**Verify**: `node --test tests/handler/manage-instance.test.mjs tests/handler/followups.test.mjs`

### T26: Migration de outreach
**What**: §3.3 — `prospects`, `outreach_sends`, `outreach_openers` + `save_openers`, colunas de `agent_configs`, `outreach_cron_secret`, triggers de propagação, RLS/grants.
**Where**: `supabase/migrations/20260925030000_outreach.sql`, `tests/db/outreach_schema.test.mjs`
**Depends on**: T7
**Done when**:
- [ ] AC-C1 2×; AC-B6 (check); AC-B22 (checks + `save_openers`); AC-U3 (CRUD cruzado e colunas protegidas)
- [ ] triggers: AC-B13, AC-B14 (sem sobrescrever `optout`)
**Verify**: `node --test tests/db/outreach_schema.test.mjs`

### T27: RPCs do disparo
**What**: `outreach_reserve`, `outreach_mark_sent`, `outreach_mark_uncertain`, `outreach_release`, `outreach_day_stats` (§3.3).
**Where**: mesma migration, `tests/db/outreach_rpcs.test.mjs`
**Depends on**: T26
**Done when**:
- [ ] AC-B3 (2 conexões simultâneas ⇒ 1 reserva), AC-B4 (medido em `sent_at`), AC-B2/B16/B18, instância de outro tenant recusada
- [ ] reserva velha ⇒ `incerto` devolvido; prospect excluído até a cadência ser aplicada
**Verify**: `node --test tests/db/outreach_rpcs.test.mjs`

### T28: `outreach.ts` — regras puras [P]
**What**: `podeDispararAgora`, `tetoEfetivo`, `proximoToque`, `montarToque1`, `sortearVariacao`, `freio` — relógio e RNG injetados.
**Where**: `supabase/functions/_shared/outreach.ts`, `tests/unit/outreach.test.mjs`
**Depends on**: T1
**Done when**: [ ] U: AC-B5 (fronteiras), B6, B7, B9, B10, B17, B21, B23, cada um com a mutação da spec
**Verify**: `node --test tests/unit/outreach.test.mjs`

### T29: `run-outreach`
**What**: §4.4 — secret fail-close, rodízio de usuários, orçamento do tick, reserva, toque 1 por variação / toques 2-3 pela IA, releitura antes do envio, timeout ⇒ `incerto`, freio + aviso.
**Where**: `supabase/functions/run-outreach/{index.ts,handle.ts}`, `tests/handler/outreach.test.mjs`
**Depends on**: T12, T27, T28
**Done when**: [ ] H: AC-B1, B8, B11 (incl. secret guardado vazio ⇒ 500), B12, B15, B19, B20, B22 (sem 2 válidas), AC-C2 (2 tenants)
**Verify**: `node --test tests/handler/outreach.test.mjs`

### T30: Deploy config do disparo
**What**: `config.toml` com `run-outreach` `verify_jwt=false`; job em `supabase/setup/cron.sql` com header por subselect.
**Where**: `supabase/config.toml`, `supabase/setup/cron.sql`
**Depends on**: T29
**Done when**: [ ] `cron.sql` aplicado 2× no local sem duplicar job · [ ] job chama `run-outreach` com secret e recebe 200
**Verify**: `select jobname from cron.job` no local

---

## Fase F — P4 página Prospecção (visual: artboards "Prospecção" e "Estados" do mockup)

### T31: Página, rota e nav
**What**: `Prospeccao.tsx` com wrapper `.dryos`, rota em `App.tsx`, link no header de `Conversas.tsx:445-455` e `Kanban.tsx:305-310`.
**Depends on**: T18, T26
**Done when**: [ ] `/prospeccao` protegida; nav nas 3 telas · [ ] `validate-gate` PASS
**Verify**: playwright

### T32: Import de CSV [P]
**What**: parse com `xlsx`, `canon_phone_input_batch`, `upsert ignoreDuplicates`, contagem de rejeitados, falha de rede com "tentar de novo" (design-gate r3 W3).
**Where**: `src/components/prospeccao/CsvImport.tsx`
**Depends on**: T31
**Done when**: [ ] E: AC-P1
**Verify**: playwright

### T33: Editor de variações [P]
**What**: lista de variações, contador, prévia sem nome, `save_openers`, erro inline.
**Where**: `src/components/prospeccao/OpenersEditor.tsx`
**Depends on**: T31
**Done when**: [ ] E: AC-B22 (recusa com link / >120 / <2)
**Verify**: playwright

### T34: Toggle, regras e freio [P]
**What**: toggle, instância, teto, dias; banner de pausa com motivo.
**Where**: `src/components/prospeccao/OutreachSettings.tsx`
**Depends on**: T31
**Done when**: [ ] E: AC-P2
**Verify**: playwright

### T35: Tabela e números [P]
**What**: KPIs do dia, tabela de contatos com Pills de estado e toque n/3, estado vazio, responsivo.
**Where**: `src/components/prospeccao/ProspectsTable.tsx`
**Depends on**: T31
**Done when**: [ ] E: tabela lê `prospects` do próprio tenant · [ ] `validate-gate` PASS
**Verify**: playwright

---

## Fase G — fechamento

### T36: Doc-sync (AC-D1)
**What**: atualizar toda afirmação da lista do AC-D1; `scripts/check-setup.mjs` conhece functions e colunas novas.
**Depends on**: todas as de código
**Done when**: [ ] `grep` das afirmações antigas no diff final = 0 · [ ] `grep 'functions/v1/whatsapp-webhook'` fora do helper só em instrução "copie pelo app" · [ ] `tsc` limpo
**Verify**: os `grep` + `npx tsc --noEmit -p tsconfig.app.json`

### T37: Revisão humana do pós-cumprimento (AC-B24, M)
**What**: ≥10 conversas de teste respondendo ao toque 1, transcritas.
**Depends on**: T13, T29
**Done when**: [ ] relatório `battery/ac-b24.md` com as transcrições e o veredito do Rafael

### T38: Rollout (§9, com o Rafael)
**What**: passo 0 `migration repair --status applied 20260924000000` (autorizado); T24 em prod; migrations; functions; `cron.sql`; reconfigurar webhook por instância; `get_advisors security`.
**Depends on**: Fase 4.5 (release gate) PASS
**Done when**: [ ] cada passo com saída capturada · [ ] `npm run check` verde · [ ] 1ª mensagem real confirma o webhook
