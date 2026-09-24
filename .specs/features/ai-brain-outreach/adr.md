# ADRs — ai-brain-outreach (Fase 2, 2026-09-23)

Formato: decisão · razão · alternativa descartada · reversível? AC só por id.

## ADR-01 — `tools` e `response_format` nunca na mesma chamada
- **Decisão:** o loop de tools chama a Groq sem `response_format`; a resposta final é parseada por `extrairJson`;
  shape inválido ⇒ 1 chamada de formatação com `json_object` e sem `tools`, que conta como rodada no teto de AC-A9.
- **Razão:** a Groq não documenta a combinação, e a página de Structured Outputs diz que tool use não é suportado ali.
  Desenhar sobre a combinação faria o P1 depender de AC-A0 dar certo; assim ele não depende.
- **Descartada:** combinação direta (rascunho `brain.ts:151-156`) — um 400 nessa chamada é engolido pelo failover (`get-ai-config.ts:223`).
- **Reversível:** sim. Se AC-A0 passar, dá para enviar os dois juntos sem mudar nenhuma interface.

## ADR-02 — Detectar "modelo não suporta tools" (Q3)
- **Decisão:** no modo novo, a cadeia de modelos exclui `groq/compound*` e vai só até 2 modelos; `GroqResult` passa a trazer
  `status`, `error.code` e o corpo cru truncado. 400 com `code = "tool_use_failed"` é **rodada perdida** (conta no teto de AC-A9,
  segue o failover normal) — não é falta de suporte. Só erro explícito de "não suporta tools/function calling" (código diferente de
  `tool_use_failed`) em toda tentativa leva o turno ao legado, com log.
- **Razão:** medido (`battery/a0-groq-loop.out`): `openai/gpt-oss-120b` devolve `tool_use_failed` em 1 de 3 loops, com corpo que cita
  "tool". A regra anterior ("corpo citando tool ⇒ legado") mandaria esses turnos ao legado por engano. Os 3 modelos medidos suportam tools.
- **Descartada:** reaproveitar o `failed_generation` do `tool_use_failed` como resposta final — funcionaria no caso medido, mas é
  código para um modelo que só entra por failover; o retry cobre.
- **Descartada:** allowlist fixa de modelos com tools — a Groq diz que todos suportam, e lista fixa apodrece.
- **Reversível:** sim.

## ADR-03 — Janela D5 por marcador `processed_at` com claim atômico
- **Decisão:** `messages.processed_at`; o turno reivindica com `UPDATE … WHERE processed_at IS NULL RETURNING`; histórico
  existente é marcado como processado na migração.
- **Razão:** igual ao `respondida = 0` do original, e o `UPDATE` com lock de linha dá conjuntos disjuntos entre turnos concorrentes
  sem lock explícito — é o que AC-A21 exige.
- **Descartada:** cursor na conversa (`last_processed_message_id`) — duas inbound com o mesmo `created_at` e a leitura de
  "maior que o cursor" voltam a depender da ordem de gravação, que é o problema da D5 antiga.
- **Custo aceito:** claim antes da resposta; se a instância morre no meio, as mensagens ficam sem resposta (design §9).
- **Reversível:** sim (coluna nova, sem perda).

## ADR-04 — Commit monotônico por RPC; ação única gated por transição
- **Decisão:** `brain_commit_turn` faz merge (`optout OR`, `ai_enabled AND NOT`, `qualification ||` só com o delta do turno) e
  devolve `flipped_off` (esta chamada desligou a IA) e `flipped_optout` (esta chamada ligou o optout). Aviso ao dono só sai com
  `flipped_off`; despedida com `flipped_optout || flipped_off` (cobre optout depois de uma escalada — gate r3 fool B1), sem exceção por
  agente desligado ou takeover (AC-A5c). O optout sempre desliga a IA dentro do RPC (gate r4 fool B1). A parada antes de cada
  bolha compara com o estado relido **logo após o claim**, não com o estado absoluto. `confirmacoes` por RPC de incremento; o limiar
  fica em `brain.ts`.
