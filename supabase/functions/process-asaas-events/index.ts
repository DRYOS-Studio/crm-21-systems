import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const MAX_EVENTS = 20;
const PAID = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);
const REVOKED = new Set(["OVERDUE", "REFUNDED", "RECEIVED_IN_CASH_UNDONE"]);

function equalSecret(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function asaasBaseUrl() {
  return Deno.env.get("ASAAS_ENVIRONMENT") === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";
}

export async function handle(req: Request, fetcher: typeof fetch = fetch) {
  if (req.method !== "POST") return Response.json({ ok: false }, { status: 405 });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const asaasKey = Deno.env.get("ASAAS_API_KEY") ?? "";
  if (!url || !serviceKey || !asaasKey) return Response.json({ ok: false, error: "Server configuration error" }, { status: 503 });

  const admin = createClient(url, serviceKey);
  const { data: secretRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "q7_billing_process_secret")
    .maybeSingle();
  const expected = secretRow?.value?.trim() ?? "";
  if (!expected || !equalSecret(req.headers.get("x-cron-secret") ?? "", expected)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const { data: events, error } = await admin.rpc("q7_claim_billing_events", { _limit: MAX_EVENTS });
  if (error) return Response.json({ ok: false, error: "Could not claim billing events" }, { status: 500 });

  let processed = 0;
  for (const event of events ?? []) {
    try {
      const response = await fetcher(`${asaasBaseUrl()}/payments/${encodeURIComponent(event.payment_id)}`, {
        headers: { access_token: asaasKey, accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`Asaas returned ${response.status}`);
      const payment = await response.json();
      if (payment.subscription !== event.subscription_id) {
        await admin.from("q7_billing_events").update({ status: "ignored", processed_at: new Date().toISOString() }).eq("id", event.id);
        continue;
      }

      const { data: installation } = await admin
        .from("q7_installations")
        .select("id, billing_due_date")
        .eq("asaas_subscription_id", payment.subscription)
        .maybeSingle();
      if (!installation) {
        await admin.from("q7_billing_events").update({ status: "ignored", processed_at: new Date().toISOString() }).eq("id", event.id);
        continue;
      }

      const dueDate = typeof payment.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payment.dueDate)
        ? payment.dueDate
        : event.due_date;
      if (!dueDate) throw new Error("Asaas payment has no due date");
      if (!installation.billing_due_date || dueDate >= installation.billing_due_date) {
        const patch: Record<string, unknown> = {
          billing_due_date: dueDate,
          payment_url: payment.invoiceUrl ?? payment.bankSlipUrl ?? null,
          updated_at: new Date().toISOString(),
        };
        if (PAID.has(payment.status)) {
          patch.billing_status = "active";
          patch.grace_ends_at = null;
          patch.last_paid_at = payment.confirmedDate ?? payment.paymentDate ?? new Date().toISOString();
        } else if (REVOKED.has(payment.status)) {
          const { data: graceEndsAt, error: graceError } = await admin.rpc("q7_grace_ends_at", { _due_date: dueDate });
          if (graceError || !graceEndsAt) throw new Error("Could not calculate billing grace period");
          patch.billing_status = new Date(graceEndsAt).getTime() <= Date.now() ? "blocked" : "past_due";
          patch.grace_ends_at = graceEndsAt;
        }
        const { error: updateError } = await admin.from("q7_installations").update(patch).eq("id", installation.id);
        if (updateError) throw new Error("Could not update installation billing status");
      }

      const { error: eventError } = await admin
        .from("q7_billing_events")
        .update({ status: "processed", processed_at: new Date().toISOString(), last_error: null })
        .eq("id", event.id);
      if (eventError) throw new Error("Could not mark event processed");
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Processing failed";
      const nextStatus = event.attempts >= 12 ? "failed" : "pending";
      await admin.from("q7_billing_events").update({ status: nextStatus, locked_at: null, last_error: message }).eq("id", event.id);
      console.error("[process-asaas-events] event processing failed", { eventId: event.id, message });
    }
  }

  return Response.json({ ok: true, processed, claimed: events?.length ?? 0 });
}

serve(handle);
