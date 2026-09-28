export type LossReason = {
  id: string;
  name: string;
  position: number;
  active: boolean;
};

export function normalizeLossReasonName(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, 48);
}

export function lossReasonLabel(reason: LossReason | undefined, note: string | null | undefined) {
  if (!reason) return note?.trim() || null;
  const detail = note?.trim();
  if (reason.name.toLowerCase() === "outro" && detail) return detail;
  return detail ? `${reason.name} — ${detail}` : reason.name;
}
