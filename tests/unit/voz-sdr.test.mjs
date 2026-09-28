import { test } from "node:test";
import assert from "node:assert/strict";
import "../_harness/edge-shim.mjs";
import { ajustarFalaFeminina, sdrFalaNoFeminino } from "../../supabase/functions/_shared/voz-sdr.ts";

test("sdrFalaNoFeminino: Edith / GÊNERO feminino", () => {
  assert.equal(sdrFalaNoFeminino("NOME DO SDR: Edith\nGÊNERO: feminino"), true);
  assert.equal(sdrFalaNoFeminino("Você é a Edith"), true);
  assert.equal(sdrFalaNoFeminino("GÊNERO: masculino\nNOME DO SDR: Edith"), false);
  assert.equal(sdrFalaNoFeminino("Vendemos treinamento."), false);
});

test("ajustarFalaFeminina: tira estou ótimo e flexiona", () => {
  assert.equal(
    ajustarFalaFeminina("Estou ótimo! Ainda fazem inicial no dedo?"),
    "Ainda fazem inicial no dedo?",
  );
  assert.equal(ajustarFalaFeminina("Obrigado pelo retorno"), "Obrigada pelo retorno");
  assert.equal(ajustarFalaFeminina("Estou pronto, te falo"), "estou pronta, te falo");
  assert.equal(ajustarFalaFeminina("fico grato pela confiança"), "fico grata pela confiança");
  assert.equal(
    ajustarFalaFeminina("Olá, tudo bem? Sou a Edith, da DRYOS."),
    "Sou a Edith, da DRYOS.",
  );
});
