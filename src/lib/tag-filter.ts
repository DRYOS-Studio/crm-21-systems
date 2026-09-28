import type { LeadTag } from "./lead-tags";

export const TAG_FILTER_NONE = "none";

export function parseTagFilters(raw: unknown, legacyTagFilter?: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  if (typeof legacyTagFilter === "string" && legacyTagFilter && legacyTagFilter !== "all") {
    return [legacyTagFilter];
  }
  return [];
}

export function conversationMatchesTagFilter(assignedTagIds: string[], tagFilters: string[]) {
  if (!tagFilters.length) return true;
  if (tagFilters.includes(TAG_FILTER_NONE)) return assignedTagIds.length === 0;
  return tagFilters.some((id) => assignedTagIds.includes(id));
}

export function toggleTagFilter(current: string[], tagId: string): string[] {
  if (tagId === TAG_FILTER_NONE) {
    if (current.length === 1 && current[0] === TAG_FILTER_NONE) return [];
    return [TAG_FILTER_NONE];
  }
  const base = current.filter((id) => id !== TAG_FILTER_NONE);
  if (base.includes(tagId)) return base.filter((id) => id !== tagId);
  return [...base, tagId];
}

export function tagFilterSummary(tagFilters: string[], catalog: LeadTag[]): string {
  if (!tagFilters.length) return "Todas as tags";
  if (tagFilters.length === 1 && tagFilters[0] === TAG_FILTER_NONE) return "Sem tags";
  const names = tagFilters
    .map((id) => catalog.find((t) => t.id === id)?.name)
    .filter((n): n is string => !!n);
  if (names.length === 0) return `${tagFilters.length} tag(s)`;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}
