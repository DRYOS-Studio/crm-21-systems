import { test } from "node:test";
import assert from "node:assert/strict";
import {
  P_PULAR,
  podeDispararAgora,
  tetoEfetivo,
  atingiuTeto,
  proximoToque,
  freio,
  devePularTick,
  sortearVariacao,
  montarToque1,
} from "../../supabase/functions/_shared/outreach.ts";

// 2026-09-24 quinta; 26 sáb; 27 dom. SP = UTC-3.
const qui859 = new Date("2026-09-24T11:59:00.000Z");
const qui900 = new Date("2026-09-24T12:00:00.000Z");
const qui1759 = new Date("2026-09-24T20:59:00.000Z");
const qui1800 = new Date("2026-09-24T21:00:00.000Z");
const sab1259 = new Date("2026-09-26T15:59:00.000Z");
const sab1300 = new Date("2026-09-26T16:00:00.000Z");
const sab900 = new Date("2026-09-26T12:00:00.000Z");
const dom1200 = new Date("2026-09-27T15:00:00.000Z");

test("AC-B5: fronteiras SP (não UTC)", () => {
  assert.equal(podeDispararAgora(qui859), false, "8:59");
  assert.equal(podeDispararAgora(qui900), true, "9:00");
  assert.equal(podeDispararAgora(qui1759), true, "17:59");
  assert.equal(podeDispararAgora(qui1800), false, "18:00");
  assert.equal(podeDispararAgora(qui900, {}), true);
  // 12:00 UTC seria 9:00 SP — se alguém usasse getUTCHours() == 9, 12:00 UTC passaria no UTC e falharia o 9:00 SP.
  const utc9 = new Date("2026-09-24T09:00:00.000Z"); // 6:00 SP
  assert.equal(podeDispararAgora(utc9), false, "9:00 UTC não é 9:00 SP");
});

test("AC-B5: sábado e domingo", () => {
  assert.equal(podeDispararAgora(sab900), false, "sáb sem flag");
  assert.equal(podeDispararAgora(sab900, { saturdayMorning: true }), true);
  assert.equal(podeDispararAgora(sab1259, { saturdayMorning: true }), true);
  assert.equal(podeDispararAgora(sab1300, { saturdayMorning: true }), false);
  assert.equal(podeDispararAgora(dom1200, { saturdayMorning: true }), false);
});

test("AC-B6: rampa semanas 0/1/6 e antes do 1º envio", () => {
  assert.equal(tetoEfetivo(40, null, "2026-09-24"), 10);
  assert.equal(tetoEfetivo(8, null, "2026-09-24"), 8);
  assert.equal(tetoEfetivo(40, "2026-09-24", "2026-09-24"), 10, "semana 0");
  assert.equal(tetoEfetivo(40, "2026-09-24", "2026-10-01"), 15, "semana 1");
  assert.equal(tetoEfetivo(40, "2026-09-24", "2026-11-05"), 40, "semana 6");
  assert.equal(tetoEfetivo(20, "2026-09-24", "2026-11-05"), 20, "cap corta a rampa");
  assert.equal(tetoEfetivo(0, null, "2026-09-24"), 0, "sem max(1) do original");
});

test("AC-B7: enviados ≥ teto", () => {
  assert.equal(atingiuTeto(9, 10), false);
  assert.equal(atingiuTeto(10, 10), true);
  assert.equal(atingiuTeto(11, 10), true);
});

test("AC-B9: cadência +3 / +7 / sem 4º", () => {
  assert.equal(proximoToque(1, "2026-09-24"), "2026-09-27");
  assert.equal(proximoToque(2, "2026-09-27"), "2026-10-04");
  assert.equal(proximoToque(3, "2026-10-04"), null);
  assert.equal(proximoToque(4, "2026-10-04"), null);
});

test("AC-B10: freio 30×1 vs 30×2", () => {
  const um = freio({ enviados: 30, responderam: 1 });
  assert.equal(um.pausar, true);
  assert.ok(um.motivo);
  const dois = freio({ enviados: 30, responderam: 2 });
  assert.equal(dois.pausar, false);
  assert.equal(freio({ enviados: 29, responderam: 0 }).pausar, false);
});

test("AC-B17: RNG injetado decide o pulo", () => {
  assert.equal(devePularTick(() => 0), true);
  assert.equal(devePularTick(() => P_PULAR - 1e-9), true);
  assert.equal(devePularTick(() => P_PULAR), false);
  assert.equal(devePularTick(() => 0.99), false);
  assert.ok(P_PULAR > 0, "pular com probabilidade 0 vira intervalo fixo de 60s");
});

test("AC-B21: placeholders e vazio sem literal", () => {
  assert.equal(
    montarToque1("Oi {nome}, sou da {empresa}", { nome: "Ana" }, "Clínica X"),
    "Oi Ana, sou da Clínica X",
  );
  const semNome = montarToque1("Oi {nome}, sou da {empresa}", { nome: "" }, "Clínica X");
  assert.equal(semNome.includes("{nome}"), false);
  assert.equal(semNome.includes("{empresa}"), false);
  assert.ok(semNome.includes("Clínica X"));
  const semTudo = montarToque1("Oi {nome}, tudo bem?", { nome: null }, null);
  assert.equal(semTudo.includes("{nome}"), false);
  assert.match(semTudo, /tudo bem\?/);
});

test("AC-B23: 10 toques 1 usam mais de uma variação", () => {
  const vars = ["A", "B", "C"];
  const seq = [0.05, 0.4, 0.8, 0.1, 0.55, 0.9, 0.2, 0.65, 0.35, 0.75];
  let i = 0;
  const picked = seq.map(() => sortearVariacao(vars, () => seq[i++]));
  assert.ok(new Set(picked).size > 1, String(picked));
});
