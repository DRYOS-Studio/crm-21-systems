import { test } from "node:test";
import assert from "node:assert/strict";
import "../_harness/edge-shim.mjs";
import { status, adminClient } from "../_harness/db.mjs";
import { handle } from "../../supabase/functions/process-asaas-events/index.ts";

const s = status();
process.env.SUPABASE_URL = s.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = s.SERVICE_ROLE_KEY;
process.env.ASAAS_API_KEY = "test-asaas-key";

test("eventos Asaas atrasados nao reabrem uma cobranca mais recente", async () => {
  const admin = adminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const subscriptionId = `sub-${suffix}`;
  const paymentById = new Map();
  const fetcher = async (url) => {
    const id = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
    const payment = paymentById.get(id);
    return new Response(JSON.stringify(payment), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const { data: secretRow, error: secretError } = await admin
    .from("app_settings").select("value").eq("key", "q7_billing_process_secret").single();
  if (secretError) throw secretError;

  const { data: installation, error: installError } = await admin.from("q7_installations").insert({
    company_name: `Billing test ${suffix}`,
    slug: `billing-test-${suffix}`,
    asaas_subscription_id: subscriptionId,
    sync_token_hash: "a".repeat(64),
    billing_status: "active",
    billing_due_date: "2026-09-01",
  }).select("id").single();
  if (installError) throw installError;

  async function enqueue(eventId, paymentId, eventType, dueDate) {
    const { error } = await admin.from("q7_billing_events").insert({
      asaas_event_id: `${eventId}-${suffix}`,
      event_type: eventType,
      payment_id: paymentId,
      subscription_id: subscriptionId,
      due_date: dueDate,
    });
    if (error) throw error;
    const response = await handle(new Request("http://localhost/process-asaas-events", {
      method: "POST",
      headers: { "x-cron-secret": secretRow.value },
    }), fetcher);
    assert.equal(response.status, 200);
  }

  try {
    paymentById.set("overdue", { id: "overdue", subscription: subscriptionId, status: "OVERDUE", dueDate: "2026-09-25" });
    await enqueue("overdue", "overdue", "PAYMENT_OVERDUE", "2026-09-25");
    let { data: current, error } = await admin.from("q7_installations").select("billing_status, billing_due_date, grace_ends_at").eq("id", installation.id).single();
    if (error) throw error;
    assert.equal(current.billing_status, "past_due");
    assert.equal(current.billing_due_date, "2026-09-25");
    assert.ok(current.grace_ends_at);

    paymentById.set("old-paid", { id: "old-paid", subscription: subscriptionId, status: "RECEIVED", dueDate: "2026-09-01" });
    await enqueue("old-paid", "old-paid", "PAYMENT_RECEIVED", "2026-09-01");
    ({ data: current, error } = await admin.from("q7_installations").select("billing_status, billing_due_date").eq("id", installation.id).single());
    if (error) throw error;
    assert.equal(current.billing_status, "past_due");
    assert.equal(current.billing_due_date, "2026-09-25");

    paymentById.set("current-paid", { id: "current-paid", subscription: subscriptionId, status: "CONFIRMED", dueDate: "2026-09-25", confirmedDate: "2026-09-30" });
    await enqueue("current-paid", "current-paid", "PAYMENT_CONFIRMED", "2026-09-25");
    ({ data: current, error } = await admin.from("q7_installations").select("billing_status, billing_due_date, grace_ends_at, last_paid_at").eq("id", installation.id).single());
    if (error) throw error;
    assert.equal(current.billing_status, "active");
    assert.equal(current.billing_due_date, "2026-09-25");
    assert.equal(current.grace_ends_at, null);
    assert.ok(current.last_paid_at);
  } finally {
    await admin.from("q7_billing_events").delete().like("asaas_event_id", `%-${suffix}`);
    await admin.from("q7_installations").delete().eq("id", installation.id);
  }
});
