import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUazapiMessageId } from "../../src/lib/message-wa-status.ts";

test("extractUazapiMessageId", () => {
  assert.equal(extractUazapiMessageId({ messageid: "abc" }), "abc");
  assert.equal(extractUazapiMessageId({ message: { id: "x1" } }), "x1");
  assert.equal(extractUazapiMessageId(null), null);
});
