# Cérebro de IA + Motor de Prospecção Fria — Design (r5, 2026-09-24)

Spec: `spec.md` r4. Racional: `adr.md` (ADR-01…ADR-14). Gates: `gates/design-*-r1.md`,
consolidação em `gates/design-consolidacao-r1.md`, `-r2.md`, `-r3.md`, `-r4.md`.
Regra deste documento: **AC aparece só por id.** O que o AC exige está na spec; aqui
está onde o código mora e onde a prova vive.

## 0. Premissas — medido × não medido

| Item | Estado | Consequência no design |
|---|---|---|
| Q1 distribuição de `contact_phone` | **medido 2026-09-24** (`preflight-q1.out`): 1 conversa, formato `55`+13 dígitos, 0 mensagens; 0 colisões; 0 sem identificador | a migração de chave passa em prod hoje; o fail-closed (§3.2) segue para outras instalações do whitelabel |
| Migrations já aplicadas em prod | **medido**: `schema_migrations` só tem `20260101000000`; a coluna `contact_email` existe ⇒ `20260924000000` foi aplicada **por fora** do registro; rascunho `ai_brain` **não** aplicado (sem `ai_stage`). PG 17.6. `pg_cron`/`pg_net` ligados, job `run-followups-every-minute` ativo. O mesmo banco tem `leads`, `searches`, `user_settings` (Extrator) Índices/constraints conferidos em `pg_indexes`/`pg_constraint`: `conversations_user_phone_uidx`, `conversations_user_email_uidx`, `conversations_contact_identifier_chk` presentes, unique antigo removido, `contact_phone` nullable ⇒ aplicada inteira | §9 passo 0: `supabase db push` reaplicaria `20260924000000`, cujo `ADD CONSTRAINT` não tem guarda ⇒ falha. Registrar como aplicada antes (`supabase migration repair --status applied 20260924000000`) |
| AC-A0 (tools + `json_object` na Groq) | **medido 2026-09-24** (`battery/a0-groq.out`, chave do tenant): `openai/gpt-oss-20b` com os dois juntos ⇒ **400 "json mode cannot be combined with tool/function calling"**; só `tools` ⇒ tool_call → resultado → JSON final com `mensagens` array (200); formatação `json_object` sem tools ⇒ OK. `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` e `groq/compound-mini` ⇒ **404 model_not_found** para esta chave | ADR-01 confirmado (o rascunho `brain.ts:151-156` falharia em toda chamada). Loop real só-tools, 3× por modelo (`battery/a0-groq-loop.out`): `qwen/qwen3.8-27b` (modelo do tenant) 3/3 em 3 rodadas; `openai/gpt-oss-20b` 3/3 em 2; `openai/gpt-oss-120b` 2/3 — a outra deu 400 `tool_use_failed` (tentou chamar uma tool `json` inexistente) nas rodadas 2-4 ⇒ ADR-02 ajustado. O qwen gasta 3 das 4 rodadas de AC-A9 com **uma** tool: turno que precise das duas pode estourar o teto e cair em D4 — medir na Fase 4. A cadeia vem de `listChatModels` (`get-ai-config.ts:67-88`), então os 404 não quebram o design; mas o default `llama-3.3-70b-versatile` (`q7_init.sql:165`) não existe para esta conta |
| Limites da edge | docs Supabase `functions/limits`: wall clock 150s Free / 400s pago; CPU 2s; idle 150s | orçamento §5 |
| `EdgeRuntime.waitUntil` | docs Supabase `functions/background-tasks`: responde na hora, instância segue até a promise | ADR-05 |
| Groq tool use | docs Groq `tool-use`: "All models hosted on Groq support tool use"; `structured-outputs`: "Streaming and tool use are not currently supported with Structured Outputs" | ADR-01, ADR-02 |
| Campo de id da mensagem na Uazapi | **palpite** (`messageid`/`id`) | Task 1 captura um payload real antes de fixar (§4.1) |
| Uazapi aceita número com 9º dígito quando o JID não tem | **palpite** | `wa_phone` preserva o número de envio real (§3.2) |
| Uazapi preserva query string da URL do webhook | **palpite** | Task 1 confirma com `set_webhook` + payload real antes de ligar a exigência (ADR-11) |

## 1. Componentes

```
whatsapp-webhook/index.ts ── serve(handle)                                  (fino)
whatsapp-webhook/handle.ts ── auth → ingest → dedupe → claim → turno        (testável em node)
run-followups/index.ts     ── usa runBrainTurn no modo novo
run-outreach/index.ts      ── NOVO: tick do disparo frio
manage-instance/index.ts   ── set_webhook passa a anexar o secret da instância
_shared/brain.ts           ── decisão pura + loop Groq  (bateria roda aqui)
_shared/turno.ts           ── NOVO: I/O de um turno (RPCs, envio com releitura, aviso ao dono)
_shared/outreach.ts        ── NOVO: regras puras do disparo (hora SP, rampa, cadência, toque 1, freio)
_shared/cerebro.ts         ── persona (+ instrução pós-cumprimento, AC-B24)
_shared/get-ai-config.ts   ── + cadeia/timeout/erro cru (ADR-02)
Postgres                   ── canonicalização, claim, commit monotônico, reserva do disparo, triggers
```

**Tudo que é concorrência ou invariante entre escritores mora no Postgres** (função/trigger:
um dono para webhook, cron, UI e Extrator). **Tudo que é regra avaliável sem banco mora em TS
puro** (bateria em node, relógio e RNG injetáveis).

## 2. Decisões (resumo; racional em `adr.md`)

