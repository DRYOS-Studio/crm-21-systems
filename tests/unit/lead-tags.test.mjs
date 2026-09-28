import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTagName, nextTagColor, tagBadgeVariant } from "../../src/lib/lead-tags.ts";

test("normalizeTagName: trim, colapsa espaço, corta 32", () => {
  assert.equal(normalizeTagName("  Quente  "), "Quente");
  assert.equal(normalizeTagName("muito    quente"), "muito quente");
  assert.equal(normalizeTagName("x".repeat(40)).length, 32);
  assert.equal(normalizeTagName("   "), "");
});

test("nextTagColor cicla as 6 pills", () => {
  assert.equal(nextTagColor(0), "oak");
  assert.equal(nextTagColor(5), "critical");
  assert.equal(nextTagColor(6), "oak");
});

test("tagBadgeVariant cai em oak se a cor for desconhecida", () => {
  assert.equal(tagBadgeVariant("ok"), "ok");
  assert.equal(tagBadgeVariant("nope"), "oak");
  assert.equal(tagBadgeVariant(null), "oak");
});
