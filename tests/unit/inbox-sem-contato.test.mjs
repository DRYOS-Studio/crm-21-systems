import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationSemContato } from "../../src/lib/inbox.ts";

test("conversationSemContato: sem inbound e fora de Em contato", () => {
  const emContato = new Set(["stage-em"]);
  assert.equal(conversationSemContato("c1", "stage-novo", {}, emContato), true);
  assert.equal(conversationSemContato("c1", "stage-em", {}, emContato), false);
  assert.equal(conversationSemContato("c1", null, { c1: "2026-01-01" }, emContato), false);
});
