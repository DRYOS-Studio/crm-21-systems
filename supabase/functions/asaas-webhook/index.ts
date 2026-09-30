import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const EVENTS = new Set([
  "PAYMENT_OVERDUE",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_REFUNDED",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE",
]);

function equalSecret(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const expected = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";
  const provided = req.headers.get("asaas-access-token") ?? "";
  if (!expected || !equalSecret(expected, provided)) return new Response("Unauthorized", { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!EVENTS.has(body?.event)) return new Response(null, { status: 204 });

  const payment = body?.payment;
  if (typeof body.id !== "string" || typeof payment?.id !== "string") {
    return new Response("Invalid payment event", { status: 400 });
  }
  if (typeof payment.subscription !== "string" || !payment.subscription) {
    return new Response(null, { status: 204 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return new Response("Server configuration error", { status: 500 });
  const admin = createClient(url, serviceKey);
  const { error } = await admin.from("q7_billing_events").insert({
    asaas_event_id: body.id,
    event_type: body.event,
    payment_id: payment.id,
    subscription_id: payment.subscription,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate ?? "") ? payment.dueDate : null,
  });
  if (error && error.code !== "23505") {
    console.error("[asaas-webhook] event persist failed", error.message);
    return new Response("Temporarily unavailable", { status: 503 });
  }
  return new Response(null, { status: 204 });
});
