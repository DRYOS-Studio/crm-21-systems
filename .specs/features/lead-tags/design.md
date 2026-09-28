# Tags de lead — design

## Modelo

- `lead_tags(id, user_id, name, color)` — catálogo por conta. Unique `(user_id, lower(btrim(name)))`.
- `conversation_tags(conversation_id, tag_id)` — N:N. PK composta.
- Cores: `oak | sage | ok | warning | neutral | critical` (pills DRYOS).

## UI

- Editor no `LeadContextPanel` (Conversas, desktop + sheet).
- Chips: inbox (máx. 2), Kanban (máx. 2), Prospecção (máx. 3).
- `TagFilterSelect` nas três telas. Some se o catálogo está vazio.

## Client

Hook `useLeadTags` carrega catálogo + vínculos e muta localmente após insert/delete.