| # | Decisão |
|---|---|
| ADR-01 | Chamada com `tools` nunca leva `response_format`; shape inválido ⇒ 1 chamada de formatação que consome uma rodada do teto de AC-A9 |
| ADR-02 | Modo novo: cadeia sem `groq/compound*`, até 2 modelos. 400 `tool_use_failed` = rodada perdida (repete/failover), **nunca** legado. Legado só com erro explícito de "não suporta tools" |
| ADR-03 | Janela D5 = `messages.processed_at IS NULL`, reivindicada por `UPDATE … RETURNING` atômico |
| ADR-04 | Commit monotônico por RPC; **toda ação única do turno** (despedida, aviso ao dono) é gated por "esta chamada desligou a IA" (`flipped_off`); parada antes de bolha compara com o estado **do início do turno** |
| ADR-05 | Modo novo em `EdgeRuntime.waitUntil`; legado síncrono e inalterado; dedupe por `external_id` |
| ADR-06 | Chave canônica em SQL por trigger; migração aborta em colisão |
| ADR-07 | Invariantes entre escritores viram trigger (`security definer`, `search_path=''`, filtro de tenant) |
| ADR-08 | Reserva do disparo serializa o usuário: reserva aberta bloqueia nova reserva; espaçamento medido em `sent_at` real |
| ADR-09 | Secret do cron em `app_settings`, lido pelo job SQL; guardado vazio ⇒ fail-close |
| ADR-10 | Rascunho: `brain.ts` reaproveitado; migration reescrita com timestamp novo |
| ADR-11 | Webhook autenticado por secret por instância na URL; modo novo e efeitos permanentes só em request autenticado |
| ADR-12 | Ordem de rollout: migration → functions; `processed_at default now()` torna a janela de deploy inofensiva |
| ADR-13 | `{empresa}` do toque 1 = empresa do tenant (`agent_configs.company_name`), não do prospect |
| ADR-14 | Telas novas (Prospecção, seção do agente) no DS DRYOS por wrapper `.dryos`; resto do Q7 segue teal |

## 3. Schema

Três migrations novas: `20260925010000_ai_brain.sql`, `20260925020000_phone_canon.sql`,
`20260925030000_outreach.sql`. O rascunho `20260924020000_ai_brain.sql` (não commitado) é apagado.

### 3.0 Regras comuns (AC-C1)

- Toda `create` com `if not exists` ou `drop … if exists` antes; `add constraint` em `DO` com checagem em `pg_constraint`.
- **Backfill por marcador**, não por "coluna acabou de nascer": tabela `private.q7_markers(key text primary key, at timestamptz)`.
  Cada backfill roda em `DO` só se o marcador não existe e grava o marcador na mesma transação. Vale mesmo se o rascunho
  já tiver sido aplicado em algum banco (as colunas existem, o marcador não).
- **Toda função nova** (definer ou invoker): `revoke execute … from public, anon, authenticated`, depois `grant execute … to service_role`;
  as exceções (`authenticated`) estão nomeadas uma a uma abaixo. Definer: `set search_path = ''` e nomes qualificados.
- **Toda tabela nova**: `enable row level security` + policy `TO authenticated` `using/with check (auth.uid() = user_id)`
  (ou só `for select` onde dito), e `revoke all … from anon, authenticated` **antes** dos grants explícitos (o default privileges
  do schema `public` pode ter concedido ALL — não medido; o revoke vale nos dois casos).

### 3.1 `20260925010000_ai_brain.sql` (P1/P2)

- `agent_configs` + `business_context text`, `owner_notify_phone text`, `company_name text` (ADR-13).
- `conversations` + `ai_stage text not null default 'abordar'` com check nas 6 etapas, `qualification jsonb not null default '{}'`,
  `confirmacoes int not null default 0`, `ai_summary text`, `optout bool not null default false`, `optout_motivo text`.
  Backfill AC-A18b (marcador `ai_brain.ai_stage`).
- `messages` + `processed_at timestamptz`, `external_id text`; índice único parcial
  `(conversation_id, external_id) where external_id is not null`; índice parcial de pendentes.
  - Ordem dentro da migration: `add column` **sem** default ⇒ backfill (marcador `ai_brain.processed_at`)
    `processed_at = created_at` onde nulo ⇒ `alter column set default now()`. (Com o default no `add column`, o fast default do
    PG 11+ carimbaria as linhas antigas com a hora do `ALTER` e o backfill não acharia nada — fool r3 W6.)
  - `default now()` (ADR-12): quem não conhece a coluna (webhook antigo, UI, Extrator, outbound) grava "já processada".
    Só o webhook novo grava inbound com `processed_at: null` explícito.
