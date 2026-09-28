import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestTransferStageId } from "../../src/lib/transfer-stage-suggest.ts";

const stages = [
  { id: "s1", name: "Sem interesse", position: 0 },
  { id: "s2", name: "Em contato", position: 1 },
  { id: "s3", name: "Perdido", position: 2 },
];

test("suggestTransferStageId: nome igual", () => {
  assert.equal(suggestTransferStageId("Em contato", stages), "s2");
});

test("suggestTransferStageId: em contato sem nome igual no destino", () => {
  const peer = [
    { id: "a", name: "Sem interesse", position: 0 },
    { id: "b", name: "Negociando", position: 1 },
    { id: "c", name: "Em Contato com lead", position: 2 },
  ];
  assert.equal(suggestTransferStageId("Em contato", peer), "c");
});

test("suggestTransferStageId: sem match não usa primeira coluna", () => {
  const peer = [
    { id: "a", name: "Sem interesse", position: 0 },
    { id: "b", name: "Fechado", position: 1 },
  ];
  assert.equal(suggestTransferStageId("Qualificação", peer), null);
});
