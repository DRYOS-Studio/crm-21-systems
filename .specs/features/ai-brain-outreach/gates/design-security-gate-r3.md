# Fase 2 — security-gate (design) — rodada 3

**Veredito: PASS** (0 BLOCKER, 9 WARN). Gate sem Bash (leitura).

WARNs (decisão em `design-consolidacao-r3.md`): W1 força real do `s` = a do token da instância (`status` sem auth devolve
`raw_response`, `manage-instance/index.ts:185-221`); W2 sem rotação do `s`; W3 `s` em logs de plataforma/Uazapi (query string);
W4 `webhook_secret_for` deve comparar com `whatsapp_instances.user_id`; W5 `outreach_reserve` sem checar dono da instância em SQL
+ `run-followups` sem filtro de tenant; W6 histórico do turno sem `.eq('user_id')`; W7 `save_openers` invoker exige DML do client ⇒
regra de "< 2 ativas" contornável; W8 RLS/revoke em tabelas `private`; W9 `run-followups` sem auth passa a gastar Groq (pré-existente).
