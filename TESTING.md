# TESTING.md — Roteiro E2E pós-deploy (Q7 Pipeline)

Guia completo para validar a aplicação **depois** do deploy no Vercel (frontend) + Supabase próprio (backend, edge functions, cron). Cobre infraestrutura, setup inicial, as 13 Waves funcionais e limpeza pós-teste.

> Substitua `<REF>` pelo ref do seu projeto Supabase (ex.: `abcd1234`).
> Substitua `<VERCEL_URL>` pela URL pública do Vercel (ex.: `q7pipe.vercel.app`).

---

## 1. Pré-requisitos

- [ ] Frontend publicado no Vercel — `https://<VERCEL_URL>` responde 200.
- [ ] Projeto Supabase próprio criado, com **todas** as migrations em `supabase/migrations/` aplicadas.
- [ ] Edge Functions deployadas: `whatsapp-webhook`, `run-followups`, `run-outreach`, `manage-instance`, `test-ai-connection`, `test-uazapi`.
- [ ] `verify_jwt = false` para `whatsapp-webhook`, `run-followups` e `run-outreach` (em `supabase/config.toml`).
- [ ] Cron configurado via `supabase/setup/cron.sql` (follow-ups e disparo a cada minuto).
- [ ] `npm run check` passando sem erros.
- [ ] Conta na **Uazapi** com: Server URL, Admin Token, Instância criada, Instance Token e webhook
      **copiado pelo app** (a URL já inclui `?s=`).
- [ ] Chave da **Groq** válida (`gsk_...`).
- [ ] Dois números de WhatsApp: um **Cliente** (envia mensagens de teste) e um **Atendente** (número conectado à Uazapi).

---

## 2. Checklist de infraestrutura

### 2.1 Frontend
```bash
curl -I https://<VERCEL_URL>
# esperado: HTTP/2 200
```
- [ ] Rota `/` carrega o login sem erros no console.
- [ ] Toggle dark/light funciona no login.
- [ ] Refresh em rota interna (ex.: `/kanban`) NÃO retorna 404 (SPA fallback OK via `vercel.json`).

### 2.2 Variáveis de ambiente do build
No Vercel → Settings → Environment Variables, confirmar:
- [ ] `VITE_SUPABASE_URL` = `https://<REF>.supabase.co`
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` = anon key do projeto Supabase
- [ ] `VITE_SUPABASE_PROJECT_ID` = `<REF>`

### 2.3 Edge Function pública (webhook)
Copie a URL pelo app (já vem com `?s=`) e faça POST com `{"event":"ping"}`.
Esperado: HTTP 200. 401 = JWT ligado **ou** `s` ausente/errado.

### 2.4 Cron ativo
No SQL Editor do Supabase:
```sql
select jobid, jobname, schedule, command, active from cron.job;
-- esperado: 2 linhas '* * * * *' (run-followups-every-minute e run-outreach-every-minute)
```

### 2.5 Proteção HIBP
- [ ] Tentar criar conta com senha `password123` → deve ser bloqueada.

---

## 3. Setup inicial

### 3.1 Criar usuário admin
1. Acesse `https://<VERCEL_URL>`.
2. Cadastre-se com o e-mail do administrador (primeiro usuário do sistema).
3. Valide no SQL Editor:
```sql
select p.email, ur.role,
  (select count(*) from pipeline_stages where user_id = p.user_id) as stages
from profiles p
join user_roles ur on ur.user_id = p.user_id
order by p.created_at desc limit 1;
-- esperado: role = 'admin', stages = 3
```

### 3.2 Configurar integrações (ConfigDrawer)
1. Abrir o app logado → botão de configurações (engrenagem).
2. **Uazapi**: preencher Server URL, Admin Token, Instance Name, Instance Token.
3. **Groq**: colar API key e prompt do agente.
4. **Ativar agente** (toggle ON).
5. Clicar **Testar webhook** → deve retornar sucesso (dry_run).

---

## 4. As 13 Waves E2E

> Formato de cada wave: **Objetivo / Passos / Esperado / Verificação SQL**.
> Marque `[x]` quando passar.

