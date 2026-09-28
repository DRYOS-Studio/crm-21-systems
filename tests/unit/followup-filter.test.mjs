import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationHasFollowup } from "../../src/lib/followup-filter.ts";

test("conversationHasFollowup: pending manual ou inatividade", () => {
  const pending = new Set(["c1"]);
  assert.equal(conversationHasFollowup({ id: "c1" }, pending), true);
  assert.equal(conversationHasFollowup({ id: "c2", inactivity_followup_at: "2026-01-01T00:00:00Z" }, pending), true);
  assert.equal(conversationHasFollowup({ id: "c3" }, pending), false);
});
