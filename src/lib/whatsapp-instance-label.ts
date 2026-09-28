export type WhatsappInstanceRow = {
  id: string;
  name: string;
  phone: string | null;
  profile_name: string | null;
  status: string;
  user_id: string;
};

export function formatWhatsappPhone(phone: string | null | undefined) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 13 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const mid = rest.length === 9 ? `${rest.slice(0, 5)}-${rest.slice(5)}` : rest;
    return `+55 ${ddd} ${mid}`;
  }
  return `+${digits}`;
}

export function whatsappInstanceLabel(
  inst: Pick<WhatsappInstanceRow, "name" | "phone" | "profile_name">,
  ownerPrefix?: string | null,
) {
  const title = inst.profile_name?.trim() || inst.name?.trim() || "WhatsApp";
  const phone = formatWhatsappPhone(inst.phone);
  const base = phone ? `${title} · ${phone}` : title;
  if (ownerPrefix) return `${ownerPrefix} · ${base}`;
  return base;
}
