import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const MAX_RESPONSE_AGE_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ ok: false }, { status: 405 });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const controlUrl = Deno.env.get("Q7_CONTROL_PLANE_URL")?.replace(/\/$/, "");
  const controlAnonKey = Deno.env.get("Q7_CONTROL_PLANE_ANON_KEY") ?? "";
  const installationId = Deno.env.get("Q7_INSTALLATION_ID") ?? "";
  const installationToken = Deno.env.get("Q7_INSTALLATION_TOKEN") ?? "";
  if (!url || !serviceKey || !controlUrl || !controlAnonKey || !installationId || !/^[0-9a-f]{64}$/i.test(installationToken)) {
    return Response.json({ ok: false, error: "Billing sync is not configured" }, { status: 503 });
  }

  const admin = createClient(url, serviceKey);
  const { data: secretRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "q7_billing_sync_secret")
    .maybeSingle();
  const expected = secretRow?.value?.trim() ?? "";
  const supplied = req.headers.get("x-cron-secret") ?? "";
  if (!expected || supplied !== expected) return Response.json({ ok: false }, { status: 401 });

  const minute = Math.floor(Date.now() / 60_000) % 5;
  const slot = Number.parseInt(installationId.replaceAll("-", "").slice(0, 2), 16) % 5;
  if (minute !== slot && req.headers.get("x-force-sync") !== "true") {
    return Response.json({ ok: true, skipped: true });
  }

  try {
    const response = await fetch(`${controlUrl}/functions/v1/billing-snapshot`, {
      method: "POST",
      headers: {
        apikey: controlAnonKey,
        "x-q7-installation-id": installationId,
        "x-q7-installation-token": installationToken,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`control plane returned ${response.status}`);
    const snapshot = await response.json();
    const serverTime = new Date(snapshot.server_time).getTime();
    if (!Number.isFinite(serverTime) || Math.abs(Date.now() - serverTime) > MAX_RESPONSE_AGE_MS) {
      throw new Error("invalid or stale billing snapshot");
    }
    if (!["active", "past_due", "blocked", "cancelled"].includes(snapshot.billing_status)) {
      throw new Error("invalid billing status");
    }

    const { error } = await admin.from("q7_local_access").update({
      billing_status: snapshot.billing_status,
      grace_ends_at: snapshot.grace_ends_at,
      payment_url: snapshot.payment_url,
      synchronized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("singleton", true);
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, billing_status: snapshot.billing_status });
  } catch (error) {
    console.error("[sync-billing-state] sync failed", error);
    return Response.json({ ok: false, error: "Billing sync failed" }, { status: 502 });
  }
});
