import assert from "node:assert/strict";
import test from "node:test";
import { usableAvatarUrl } from "../../src/lib/contact-avatar.ts";

test("usableAvatarUrl accepts https only", () => {
  assert.equal(usableAvatarUrl("https://pps.whatsapp.net/x.jpg"), "https://pps.whatsapp.net/x.jpg");
  assert.equal(usableAvatarUrl("  "), null);
  assert.equal(usableAvatarUrl(""), null);
  assert.equal(usableAvatarUrl("data:image/png;base64,abc"), null);
});
