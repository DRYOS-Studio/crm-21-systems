// T9: GroqResult (status/code/rawBody), timeout e opções de cadeia (maxModels/exclude).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFetchStub, restoreFetch, jsonOnce } from "../_harness/fetch-stub.mjs";
import { callGroqOnce, callGroq, listChatModels } from "../../supabase/functions/_shared/get-ai-config.ts";

const MODELS_BODY = {
  data: [
    { id: "llama-3.1-8b-instant", active: true, context_window: 128000 },
    { id: "llama-3.3-70b-versatile", active: true, context_window: 128000 },
    { id: "openai/gpt-oss-20b", active: true, context_window: 128000 },
    { id: "qwen/qwen3.6-27b", active: true, context_window: 128000 },
    { id: "openai/gpt-oss-120b", active: true, context_window: 128000 },
    { id: "groq/compound-mini", active: true, context_window: 128000 },
  ],
};

test("callGroqOnce: 400 tool_use_failed expõe code e rawBody sem o header de auth", async () => {
  installFetchStub([
    jsonOnce("api.groq.com/openai/v1/chat/completions", { error: { message: "tool call failed", code: "tool_use_failed" } }, { status: 400 }),
  ]);
  try {
    const r = await callGroqOnce("segredo-nao-pode-vazar", "openai/gpt-oss-120b", [{ role: "user", content: "oi" }]);
    assert.equal(r.ok, false);
    assert.equal(r.code, "tool_use_failed");
    assert.equal(r.status, 400);
    assert.ok(r.rawBody, "rawBody ausente");
    assert.ok(!r.rawBody.includes("segredo-nao-pode-vazar"), "rawBody vazou a chave/header de auth");
    assert.ok(!r.rawBody.includes("Bearer"), "rawBody vazou o header de auth");
  } finally {
    restoreFetch();
  }
});

test("callGroqOnce: corpo não-JSON não quebra e não gera code", async () => {
  installFetchStub([
    { match: (url) => url.includes("api.groq.com/openai/v1/chat/completions"), respond: () => new Response("upstream caiu", { status: 500 }) },
  ]);
  try {
    const r = await callGroqOnce("k", "m", [{ role: "user", content: "oi" }]);
    assert.equal(r.ok, false);
    assert.equal(r.code, undefined);
    assert.equal(r.rawBody, "upstream caiu");
  } finally {
    restoreFetch();
  }
});

test("callGroq: maxModels limita quantas tentativas a cadeia faz", async () => {
  let calls = 0;
  installFetchStub([
    jsonOnce("api.groq.com/openai/v1/models", MODELS_BODY),
    {
      match: (url) => url.includes("api.groq.com/openai/v1/chat/completions"),
      respond: () => {
        calls++;
        return new Response(JSON.stringify({ error: { code: "rate_limit" } }), { status: 429 });
      },
    },
  ]);
  try {
    const r = await callGroq("k", "auto", [{ role: "user", content: "oi" }], { maxModels: 2 });
    assert.equal(r.ok, false);
    assert.equal(calls, 2, "chamou "+calls+" vezes, esperado 2");
    assert.equal(r.tried.length, 2);
  } finally {
    restoreFetch();
  }
});

test("callGroq: exclude tira groq/compound* da cadeia", async () => {
  installFetchStub([
    jsonOnce("api.groq.com/openai/v1/models", MODELS_BODY),
    jsonOnce("api.groq.com/openai/v1/chat/completions", { choices: [{ message: { content: "ok" } }] }),
  ]);
  try {
    const r = await callGroq("k", "groq/compound-mini", [{ role: "user", content: "oi" }], { exclude: ["groq/compound"] });
    assert.equal(r.ok, true);
    assert.ok(!r.tried.includes("groq/compound-mini"), "tentou um modelo excluído: " + JSON.stringify(r.tried));
  } finally {
    restoreFetch();
  }
});

test("listChatModels: timeout usa AbortSignal (request chega com signal setado)", async () => {
  let sawSignal = false;
  installFetchStub([
    {
      match: (url) => url.includes("api.groq.com/openai/v1/models"),
      respond: (_url, init) => {
        sawSignal = init?.signal instanceof AbortSignal;
        return new Response(JSON.stringify(MODELS_BODY), { status: 200 });
      },
    },
  ]);
  try {
    await listChatModels("k-signal-check");
    assert.ok(sawSignal, "listChatModels não passou AbortSignal pro fetch");
  } finally {
    restoreFetch();
  }
});