### Wave 1 — Primeira mensagem do cliente
- **Objetivo**: IA responde automaticamente via Groq e conversa entra em "Novo Lead".
- **Passos**: Do número Cliente, enviar `oi` para o número Atendente.
- **Esperado**: em até 10s o Cliente recebe resposta gerada pela IA.
- **SQL**:
```sql
select c.contact_phone, c.stage_id, s.name as stage, count(m.*) as msgs
from conversations c
left join pipeline_stages s on s.id = c.stage_id
left join messages m on m.conversation_id = c.id
group by c.id, s.name;
-- esperado: stage = 'Novo Lead', msgs >= 2 (in + out)
```
- [ ] PASS

### Wave 2 — Human takeover
- **Objetivo**: quando o Atendente responde manualmente pelo WhatsApp, a IA para.
- **Passos**: pelo WhatsApp do Atendente, responder manualmente à mesma conversa.
- **Esperado**: mensagem aparece no painel; `human_takeover_at` preenchido; IA não responde nas próximas mensagens do Cliente.
- **SQL**:
```sql
select contact_phone, human_takeover_at from conversations
where human_takeover_at is not null order by human_takeover_at desc;
```
- [ ] PASS

### Wave 3 — IA não retoma automaticamente
- **Objetivo**: confirmar comportamento atual (sem retomada automática).
- **Passos**: aguardar 30+ minutos após Wave 2 e enviar nova mensagem do Cliente.
- **Esperado**: IA permanece em silêncio. UI mostra "Humano assumiu — reative a IA manualmente". Ao clicar em **Reativar IA**, a IA volta a responder.
- **SQL**: após reativação, `human_takeover_at IS NULL` para a conversa.
- [ ] PASS

### Wave 4 — Follow-up manual
- **Objetivo**: agendar follow-up manual e receber no horário.
- **Passos**: na conversa, agendar follow-up em 1 minuto com mensagem "teste follow-up".
- **Esperado**: após ~1 min, Cliente recebe a mensagem; card aparece no painel de pendentes com countdown até disparar.
- **SQL**:
```sql
select send_at, status, kind, text_override from followups order by send_at desc limit 5;
-- esperado: status transita de 'pending' -> 'sent'
```
- [ ] PASS

### Wave 5 — Follow-up automático encadeado
- **Objetivo**: após cada follow-up enviado, o próximo é agendado automaticamente até o limite configurado.
- **Passos**: deixar o agente ativo com auto-follow-up habilitado; aguardar N ciclos.
- **Esperado**: N follow-ups em `status='sent'`, o (N+1)º NÃO é criado.
- **SQL**:
```sql
select conversation_id, count(*) filter (where status='sent') as sent,
  count(*) filter (where status='pending') as pending
from followups group by conversation_id;
```
- [ ] PASS

### Wave 6 — Kanban
- **Objetivo**: gerenciar pipeline visualmente.
- **Passos**: em `/kanban`, arrastar card entre colunas; criar novo estágio; renomear; excluir.
- **Esperado**: mudanças persistem após refresh; Dialogs (não `prompt` do browser) aparecem para criar/editar/excluir.
- **SQL**:
```sql
select name, position, color from pipeline_stages order by position;
```
- [ ] PASS

### Wave 7 — Dois clientes simultâneos
- **Objetivo**: conversas isoladas, sem cruzamento de contexto.
- **Passos**: dois números diferentes enviam mensagens ao mesmo Atendente ao mesmo tempo.
- **Esperado**: duas conversas distintas; respostas da IA usam apenas o histórico da respectiva conversa.
- **SQL**:
```sql
select c.contact_phone, count(m.*) from messages m
join conversations c on c.id = m.conversation_id
group by c.contact_phone order by count desc;
```
- [ ] PASS

### Wave 8 — Mensagens especiais
- **Objetivo**: tratamento correto de mídia, áudio, grupo e mensagens apagadas.
- **Passos**: enviar cada tipo do Cliente.
- **Esperado**:
  - Imagem/áudio: registrada com tipo correspondente, IA responde texto padrão ou ignora conforme prompt.
  - Grupo: mensagens de grupo ignoradas (não criam conversa).
  - Deletadas: não quebram o webhook (sempre 200).
