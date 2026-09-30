import { test } from "node:test";
import assert from "node:assert/strict";
import { callAI } from "../../supabase/functions/_shared/get-ai-config.ts";
import { installFetchStub, restoreFetch } from "../_harness/fetch-stub.mjs";

const tool = {
  type: "function",
  function: { name: "consultar", description: "Consulta dados", parameters: { type: "object", properties: { tema: { type: "string" } }, required: ["tema"] } },
};
const messages = [
  { role: "system", content: "Responda em JSON." },
  { role: "user", content: "Consulte o preço." },
  { role: "assistant", content: null, tool_calls: [
    { id: "call-1", type: "function", function: { name: "consultar", arguments: '{"tema":"preço"}' } },
    { id: "call-1b", type: "function", function: { name: "consultar", arguments: '{"tema":"prazo"}' } },
  ] },
  { role: "tool", tool_call_id: "call-1", content: "R$ 20" },
  { role: "tool", tool_call_id: "call-1b", content: "amanhã" },
];

test("OpenAI recebe tools e normaliza uma chamada de função", async () => {
  let request;
  installFetchStub([{
    match: (url) => url === "https://api.openai.com/v1/chat/completions",
    respond: (_url, init) => {
      request = { headers: init.headers, body: JSON.parse(init.body) };
      return Response.json({ choices: [{ message: { tool_calls: [{ id: "call-2", type: "function", function: { name: "consultar", arguments: '{"tema":"preço"}' } }] } }] });
    },
  }]);
  try {
    const result = await callAI("openai", "openai-secret", "gpt-test", messages, { tools: [tool] });
    assert.equal(request.headers.Authorization, "Bearer openai-secret");
    assert.equal(request.body.tools[0].function.name, "consultar");
    assert.equal(result.toolCalls[0].function.name, "consultar");
  } finally { restoreFetch(); }
});

test("Gemini traduz tool calls e respostas para o formato functionCall", async () => {
  let request;
  installFetchStub([{
    match: (url) => url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:"),
    respond: (_url, init) => {
      request = { headers: init.headers, body: JSON.parse(init.body) };
      return Response.json({ candidates: [{ content: { parts: [{ functionCall: { name: "consultar", args: { tema: "prazo" } } }] } }] });
    },
  }]);
  try {
    const result = await callAI("gemini", "google-secret", "gemini-test", messages, { tools: [tool] });
    assert.equal(request.headers["x-goog-api-key"], "google-secret");
    assert.equal(request.body.systemInstruction.parts[0].text, "Responda em JSON.");
    assert.equal(request.body.contents[2].parts[0].functionResponse.name, "consultar");
    assert.equal(request.body.contents[2].parts.length, 2);
    assert.equal(result.toolCalls[0].function.arguments, '{"tema":"prazo"}');
  } finally { restoreFetch(); }
});

test("Claude traduz tools e preserva a resposta de ferramenta", async () => {
  let request;
  installFetchStub([{
    match: (url) => url === "https://api.anthropic.com/v1/messages",
    respond: (_url, init) => {
      request = { headers: init.headers, body: JSON.parse(init.body) };
      return Response.json({ content: [{ type: "tool_use", id: "toolu-2", name: "consultar", input: { tema: "estoque" } }] });
    },
  }]);
  try {
    const result = await callAI("claude", "claude-secret", "claude-test", messages, { tools: [tool] });
    assert.equal(request.headers["x-api-key"], "claude-secret");
    assert.equal(request.body.system, "Responda em JSON.");
    assert.equal(request.body.tools[0].input_schema.required[0], "tema");
    assert.equal(request.body.messages[2].content[0].tool_use_id, "call-1");
    assert.equal(request.body.messages[2].content.length, 2);
    assert.equal(result.toolCalls[0].function.name, "consultar");
  } finally { restoreFetch(); }
});
