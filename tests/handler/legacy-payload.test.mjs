import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../_harness/edge-shim.mjs";
import { status, adminClient } from "../_harness/db.mjs";
import { installFetchStub, restoreFetch } from "../_harness/fetch-stub.mjs";
import { createUser } from "../_harness/sessions.mjs";

const s = status();
process.env.SUPABASE_URL = s.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = s.SERVICE_ROLE_KEY;

// Snapshot congela o corpo que o CAMINHO LEGADO manda pra Groq (AC-A12): a referência com a
// qual T9-T17 (rewrite do cérebro) vão ter que justificar toda diferença — tools/response_format
// adicionados de propósito, nunca por acidente. Escrito ANTES de T2 tocar em index.ts/handle.ts.
const SNAPSHOT_PATH = fileURLToPath(new URL("./__snapshots__/legacy-groq-body.json", import.meta.url));

const webhookUrl = new URL("../../supabase/functions/whatsapp-webhook/index.ts", import.meta.url);
await import(webhookUrl.href);
const handler = globalThis.__dcLastHandler;

// Capturado no load do módulo, não dentro do teste: se este arquivo ganhar um 2º teste que
// instale um stub sem `restoreFetch()` no finally, um `realFetch` capturado tarde herdaria o
// stub alheio em vez do fetch de verdade — reabriria em silêncio o bug de instância "não
// encontrada" já achado e corrigido nesta task (achado do code-review de T2).
const realFetch = globalThis.fetch;

const PHONE = "5511999990000";
// `whatsapp_instances.instance_token` não é UNIQUE no schema — um valor fixo colide com
// linhas de runs anteriores não limpas e `.maybeSingle()` devolve null (achado desta task).
const INSTANCE_TOKEN = `test-instance-token-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function seedTenant() {
  const admin = adminClient();
  const user = await createUser("t2-legacy");

  await admin.from("whatsapp_instances").insert({
    user_id: user.id,
    name: "t2-instance",
    instance_token: INSTANCE_TOKEN,
    server_url: "https://uazapi.example.test",
    status: "connected",
  });

  // business_context DELIBERADAMENTE null — é o caso que o AC-A12 pede ("tenant sem business_context").
  await admin.from("agent_configs").insert({
    user_id: user.id,
    groq_api_key: "test-groq-key",
    groq_model: "auto",
    business_context: null,
    enabled: true,
  });

  const { data: conv, error } = await admin
    .from("conversations")
    .insert({ user_id: user.id, contact_phone: PHONE, ai_enabled: true })
    .select()
    .single();
  if (error) throw new Error(`seed conversation falhou: ${error.message}`);

  // 19 mensagens de histórico + a 20ª entra quando o webhook processa o inbound do teste.
  // `created_at` explícito e crescente: um insert em lote dá a todas o mesmo default `now()`,
  // e o desempate de `order by created_at` vira arbitrário (não cronológico) — já pegou isso
  // uma vez nesta task (ver commit/HANDOFF).
  const base = Date.now() - 19 * 60_000;
  const history = Array.from({ length: 19 }, (_, i) => ({
    conversation_id: conv.id,
    user_id: user.id,
    direction: i % 2 === 0 ? "inbound" : "outbound",
    sender: i % 2 === 0 ? "contact" : "ai",
    content: `mensagem de histórico #${i + 1}`,
    created_at: new Date(base + i * 60_000).toISOString(),
  }));
  const { error: histErr } = await admin.from("messages").insert(history);
  if (histErr) throw new Error(`seed histórico falhou: ${histErr.message}`);

  return user;
}

function installStubs() {
  let capturedChatBody = null;
  // `createClient` (Supabase) usa `fetch` por baixo pras próprias chamadas REST do handler
  // (achar instância/conversa, gravar mensagem). Sem passthrough pra API_URL local, o
  // fetch-stub (fail-closed por design, T1) rejeitaria essas chamadas também — e o supabase-js
  // engole o throw como `{data: null, error}`, o que aparecia como "instância não encontrada"
  // em vez de um erro de rede óbvio.
  const stop = installFetchStub([
    {
      match: (url) => url.startsWith(s.API_URL),
      respond: (url, init) => realFetch(url, init),
    },
    {
      match: (url) => url.includes("api.groq.com/openai/v1/models"),
      respond: () =>
        new Response(
          JSON.stringify({ data: [{ id: "llama-3.1-8b-instant", active: true, context_window: 8192 }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
    {
      match: (url) => url.includes("api.groq.com/openai/v1/chat/completions"),
      respond: (_url, init) => {
        capturedChatBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "Resposta simulada" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
    {
      match: (url) => url.includes("uazapi.example.test"),
      respond: () =>
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
    },
  ]);
  return { stop, getCaptured: () => capturedChatBody };
}

test("T2 (H): payload legado enviado à Groq bate com o snapshot congelado (AC-A12)", async () => {
  await seedTenant();
  const { stop, getCaptured } = installStubs();

  try {
    const req = new Request("http://localhost/whatsapp-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        EventType: "messages",
        token: INSTANCE_TOKEN,
        message: {
          text: "Mensagem de teste do cliente",
          fromMe: false,
          chatid: `${PHONE}@s.whatsapp.net`,
        },
        chat: {},
      }),
    });
    const res = await handler(req);
    assert.equal(res.status, 200);

    const captured = getCaptured();
    assert.ok(captured, "webhook não chegou a chamar a Groq — algo na resolução de instância/tenant quebrou");
    assert.equal(captured.messages.length, 21, "system prompt + 20 mensagens de histórico (19 seed + 1 inbound)");
    assert.ok(!("tools" in captured), "caminho legado nunca manda `tools` — se isto falhar, o legado mudou de comportamento");
    assert.ok(!("response_format" in captured), "caminho legado nunca manda `response_format`");

    if (!existsSync(SNAPSHOT_PATH)) {
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(captured, null, 2) + "\n");
      return;
    }
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    assert.deepEqual(captured, snapshot, "corpo mandado à Groq no caminho legado divergiu do snapshot congelado");
  } finally {
    stop();
  }
});
