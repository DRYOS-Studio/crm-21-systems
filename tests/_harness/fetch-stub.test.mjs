import { test } from "node:test";
import assert from "node:assert/strict";
import { installFetchStub, restoreFetch, jsonOnce } from "./fetch-stub.mjs";

test("fetch-stub: request casada devolve a resposta canned", async () => {
  installFetchStub([jsonOnce("api.groq.com", { ok: true })]);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    restoreFetch();
  }
});

test("fetch-stub: request sem entrada casada é recusada (fail-closed), nunca vai pra rede real", async () => {
  installFetchStub([jsonOnce("api.groq.com", { ok: true })]);
  try {
    await assert.rejects(() => fetch("https://outra-url-qualquer.example/x"), /fail-closed/);
  } finally {
    restoreFetch();
  }
});