- `private.instance_webhook_secrets(instance_id uuid pk references whatsapp_instances on delete cascade, user_id uuid not null,
  secret text not null unique default replace(gen_random_uuid()::text,'-',''), confirmed_at timestamptz)` (ADR-11). Schema `private`,
  nenhum grant a `anon`/`authenticated`, RLS ligada e `revoke all` (defesa se o schema for exposto) — fora do alcance do client por
  construção (grant de tabela em `whatsapp_instances`, `q7_init.sql:104`, tornaria revoke por coluna inócuo). Mesma regra em
  `private.q7_markers`. Linha criada pelo `set_webhook` se não existe.
  Acesso só por RPC em `public` (o PostgREST não expõe `private`), definer:
  Colunas: `secret`, `secret_prev` (aceito até `prev_until`), `confirmed_at`.
  - `service_role`: `webhook_secret_for(p_user, p_instance) returns text` (confere `whatsapp_instances.user_id = p_user` **dentro** da
    função; cria se não existe); `webhook_rotate_begin(p_user, p_instance) returns text` (gera candidato, **não** troca nada) e
    `webhook_rotate_commit(p_user, p_instance, p_novo)` (chamado só depois que a Uazapi aceitou a URL nova: `secret_prev = secret`,
    `prev_until = now() + 10 min`, `secret = p_novo`, `confirmed_at = null`). Falha no registro ⇒ nada muda (fool r4 W2).
    `webhook_resolve(p_secret) returns (instance_id, user_id, confirmed_at)` casa `secret` ou `secret_prev` dentro do prazo;
    `user_id` lido de `whatsapp_instances`. `webhook_confirm(p_instance)`; `webhook_is_confirmed(p_instance) returns bool`.
  - `authenticated` (exceção nomeada): `my_webhook_secret(p_instance) returns text` — só para `whatsapp_instances.user_id = auth.uid()`.
    A URL é montada fora do banco por um único helper de formato (`whatsapp-webhook?s=`), com `VITE_SUPABASE_URL` na UI e `SUPABASE_URL`
    no servidor — o Postgres não conhece a URL do projeto (fool r4 W5). O dono vê o próprio secret; a força do `s` já é, na
    prática, a do token da instância que ele também vê (security r3 W1).
- `knowledge_base` (como no plano) + trigger `topic = lower(btrim(topic))` (dono único de AC-U2; UI mostra 23505 como
  "tópico já existe"). Policies `TO authenticated`, `using/with check (auth.uid() = user_id)`.
- RPCs (service role):
  - `brain_claim_inbound(p_user uuid, p_conv uuid) returns setof messages` — `update … set processed_at=now() where
    conversation_id=p_conv and user_id=p_user and direction='inbound' and processed_at is null returning *`.
  - `brain_bump_confirmacoes(p_user, p_conv, p_delta int) returns int`.
  - `brain_commit_turn(p_user, p_conv, p_stage, p_qualification_delta jsonb, p_summary, p_desligar bool, p_optout bool,
    p_motivo) returns (ai_enabled, optout, flipped_off bool, flipped_optout bool)`: `select … for update`, depois
    `qualification = qualification || p_qualification_delta` (só o que **este** turno descobriu — W2),
    `optout = optout or p_optout`, `ai_enabled = ai_enabled and not (p_desligar or p_optout)` (optout sempre desliga, dono único — fool r4 B1),
    `ai_stage = case when p_optout then 'descartar' when ai_stage = 'descartar' and optout and not ai_enabled then 'descartar' else coalesce(p_stage, ai_stage) end`,
    `human_takeover_at = now()` só quando `flipped_off`.
    `flipped_off` = `ai_enabled` era true e esta chamada o desligou; `flipped_optout` = `optout` era false e esta chamada o ligou.
    - Por que o `case` resolve os dois lados: turno concorrente (IA já desligada pelo optout) não tira `descartar` (AC-A20);
      depois que o humano religa, `ai_enabled` é true e o 2º ramo não prende mais, nem se o modelo escolher `descartar` depois (AC-A19, fool r3 W1).
- Trigger `conversations_ai_reenable` (`before update`): `old.ai_enabled=false and new.ai_enabled=true` ⇒
  `confirmacoes=0`; `ai_stage='descartar'` ⇒ `'descobrir'`; `optout` intocado. Pega o toggle de `Conversas.tsx:269`.
  Decisão sobre o furo "optout + IA religada" (fool B1): a IA **volta a responder** normalmente nessa conversa (o humano decidiu);
  o prospect ligado continua `optout` e nunca recebe toque. Não há UI para limpar `optout` (AC-A19 não pede).

### 3.2 `20260925020000_phone_canon.sql` (AC-C3/C3b)

- `canon_phone(text) returns text immutable` — número já com DDI: só dígitos; vazio ⇒ null; 12 dígitos começando com `55` e
  1º dígito local (5º dígito) em 6-9 ⇒ insere o 9 após o DDD. Idempotente.
- `canon_phone_input(text) returns text immutable` — número digitado por humano: com `+` ⇒ `canon_phone(dígitos)`;
  10/11 dígitos ⇒ `canon_phone('55'||dígitos)`; senão `canon_phone(dígitos)`; fora de 12-15 dígitos ⇒ null (inválido).
  Não é idempotente para número estrangeiro de 11 dígitos ⇒ nunca em trigger. `execute` para `authenticated`.
- `canon_phone_input_batch(text[]) returns text[]` — CSV na UI; array acima de 5000 ⇒ exception. `execute` para `authenticated`.
- Triggers com `canon_phone` em `conversations.contact_phone`, `prospects.phone` (criado em 3.3), `agent_configs.owner_notify_phone`.
- `conversations` + `wa_phone text` (dígitos crus do último JID visto). **Todo** envio para contato usa
  `coalesce(wa_phone, contact_phone)`: `turno.ts`, `run-followups/index.ts:132`, `run-outreach`, e o envio manual
  de `Conversas.tsx:408` (fool W7).
- Migração dos existentes (marcador `phone_canon.backfill`), em `DO`: (1) `wa_phone = contact_phone` onde nulo;
  (2) colisão = `(user_id, canon_phone(contact_phone))` com mais de 1 linha, **excluída chave nula**; linha cujo
  `canon_phone` dá null e não tem `contact_email` também aborta (violaria `conversations_contact_identifier_chk`);
  em qualquer um ⇒ `raise exception` com as contagens, sem mesclar; (3) senão canonicaliza.
- `preflight-q1.sql`: **estimativa** (reimplementa a regra em regex porque a função ainda não existe). A autoridade é o
  passo (2) da própria migration, que aborta antes de escrever.
