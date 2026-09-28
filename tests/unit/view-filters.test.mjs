import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VIEW_FILTERS,
  conversationMatchesInstanceFilter,
  INSTANCE_FILTER_NONE,
  parseViewFilters,
  serializeViewFilters,
  viewFiltersKey,
} from "../../src/lib/view-filters.ts";

test("parseViewFilters: vazio e lixo caem no default", () => {
  assert.deepEqual(parseViewFilters(null), DEFAULT_VIEW_FILTERS);
  assert.deepEqual(parseViewFilters(""), DEFAULT_VIEW_FILTERS);
  assert.deepEqual(parseViewFilters("{nope"), DEFAULT_VIEW_FILTERS);
  assert.deepEqual(parseViewFilters("[]"), DEFAULT_VIEW_FILTERS);
});

test("parseViewFilters: ignora chip inválido e campos vazios", () => {
  assert.equal(parseViewFilters(JSON.stringify({ inboxFilter: "xyz" })).inboxFilter, "todas");
  assert.deepEqual(parseViewFilters(JSON.stringify({ tagFilters: [] })).tagFilters, []);
  assert.deepEqual(parseViewFilters(JSON.stringify({ tagFilter: "tag-x" })).tagFilters, ["tag-x"]);
  assert.equal(parseViewFilters(JSON.stringify({ userFilter: 12 })).userFilter, "all");
});

test("parseViewFilters: round-trip preserva escolha válida", () => {
  const saved = {
    inboxFilter: "responder",
    tagFilters: ["tag-1"],
    userFilter: "user-9",
    instanceFilter: "inst-42",
    followupOnly: true,
  };
  assert.deepEqual(parseViewFilters(serializeViewFilters(saved)), saved);
});

test("parseViewFilters: instanceFilter inválido cai em all", () => {
  assert.equal(parseViewFilters(JSON.stringify({ instanceFilter: "" })).instanceFilter, "all");
});

test("conversationMatchesInstanceFilter", () => {
  const inst = [
    { id: "dev-a", user_id: "u1" },
    { id: "dev-b", user_id: "u2" },
  ];
  assert.equal(conversationMatchesInstanceFilter("dev-a", "all", "u1", inst), true);
  assert.equal(conversationMatchesInstanceFilter("dev-a", "dev-a", "u1", inst), true);
  assert.equal(conversationMatchesInstanceFilter("dev-b", "dev-a", "u1", inst), false);
  assert.equal(conversationMatchesInstanceFilter(null, INSTANCE_FILTER_NONE, "u1", inst), true);
  assert.equal(conversationMatchesInstanceFilter("dev-a", INSTANCE_FILTER_NONE, "u1", inst), false);
  assert.equal(conversationMatchesInstanceFilter(null, "dev-a", "u1", inst), true);
  assert.equal(conversationMatchesInstanceFilter(null, "dev-a", "u2", inst), false);
});

test("viewFiltersKey isola por login", () => {
  assert.equal(viewFiltersKey("abc"), "q7:view-filters:abc");
});
