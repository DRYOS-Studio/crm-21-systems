# Organização — design

- `organizations` + `organization_members` (1 user = 1 org).
- `same_org(user_id)` no RLS de conversas, mensagens, kanban, prospects, tags, knowledge, followups.
- WhatsApp: SELECT do time; CREATE/UPDATE só do dono.
- Disparo e prompt da Edith continuam por conta.
- Webhook localiza conversa/prospect no time (`org_user_ids`), prefere `instance_id`.
- Backfill: as duas contas atuais entram em ProspectIA; etapas duplicadas da 2ª conta somem.
