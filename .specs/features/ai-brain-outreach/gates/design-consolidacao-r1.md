# Fase 2 — consolidação da rodada 1 → design r2

## BLOCKERs (7) → resolução
| Gate | # | Resolução (design r2) |
|---|---|---|
| security | B1 webhook sem prova de origem | ADR-11; design §4.1 passo 1 |
| design | B1 Extrator × canonicalização | design §3.2 "Dependência de deploy cross-repo", §9 passo 1, AC-C3b forma E no Extrator |
| fool | B1 optout + IA religada muda | ADR-04; `ai_stage` `case` explícito §3.1; parada vs estado do início §4.2 |
| fool | B2 2 despedidas | despedida gated por `flipped_off` §4.2 |
| fool | B3 espaçamento na reserva | ADR-08; `outreach_reserve` passos 2-5 §3.3 |
| fool | B4 `{empresa}` | ADR-13; `company_name` §3.1/§6; `save_openers` §3.3 |
| fool | B5 rollout | ADR-12; `processed_at default now()` §3.1; §9 |

## WARNs — decisão
- sec W1 incorporado: revoke antes de grant; insert/update por coluna em `prospects`; `outreach_sends` só select (§3.0/§3.3).
- sec W2 incorporado: triggers/RPCs filtram `user_id` da conversa ligada (§3.3). FK composta não — checagem nas RPCs basta e não mexe em `messages`.
- sec W3 incorporado: `run-outreach` confere `whatsapp_instances.user_id` (§4.4). `run-followups:66-70` (pré-existente) não tocado.
- sec W4 incorporado: secret guardado vazio ⇒ 500 (ADR-09, §4.4).
- sec W5 incorporado: `search_path = ''` (§3.0).
- sec W6 incorporado: `p_user` em toda RPC outreach (§3.3).
- sec W7 incorporado: triggers `security definer` (ADR-07, §3.0).
- sec W8 aceito: `dry_run` sem auth é pré-existente, fora de escopo; registrado §4.1.
- sec W9 incorporado parcial: caminho novo não loga o número do dono; logs existentes (`index.ts:122-132`) não tocados.
- sec W10 incorporado: corpo cru só da resposta, truncado (§7).
- design W1 aceito como dívida: Extrator sem contrato com o Q7 (§3.2).
- design W2-W4 incorporados: estados de loading/vazio/responsivo/tema (§6).
- design W5 → Rafael: sign-off da migração de chave antes de prod (§9 passo 2).
- design W6 incorporado: redação de `deveEscalarPorConfirmacoes` (§4.2).
- fool W1 aceito: claim durante takeover — humano no controle viu a mensagem.
- fool W2 incorporado: `qualificacaoDoTurno` como delta (§3.1, §7).
- fool W3 incorporado: try/catch ⇒ escala; timeouts em todo fetch externo (§4.2).
- fool W4 incorporado: orçamento do tick + `incerto` (§5, §3.3).
- fool W5 → Rafael: cota Groq esgotada escala tudo (D4 como está) (§5).
- fool W6 incorporado: disparo exige `modoCerebro` (§4.4).
- fool W7 incorporado: todo envio usa `coalesce(wa_phone, contact_phone)`, inclusive `Conversas.tsx:408` (§3.2).
- fool W8 incorporado: chave nula excluída; nula sem email aborta; preflight é estimativa; redação dos 12 dígitos (§3.2).
- fool W9 incorporado: timestamps novos + backfill por marcador (§3.0, ADR-10).
- fool W10 incorporado: conversa criada/ligada pelo disparo ganha `instance_id`/`stage_id` (§3.3 passo 6).
- fool W11 incorporado: trigger de inbound não sobrescreve `optout`/`descartado` (§3.3).
- fool W12 incorporado: formas de prova de AC-C3b, AC-B6, AC-B9 corrigidas (§8).
- fool W13 incorporado parcial: regex de link ampliada; uniformidade com 2 variações aceita (mínimo da D8) (§10).
- fool W14 incorporado: `pediuHumano` avaliado antes do fallback legado (§4.2).
- fool W15 → Rafael: texto de AC-A4w ainda fala de "última outbound" (D5 antiga); a prova U usa janela explícita. Não editei o AC.
- fool W16 incorporado na spec: AC-D1 ganhou `CLAUDE.md:162-173`, `:179`, `:229`, `:358` (mudança aditiva na lista).
- fool W17 incorporado: triggers `security definer` (§3.0).