- **Dependência de deploy cross-repo (design-gate B1):** o Extrator grava direto em `conversations`
  (`03.dryos_os_extractor/src/components/leadhunter/LeadCard.tsx:52-58` dedupe por telefone cru, `:75-86` insert + `error.message`
  cru no toast). Mudança no Extrator: **só** tratar 23505 **do índice de telefone** (`conversations_user_phone_uidx` na mensagem do
  erro) como estado `exists`; 23505 do índice de email mostra "email já cadastrado em outro contato" (fool r3 W11). Sem RPC nova —
  o dedupe cru pode não achar a conversa de 13 dígitos, e aí o insert canonicalizado pelo trigger bate no índice único e cai no
  mesmo estado. Funciona igual antes e depois da migration, então a ordem entre os dois deploys deixa de importar para a
  correção (design-gate r2 B1/B2); sobe antes só para não haver janela com toast cru. Prova: AC-C3b, forma E no repo do
  Extrator (§8). Dívida registrada: o Extrator não tem contrato com o Q7, conhece o schema interno (design-gate W1).

### 3.3 `20260925030000_outreach.sql` (P3/P4)

- `prospects` (colunas do plano) — `phone` canônico por trigger; `estado check in ('fila','abordado','respondeu','descartado','optout')`;
  `unique (user_id, phone)`. `authenticated`: select, delete, **insert só de** `user_id, phone, name, company, city, extra, origem`,
  **update só de** `name, company, city, extra`. Apagar e reimportar quem teve optout não reabre o contato: a conversa com optout
  continua existindo (a UI não apaga conversa) e cai na regra de AC-B2.
- `outreach_sends (id, user_id, prospect_id, toque int, status text check in ('reservado','enviado','incerto'), reserved_at, sent_at)`.
  `authenticated`: só select (policy `for select`).
- `outreach_openers (id, user_id, text, active)` com check de tamanho (AC-B22) e de link
  (`text !~* '(https?://|www\.|wa\.me|\m[a-z0-9-]+\.(com|net|org|br|io|app|me)\M)'`). `authenticated`: **só select** na tabela;
  escrita só pela RPC `save_openers(text[])` (definer, `auth.uid()` como dono, exceção nomeada de `execute` para `authenticated`):
  troca o conjunto numa transação; recusa < 2 ativas; recusa variação com `{empresa}` se `company_name` está vazio (ADR-13).
  Na hora do disparo, variação com `{empresa}` e `company_name` vazio (apagado depois do save) **não** conta como válida para AC-B22.
- `agent_configs` + `outreach_enabled bool default false`, `outreach_daily_cap int default 40` com check `>= 1`,
  `outreach_instance_id`, `outreach_ramp_start date`, `outreach_weekdays_only`, `outreach_saturday_morning`, `outreach_paused_reason`.
- `app_settings` + `outreach_cron_secret` gerado se não existir (ADR-09).
- Triggers (ADR-07), com filtro `prospects.user_id = new.user_id`:
  - `conversations after update of optout` (false→true) ⇒ prospect ligado vira `optout`, `proximo_toque=null` (AC-B13).
  - `messages after insert` inbound ⇒ prospect ligado vira `respondeu`, `proximo_toque=null` **se** `estado not in ('optout','descartado')` (AC-B14, fool W11).
- RPCs (service role), todas com `p_user` e `where user_id = p_user` em toda leitura/escrita:
  - `outreach_reserve(p_user, p_teto int, p_intervalo interval) returns (send_id, prospect, conversation)`:
    1. `select … from agent_configs where user_id=p_user for update` (serializa o usuário).
    2. Reserva `reservado` com `reserved_at` > 5 min ⇒ vira `incerto`, `sent_at = reserved_at`, `cadencia_aplicada = false`,
       e é devolvida ao chamador, que aplica a cadência com `proximoToque` de `outreach.ts` via `outreach_mark_uncertain`
       (a regra de AC-B9 tem um dono só, em TS — fool r4 W4). Prospect com linha `reservado` ou `incerto` sem cadência aplicada
       fica fora do passo 6 (lado seguro: pular um toque, nunca duplicar).
    3. Existe reserva `reservado` aberta ⇒ devolve nulo (ADR-08: um envio em voo por usuário).
    4. Último `sent_at` (status `enviado`/`incerto`) mais novo que `p_intervalo` ⇒ nulo (AC-B4 medido no envio real).
    5. Conta do dia SP por `coalesce(sent_at, reserved_at)` (`enviado` + `incerto` + `reservado`) `>= p_teto` ⇒ nulo.
    6. Prospect elegível `for update skip locked`; AC-B2/B16/B18 sobre a conversa da chave: com mensagem ⇒ `descartado`, próximo;
       vazia ⇒ liga e preenche `instance_id`/`stage_id` se nulos (conversa do Extrator não tem `instance_id`); nenhuma ⇒ cria com
       `ai_stage='abordar'`, `instance_id=outreach_instance_id`, `stage_id` = 1º estágio do usuário; `ai_enabled=false` ⇒ para cadência.
       Conversa ligada tem de ter `user_id = p_user`; `outreach_instance_id` tem de ter `whatsapp_instances.user_id = p_user`
       (checado aqui, sob o lock — security r3 W5).
    7. Insere `outreach_sends` `reservado`.
  - `outreach_mark_sent(p_user, p_send, p_proximo_toque, p_tentativas)` — `enviado`, `sent_at=now()`; prospect atualizado;
    3º toque ⇒ `descartado` (AC-B9); `outreach_ramp_start` se nulo. Linha que já virou `incerto` (tick lento): só troca o status;
    se a cadência já foi aplicada, não aplica de novo.
  - `outreach_mark_uncertain(p_user, p_send, p_proximo_toque, p_tentativas)` — resultado desconhecido (timeout do envio, ou reserva
    velha do passo 2): `incerto`, `sent_at = coalesce(sent_at, now())` (no timeout, `now()` é depois da tentativa de envio, então o
    espaçamento de AC-B4 conta a partir dela — fool r4 W3), aplica a cadência e `outreach_ramp_start` se nulo como `mark_sent`,
    `cadencia_aplicada = true`. Depois dele o fluxo **não** chama `mark_sent`; grava a outbound em `messages` (o toque pode ter saído).
  - `outreach_release(p_user, p_send, p_motivo)` — apaga a reserva e grava `ultima_falha_*` (AC-B15/B19); sem motivo = liberação
    silenciosa (AC-B8/B18).
  - `outreach_day_stats(p_user) returns (enviados, responderam)` — AC-B10; `enviados` conta `enviado` + `incerto`.

