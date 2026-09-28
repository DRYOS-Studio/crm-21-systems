/** Campos de avatar no payload Uazapi (webhook chat ou /chat/details). */
export function contactAvatarFromUazapiChat(chat: Record<string, unknown> | null | undefined): string | null {
  if (!chat || typeof chat !== "object") return null;
  const keys = ["image", "imagePreview", "wa_profilePicUrl", "profilePicUrl"] as const;
  for (const key of keys) {
    const v = chat[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
