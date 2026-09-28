import type { InboxFilter } from "./inbox";

const INBOX_FILTERS = new Set<InboxFilter>(["todas", "responder", "aguardando", "humano", "encerrados"]);

export const INSTANCE_FILTER_NONE = "none";

export type ViewFilters = {
  inboxFilter: InboxFilter;
  tagFilter: string;
  userFilter: string;
  instanceFilter: string;
};

export const DEFAULT_VIEW_FILTERS: ViewFilters = {
  inboxFilter: "todas",
  tagFilter: "all",
  userFilter: "all",
  instanceFilter: "all",
};

export type InstanceFilterRow = { id: string; user_id: string };

export function instancesForUserFilter(instances: InstanceFilterRow[], userFilter: string) {
  if (userFilter === "all") return instances;
  return instances.filter((i) => i.user_id === userFilter);
}

/** Evita dispositivo de outro usuário quando o inbox está filtrado por responsável. */
export function coerceInstanceFilter(
  instanceFilter: string,
  userFilter: string,
  instances: InstanceFilterRow[],
): string {
  if (instanceFilter === "all" || instanceFilter === INSTANCE_FILTER_NONE) return instanceFilter;
  const inst = instances.find((i) => i.id === instanceFilter);
  if (!inst) return "all";
  if (userFilter !== "all" && inst.user_id !== userFilter) return "all";
  return instanceFilter;
}

export function conversationMatchesInstanceFilter(
  instanceId: string | null | undefined,
  filter: string,
  conversationUserId: string,
  instances: InstanceFilterRow[],
) {
  if (filter === "all") return true;
  if (filter === INSTANCE_FILTER_NONE) return !instanceId;
  if (instanceId) return instanceId === filter;
  const picked = instances.find((i) => i.id === filter);
  if (!picked) return false;
  return picked.user_id === conversationUserId;
}

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
    const instanceFilter =
      typeof v.instanceFilter === "string" && v.instanceFilter
        ? v.instanceFilter
        : DEFAULT_VIEW_FILTERS.instanceFilter;
    return { inboxFilter, tagFilter, userFilter, instanceFilter };
  } catch {
    return { ...DEFAULT_VIEW_FILTERS };
  }
}

export function serializeViewFilters(filters: ViewFilters): string {
  return JSON.stringify({
    inboxFilter: filters.inboxFilter,
    tagFilter: filters.tagFilter,
    userFilter: filters.userFilter,
    instanceFilter: filters.instanceFilter,
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