## 4. Fluxos

### 4.1 Webhook

1. **Auth (ADR-11):** `url.searchParams.has('s')` (plano B se a Task 1 mostrar que a Uazapi descarta query: segmento de path
   `/whatsapp-webhook/s/<secret>`, mesma regra) ⇒ resolve a instância **por** `secret` em `private.instance_webhook_secrets`
   (igualdade, índice único); vazio ou não achou ⇒ 401. Ausente ⇒ instância com `confirmed_at` preenchido rejeita (401); sem
   confirmação ⇒ resolução atual por token/nome/owner, marcada `autenticado=false`.
   `autenticado=false` ⇒ caminho legado, byte a byte: turno legado e nenhuma decisão do cérebro (modo novo, optout, escalada,
   aviso). O que o legado já grava hoje (upsert, inbound) continua sendo gravado, e os triggers de §3.3 reagem a esse inbound —
   dano possível: prospect do próprio tenant vira `respondeu` e a cadência para (lado seguro). Por isso `run-outreach` exige
   instância confirmada (§4.4). `confirmed_at` só é gravado por um evento `messages` real com `s` válido — prova de que a **Uazapi**
   manda o `s`. `dry_run`, `test` e `connection` nunca confirmam (fool r4 B2).
   Request rejeitada por falta de `s` em instância confirmada: log com o id da instância (sem telefone). `dry_run` passa pela mesma
   auth (com `s` vindo de `my_webhook_secret`), mas não confirma.
2. Parse (inalterado) → `phone` do JID → `key = rpc canon_phone(phone)`.
3. Só com `autenticado && modoCerebro(agent)`: `key = agent.owner_notify_phone` ⇒ `ok()`, sem criar conversa, sem logar o número
   (AC-A15; security W9). No legado nada muda (fool r3 W10).
4. Upsert da conversa por `key`; insert grava `ai_stage` `'abordar'` se `fromMe`, senão `'descobrir'` (AC-A18/A18c); `wa_phone = phone`.
5. Insert do inbound com `external_id` e `processed_at: null`, **checando o erro**: 23505 no índice de `external_id` ⇒ reenvio ⇒ `ok()`;
   outro erro ⇒ log alto + `ok()`. Sem id no payload ⇒ insere sem `external_id` e loga.
6. `fromMe` ⇒ takeover atual.
7. `claim = brain_claim_inbound(…)` — sempre.
8. `!autenticado || !modoCerebro(agent)` ⇒ legado atual (AC-A12).
9. Modo novo, **IA desligada na conversa ou agente off**: a regra de saída ainda roda sobre o claim (pura, sem IA — fool r3 B1):
   casou ⇒ o **mesmo** ramo optout de §4.2 (commit que desliga a IA, cancela follow-ups, despedida pela regra de §4.2). Não casou ⇒ `ok()`.
   A despedida sai mesmo com agente off ou conversa em takeover humano: é o que AC-A5c pede (fool r4 W9/W10 — registrado, sem exceção).
10. Modo novo, IA ligada ⇒ `EdgeRuntime.waitUntil(turno.responder(conv, claim))`; `ok()`. `claim` vazio ⇒ nada a fazer.

`dry_run` (`index.ts:405-499`): passa pela auth do passo 1 como qualquer request (fool r3 W8).

### 4.2 `turno.responder` (modo novo)

```
estado0 = conversa relida logo após o claim          // optout0, ai_enabled0
janela  = claim.map(content)
try {
  d = runBrainTurn({…, historyMessages, janela})      // brain.ts
    ├─ pediuParaSair(janela)  → {tipo:'optout'}   0 chamadas à IA
    ├─ IA falha (D4)          → {tipo:'escalar', motivo:'IA falhou'}
    ├─ tools não suportadas   → {tipo:'legado'}   (pediuHumano(janela) avaliado antes: se casou ⇒ escalar)
    └─ ok                     → {tipo:'responder', mensagens, etapa, qualificacaoDoTurno, prometeu, escalarSemContador}
                                escalarSemContador = modelo.escalar || modelo.optout (D6) || pediuHumano(janela)
                                pedido de humano não pula a IA: a resposta sai e a conversa escala (fluxo.js:216-230)
} catch (erro fora da IA) → tratar como {tipo:'escalar', motivo:'erro no turno'}   (fool W3)

optout:    c = commit(p_optout, p_desligar) → cancelPendingFollowups (todos os kinds)
           → SE c.flipped_optout || c.flipped_off: envia DESPEDIDA_OPTOUT, grava message
             ("pare"+"PARE!" ⇒ o 2º não muda nada ⇒ 1 despedida; optout depois de uma escalada ⇒ muda optout ⇒ despedida;
              conversa com optout religada ⇒ muda ai_enabled ⇒ despedida — fool r1 B2, r3 B1)
escalar:   c = commit(p_desligar) → SE c.flipped_off e owner_notify_phone: aviso ao dono
responder: n = bump(prometeu ? 1 : 0)
           desligar = escalarSemContador || deveEscalarPorConfirmacoes(n)
           c = commit(etapa, qualificacaoDoTurno, resumo, desligar)
           para cada bolha: relê (optout, ai_enabled); PARA se
              (optout && !optout0)                         // outro turno deu optout durante este
              || (!ai_enabled && !(desligar && c.flipped_off))  // outro escritor desligou (takeover, outro turno)
           envia; grava; espera (AC-A16)
           → SE desligar && c.flipped_off e owner_notify_phone: aviso ao dono
           → agenda follow-up (função atual; ela checa ai_enabled)
legado:    caminho legado com o mesmo claim; console.warn
```

