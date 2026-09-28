export type WaMessageStatus = "sent" | "delivered" | "read" | "failed";

export function extractUazapiMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const msg =
    root.message && typeof root.message === "object"
      ? (root.message as Record<string, unknown>)
      : root;
  for (const key of ["messageid", "messageId", "id", "msgId"]) {
    const v = msg[key] ?? root[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}
