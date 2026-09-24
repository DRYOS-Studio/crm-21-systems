# Cérebro de IA + Motor de Prospecção Fria — Specification (r4 — aprovada pelo Rafael sem 4ª rodada de gate, 2026-09-23)

Fonte: plano `~/.claude/plans/fluffy-crunching-adleman.md` (revisado 2026-09-23).
Origem da lógica: `02.dryos_sdr_prospeccao/codigo/src/` (não é tocado).
Gates: `gates/specify-fool-gate-r1.md`, `-r2.md`, `-r3.md` (todos FAIL; BLOCKERs incorporados aqui).

## Problem Statement

A IA do Q7 responde com um `system_prompt` estático + últimas 20 mensagens
(`whatsapp-webhook/index.ts:338-353`), sem tools, sem estado de qualificação, sem
base de conhecimento e sem nenhuma guarda em código: se o modelo convida cedo,
ignora um "pare" ou promete "vou confirmar" pela terceira vez, nada impede. O
02.dryos já resolveu isso (gate NAVT, regex de saída/humano, tools) e tem um motor
de disparo frio com 7 proteções anti-bloqueio que o Q7 não tem.

## Goals

- [ ] Toda guarda que no original é "coluna e IF" (não instrução ao modelo) existe
      em código no Q7 e tem teste de execução que reprova a mutação nomeada.
- [ ] Clientes atuais (sem `business_context`) não percebem mudança nenhuma.
- [ ] Um cliente consegue importar prospects e ligar disparo frio sem risco de:
      tocar cliente atual, tocar quem pediu pra sair, passar do teto, disparar fora
      de hora ou em rajada.

## Out of Scope

- Trocar de provider de IA (fica Groq) ou de WhatsApp (fica Uazapi; sem YCloud/template Meta).
- Agrupar rajada de mensagens do lead (`fluxo.js:15`, `ESPERA_RAJADA_MS`) — Q7 segue respondendo mensagem a mensagem.
- Extrair `<AppNav>` compartilhado.
- Editar a persona-base (`CEREBRO`) pela UI — mudar comportamento continua sendo redeploy.
- Qualquer mudança no `02.dryos_sdr_prospeccao`.

## Decisões registradas

- **D1 (confirmado pelo Rafael, 2026-09-23):** conversa criada por mensagem do
  contato nasce em `ai_stage='descobrir'`. Conversa que **nós** iniciamos — disparo
  frio, Extrator ("Enviar para CRM") ou mensagem nossa (`fromMe`) — nasce em
  `'abordar'`. Default da coluna: `'abordar'`; o webhook grava `'descobrir'`
  explicitamente no inbound. (Leitura do TLC de "começa em novo prospect" para
  `fromMe` = `abordar`; reversível.)
- **D9 (Rafael, 2026-09-23):** leads vindos do Extrator **podem** ser prospectados.
  Regra de AC-B2: conversa existente **sem nenhuma mensagem** (caso do Extrator,
  `LeadCard.tsx:75-81` insere só a conversa) é reaproveitada — o prospect é ligado a
  ela, sem criar outra; conversa com qualquer mensagem é contato existente e é pulada.
- **D2:** o modo novo liga por usuário quando `business_context.trim()` é não-vazio; senão, modo legado.
- **D3:** a regex de saída/humano do original **não** é portada literalmente: ela
  gera falso positivo em PT-BR comum (verificado por execução, gate r1 B1). A
  regra é definida pelos corpora de AC-A4/A4n/A5/A5n; o original é a mutação M12/M13.
- **D4:** IA falha 2× num turno ⇒ escala (igual ao original, `fluxo.js:163-170`).
- **D5:** "janela do lead" = mensagens inbound **ainda não processadas** por um turno
  (marcador por mensagem, como `respondida = 0` do original, `02.dryos/codigo/src/db.js:114-117`,
  `fluxo.js:144`). Não é definida pela posição da última outbound — isso perde "pare"
  quando outro turno grava a outbound depois (gate r3 B1). É o único texto que passa
  pelas regras de saída/humano.
- **D6:** `optout=true` devolvido **só pelo modelo** (sem casar AC-A5) ⇒ escala
  (AC-A14), não optout permanente e sem despedida. Optout permanente só pela regra de
  código (AC-A5e).
