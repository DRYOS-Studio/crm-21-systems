# Fase 1 — fool-gate (spec) — rodada 1

**Veredito: FAIL** (3 BLOCKER, 18 WARN). Artefato: `spec.md` r1 + `battery/battery-r1.out`.

## BLOCKERs e resolução

| # | Achado | Verificado pelo TLC | Resolução na spec r2 |
|---|---|---|---|
| B1 | A regex de saída herdada (`\bpar[ea]\b`, `n[aã]o (quero\|tenho interesse)`) casa "para" preposição e "não quero pagar caro" ⇒ optout permanente em conversa normal | **Execução**: `pediuParaSair("orçamento para amanhã")=true`, `("não quero pagar caro")=true`; `pediuHumano("queria falar com vocês sobre preço")=true` | AC-A4/A5 passam a ser definidos por corpus positivo + negativo (AC-A4n/A5n); M12/M13 (regex original ligada) morrem |
| B2 | No original a saída é checada ANTES da IA, com despedida fixa (`fluxo.js:150-155,303-310`); spec permitia override pós-IA, que perde o optout quando a Groq falha | leitura `fluxo.js:150-155` | AC-A5b: saída detectada ⇒ 0 chamadas à IA, optout mesmo com Groq fora; AC-A5c: ações do optout |
| B3 | Sem canonicalização de telefone CSV × JID; webhook compara dígitos crus por igualdade (`whatsapp-webhook/index.ts:24-28,207-212`) ⇒ B2/B10/B13/B14 cegos | leitura das linhas citadas | AC-C3 (chave canônica, incl. 9º dígito BR) + premissa a medir no Design |

## WARNs — decisão (1 linha cada)

- W1 incorporado: AC-A2n (convite legítimo passa, 1 chamada; mata M10) e AC-A2r (re-prompt leva a recusa; mata M9).
- W2 incorporado: AC-A3n (mata M11/M11b).
- W3 incorporado: janela = mensagens inbound desde a última outbound; AC-A4w (mata M13).
- W4 incorporado: AC-A1 cobre "n/a", "???", "NA" (M1b/M1c). "?" sozinho era mutação equivalente (tamanho < 2) — trocado por "???".
- W5 adiado para Design: orçamento de chamadas/tempo por turno × timeout da edge e dedupe de reenvio da Uazapi. Registrado como pergunta aberta Q2.
- W6 adiado para Design (depende de AC-A0); pergunta aberta Q3.
- W7 incorporado: IA falha 2× ⇒ escala, como o original (`fluxo.js:163-170`); AC-A14.
- W8 incorporado: AC-A18b (backfill das conversas existentes para `descobrir`).
- W9 incorporado: AC-A15 reescrito (premissa `excludeMessages: ["wasSentByApi"]`, `manage-instance/index.ts:273`, verificada; caso real = dono respondendo).
- W10 incorporado: AC-A5c cancela todos os follow-ups pendentes, inclusive manuais.
- W11 incorporado: AC-A19 (religar a IA zera `confirmacoes`).
- W12 incorporado: AC-B3 atômico por usuário.
- W13 incorporado: AC-B9 explicita +7 após o toque 2.
- W14 incorporado: AC-B18/B19/B20.
- W15 incorporado: AC-A16 com intervalo 2-4s.
- W16 incorporado: AC-U2 canonicaliza tópico no save.
- W17 incorporado: AC-D1 inclui `supabase/setup/cron.sql` e `types.ts`.
- W18 incorporado: D2 usa `trim()`.
