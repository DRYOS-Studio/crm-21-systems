# Filtros fixos — design

**Spec**: `.specs/features/sticky-filters/spec.md`
**Status**: Approved

## Approach

Uma chave `localStorage` por login guarda `{ inboxFilter, tagFilter, userFilter }`.
Inbox e CRM leem/escrevem a mesma chave, então tag e usuário ficam iguais nas
duas telas. O chip do inbox só vale na lista, mas persiste junto.

A barra é pinada por layout flex (`shrink-0` + lista/board com overflow), no
mesmo molde do `BoardFilterBar` do Aegis — fora da área que rola.

## Reuses

| Peça | Onde |
| --- | --- |
| `InboxFilter` | `src/lib/inbox.ts` |
| `UserFilterSelect` | `src/components/org/UserFilterSelect.tsx` |
| `TagFilterSelect` | `src/components/lead/LeadTagEditor.tsx` |

## Files

- `src/lib/view-filters.ts` — parse/serialize/load/save (testável)
- `src/hooks/useViewFilters.ts` — estado + persist
- `src/pages/Conversas.tsx` — consome o hook; barra `shrink-0`
- `src/pages/Kanban.tsx` — consome o hook; barra `shrink-0`
- `tests/unit/view-filters.test.mjs`

## Defaults

`inboxFilter: "todas"`, `tagFilter: "all"`, `userFilter: "all"`.
