# Fase 2 — security-gate (design) — rodada 1

**Veredito: FAIL** (1 BLOCKER, 10 WARN). Gate sem Bash (leitura).

| # | Achado | Verificado pelo TLC |
|---|---|---|
| B1 | Webhook público sem prova de origem; o tenant é resolvido por nome/`owner` (telefone público). O design pendura efeitos permanentes (optout, despedida, cancelamento, prospect optout) e envio pelo número do cliente num POST forjável | leitura `config.toml:10-11`, `whatsapp-webhook/index.ts:108-192` (sem checagem de secret), `manage-instance/index.ts:257-273` (URL do webhook sem secret) |

WARNs W1–W10: grants/REVOKE por coluna; FK composta de tenant (`prospects.conversation_id`, `messages.conversation_id`);
`outreach_instance_id` sem checagem de tenant; secret guardado vazio ⇒ fail-close; `search_path=''`; filtro `user_id` explícito
nas RPCs outreach; invoker × definer dos triggers; `dry_run` sem auth; telefone em log; corpo cru do erro Groq em log.
Decisões: ver `design-FINAL` / seção de resolução após a consolidação.
