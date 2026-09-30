# Inventário de autorização — usuários e permissões

**Escopo:** autorização atual relevante para Dashboard, Conversas, CRM, Agenda,
Prospecção, Configurações e instâncias WhatsApp.
**Fonte:** migrations locais, `src` e handlers em `supabase/functions`.
**Verificação local:** banco `supabase_db_q7-pipeline`, catálogo consultado em
2026-09-30. Isto não prova que o Supabase remoto tenha o mesmo estado.

## Modelo atual

- `organization_members` vincula cada usuário a uma organização; há índice
  único global em `user_id`, portanto o modelo atual permite uma organização por
  usuário.
- `public.same_org(user_id)` é usado pelas policies para compartilhar registros
  entre membros da organização. Não considera status ativo nem permissão de
  módulo/dispositivo.
- `public.user_roles` guarda papel global `admin | moderator | user`. O primeiro
  usuário sem admin é promovido a admin pelo trigger `handle_new_user`; os demais
  recebem `user`. O check de admin também é global.
- RLS impede acesso anônimo em várias tabelas, mas as policies organizacionais
  concedem CRUD coletivo. O catálogo local confirmou policies antigas ainda
  ativas em `conversations`, `messages`, `followups`, `knowledge_base`,
  `pipeline_stages`, `prospects` e `outreach_sends`; policies permissivas se
  combinam por `OR`.

## Tabelas e armazenamento

| Tabela/objeto | Uso no produto | Autorização atual | Escopo necessário |
|---|---|---|---|
| `conversations` | Conversas, Inbox, CRM, Agenda e Dashboard | `org_conversations` e `own_conversations` estavam simultaneamente ativas no catálogo local. | CRM + Conversas é concessão conjunta; Agenda e Dashboard dependem dela. Aplicar instância a linhas com `instance_id` e impedir que membro desassocie a conversa. |
| `messages` | Mensagens e anexos de conversas | `org_messages`: CRUD por organização. | Conversas + instância da conversa; mídia deve seguir a mesma verificação. |
| `pipeline_stages` | Etapas do CRM/Kanban | `org_pipeline_stages`: CRUD por organização. | CRM. |
| `followups` | Follow-ups da conversa | `org_followups`: CRUD por organização. | Conversas + módulo/instância da conversa quando associada. |
| `prospects` | Prospecção e leads importados | `org_prospects`: CRUD por organização; grants de coluna restringem insert/update. | Prospecção; verificar `conversation_id` e efeitos indiretos. |
| `outreach_sends` | Histórico de disparos | `org_outreach_sends`: SELECT por organização; grants concedem SELECT. Escrita ocorre por funções/serviços internos. | Prospecção + instância usada no disparo. |
| `outreach_openers` | Textos de prospecção | SELECT somente do próprio usuário; gravação via `save_openers()` SECURITY DEFINER. | Prospecção; RPC hoje não verifica grant de módulo. |
| `saved_prospect_segments` | Segmentos salvos | `org_saved_prospect_segments`: CRUD por organização. | Prospecção. |
| `lead_tags` | Tags de leads | `org_lead_tags`: CRUD por organização. | CRM/Prospecção conforme os chamadores. |
| `conversation_tags` | Associação tag/conversa | `org_conversation_tags`: SELECT/INSERT/DELETE por organização; grants não incluem UPDATE. | Mesmo módulo e escopo da conversa e da tag. |
| `lead_custom_fields` | Campos customizados | `org_lead_custom_fields`: CRUD por organização. | CRM; leitura por Inbox/Agenda precisa ser minimizada. |
| `loss_reasons` | Motivos de perda | `org_loss_reasons`: CRUD por organização. | CRM. |
| `knowledge_base` | Base de conhecimento do agente | `org_knowledge_base`: CRUD por organização; policy própria substituída. | Configurações; o agente consome via serviço. |
| `agent_configs` | Configuração e chaves de IA/WhatsApp/prospecção | `own_agent_config`: CRUD do próprio usuário; contém segredos. | Configurações próprias; não compartilhar chaves entre membros. |
| `conversation_events` | Métricas do Dashboard | SELECT por organização; inserções vêm de triggers e serviços. | Dashboard exige CRM + Conversas e agrega apenas eventos de conversas visíveis por grant de instância. |
| `profiles` | Nome e email dos membros | SELECT próprio/admin e `org_view_profiles` para membros da organização; UPDATE próprio/admin. | A listagem administrativa deve usar endpoint admin e não conceder escrita ao membro. |
| `user_roles` | Papel global | SELECT próprio; INSERT/UPDATE/DELETE admin conforme policies iniciais. | Somente admin confiável; nenhuma ação do CRUD de membros pode alterar papel. |
| `organization_members` | Associação, futura atividade e grants | SELECT para qualquer membro da organização; service role tem gestão. | Admin lista membros; checar se IDs de membros podem continuar visíveis aos usuários. Escrita só por endpoint confiável. |
| `organizations` | Identidade e marca da empresa | SELECT da organização atual; UPDATE restrito à coluna `logo_url` e policy admin. | Marca admin-only. |
| `app_settings` | Configurações globais e segredos | Policies admin-only para CRUD. | Admin-only; não disponibilizar ao CRUD de membros. |
| `whatsapp_instances` | Dispositivos/conexões WhatsApp | Proprietário tinha CRUD; membro da organização e admin podiam SELECT linhas. Grants incluíam `instance_token` e `server_url`. | Conceder metadados seguros das instâncias autorizadas; credenciais só no servidor; escrita/configuração admin-only. |
| `q7_local_access` | Estado local de faturamento | SELECT para todo usuário autenticado (`USING (true)`). | Controle de faturamento fora do CRUD; confirmar que contém apenas o estado global esperado. |
| `q7_installations`, `q7_billing_events` | Control plane de faturamento | Revoke de anon/authenticated; serviço usa service role. | Fora do acesso por módulos. Preservar grants restritos. |
| `private.q7_markers`, `private.instance_webhook_secrets` | Estado interno/segredo de webhook | RLS e revoke para anon/authenticated; service role. | Permanecem privados; funções que revelam segredo precisam validar módulo/dispositivo. |
| `storage.objects` / `chat-media` | Arquivos de conversa | Bucket criado como público; políticas permitem upload e SELECT em prefixo do dono. Downloads via URL pública não obedecem ao RLS. | Tornar privado; upload exige membro ativo + Conversas; emissão de URL assinada valida mensagem, módulo e instância. |
| `storage.objects` / `organization-brand` | Logo da organização | Bucket público; upload/update por policy admin e pasta da organização. | Leitura pública intencional para exibir a marca; escrita continua admin-only. |