- **Razão:** AC-A20 proíbe um turno desfazer o outro, e o estado lido no início do turno faz exatamente isso num update comum.
  Gatear pela transição dá 1 despedida para "pare" + "PARE!" (gate r1 fool B2). Comparar com o estado do início evita calar para
  sempre a conversa com optout que o humano religou (gate r1 fool B1).
- **Descartada:** lock por conversa durante o turno — segura conexão por dezenas de segundos e ainda precisaria de merge para o toggle da UI.
- **Reversível:** sim.

## ADR-05 — Modo novo em `EdgeRuntime.waitUntil`; dedupe por `external_id`
- **Decisão:** o webhook grava o inbound, reivindica e responde 200; o turno roda em background. O legado continua síncrono.
  `messages.external_id` único por conversa barra o reenvio.
- **Razão:** um turno novo pode durar dezenas de segundos (§5 do design); segurar a resposta convida reenvio. Legado intocado
  preserva AC-A12 sem precisar provar equivalência de temporização.
- **Descartada:** fila (pgmq/Queues) — infra nova para um problema que o marcador de D5 já cobre.
- **Reversível:** sim.

## ADR-06 — Chave canônica de telefone em SQL, aplicada por trigger
- **Decisão:** `canon_phone` (com DDI, idempotente) em trigger nas três colunas; `canon_phone_input` (digitado por humano) só por RPC
  chamada pela UI. `wa_phone` guarda o número de envio cru. Migração aborta se houver colisão.
- **Razão:** um dono para quatro escritores (webhook, disparo, UI, Extrator, que grava direto pelo client). Inferir DDI em trigger
  quebraria número estrangeiro de 11 dígitos, que a regra de AC-C3 manda preservar. Abortar em colisão porque mesclar conversa é
  destrutivo e Q1 não foi medido.
- **Descartada:** normalizar em TS em cada ponto — o Extrator mora em outro repo e já diverge hoje (`LeadCard.tsx:35-39`).
- **Reversível:** a canonicalização das linhas existentes **não** é trivialmente reversível (`wa_phone` guarda o original — por isso ele existe). **1-way door parcial → Rafael aprova antes de aplicar em prod.**

## ADR-07 — Invariantes entre escritores viram trigger
- **Decisão:** religar IA zera contador/estágio (AC-A19); optout e resposta propagam para o prospect (AC-B13/B14) — todos por trigger.
- **Razão:** o toggle da UI (`Conversas.tsx:269`), o webhook e o cron escrevem as mesmas linhas; regra em código de um deles
  seria furada pelos outros.
- **Reversível:** sim.

## ADR-08 — Reserva do disparo serializa o usuário
- **Decisão:** `outreach_reserve` trava `agent_configs` do usuário (`FOR UPDATE`); reserva aberta impede outra; o espaçamento
  se mede pelo `sent_at` real; reserva velha vira `incerto`, conta como enviada e avança a cadência.
- **Razão:** AC-B3 pede atomicidade **por usuário** com o envio. Medir na reserva deixava 2 envios com menos que o intervalo quando
  o toque 2/3 demora gerando texto (gate r1 fool B3). Em morte no meio do envio, pular um toque é o lado seguro para o número.
- **Descartada:** advisory lock — some com a conexão do PostgREST, que não é a mesma entre chamadas; reserva por prospect (plano original).
- **Reversível:** sim.

## ADR-09 — Secret do cron em `app_settings`
- **Decisão:** a migration gera `outreach_cron_secret`; o job do `cron.sql` o lê por subselect; `run-outreach` compara em tempo constante; guardado ausente ou vazio ⇒ 500 e 0 envios.
- **Razão:** o `CLAUDE.md` de instalação diz "Não configure secrets"; este caminho não pede passo manual e a tabela já é admin-only.
- **Descartada:** `supabase secrets set` — passo de instalação novo que o fluxo guiado não tem.
- **Reversível:** sim.

## ADR-10 — Aproveitar o rascunho
- **Decisão:** manter a estrutura do `brain.ts` (e as âncoras de mutação que ainda fizerem sentido), reescrever as regras; a migration do rascunho é apagada e substituída por migrations com timestamp novo e backfill por marcador (não se sabe se o rascunho foi aplicado em algum banco).
- **Razão:** a bateria já mata as mutações sobre essa estrutura; reescrever do zero jogaria fora a cobertura de AC-A1…A11.
- **Reversível:** sim.

