export const FUNNEL_COLORS = [
  "#3FB8BE",
  "#6366F1",
  "#0EA5E9",
  "#F59E0B",
  "#EF4444",
  "#10B981",
  "#8B5CF6",
  "#EC4899",
  "#64748B",
  "#D97706",
] as const;

export function nextFunnelColor(used: Array<string | null | undefined>) {
  const taken = new Set(used.filter(Boolean).map((c) => String(c).toLowerCase()));
  return (
    FUNNEL_COLORS.find((c) => !taken.has(c.toLowerCase())) ??
    FUNNEL_COLORS[used.length % FUNNEL_COLORS.length]
  );
}