- **D8 (pedido do Rafael, 2026-09-23):** o toque 1 do disparo frio **não vende**: é
  um cumprimento curto que espera resposta ("Oi {nome}, tudo bem?", "Olá {nome}, aqui
  é da {empresa}. Tudo bem?"), no máximo um gancho de curiosidade. Vem de **variações
  cadastradas pelo cliente** (sorteadas por envio; texto idêntico em massa é assinatura
  de spam), não da IA. Só depois da resposta o cérebro se apresenta e segue o fluxo.
  Toques 2/3 seguem gerados pela IA (`disparo.js:268-277`). Escolha template × IA é
  reversível; template foi escolhido por ser determinístico e testável.
- **D7:** a regra de saída é de **forma**, não de palavra: o termo de parada precisa
  ser a mensagem inteira ("pare", "stop") ou uma frase de pedido de parada explícita
  ("para de me mandar", "me tira da lista"). Palavra solta dentro de frase de
  negócio ("me tira uma dúvida", "caiu no spam") não conta. `battery/sonda-corpus.mjs`
  prova que existe regra satisfazendo A4/A4n/A5/A5n juntos.

## Perguntas abertas para o Design

- **Q1:** medir nos `conversations.contact_phone` reais a distribuição de formato
  (12 × 13 dígitos BR, sem DDI) antes de fixar a chave de AC-C3.
- **Q2:** orçamento de chamadas/tempo por turno (2 `pensar` × 4 rodadas × 2
  tentativas × failover de modelo, `get-ai-config.ts:210-228`) × timeout da edge;
  e dedupe de reenvio de webhook pela Uazapi.
- **Q3:** como detectar "modelo não suporta tools" se o failover em 400 troca de
  modelo em silêncio (`get-ai-config.ts:223`). Depende de AC-A0.

## Convenção dos critérios

Cada AC tem **Mutação** (a implementação errada que ele tem de reprovar) e **Prova**.
Status da bateria (`battery/run.sh`, saída em `battery/battery-r3.out`; anteriores `battery-r1.out`, `battery-r2.out`):

- `EXEC-MATA` — teste roda sobre o arquivo de produção `_shared/brain.ts` (Groq e
  Supabase stubados por loader, `battery/hooks.mjs`); baseline PASS e a mutação reprova.
- `EXEC-LACUNA` — o teste já roda e **reprova o rascunho atual**: o AC não está
  satisfeito pelo código existente.
- `EXEC-GUARDA` — passa hoje e mata a mutação "implementação errada plausível"
  (M12–M16); protege contra regressão quando a lacuna for fechada.
- `PENDENTE-EXEC` — o código não existe; mutação nomeada, prova só na Fase 4.

Bateria r4 (`battery-r4.out`): **21 mutações, 21 mortas, 0 sobreviventes**;
baseline reprova AC-A3o, AC-A4, AC-A5, AC-A5b, AC-A5e (lacunas do rascunho — ele
**não** cumpre D6 nem D7). Sonda de satisfazibilidade dos corpora: PASS.

---

## P1: Cérebro com guardas em código ⭐ MVP

**User Story**: Como dono de um negócio no Q7, quero que a IA qualifique o lead e
respeite regras duras (não convidar cedo, parar quando pedem, escalar quando
precisa) para não perder lead por comportamento de robô.

| AC | WHEN / THEN | Mutação que mata | Prova | Status |
|---|---|---|---|---|
| AC-A0 | WHEN a Groq recebe `tools` + `response_format: json_object` na mesma chamada, com uma rodada tool_call → resultado → resposta THEN SHALL devolver JSON com `mensagens` array | combinação rejeitada ou shape errado | curl real contra `llama-3.3-70b-versatile` e contra o default `auto`, saída capturada | **EXECUTADO 2026-09-24** (`battery/a0-groq.out`): combinação ⇒ 400; o Design não a usa (ADR-01); caminho só-tools devolve o JSON esperado |
| AC-A1 | WHEN um campo NAVT vem como "não informado", "n/a", "NA", "???" THEN SHALL contar como faltando; resposta real SHALL não contar | `M1` sem `NAO_RESPOSTA`; `M1b` sem `\?+`; `M1c` sem `n\/?a` | execução | EXEC-MATA |
| AC-A2 | WHEN o modelo devolve `etapa='convidar'` sem necessidade+autoridade+volume THEN SHALL re-promptar 1x e, se insistir, gravar `etapa='descobrir'` | `M2a` aceita `convidar`; `M2b` sem re-prompt | execução: etapa + nº de chamadas = 2 | EXEC-MATA |
| AC-A2r | WHEN há re-prompt THEN o system SHALL conter a recusa e os campos que faltam | `M9` re-prompt sem a recusa | execução | EXEC-MATA |
| AC-A2n | WHEN o modelo devolve `convidar` e a própria resposta preenche N/A/V THEN SHALL aceitar `convidar` com 1 chamada | `M10` `falta` calculado sem mesclar `qualificacao` (rebaixa todo convite) | execução | EXEC-MATA |
| AC-A3 | WHEN a resposta que vai sair contém "vou confirmar/ver/checar/verificar" e já havia 1 THEN SHALL escalar | `M3` limiar 3 | execução | EXEC-MATA |
| AC-A3o | WHEN "vou confirmar" aparece só numa bolha além da 2ª (cortada, AC-A10) THEN SHALL não contar | rascunho atual conta antes do corte (`brain.ts:309` × `:317`) | execução | **EXEC-LACUNA** |
| AC-A3n | WHEN há 1 anterior e a resposta não promete, ou 0 anterior e a resposta promete THEN SHALL não escalar e o contador SHALL ser 1 | `M11` conta sem promessa; `M11b` limiar 1 | execução | EXEC-MATA |
| AC-A4 | WHEN a janela do lead (D5) contém qualquer de: "quero falar com uma pessoa", "tem alguém aí de verdade?", "me passa pra um atendente", "isso é um robô?" THEN SHALL escalar, mesmo com o modelo devolvendo `escalar=false` | rascunho atual (regex não chamada) | execução, corpus | **EXEC-LACUNA** |
| AC-A4n | WHEN a janela contém "queria falar com vocês sobre preço", "me passa pra mim o valor", "posso falar com vocês amanhã?", "quero falar com vocês sobre o plano anual" THEN SHALL não escalar | `M16` regex original ligada na janela; `M13` idem no histórico | execução | EXEC-GUARDA |
| AC-A4w | WHEN o pedido de humano está só em mensagem anterior à última outbound THEN SHALL não escalar | `M13` regex sobre o histórico inteiro | execução | EXEC-GUARDA |
| AC-A5 | WHEN a janela contém qualquer de: "pare", "PARE!", "para de me mandar mensagem", "oi, não tenho interesse, obrigado", "por favor, pare de me mandar mensagem", "não quero mais receber", "não tenho interesse", "me tira da lista", "sai da lista", "quero descadastrar", "stop", "vou denunciar", "isso é spam", "não perturbe" THEN SHALL marcar optout | rascunho atual | execução, corpus | **EXEC-LACUNA** |
| AC-A5n | WHEN a janela contém "orçamento para amanhã", "não quero pagar caro", "para quando fica pronto?", "vou sair do escritório às 18h", "me tira uma dúvida", "vocês não me enviaram o orçamento", "o email caiu no spam", "tira meu nome da nota e coloca o da empresa", "pode parar o carro na frente?", "você perdeu meu tempo ontem mas tudo bem, vamos fechar", "o stop do carro quebrou, vocês consertam?", "não quero perder essa promoção" THEN SHALL não marcar optout | `M12` original no histórico; `M14` "edição mínima" (original − 3 padrões + frases do A5) na janela | execução | EXEC-GUARDA |
| AC-A5w | WHEN "não tenho interesse" está só antes da última outbound e a janela é "mudei de ideia, quanto custa?" THEN SHALL não marcar optout | `M15` edição mínima sobre o histórico inteiro | execução | EXEC-GUARDA |
| AC-A5b | WHEN a janela casa AC-A5 THEN SHALL decidir optout **sem chamar a IA** (0 chamadas), inclusive com a Groq fora | regra aplicada depois de `pensar()` (perde o optout quando a IA falha) | execução com Groq stub falhando | **EXEC-LACUNA** |
| AC-A5c | WHEN o optout é decidido THEN SHALL: enviar 1 despedida fixa (não gerada pelo modelo), gravar `optout`/`optout_motivo`, `ai_stage='descartar'`, `ai_enabled=false`, e cancelar **todos** os follow-ups pendentes da conversa, inclusive manuais | enviar a resposta de vendas; cancelar só `auto_inactivity` (`run-followups/index.ts:57`) | execução do handler | PENDENTE-EXEC |
| AC-A5e | WHEN o modelo devolve `optout=true` e a janela não casa AC-A5 THEN SHALL não marcar optout, não enviar despedida, e escalar (D6) | rascunho atual (`brain.ts:323` repassa o optout do modelo) | execução | **EXEC-LACUNA** |
| AC-A21 | WHEN o turno 1 está pensando, o lead manda "pare" (turno 2 insere a inbound) e o turno 1 grava sua outbound depois THEN o "pare" SHALL ainda ser processado pelo turno 2 (ou pelo próximo) e virar optout | janela = "inbound desde a última outbound" (D5 antiga) | execução concorrente com Groq stub com atraso, ordem forçada | PENDENTE-EXEC |
| AC-A5d | WHEN um follow-up (qualquer tipo) vai ser enviado e a conversa está com `optout=true` THEN SHALL cancelar sem enviar | checar optout só no momento do optout (follow-up agendado depois sai) | execução do `run-followups` | PENDENTE-EXEC |
| AC-A6 | WHEN são 23:00 em São Paulo (02:00 UTC do dia seguinte) THEN `consultar_calendario` SHALL devolver "hoje" = data de São Paulo | `M4` fuso 0 | execução com relógio fixo | EXEC-MATA |
| AC-A7 | WHEN o modelo pede um tópico que só existe em outro tenant THEN SHALL responder `encontrado:false` sem o conteúdo | `M5b` lista sem filtro `user_id` | execução com 2 tenants | EXEC-MATA |
| AC-A7b | WHEN dois tenants têm o mesmo tópico THEN SHALL devolver o conteúdo do tenant da conversa | `M5` busca de conteúdo sem filtro `user_id` | execução, tenant alheio primeiro | EXEC-MATA |
| AC-A8 | WHEN o tópico não existe THEN SHALL devolver `encontrado:false` + lista dos tópicos do tenant | `M5b` | execução | EXEC-MATA |
| AC-A9 | WHEN o modelo só pede tool THEN SHALL falhar após no máximo 4 rodadas × 2 tentativas por `pensar` | `M6` teto 40 | execução: chamadas lógicas ≤ 8 (failover HTTP: Q2) | EXEC-MATA |
| AC-A10 | WHEN o modelo devolve 3+ mensagens THEN SHALL enviar no máximo 2 | `M7` sem corte | execução | EXEC-MATA |
| AC-A11 | WHEN o modelo devolve JSON válido sem `mensagens` THEN SHALL tratar como falha | `M8` sem checagem de shape | execução | EXEC-MATA |
| AC-A12 | WHEN `business_context.trim()` é vazio THEN o payload enviado à Groq SHALL ser idêntico ao de hoje (system_prompt + 20 mensagens, sem `tools`, sem `response_format`) | legado passando `tools` ou `CEREBRO`; contexto só de espaços ligando o modo novo | execução: snapshot do payload antes × depois | PENDENTE-EXEC |
| AC-A13 | WHEN um turno do modo novo termina THEN `conversations` SHALL ter `ai_stage`, `qualification`, `ai_summary` do turno e `confirmacoes` incrementado — respeitando AC-A20 | não persistir um campo (ex.: `confirmacoes` ⇒ AC-A3 nunca dispara entre mensagens) | execução do handler: ler a linha após 2 turnos | PENDENTE-EXEC |
| AC-A20 | WHEN dois turnos da mesma conversa se sobrepõem (lead manda "oi" e, 2s depois, "pare") THEN: `optout=true`, `ai_enabled=false` e — quando vier de optout — `ai_stage='descartar'` SHALL ser monotônicos (nenhum turno os reverte; só ação humana); cada turno SHALL reler a conversa antes de **cada** bolha e não enviar se **outro** turno gravou `optout` ou `!ai_enabled` (o turno que decidiu o optout envia a despedida; o que decidiu escalar envia sua resposta); o incremento de `confirmacoes` SHALL ser atômico; o aviso ao dono SHALL sair no máximo 1× por escalada | persistir o estado lido no início do turno (sobrescreve o optout do turno concorrente); enviar sem reler; read-modify-write em `confirmacoes` | execução concorrente de 2 invocações do webhook contra Postgres real, Groq stub com atraso | PENDENTE-EXEC |
| AC-A14 | WHEN o turno resulta em escalar (modelo, `optout` só do modelo — D6, AC-A3, AC-A4 ou IA falhando 2× — D4) THEN SHALL setar `ai_enabled=false`, `human_takeover_at`, e SE `owner_notify_phone` existe, enviar 1 aviso ao dono com nome/telefone/motivo/últimas msgs | escalar sem desligar a IA; IA falhando ⇒ silêncio; avisar sem `owner_notify_phone` | execução: envios Uazapi + linha da conversa | PENDENTE-EXEC |
| AC-A15 | WHEN chega mensagem inbound cujo telefone = `owner_notify_phone` do tenant THEN o cérebro SHALL não responder nem qualificar. Premissa: envio por API não volta ao webhook (`excludeMessages: ["wasSentByApi"]`, `manage-instance/index.ts:273`) | dono respondendo ao aviso vira lead | execução do webhook | PENDENTE-EXEC |
| AC-A16 | WHEN há 2 mensagens a enviar THEN SHALL enviar na ordem, com 2-4s entre elas, e gravar cada uma em `messages` | gravar só a primeira; sem intervalo | execução com relógio/timer observado | PENDENTE-EXEC |
| AC-A17 | WHEN `run-followups` gera reengajamento no modo novo THEN SHALL usar `runBrainTurn`, e se a IA falhar SHALL manter o texto fallback (`run-followups/index.ts:115-118`) | perder o fallback | execução com Groq stub falhando | PENDENTE-EXEC |
| AC-A18 | WHEN uma conversa nasce de mensagem do contato THEN `ai_stage` SHALL ser `'descobrir'` (D1) | default `'abordar'` aplicado a inbound | execução do webhook | PENDENTE-EXEC |
| AC-A18b | WHEN a migration roda THEN conversas existentes cuja primeira mensagem é inbound SHALL ficar com `ai_stage='descobrir'`; as demais (sem mensagem, ou iniciadas por nós) SHALL ficar `'abordar'` (D1) | `add column ... default 'abordar'` preenchendo tudo (rascunho `20260924020000_ai_brain.sql:14`); backfill `descobrir` em tudo (quebra os leads do Extrator) | execução da migration + select | PENDENTE-EXEC |
| AC-A18c | WHEN o Extrator insere uma conversa, ou nasce uma conversa por `fromMe` THEN `ai_stage` SHALL ser `'abordar'` | webhook gravando `descobrir` em toda conversa nova | execução do webhook (`fromMe`) + insert do Extrator | PENDENTE-EXEC |
| AC-A19 | WHEN o humano religa a IA numa conversa (`ai_enabled` false→true) THEN `confirmacoes` SHALL voltar a 0, `ai_stage` SHALL sair de `descartar` para `descobrir`, e `optout` SHALL continuar como estava (só limpa por ação humana explícita) | contador persistido ⇒ escala de novo no 1º turno; turno seguinte gravando `optout=false` | execução | PENDENTE-EXEC |

**Independent Test**: usuário com `business_context` + 1 tópico; mensagens de
teste forçam cada tool, o convite prematuro, "pare" e "quero falar com uma pessoa";
usuário sem `business_context` com payload idêntico (AC-A12).

---

## P2: Configuração do cérebro na UI

| AC | WHEN / THEN | Mutação que mata | Prova | Status |
|---|---|---|---|---|
| AC-U1 | WHEN o usuário salva "Sobre o seu negócio" THEN `agent_configs.business_context` SHALL refletir e o próximo turno SHALL usar o modo novo | salvar em `system_prompt` | execução (playwright) + banco | PENDENTE-EXEC |
| AC-U2 | WHEN o usuário cria/edita/remove um tópico THEN `knowledge_base` SHALL refletir, com `topic` salvo em minúsculas e sem espaços nas pontas; tópico duplicado SHALL mostrar erro | salvar "Preços" cru (nunca achado: `brain.ts:84,90` compara em minúsculas); upsert silencioso | execução | PENDENTE-EXEC |
| AC-U3 | WHEN o usuário A tenta ler/escrever tópico do B pelo client THEN RLS SHALL negar | policy ausente ou `using(true)` | execução com 2 sessões `authenticated` | PENDENTE-EXEC |

---

## P3: Disparo frio com as 7 proteções

**Why P3**: maior risco (Baileys não-oficial ⇒ bloqueio de número real); só entra
depois do P1 estável, e nasce desligado.

| AC | WHEN / THEN | Mutação que mata | Prova | Status |
|---|---|---|---|---|
| AC-B1 | WHEN `outreach_enabled=false` (default) THEN SHALL enviar 0 | default `true` / ignorar a flag | execução do tick | PENDENTE-EXEC |
| AC-B2 | WHEN a chave canônica (AC-C3) do prospect bate com a de uma `conversations` do tenant e o prospect não tem `conversation_id` THEN: se a conversa tem ≥ 1 mensagem SHALL não enviar e marcar `descartado`; se tem 0 mensagens (D9) SHALL ligar o prospect a ela e seguir o toque sem criar conversa nova | comparar telefone cru; pular também a conversa vazia do Extrator; criar conversa duplicada | execução com formatos diferentes, conversa vazia × com mensagem | PENDENTE-EXEC |
| AC-B3 | WHEN dois ticks rodam ao mesmo tempo THEN SHALL sair no máximo 1 envio **por usuário** por tick, e a checagem de teto+espaçamento SHALL ser atômica com o envio | reserva só por prospect (2 prospects do mesmo usuário furam 60s/teto) | execução concorrente contra Postgres real | PENDENTE-EXEC |
| AC-B4 | WHEN o último envio do usuário foi há < 60s THEN SHALL não enviar, mesmo com invocação manual | espaçamento confiado ao cron | execução: 2 invocações seguidas | PENDENTE-EXEC |
| AC-B5 | WHEN é domingo; ou sábado sem flag ou fora de 9-13h; ou dia útil fora de 9-18h — **horário de São Paulo** — THEN SHALL enviar 0 | hora UTC; sábado sem checar flag | execução nas fronteiras (8:59/9:00/17:59/18:00; sáb 12:59/13:00) | PENDENTE-EXEC |
| AC-B6 | WHEN o teto do dia é calculado THEN SHALL ser `min(10 + 5·semanas_desde_primeiro_envio, outreach_daily_cap)`, e `min(10, cap)` antes do primeiro envio; `outreach_daily_cap >= 1` imposto no banco (check) | teto = cap fixo; rampa sem teto; cap 0 aceito (`max(1,…)` do original, `disparo.js:34`, dispararia 1/dia) | execução nas semanas 0/1/6 | PENDENTE-EXEC |
| AC-B7 | WHEN enviados do dia (dia de São Paulo) ≥ teto THEN SHALL enviar 0 | contar dia UTC | execução às 22:00 SP | PENDENTE-EXEC |
| AC-B8 | WHEN o prospect tem `optout` (lido no momento do envio) THEN SHALL nunca enviar | ler optout só na seleção | execução: optout entre seleção e envio | PENDENTE-EXEC |
| AC-B9 | WHEN o toque 1 sai THEN o toque 2 SHALL ser em +3 dias; o toque 3 em +7 dias **após o toque 2**; após o 3º SHALL virar `descartado`; nunca existe 4º | cadência contada do toque 1; `tentativas>=3` não tratado | execução de 4 ticks com relógio avançado | PENDENTE-EXEC |
| AC-B10 | WHEN ≥30 enviados no dia e taxa de resposta < 5% THEN SHALL desligar `outreach_enabled`, gravar `outreach_paused_reason`. Resposta = ≥1 `messages` inbound na conversa ligada ao prospect depois do envio | contar resposta de qualquer conversa do tenant | execução 30 envios × 1 vs 2 respostas | PENDENTE-EXEC |
| AC-B11 | WHEN `run-outreach` é chamada sem o secret correto THEN SHALL responder 401 e enviar 0 | função aberta como `run-followups` | execução HTTP | PENDENTE-EXEC |
| AC-B12 | WHEN `outreach_instance_id` é nulo ou a instância não está `connected` THEN SHALL enviar 0 | usar qualquer instância | execução | PENDENTE-EXEC |
| AC-B13 | WHEN a conversa de um prospect vira optout (AC-A5c) THEN o prospect SHALL virar `optout` e nenhum toque restante SHALL sair | optout só na conversa | execução: optout após toque 1, +3 dias | PENDENTE-EXEC |
| AC-B14 | WHEN o prospect responde THEN SHALL parar a cadência e a conversa SHALL seguir pelo cérebro | cadência ignora resposta | execução | PENDENTE-EXEC |
| AC-B15 | WHEN o envio Uazapi falha THEN SHALL gravar `ultima_falha_*`, sem `outreach_sends`, sem incrementar `tentativas` | contar falha como envio | execução com Uazapi stub 500 | PENDENTE-EXEC |
| AC-B16 | WHEN o toque 1 sai THEN SHALL existir `conversations` com `ai_stage='abordar'`, chave canônica, ligada em `prospects.conversation_id`, e a mensagem em `messages` | conversa não ligada ⇒ B10/B13/B14 cegos | execução | PENDENTE-EXEC |
| AC-B17 | WHEN o sorteio do tick diz "pular" THEN SHALL não enviar naquele tick | intervalo fixo de 60s | execução com RNG injetado | PENDENTE-EXEC |
| AC-B18 | WHEN a conversa do prospect está com `ai_enabled=false` (takeover humano) no momento do toque THEN SHALL não enviar e parar a cadência | checar só o estado do prospect (original relê, `disparo.js:180`) | execução | PENDENTE-EXEC |
| AC-B21 | WHEN o toque 1 é montado THEN SHALL sair de uma das variações cadastradas pelo cliente, com `{nome}`/`{empresa}` preenchidos (placeholder sem valor some junto com a vírgula/espaço vizinho, sem sobrar "{nome}"), em 1 bolha, sem chamar a IA | gerar pela IA; placeholder literal no texto enviado | execução com prospect sem nome | PENDENTE-EXEC |
| AC-B22 | WHEN o cliente salva uma variação de toque 1 com mais de 120 caracteres, link, ou menos de 2 variações ativas THEN SHALL recusar o save (e `run-outreach` SHALL não disparar toque 1 sem ≥ 2 variações válidas) | aceitar texto longo/com link; disparar sempre a mesma frase | execução | PENDENTE-EXEC |
| AC-B23 | WHEN 10 toques 1 saem num dia THEN SHALL usar mais de uma variação (sorteio) | variação fixa | execução com RNG injetado | PENDENTE-EXEC |
| AC-B24 | WHEN o lead responde ao toque 1 THEN a resposta da IA SHALL se apresentar (empresa + motivo) em até 2 bolhas e fazer 1 pergunta de descoberta, sem propor reunião | persona sem instrução pro pós-cumprimento (prompt atual do `abordar` supõe abordagem já feita) | **não automatizável**: revisão humana de ≥ 10 conversas de teste, transcritas no relatório da Fase 4 | PENDENTE-EXEC (manual) |
| AC-B19 | WHEN a IA falha ao gerar o texto do toque THEN SHALL gravar `ultima_falha_*` sem consumir teto nem toque | tratar como enviado | execução com Groq stub falhando | PENDENTE-EXEC |
| AC-B20 | WHEN o freio (AC-B10) desliga o disparo THEN SHALL avisar `owner_notify_phone` se configurado | desligar em silêncio | execução | PENDENTE-EXEC |

---

## P4: Página Prospecção

| AC | WHEN / THEN | Mutação que mata | Prova | Status |
|---|---|---|---|---|
| AC-P1 | WHEN um CSV com cabeçalho telefone/nome/empresa/cidade + extras é importado THEN SHALL criar prospects com chave canônica (AC-C3), extras em `extra`, sem duplicar telefone; linha com telefone inválido SHALL ser rejeitada e contada | extras descartados; "11 99999-9999" e "5511999999999" viram 2 prospects | execução (playwright) + banco | PENDENTE-EXEC |
| AC-P2 | WHEN o disparo está pausado pelo freio THEN a página SHALL mostrar o motivo e o toggle desligado | toggle lê só `outreach_enabled` | execução | PENDENTE-EXEC |

---

## Restrições transversais

| AC | WHEN / THEN | Mutação que mata | Prova | Status |
|---|---|---|---|---|
| AC-C1 | WHEN cada migration nova é aplicada 2× seguidas THEN SHALL não dar erro (regra 6 do `CLAUDE.md`) | `create table`/`policy`/`trigger` sem guarda (o rascunho `20260924020000_ai_brain.sql` falha a 2ª aplicação) | execução contra Postgres (branch Supabase ou local) | PENDENTE-EXEC |
| AC-C2 | WHEN a edge function (service role) lê `knowledge_base`/`prospects`/`conversations` THEN toda query SHALL filtrar pelo `user_id` do tenant | RLS não protege service role | AC-A7/A7b (EXEC-MATA) + equivalente em `run-outreach` | parcial |
| AC-C3 | WHEN telefones são comparados entre CSV, prospects, conversas e `owner_notify_phone` (inclusive as do Extrator, cujo `toCrmPhone` só prefixa 55, `LeadCard.tsx:35-39`) THEN SHALL usar uma chave canônica. Casos e chave esperada: "11 99999-9999" → `5511999999999`; "+55 (11) 99999-9999" → `5511999999999`; "5511999999999" → `5511999999999`; "551199999999" (celular sem o 9º) → `5511999999999`; fixo "551133334444" → `551133334444` (sem 9 inserido: 1º dígito do número local 2-5); "+1 415 555 0100" (com DDI) → `14155550100` (não recebe 55); `contact_phone` nulo → sem chave, nunca casa | igualdade de dígitos crus (hoje, `whatsapp-webhook/index.ts:207-212`); normalizar só no CSV; inserir 9 em todo número de 12 dígitos (quebra o fixo); prefixar 55 em número que veio com "+" | execução da tabela | PENDENTE-EXEC (Q1 antes do Design) |
| AC-C3b | WHEN uma conversa é criada (webhook, disparo, Extrator) THEN `contact_phone` SHALL ser gravado já na chave canônica e a unicidade `(user_id, contact_phone)` SHALL valer sobre ela | gravar cru ⇒ a proteção de corrida do webhook (`whatsapp-webhook/index.ts:267-281`, índice único) não deduplica 12 × 13 dígitos | execução: 2 inbound quase simultâneas, uma de cada formato ⇒ 1 conversa. Migração das linhas existentes: Design (Q1) | PENDENTE-EXEC |
| AC-D1 | WHEN a feature fecha THEN SHALL estar atualizado tudo que afirma o que ela invalida: `README.md:44` e `CLAUDE.md:63` ("5 Edge Functions"), `INSTALL.md:287`, `TESTING.md:15`, `supabase/config.toml:6` ("Estas duas funções"), `scripts/check-setup.mjs:57-58` (lista de funções) e `:134` (só o init), `CLAUDE.md:44` e `:387` ("só existe um arquivo de schema" — já falso hoje), `CLAUDE.md:162-173` (instalação aplica só o init; "9 tabelas"), `:179` ("São 5"), `:229` e `:358` ("9 tabelas e 5 functions"), e toda instrução de colar a URL do webhook sem o secret ou de ler 401 só como deploy sem `--no-verify-jwt` (`INSTALL.md:120-122`, `:242-246`, `:271`, `README.md:50`, `CLAUDE.md:68`, `:199-201`, `:304`, `:341`, `TESTING.md:21`, `:47`; prova: `grep 'functions/v1/whatsapp-webhook'` fora do helper = só com `s` ou instrução de copiar pelo app), `supabase/setup/cron.sql` (job + secret de `run-outreach`), e `src/integrations/supabase/types.ts` regenerado | atualizar só o código | `grep` das afirmações antigas no diff final = 0; `tsc` limpo | PENDENTE-EXEC |

## Edge Cases

- WHEN a Groq falha nas 2 tentativas THEN a mensagem do lead SHALL ficar salva e o turno SHALL escalar (D4, AC-A14).
- WHEN o modelo configurado não suporta tools THEN SHALL cair no modo legado para aquele turno e registrar em log (mecanismo: Q3).
- WHEN `knowledge_base` está vazia THEN `consultar_conhecimento` SHALL devolver `encontrado:false` com lista vazia.

## Success Criteria

- [ ] Bateria: todo AC `EXEC-*` com baseline PASS e toda mutação morta; nenhum `EXEC-LACUNA` restante.
- [ ] Todo `PENDENTE-EXEC` vira teste de execução com mutação morta até a Fase 4.
- [ ] Payload legado idêntico (AC-A12) para 100% dos usuários sem `business_context`.