## ADR-11 — Webhook autenticado por secret de instância
- **Decisão:** secret por instância em `private.instance_webhook_secrets` (o client só lê o **próprio**, por `my_webhook_secret`); `set_webhook` — agora com
  `auth.getUser()` e dono da instância — monta a URL com `?s=<secret>` no servidor e nunca devolve nem loga o `s`. O handler resolve
  a instância pelo secret. Instância que já recebeu 1 evento `messages` real com secret recusa request sem ele (diagnóstico da UI não confirma). Rotação só troca o secret depois que a Uazapi aceitou a URL nova, e o anterior vale por 10 min. Sem secret ⇒ só o legado (sem decisão
  nenhuma do cérebro).
- **Razão:** o webhook é público e resolve o tenant por nome ou pelo telefone da instância (`whatsapp-webhook/index.ts:146-184`),
  e a feature pendura nele efeitos permanentes e envio pelo número do cliente (gate r1 security B1). `manage-instance` hoje não
  autentica o chamador e cai no token global (`manage-instance/index.ts:23-60`) — anexar o secret ali sem auth o entregaria a quem
  tem a anon key (gate r2 security B1).
- **Descartada:** coluna em `whatsapp_instances` — o grant de tabela (`q7_init.sql:104`) torna revoke por coluna inócuo; secret global — vaza para todo tenant; header — a Uazapi não deixa configurar header (palpite).
- **Limites conhecidos:** a força real do `s` é a do token da instância (quem tem o token lê a URL registrada na Uazapi); o `s` fica em
  logs de plataforma/Uazapi por ir na URL; contenção de vazamento = "Reconfigurar webhook" rotaciona (security r3 W1-W3).
- **Fora de escopo, levado ao Rafael:** as outras ações de `manage-instance` (`send_text` etc.) seguem sem auth e com fallback global — pré-existente.
- **Reversível:** sim. Instância não reconfigurada segue como hoje.

## ADR-12 — Ordem de rollout e janela de deploy inofensiva
- **Decisão:** migrations antes das functions; `messages.processed_at default now()`, e só o webhook novo grava `null`.
- **Razão:** o webhook antigo, rodando entre a migration e o deploy, gravaria inbound "não processado" que viraria janela do 1º turno
  (gate r1 fool B5). Com o default, quem não conhece a coluna grava "processado".
- **Descartada:** feature flag de deploy — mais estado para uma janela de minutos.
- **Reversível:** sim.

## ADR-13 — `{empresa}` = empresa do tenant
- **Decisão:** coluna `agent_configs.company_name`; `{empresa}` no toque 1 é ela; variação com `{empresa}` não salva sem ela.
- **Razão:** o exemplo da D8 ("aqui é da {empresa}") é quem envia; preencher com `prospects.company` mandaria "aqui é da <empresa do lead>"
  em massa (gate r1 fool B4). A remoção de placeholder vazio da AC-B21 fica para `{nome}`.
- **Descartada:** extrair o nome do `business_context` — texto livre.
- **Reversível:** sim (2-way door; leitura do TLC sobre a D8, levada ao Rafael).

## ADR-14 — Telas novas no DS DRYOS, escopadas
- **Decisão:** Prospecção e a seção do agente usam o DS DRYOS por um wrapper `.dryos` que redefine as vars do shadcn só ali; o resto do Q7 segue teal.
- **Razão:** pedido do Rafael (2026-09-24, "mockups + telas novas no DS"). O Q7 virou o CRM central do ecossistema DRYOS e o Extrator
  já roda no DS; escopar por wrapper evita fork de componente e não mexe nas telas existentes.
- **Descartada:** migrar o Q7 inteiro agora — outra feature, maior; tokens soltos por classe (`bg-[#1F3A2A]`) — viola o DS ("cores sempre via token").
- **Custo aceito:** dois temas no mesmo app (header/nav teal ao lado de conteúdo oak) até a migração.
- **Reversível:** sim (tirar o wrapper).
