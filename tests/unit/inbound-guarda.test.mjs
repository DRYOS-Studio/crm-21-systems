import { test } from "node:test";
import assert from "node:assert/strict";
import "../_harness/edge-shim.mjs";
import {
  aindaDigitando,
  debounceInboundMs,
  DEBOUNCE_INBOUND_MS_DEFAULT,
  pareceRespostaAutomatica,
} from "../../supabase/functions/_shared/inbound-guarda.ts";

test("debounceInboundMs: default 12s; 0 no teste", () => {
  assert.equal(debounceInboundMs(undefined), DEBOUNCE_INBOUND_MS_DEFAULT);
  assert.equal(debounceInboundMs(""), DEBOUNCE_INBOUND_MS_DEFAULT);
  assert.equal(debounceInboundMs("0"), 0);
  assert.equal(debounceInboundMs("80"), 80);
  assert.equal(debounceInboundMs("nao"), DEBOUNCE_INBOUND_MS_DEFAULT);
});

test("aindaDigitando: só o inbound mais novo responde", () => {
  assert.equal(aindaDigitando("a", "a"), false);
  assert.equal(aindaDigitando("a", "b"), true);
  assert.equal(aindaDigitando("a", null), false);
});

test("pareceRespostaAutomatica: templates do WhatsApp, não fala humana", () => {
  assert.equal(pareceRespostaAutomatica("Mensagem automática: estou fora do escritório"), true);
  assert.equal(pareceRespostaAutomatica("Esta é uma resposta automática. Retornaremos em breve."), true);
  assert.equal(pareceRespostaAutomatica("Olá! Obrigado por entrar em contato. Retornaremos assim que possível."), true);
  assert.equal(pareceRespostaAutomatica("Auto-reply: I am currently away"), true);
  assert.equal(pareceRespostaAutomatica("Não estou disponível"), true);
  assert.equal(pareceRespostaAutomatica("oi"), false);
  assert.equal(pareceRespostaAutomatica("estou ocupado amanhã, me liga depois"), false);
  assert.equal(pareceRespostaAutomatica("quanto custa?"), false);
  assert.equal(pareceRespostaAutomatica("[áudio]"), false);
});
