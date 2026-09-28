import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VIEW_FILTERS,
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
  assert.equal(parseViewFilters(JSON.stringify({ tagFilter: "" })).tagFilter, "all");
  assert.equal(parseViewFilters(JSON.stringify({ userFilter: 12 })).userFilter, "all");
});

test("parseViewFilters: round-trip preserva escolha válida", () => {
  const saved = {
    inboxFilter: "responder",
    tagFilter: "tag-1",
    userFilter: "user-9",
  };
  assert.deepEqual(parseViewFilters(serializeViewFilters(saved)), saved);
});

test("viewFiltersKey isola por login", () => {
  assert.equal(viewFiltersKey("abc"), "q7:view-filters:abc");
});
