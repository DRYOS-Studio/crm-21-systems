import type { InboxFilter } from "./inbox";

const INBOX_FILTERS = new Set<InboxFilter>(["todas", "responder", "aguardando", "humano", "encerrados"]);

export type ViewFilters = {
  inboxFilter: InboxFilter;
  tagFilter: string;
  userFilter: string;
};

export const DEFAULT_VIEW_FILTERS: ViewFilters = {
  inboxFilter: "todas",
  tagFilter: "all",
  userFilter: "all",
};

export function viewFiltersKey(userId: string) {
  return `q7:view-filters:${userId}`;
}

export function parseViewFilters(raw: string | null | undefined): ViewFilters {
  if (!raw) return { ...DEFAULT_VIEW_FILTERS };
  try {
    const v = JSON.parse(raw) as Partial<ViewFilters>;
    const inboxFilter = INBOX_FILTERS.has(v.inboxFilter as InboxFilter)
      ? (v.inboxFilter as InboxFilter)
      : DEFAULT_VIEW_FILTERS.inboxFilter;
    const tagFilter = typeof v.tagFilter === "string" && v.tagFilter ? v.tagFilter : DEFAULT_VIEW_FILTERS.tagFilter;
    const userFilter =
      typeof v.userFilter === "string" && v.userFilter ? v.userFilter : DEFAULT_VIEW_FILTERS.userFilter;
    return { inboxFilter, tagFilter, userFilter };
  } catch {
    return { ...DEFAULT_VIEW_FILTERS };
  }
}

export function serializeViewFilters(filters: ViewFilters): string {
  return JSON.stringify({
    inboxFilter: filters.inboxFilter,
    tagFilter: filters.tagFilter,
    userFilter: filters.userFilter,
  });
}

export function loadViewFilters(userId: string): ViewFilters {
  if (typeof localStorage === "undefined") return { ...DEFAULT_VIEW_FILTERS };
  return parseViewFilters(localStorage.getItem(viewFiltersKey(userId)));
}

export function saveViewFilters(userId: string, filters: ViewFilters) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(viewFiltersKey(userId), serializeViewFilters(filters));
}
