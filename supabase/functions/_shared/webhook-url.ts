/** Único formato da URL do webhook (design §3.1 / ADR-11). UI e servidor passam o origin. */
export function montarWebhookUrl(supabaseUrl: string, secret: string): string {
  const origin = String(supabaseUrl || "").replace(/\/$/, "");
  return `${origin}/functions/v1/whatsapp-webhook?s=${encodeURIComponent(secret)}`;
}

/** Tira o valor de `s` de URL, log e JSON ecoado pela Uazapi. */
export function redigirSecret(texto: string, secret?: string | null): string {
  let out = String(texto ?? "");
  if (secret) out = out.split(secret).join("[redacted]");
  return out.replace(/([?&]s=)[^&\s"'\\]+/gi, "$1[redacted]");
}

export function redigirJson(value: unknown, secret?: string | null): unknown {
  if (typeof value === "string") return redigirSecret(value, secret);
  if (Array.isArray(value)) return value.map((v) => redigirJson(v, secret));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redigirJson(v, secret);
    return out;
  }
  return value;
}
