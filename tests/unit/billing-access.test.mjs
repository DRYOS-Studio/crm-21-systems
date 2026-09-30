import { test } from "node:test";
import assert from "node:assert/strict";
import { isBillingAccessAllowed } from "../../supabase/functions/_shared/billing-access.ts";

const now = Date.parse("2026-09-30T12:00:00Z");
const fresh = "2026-09-30T11:55:00Z";

test("cobrança em dia e atraso dentro da tolerância mantêm acesso", () => {
  assert.equal(isBillingAccessAllowed("active", null, fresh, now), true);
  assert.equal(isBillingAccessAllowed("past_due", "2026-10-01T03:00:00Z", fresh, now), true);
});

test("atraso vencido, estado bloqueado ou sincronização antiga negam acesso", () => {
  assert.equal(isBillingAccessAllowed("past_due", "2026-09-30T11:59:59Z", fresh, now), false);
  assert.equal(isBillingAccessAllowed("blocked", null, fresh, now), false);
  assert.equal(isBillingAccessAllowed("active", null, "2026-09-30T11:49:59Z", now), false);
  assert.equal(isBillingAccessAllowed("active", null, "invalid", now), false);
});
