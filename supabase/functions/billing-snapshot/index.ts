import { createClient } from "npm:@supabase/supabase-js@2.49.1";

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const installationId = req.headers.get("x-q7-installation-id") ?? "";
  const token = req.headers.get("x-q7-installation-token") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(installationId) || !/^[0-9a-f]{64}$/i.test(token)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return new Response("Server configuration error", { status: 500 });

  const admin = createClient(url, serviceKey);
  const { data: installation, error } = await admin
    .from("q7_installations")
    .select("sync_token_hash, billing_status, grace_ends_at, payment_url")
    .eq("id", installationId)
    .maybeSingle();
  if (error) return new Response("Temporarily unavailable", { status: 503 });
  if (!installation) return new Response("Not found", { status: 404 });

  const tokenHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  if (tokenHash !== installation.sync_token_hash) return new Response("Unauthorized", { status: 401 });

  const status = installation.billing_status === "past_due" && installation.grace_ends_at &&
      new Date(installation.grace_ends_at).getTime() <= Date.now()
    ? "blocked"
    : installation.billing_status;

  return Response.json({
    billing_status: status,
    grace_ends_at: installation.grace_ends_at,
    payment_url: installation.payment_url,
    server_time: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
});