- **Verificação**: logs da função `whatsapp-webhook` sem 5xx.
- [ ] PASS

### Wave 9 — Painel de follow-ups pendentes (Realtime)
- **Objetivo**: contagem regressiva e cancelamento em tempo real.
- **Passos**: agendar follow-up de 5 min; abrir a mesma tela em duas abas; cancelar em uma.
- **Esperado**: countdown atualiza em ambas; ao cancelar, some das duas abas instantaneamente (Realtime).
- **SQL**: `status='cancelled'` na linha correspondente.
- [ ] PASS

### Wave 10 — Reset manual do takeover
- **Objetivo**: botão "Reativar IA" limpa `human_takeover_at`.
- **Passos**: em conversa com takeover ativo, clicar "Reativar IA" e enviar nova mensagem do Cliente.
- **Esperado**: IA responde novamente.
- [ ] PASS

### Wave 11 — Tema dark/light persistente
- **Passos**: alternar tema no login e no dashboard; refresh; logout/login.
- **Esperado**: preferência salva (localStorage) e aplicada em ambos os contextos.
- [ ] PASS

### Wave 12 — Segurança / RLS
- **Objetivo**: usuário B não vê dados de A.
- **Passos**: criar 2º usuário (não-admin); logar; abrir Conversas/Kanban.
- **Esperado**: nenhuma conversa/estágio do admin aparece; `app_settings` inacessível para não-admin.
- **SQL** (com JWT do usuário B via API):
```bash
curl https://<REF>.supabase.co/rest/v1/conversations \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <JWT_USUARIO_B>"
# esperado: [] (nenhuma conversa do admin)
```
- [ ] PASS

### Wave 13 — Resiliência
- **Objetivo**: falhas externas não derrubam o sistema.
- **Passos**:
  1. Trocar chave Groq por valor inválido.
  2. Enviar mensagem do Cliente.
  3. Deixar um follow-up disparar.
- **Esperado**:
  - Webhook responde 200 mesmo com Groq falhando.
  - Follow-up envia mensagem de fallback (não trava o cron).
  - Logs mostram erro, mas sem 5xx.
- **Verificação**: `supabase functions logs whatsapp-webhook` e `run-followups`.
- [ ] PASS

---

## 5. Observabilidade

### 5.1 Logs das edge functions
No dashboard Supabase → Edge Functions → selecionar função → aba **Logs**.

CLI:
```bash
supabase functions logs whatsapp-webhook --project-ref <REF>
supabase functions logs run-followups   --project-ref <REF>
```

### 5.2 Queries úteis
```sql
-- Últimas 20 mensagens
select m.created_at, m.direction, c.contact_phone, left(m.content, 80) as preview
from messages m
join conversations c on c.id = m.conversation_id
order by m.created_at desc limit 20;

-- Follow-ups pendentes
select id, send_at, status, conversation_id
from followups where status = 'pending' order by send_at;

-- Conversas por estágio
select s.name, count(c.*) as total
from pipeline_stages s
left join conversations c on c.stage_id = s.id
group by s.name order by s.position;

-- Erros recentes (se logar em tabela app_logs)
select * from cron.job_run_details order by start_time desc limit 20;
```

---

## 6. Limpeza pós-teste

Executar no SQL Editor (**mantém** admin, roles e stages padrão):

```sql
delete from messages;
delete from followups;
delete from conversations;
-- Se quiser zerar instâncias/config e reconfigurar do zero:
-- delete from whatsapp_instances;
-- delete from agent_configs;
```

Confirmação:
```sql
select
  (select count(*) from conversations) as conversations,
  (select count(*) from messages) as messages,
  (select count(*) from followups) as followups;
-- esperado: 0, 0, 0
```

---

## 7. Critérios de aceite final

- [ ] Waves 1–13 marcadas como PASS.
- [ ] Zero respostas 5xx nos logs de `whatsapp-webhook` e `run-followups` durante os testes.
- [ ] Build do Vercel sem erros; console do navegador sem erros vermelhos.
- [ ] RLS validada (Wave 12).
- [ ] Cron ativo e disparando a cada minuto.

Se todos os itens acima estiverem OK, o deploy está pronto para produção.