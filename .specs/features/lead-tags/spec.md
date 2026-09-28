# Tags de lead

## Problem Statement

Não dá para marcar um lead (conversa) com um rótulo simples e filtrar a lista
pelo mesmo rótulo no inbox, no Kanban e na prospecção.

## Goals

- [ ] Cada conta tem o próprio catálogo de tags (nome + cor).
- [ ] Tags colam na conversa (lead), não no usuário.
- [ ] Criar e atribuir no painel do lead: digitar + Enter.
- [ ] Chips visíveis no inbox, no card do Kanban e na tabela de contatos.
- [ ] Filtro por tag nessas três telas.

## Out of Scope

- Tags compartilhadas entre contas.
- Automação (tag ao importar / ao responder).
- Renomear/apagar catálogo em tela própria (apagar o vínculo no chip basta).

## Acceptance

- AC1: Enter com nome novo cria a tag e cola no lead aberto.
- AC2: Clique numa tag existente (sugestão) cola sem duplicar.
- AC3: X no chip remove só daquele lead.
- AC4: Filtro “Quente” esconde leads sem essa tag.
- AC5: RLS: user A não vê/edita tags de user B.
