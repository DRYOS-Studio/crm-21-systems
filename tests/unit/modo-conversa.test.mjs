import { test } from "node:test";
import assert from "node:assert/strict";
import "../_harness/edge-shim.mjs";
import { modoDaConversa, nosEscrevemosPrimeiro } from "../../supabase/functions/_shared/modo-conversa.ts";

test("nós escrevemos o olá primeiro: nunca vira receptivo", () => {
  const history = [
    { role: "assistant", content: "Olá, tudo bem?" },
    { role: "user", content: "Tudo bem?" },
  ];
  assert.equal(nosEscrevemosPrimeiro(history), true);
  const modo = modoDaConversa("descobrir", history);
  assert.match(modo, /abordagem/);
  assert.doesNotMatch(modo, /receptivo \(atendimento\)/);
});

test("ela chegou falando: receptivo", () => {
  const history = [{ role: "user", content: "Oi" }];
  assert.equal(nosEscrevemosPrimeiro(history), false);
  assert.match(modoDaConversa("descobrir", history), /receptivo/);
});

test("etapa abordar sozinha já trava abordagem", () => {
  assert.match(modoDaConversa("abordar", []), /abordagem/);
});
