export type InboxFilter =
  | "todas"
  | "responder"
  | "aguardando"
  | "sem_contato"
  | "humano"
  | "encerrados";

export type LastSnap = {
  id: string;
  content: string;
  direction: "inbound" | "outbound";
  sender: "contact" | "ai" | "human";
  created_at: string;
};

export function lastSnapFromMessage(row: {
  id: string;
  content: string;
  direction: "inbound" | "outbound";
  sender: "contact" | "ai" | "human";
  created_at: string;
}): LastSnap {
  return {
    id: row.id,
    content: row.content,
    direction: row.direction,
    sender: row.sender,
    created_at: row.created_at,
  };
}

export function inboxInitials(title: string) {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return title.slice(0, 2).toUpperCase() || "?";
}

export function formatInboxTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = now - d.getTime();
  if (diff < 45_000) return "agora";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} min`;
  const sameDay = d.toDateString() === new Date(now).toDateString();
  if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff < 6 * 86_400_000) return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function previewText(content: string | null | undefined, max = 72) {
  const t = String(content || "").replace(/\s+/g, " ").trim();
  if (!t) return "Sem mensagens";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function ehEmContato(nome: string | null | undefined) {
  return /em\s*contato/i.test(String(nome || ""));
}

export function ehPerdido(nome: string | null | undefined) {
  return /perdid/i.test(String(nome || ""));
}

/** Lead aberto que ainda não entrou em “Em contato” e nunca respondeu — prioridade para ligar/chamar. */
export function conversationSemContato(
  conversationId: string,
  stageId: string | null | undefined,
  lastInboundAt: Record<string, string>,
  emContatoStageIds: ReadonlySet<string>,
) {
  if (lastInboundAt[conversationId]) return false;
  if (stageId && emContatoStageIds.has(stageId)) return false;
  return true;
}

export function precisaResponder(last: LastSnap | undefined) {
  return last?.direction === "inbound";
}

export function matchesInboxQuery(
  q: string,
  fields: Array<string | null | undefined>,
) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => String(f || "").toLowerCase().includes(needle));
}

export function threadDateLabel(iso: string, now = Date.now()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function waMeUrl(phone: string | null | undefined) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}
