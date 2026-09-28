import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAG_FILTER_NONE,
  conversationMatchesTagFilter,
  parseTagFilters,
  toggleTagFilter,
} from "../../src/lib/tag-filter.ts";

test("parseTagFilters: legacy tagFilter string", () => {
  assert.deepEqual(parseTagFilters(undefined, "tag-1"), ["tag-1"]);
  assert.deepEqual(parseTagFilters(undefined, "all"), []);
});

test("conversationMatchesTagFilter", () => {
  assert.equal(conversationMatchesTagFilter(["a"], []), true);
  assert.equal(conversationMatchesTagFilter(["a"], ["a"]), true);
  assert.equal(conversationMatchesTagFilter(["a"], ["b"]), false);
  assert.equal(conversationMatchesTagFilter(["a", "b"], ["b", "c"]), true);
  assert.equal(conversationMatchesTagFilter([], [TAG_FILTER_NONE]), true);
  assert.equal(conversationMatchesTagFilter(["a"], [TAG_FILTER_NONE]), false);
});

test("toggleTagFilter: sem tags exclui outras", () => {
  assert.deepEqual(toggleTagFilter(["t1"], TAG_FILTER_NONE), [TAG_FILTER_NONE]);
  assert.deepEqual(toggleTagFilter([TAG_FILTER_NONE], "t1"), ["t1"]);
});