- `deveEscalarPorConfirmacoes(n)` e o limiar vivem em `brain.ts`; `n` é sempre a contagem **já incluindo** a promessa deste turno.
  `runBrainTurn` chama com `conversa.confirmacoes + (prometeu ? 1 : 0)` (bateria: AC-A3/A3n/A3o); `turno.ts` chama com o retorno do
  bump, que já somou (H: AC-A3 repetido em `turno.ts` e AC-A20). A mutação "turno ignora o contador" morre no H de AC-A3, não só no
  de AC-A20 (fool r3 W2).
- Histórico do turno lido com `.eq('conversation_id', conv).eq('user_id', p_user)` (security r3 W6).
- Timeouts: todo `fetch` externo (Groq, `listChatModels`, Uazapi) com `AbortSignal.timeout` (Groq 20s; Uazapi e models 10s).

### 4.3 `run-followups`

- Envio usa `coalesce(wa_phone, contact_phone)`; instância carregada com `.eq('user_id', conv.user_id)` (security r3 W5).
- Antes do envio (depois de gerar o texto): relê `optout`; `true` ⇒ cancela, qualquer `kind` (AC-A5d).
- Reengajamento no modo novo: `runBrainTurn` com janela vazia e `extraSistema` = instrução atual; só a 1ª bolha; não comita
  estado. Falha ⇒ fallback atual (AC-A17). Legado inalterado.

### 4.4 `run-outreach` (tick por minuto)

```
secret guardado ausente/vazio ⇒ 500, 0 envios; header ≠ guardado (tempo constante) ⇒ 401   (AC-B11, security W4)
inicio = agora
para cada user com outreach_enabled, sem paused_reason, modoCerebro(agent),        (fool W6)
  em ordem de outreach_last_tick_at (nulls first; atualizado ao visitar — fool r3 W12)
  e agora - inicio < ORCAMENTO_TICK (90s; §5):
  instância outreach_instance_id conectada, com user_id = user e webhook confirmado (AC-B12, security W3, security r2 W2)
  podeDispararAgora(agoraSP, flags)?                                              (AC-B5)  outreach.ts
  rng() < P_PULAR ⇒ pula                                                          (AC-B17) outreach.ts
  r = outreach_reserve(user, tetoEfetivo(...), intervalo AC-B4)                   (AC-B2/B3/B4/B6/B7/B16/B18)
  texto = tentativas=0 ? montarToque1(sortear(openers válidas ≥ 2), prospect, agent.company_name)  (AC-B21/B22/B23, sem IA)
                       : runBrainTurn modo toque (instrucaoDoToque portada), 1 bolha, prazo 30s
  falha IA ⇒ outreach_release(motivo)                                             (AC-B19)
  relê prospect.optout e conversa (optout, ai_enabled) ⇒ release silencioso       (AC-B8/B18)
  Uazapi send (coalesce(wa_phone, contact_phone)); resposta de erro ⇒ outreach_release(motivo) (AC-B15);
    timeout/rede sem resposta ⇒ outreach_mark_uncertain (resultado desconhecido não é falha — fool r3 W4)
  grava messages outbound; outreach_mark_sent(proximoToque(n))                    (AC-B9)
  freio(outreach_day_stats) ⇒ desliga + paused_reason + aviso ao dono             (AC-B10/B20)
```

- `montarToque1`: `{nome}` = nome do prospect, `{empresa}` = `company_name` do tenant (ADR-13); a regra de placeholder vazio é a de AC-B21,
  e variação com `{empresa}` sem `company_name` já foi filtrada como inválida (§3.3).
- Deploy: `config.toml` + `[functions.run-outreach] verify_jwt = false`; `supabase/setup/cron.sql` + job com o header montado por
  `(select value from public.app_settings where key='outreach_cron_secret')`.

## 5. Orçamento (Q2)

- Turno do webhook: `TURN_DEADLINE_MS = 120000`; antes de cada chamada à Groq, restante < timeout ⇒ erro de prazo ⇒ IA falhou (D4).
  Pior caso de HTTP por turno = 2 `pensar` × teto de AC-A9 × 2 modelos; o prazo corta antes.
- Tick do `run-outreach`: não começa usuário novo depois de 90s; toque de IA com prazo 30s ⇒ o tick termina antes dos 150s.
  Morte entre envio e `mark_sent` ⇒ reserva vira `incerto` no tick seguinte (§3.3, passo 2): pula um toque, não duplica.
