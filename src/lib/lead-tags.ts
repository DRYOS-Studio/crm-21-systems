export type TagColor = "oak" | "sage" | "ok" | "warning" | "neutral" | "critical";

export type LeadTag = {
  id: string;
  name: string;
  color: TagColor;
};

export const TAG_COLORS: TagColor[] = ["oak", "sage", "ok", "warning", "neutral", "critical"];

export function nextTagColor(index: number): TagColor {
  return TAG_COLORS[index % TAG_COLORS.length];
}

export function normalizeTagName(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, 32);
}

export function tagBadgeVariant(color: string | null | undefined): TagColor {
  if (color === "sage" || color === "ok" || color === "warning" || color === "neutral" || color === "critical") {
    return color;
  }
  return "oak";
}
