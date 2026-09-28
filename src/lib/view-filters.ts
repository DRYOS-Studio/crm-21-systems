import type { InboxFilter } from "./inbox";

function parseStoredTagFilters(raw: unknown, legacyTagFilter?: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  if (typeof legacyTagFilter === "string" && legacyTagFilter && legacyTagFilter !== "all") {
    return [legacyTagFilter];
  }
  return [];
}

const INBOX_FILTERS = new Set<InboxFilter>(["todas", "responder", "aguardando", "humano", "encerrados"]);

export const INSTANCE_FILTER_NONE = "none";

export type ViewFilters = {
  inboxFilter: InboxFilter;
  tagFilters: string[];
  userFilter: string;
  instanceFilter: string;
  followupOnly: boolean;
};

export const DEFAULT_VIEW_FILTERS: ViewFilters = {
  inboxFilter: "todas",
  tagFilters: [],
  userFilter: "all",
  instanceFilter: "all",
  followupOnly: false,
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
    const tagFilters = parseStoredTagFilters(v.tagFilters, v.tagFilter);
    const userFilter =
      typeof v.userFilter === "string" && v.userFilter ? v.userFilter : DEFAULT_VIEW_FILTERS.userFilter;
    const instanceFilter =
      typeof v.instanceFilter === "string" && v.instanceFilter
        ? v.instanceFilter
        : DEFAULT_VIEW_FILTERS.instanceFilter;
    const followupOnly = v.followupOnly === true;
    return { inboxFilter, tagFilters, userFilter, instanceFilter, followupOnly };
  } catch {
    return { ...DEFAULT_VIEW_FILTERS };
  }
}

export function serializeViewFilters(filters: ViewFilters): string {
  return JSON.stringify({
    inboxFilter: filters.inboxFilter,
    tagFilters: filters.tagFilters,
    userFilter: filters.userFilter,
    instanceFilter: filters.instanceFilter,
    followupOnly: filters.followupOnly,
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