- CPU (2s) não é gargalo: I/O.
- Reenvio do webhook: ADR-05.
- Cota diária da Groq esgotada (429 nos 2 modelos) ⇒ D4 escala cada conversa ativa, com um aviso ao dono por conversa (fool W5):
  **confirmado pelo Rafael (2026-09-24): escala para humano.**

## 6. UI

- `ConfigDrawer.tsx`, seção do agente (`:679-736`): "Nome da empresa" → `company_name`; "Sobre o seu negócio" → `business_context`;
  "WhatsApp do responsável" → `rpc canon_phone_input` → `owner_notify_phone` (inválido ⇒ erro inline); bloco "Base de conhecimento"
  (lista, editar, remover; 23505 ⇒ "tópico já existe"; vazio ⇒ texto "nenhum tópico ainda" + botão adicionar). `saveAgent` (`:347`)
  ganha os campos; salvar com `business_context` preenchido dispara `set_webhook` na instância conectada (ADR-11).
- A constante `webhookUrl` (`ConfigDrawer.tsx:393`) deixa de existir: **todo** uso dela — `copyWebhook`, `runWebhookDiagnostic`, o
  `Input` exibido (`:616`) e os bodies de `set_webhook` (`:306`, `:441`, que o servidor passa a ignorar) — passa pelo helper de URL
  com o secret de `rpc my_webhook_secret(instance)` (fool r3 B2, r4 W6). Status "confirmado / aguardando 1ª mensagem" visível na seção.
  Botão "Reconfigurar webhook" chama `set_webhook` com rotação.
- `manage-instance` (ADR-11): `set_webhook` e `get_webhooks` exigem `auth.getUser()` do JWT do chamador e instância com
  `user_id = uid` achada por `instance_token`; sem instância própria ⇒ erro (nunca o token global). URL montada no servidor pelo
  helper; `webhook_url` do body ignorado. Rotação: `rotate_begin` → registra na Uazapi → só com sucesso `rotate_commit`.
  Resposta e log com `s` redigido.
- `src/pages/Prospeccao.tsx` + rota em `App.tsx` + link no header de `Conversas.tsx:445-455` e `Kanban.tsx:305-310` (3ª cópia do nav,
  Out of Scope). Conteúdo: import CSV (`xlsx`, já dependência; `canon_phone_input_batch`; `upsert … ignoreDuplicates`; contagem de
  rejeitados), editor de variações (`save_openers`; recusa ⇒ mensagem do erro da RPC inline abaixo do editor, variação ofensora destacada),
  toggle + config, motivo de pausa (AC-P2), tabela de prospects, enviados hoje / taxa.
- Estados (design-gate W2-W4): todo save/import/fetch com botão desabilitado + spinner (padrão atual `saving` de `ConfigDrawer.tsx:348`);
  tabela vazia ⇒ texto + CTA de import; tabela com `overflow-x-auto` no mobile; só tokens do tema (`bg-background`, `text-muted-foreground`…),
  que já cobrem dark/light.
- **Visual (ADR-14):** as superfícies novas — página Prospecção e a seção do agente no ConfigDrawer (negócio, base de conhecimento,
  webhook) — seguem o **DS DRYOS** (`delivery_os/.claude/skills/dryos-design-system/SKILL.md`), não o tema teal "Q7 Educação"
  (`src/index.css:5`). Referência visual: artifact de mockups https://claude.ai/artifact/PrLweS7oQpWf1tfLfrVymj (Prospecção, agente, estados).
  Mecanismo: wrapper `.dryos` nessas superfícies redefine as vars HSL do shadcn (`--background`, `--primary`, `--border`, `--radius`…)
  com os valores já mapeados no Extrator (`03.dryos_os_extractor/src/index.css:8-60`), e `.dark .dryos` com o dark do DS. Componentes
  shadcn existentes (`src/components/ui`) herdam o tema dentro do wrapper sem fork; Pill vira variante de `Badge`. Fontes Funnel Display/
  Onest/JetBrains Mono entram no `index.html` ao lado da Space Grotesk atual (`index.html:8`); `tailwind.config.ts` ganha `fontFamily.display/mono`.
  O resto do Q7 fica teal: dois temas convivem até uma migração inteira (fora de escopo).

## 7. Rascunho existente (ADR-10)

| Arquivo | Destino |
|---|---|
| `brain.ts` | fica: `faltaNavt`, `NAO_RESPOSTA`, `calendario`, `TOOLS`, `executarTool`, `extrairJson`, gate NAVT, `pensar`/`chamarComTools`. Reescreve: regras de saída/humano (corpora, D3/D7), parâmetro `janela`, saída antes da IA, contagem após o corte, optout do modelo ⇒ escala, `qualificacaoDoTurno` separado de `dados`, sem `response_format` com `tools` |
| `cerebro.ts` | fica; + instrução para a resposta ao cumprimento do toque 1 (AC-B24) |
| `get-ai-config.ts` (diff) | fica; + corpo cru do erro (truncado, só da resposta — nunca o request; security W10), timeout, opções de cadeia |
| `20260924020000_ai_brain.sql` | apagado; substituído por §3.1 |

A bateria ancora mutações em strings do `brain.ts` atual; `mut()` aborta com "mutacao nao aplicou" quando a âncora some.
Na Fase 4 as âncoras são refeitas sobre o `brain.ts` novo e os testes passam `janela` explicitamente; toda mutação existente
tem de continuar morrendo.

## 8. AC → onde mora a prova

**U** = bateria node sobre arquivo de produção (`battery/`); **H** = handler (`handle.ts`/`turno.ts`/`run-outreach`/`run-followups`)
em node contra `supabase start` local (Docker), Groq e Uazapi stubados por `fetch` injetado; **S** = SQL contra o mesmo Postgres;
**E** = playwright contra `npm run dev` + local; **M** = manual.