### Objetos divergentes ou sem referência nas migrations

| Objeto | Evidência local | Escopo necessário |
|---|---|---|
| `leads` | Tabela no catálogo; policy `own_leads` (`ALL`, `public`) | CRM/Conversas, membro ativo e escopo derivado da conversa quando vinculada. |
| `searches` | Tabela no catálogo; policy `own_searches` (`ALL`, `public`) | Prospecção e membro ativo. |
| `user_settings` | Tabela no catálogo; policy `own_user_settings` (`ALL`, `public`); contém `apify_token` | Prospecção; segredo permanece próprio e fora da resposta administrativa. |
| `saved_prospect_segments`, `conversation_events` | Existem nas migrations, mas faltam ou estão incompletos nos tipos do cliente. | Gerar policies sem depender dos tipos TypeScript. |

## RPCs chamadas pelo cliente

| RPC | Uso e permissão atual | Controle necessário |
|---|---|---|
| `my_org_id()` | Lido pelo logo e configurações de marca; authenticated. | Usuário ativo; manter escopo da própria associação. |
| `canon_phone_input(text)`, `canon_phone_input_batch(text[])` | Normalização de entrada; authenticated. | Sem acesso a linhas alheias; exigir módulo chamador quando aplicável. |
| `save_openers(text[])` | SECURITY DEFINER, grava textos do usuário autenticado; authenticated. | Exigir Prospecção e membro ativo. |
| `seed_pipeline_stages(uuid)` | SECURITY DEFINER, parâmetro aceita um `user_id`; execução revogada para authenticated na migration inicial, mas `Kanban.tsx` ainda tenta chamá-la diretamente. | Confirmar privilégio efetivo; não confiar no parâmetro, exigir CRM e restringir ao membro atual/admin. |
| `transfer_conversation(uuid, uuid)` e overload com `stage_id` | SECURITY DEFINER; permite transferir conversa para membro da mesma organização. authenticated. | Exigir Conversas + CRM e grant de instância; validar origem e destino ativos/permissões. |
| `my_webhook_secret(uuid)` | SECURITY DEFINER; authenticated podia ler secret apenas se `whatsapp_instances.user_id = auth.uid()`. | Execução revogada para authenticated; resolver o webhook no servidor e retornar somente para ação admin autorizada. |
| `webhook_is_confirmed(uuid)` | Chamado pelo painel, mas execute está revogado a authenticated e permitido a service role. | Corrigir fluxo: endpoint seguro por ID ou view/RPC com estado não secreto e grant de dispositivo/admin. |
| `org_user_ids(uuid)`, `same_org(uuid)`, `has_role(uuid, role)` | Funções usadas por RLS/serviços; algumas grants aceitam authenticated. | Não usar como substituto de módulo/dispositivo; manter parâmetro de usuário não confiável sob validação do chamador. |

