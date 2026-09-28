# Filtros fixos (inbox + CRM)

## Problem Statement

Os filtros de usuário e tag no inbox e no Kanban resetam ao trocar de tela
ou recarregar. A barra também precisa permanecer visível enquanto a lista
rola, como no app de referência (Aegis / board filter bar).

## Goals

- [ ] A barra de filtros fica pinada no inbox e no CRM (não some no scroll).
- [ ] A última escolha do usuário (chip do inbox, tag, usuário) sobrevive a
      navegação e reload, por login.

## Out of Scope

- Sincronizar busca textual do inbox.
- Sync entre dispositivos (só localStorage deste browser).

## User Stories

### P1: Preferência persistida

**User Story**: Como operador, quero que tag e usuário escolhidos fiquem iguais
no inbox e no CRM depois de eu navegar ou atualizar a página.

**Acceptance Criteria**:

1. WHEN o usuário escolhe uma tag ou um membro THEN o sistema SHALL gravar
   essa escolha na chave `q7:view-filters:{userId}`.
2. WHEN o usuário abre `/`, `/crm` ou `/prospeccao` THEN o sistema SHALL
   restaurar tag e usuário gravados.
3. WHEN o usuário escolhe um chip do inbox (Sua vez, Encerrados, …) THEN o
   sistema SHALL restaurar esse chip na próxima visita ao inbox.
4. WHEN o JSON gravado for inválido THEN o sistema SHALL cair no default
   (todas / all / all) sem quebrar a tela.

### P1: Barra pinada

**User Story**: Como operador, quero os filtros sempre visíveis enquanto
rolo a lista ou o board.

**Acceptance Criteria**:

1. WHEN a lista do inbox rola THEN a barra de filtros SHALL permanecer no topo
   da coluna.
2. WHEN o board do CRM rola THEN a barra de filtros SHALL permanecer abaixo
   do header.
3. WHEN a lista de contatos na Prospecção rola THEN a barra de filtros SHALL
   permanecer visível no topo da área rolável.