| AC | Forma | Onde |
|---|---|---|
| AC-A0 | curl real, saída capturada | `battery/a0-groq.sh` (Task 0) |
| AC-A1 A2 A2r A2n A3 A3n A3o A6 A7 A7b A8 A9 A10 A11 | U | `brain.ts` |
| AC-A4 A4n A4w A5 A5n A5w A5b A5e | U (janela explícita) + H de AC-A5 com IA desligada na conversa ("pare" após escalada ⇒ optout + 1 despedida) | `brain.ts`, `handle.ts` |
| AC-A5c A13 A14 A15 A16 A18 A18c | H | `handle.ts`, `turno.ts` |
| AC-A20 A21 | H concorrente (2 invocações, Groq stub com atraso, ordem forçada por barreira) + caso "pare" + "PARE!" = 1 despedida | `turno.ts` + RPCs §3.1 |
| AC-A19 | S (trigger) + H (turno após religar com optout=true envia) | §3.1, `turno.ts` |
| AC-A12 | H: snapshot do body enviado à Groq, antes × depois; e request sem `s` em instância não confirmada | `handle.ts` |
| AC-A3 (handler) | H: 2 turnos seguidos com promessa ⇒ escala pelo contador pós-bump | `turno.ts` |
| AC-A17 A5d | H | `run-followups` |
| AC-A18b AC-C1 AC-C3 | S (C1: cada migration 2×, e 2× depois do rascunho antigo aplicado; C3: tabela da spec contra `canon_phone`/`canon_phone_input`) | migrations §3 |
| AC-C3b | H (2 inbound quase simultâneas, formatos diferentes ⇒ 1 conversa) + E no repo do Extrator (lead de 12 dígitos já no CRM ⇒ "já está no CRM") | `handle.ts`, `LeadCard.tsx` |
| AC-C2 | U (A7/A7b) + H em `run-outreach` com 2 tenants (reserva, `day_stats`, instância) | `brain.ts`, RPCs §3.3 |
| AC-B1 B2 B4 B8 B11 B12 B13 B14 B15 B16 B18 B19 B20 | H | `run-outreach`, triggers §3.3 |
| AC-B3 | H concorrente contra Postgres (2 ticks, toque 2 com IA lenta) | `outreach_reserve` |
| AC-B5 B7 B17 B21 B23 | U (relógio/RNG injetados) | `outreach.ts` |
| AC-B6 | U (rampa) + S (check `>= 1`) | `outreach.ts`, §3.3 |
| AC-B9 | U (datas) + S/H (3º toque ⇒ `descartado`) | `outreach.ts`, `outreach_mark_sent` |
| AC-B10 | U (regra) + S (`outreach_day_stats`) | `outreach.ts`, §3.3 |
| AC-B22 | S (`save_openers`, checks) + H (`run-outreach` sem 2 válidas) | §3.3 |
| AC-B24 | M | relatório da Fase 4 |
| AC-U1 AC-U2 AC-P1 AC-P2 | E + banco | `ConfigDrawer.tsx`, `Prospeccao.tsx` |
| AC-U3 | S com 2 JWTs `authenticated`: select/insert/update/delete cruzado em `knowledge_base`, `prospects`, `outreach_openers`, `outreach_sends` negados; `update prospects set optout=false` e `delete from outreach_sends` do próprio tenant negados; RPCs `brain_*`/`outreach_*` negadas a `authenticated`; `private.instance_webhook_secrets` inacessível | policies/grants §3 |
| AC-D1 | `grep` no diff final + `tsc` | lista do AC na spec |

## 9. Rollout (ADR-12)

0. Prod: `migration repair` da `20260924000000` (§0) — mexe só no registro de migrations, não no schema; confirmar com o Rafael.
1. Extrator com o tratamento de 23505 (§3.2) em prod.
2. `preflight-q1.sql` rodado; colisão ⇒ Rafael decide antes.
3. Migrations 3.1 → 3.2 → 3.3.
4. Functions (`whatsapp-webhook`, `run-followups`, `manage-instance`, `run-outreach`) + `cron.sql`.
5. Por instância: "Reconfigurar webhook" (grava URL com `s`); o modo novo só liga depois da 1ª request autenticada.
   Task 1 confirma antes que a Uazapi preserva a query string (§0).
   Docs que mandam colar a URL sem `s` ou que leem 401 só como "deploy sem --no-verify-jwt" passam a dizer "copie a URL pelo botão
   do app" / "401 também = instância confirmada sem `s`" — lista no AC-D1 da spec (fool r3 B2, r4 W7).

Janela entre 3 e 4 é inofensiva: webhook antigo grava inbound com `processed_at` default `now()`. Ordem inversa (4 antes de 3)
quebra o insert do inbound; o insert passa a checar erro e logar alto, e `npm run check` (`scripts/check-setup.mjs`) passa a
verificar as colunas novas.

## 10. Riscos aceitos

- Claim antes da resposta: morte da instância entre claim e commit deixa as mensagens sem resposta (o original resgata por cron).
- Dedupe depende de a Uazapi mandar id.
- Instância não reconfigurada segue no caminho legado, com a exposição pré-existente do webhook sem auth.
- Com o mínimo de 2 variações e teto 40, ~20 toques 1 iguais por dia (fool W13) — é o mínimo da D8; a UI recomenda 5+.
- `20260924000000_conversations_email_optional_phone.sql` (já commitada, fora desta feature) tem `ADD CONSTRAINT` sem guarda. Não tocada.
