/** URL http(s) usável em <img> — evita strings vazias que a Uazapi manda como "". */
export function usableAvatarUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const t = url.trim();
  if (!t) return null;
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  return null;
}
