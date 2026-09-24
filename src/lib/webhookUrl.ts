import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Único lugar em `src/` que conhece o path do webhook (ADR-11). */
export function montarWebhookUrl(supabaseUrl: string, secret: string): string {
  const origin = String(supabaseUrl || "").replace(/\/$/, "");
  return `${origin}/functions/v1/whatsapp-webhook?s=${encodeURIComponent(secret)}`;
}

export async function resolveWebhookUrl(
  client: SupabaseClient<Database>,
  supabaseUrl: string,
  instanceId: string | null | undefined,
): Promise<string | null> {
  if (!instanceId) return null;
  const { data, error } = await client.rpc("my_webhook_secret", { p_instance: instanceId });
  if (error || !data) return null;
  return montarWebhookUrl(supabaseUrl, data);
}