RPCs internas de webhook, prospecção, billing e brain têm revoke de execução
para `authenticated` nas migrations analisadas; revalidar privilégios efetivos no
catálogo.

## Edge Functions

### Chamadas diretamente do browser

| Função | Chamadores/estado atual | Controle necessário |
|---|---|---|
| `manage-instance` | Uazapi panel, Conversas, mídia, avatar e configuração da Edith; usa service role. Algumas ações aceitam `instance_token` do body; handlers diferem em validação JWT/ownership. | Inventariar cada ação; JWT, membro ativo, módulo, dispositivo e admin conforme ação; apenas `instance_id`; remover fallback global para membro. Mídia retorna URL assinada após autorização. |
| `test-uazapi` | Painel WhatsApp; lê segredos com service role. Não valida JWT dentro do handler. | Exigir JWT, membro ativo e admin antes de ler segredo ou chamar servidor externo. |
| `test-ai-connection` | Configuração do agente; valida JWT, mas lê `agent_configs` via service role sem checar status ativo/grant. | Exigir membro ativo + Configurações antes de ler dados/chamar provedor. |
| `manage-installation` | Configuração de instalações; valida JWT e `user_roles.admin`; usa service role. | Preservar admin-only e negar membro inativo antes de qualquer ação. |

### Chamadas internas, webhooks ou agendadas

`asaas-webhook`, `process-asaas-events`, `billing-snapshot`,
`sync-billing-state`, `run-followups`, `run-outreach` e `whatsapp-webhook` não
aparecem em `functions.invoke` no frontend. Seus fluxos de serviço/webhook devem
ser classificados separadamente, sem aplicar permissões de sessão do browser
como se fossem chamadas de membro. Confirmar chamadas encadeadas e configuração
`verify_jwt` em `supabase/config.toml` antes da migration.

## Gaps que condicionam a implementação

1. **Bucket público:** `chat-media` ignora RLS para download público; a política
   de SELECT pelo prefixo do dono não protege uma URL pública conhecida. A
   implementação precisa tornar o bucket privado e emitir URLs assinadas depois
   da autorização da mensagem. Fonte: [controle de acesso do Storage no
   Supabase](https://supabase.com/docs/guides/storage/buckets/fundamentals).
2. **Módulos sobre `conversations`:** Inbox, CRM/Kanban, Agenda e Dashboard leem
   a mesma tabela. Decisão aprovada: CRM + Conversas formam uma concessão
   conjunta; Agenda e Dashboard dependem dela. RLS também precisa filtrar
   instâncias.
3. **Privilégios/catalog:** grants locais dão privilégios amplos a
   `authenticated`, inclusive CRUD em `whatsapp_instances`; migrations novas
   revogam segredos e limitam metadados. O catálogo confirmou policies próprias
   residuais, que também são substituídas. O remoto não foi comparado nem alterado.
4. **RPC de transferência:** funções SECURITY DEFINER alteram conversa,
   mensagens, follow-ups e prospect; precisam de guardas equivalentes às tabelas.
5. **Schema de tipos desatualizado:** confirmar views/tabelas ausentes dos
   migrations antes de gerar políticas ou tipos novos.

## Comandos para reproduzir o inventário estático

```bash
supabase db query --local -o table "select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname='public' order by tablename,policyname"
supabase db query --local -o table "select table_name, string_agg(distinct privilege_type, ', ' order by privilege_type) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' group by table_name order by table_name"
rg -n -i 'create policy' supabase/migrations
rg -n -i '^\s*(grant|revoke)|row level security' supabase/migrations
rg -n '\.rpc\(' src
rg -n 'functions\.invoke|instance_token|getPublicUrl|createSignedUrl' src
```
