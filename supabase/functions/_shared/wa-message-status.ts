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

export function normalizeWaStatus(raw: unknown): WaMessageStatus | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    if (raw >= 3) return "read";
    if (raw === 2) return "delivered";
    if (raw === 1) return "sent";
    if (raw === 0) return "sent";
    return null;
  }
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === "read" || s.includes("read") || s === "played" || s === "viewed") return "read";
  if (s === "delivered" || s.includes("delivery") || s === "received") return "delivered";
  if (s === "failed" || s.includes("fail") || s === "error") return "failed";
  if (s === "sent" || s.includes("server") || s === "pending" || s === "ack") return "sent";
  return null;
}

export function parseMessagesUpdate(body: Record<string, unknown>): {
  messageId: string;
  status: WaMessageStatus;
} | null {
  const event = String(body.EventType || body.event || body.type || "").toLowerCase();
  if (event !== "messages_update" && event !== "messages.update") return null;

  const envelope = (body.data && typeof body.data === "object" ? body.data : body) as Record<
    string,
    unknown
  >;
  const m =
    (envelope.message && typeof envelope.message === "object"
      ? envelope.message
      : envelope) as Record<string, unknown>;

  const messageId =
    extractUazapiMessageId(m) ??
    extractUazapiMessageId(envelope) ??
    (m.key && typeof m.key === "object"
      ? extractUazapiMessageId({ message: m.key })
      : null);

  const statusRaw =
    m.status ??
    m.ack ??
    m.messageStatus ??
    m.MessageStatus ??
    m.updateStatus ??
    envelope.status;

  const status = normalizeWaStatus(statusRaw);
  if (!messageId || !status) return null;
  return { messageId, status };
}
