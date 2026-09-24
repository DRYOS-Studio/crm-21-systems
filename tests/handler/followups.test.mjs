// T16: run-followups (design.md §4.3). H — Postgres real, Groq/Uazapi stubados.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../_harness/edge-shim.mjs";
import { status, adminClient } from "../_harness/db.mjs";
import { installFetchStub } from "../_harness/fetch-stub.mjs";
import { createUser } from "../_harness/sessions.mjs";
import { handle } from "../../supabase/functions/run-followups/handle.ts";

const s = status();
process.env.SUPABASE_URL = s.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = s.SERVICE_ROLE_KEY;
const realFetch = globalThis.fetch;

const FALLBACK = "Oi! Só passando pra saber se ainda posso te ajudar com alguma coisa por aqui. 🙂";

let seq = 0;
function phone() {
  seq++;
  return `55119${(8_0000_000 + (Date.now() % 1_0000_000) + seq).toString().slice(-8)}`;
}

async function seedTenant(admin, prefix, { businessContext = null, waPhone = null } = {}) {
  const user = await createUser(prefix);
  const serverUrl = `https://uazapi-${prefix}-${Date.now()}.example.test`;
  const { data: inst, error: instErr } = await admin
    .from("whatsapp_instances")
    .insert({
      user_id: user.id,
      name: `${prefix}-inst`,
      instance_token: `tok-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      server_url: serverUrl,
      status: "connected",
    })
    .select()
    .single();
  if (instErr) throw new Error(`seed instance falhou: ${instErr.message}`);

  const { error: agentErr } = await admin.from("agent_configs").insert({
    user_id: user.id,
    groq_api_key: "test-groq-key",
    groq_model: "auto",
    business_context: businessContext,
    enabled: true,
  });
  if (agentErr) throw new Error(`seed agent falhou: ${agentErr.message}`);

  const contact = phone();
  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .insert({
      user_id: user.id,
      instance_id: inst.id,
      contact_phone: contact,
      wa_phone: waPhone,
      ai_enabled: true,
      ai_stage: "descobrir",
    })
    .select()
    .single();
  if (convErr) throw new Error(`seed conversation falhou: ${convErr.message}`);

  return { user, inst, conv, serverUrl, contact };
}

async function seedDue(admin, conv, { kind = "auto_inactivity", textOverride = null } = {}) {
  const { data, error } = await admin
    .from("followups")
    .insert({
      user_id: conv.user_id,
      conversation_id: conv.id,
      send_at: new Date(Date.now() - 1000).toISOString(),
      status: "pending",
      kind,
      text_override: textOverride,
    })
    .select()
    .single();
  if (error) throw new Error(`seed followup falhou: ${error.message}`);
  return data;
}

function passthroughApi() {
  return { match: (url) => url.startsWith(s.API_URL), respond: (url, init) => realFetch(url, init) };
}
function stubGroqModels() {
  return {
    match: (url) => url.includes("api.groq.com/openai/v1/models"),
    respond: () =>
      new Response(JSON.stringify({ data: [{ id: "llama-3.1-8b-instant", active: true, context_window: 8192 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  };
}
function chatOk(o = {}) {
  const payload = {
    mensagens: ["sumiu por aí?"],
    etapa: "descobrir",
    qualificacao: {},
    qualificado: false,
    resumo: null,
    optout: false,
    escalar: false,
    motivo_escalar: null,
    ...o,
  };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
function stubUazapi(serverUrl, onSend) {
  return {
    match: (url) => url.startsWith(serverUrl),
    respond: (_url, init) => {
      onSend?.(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  };
}

function post() {
  return handle(new Request("http://localhost/run-followups", { method: "POST" }));
}

test("T16 AC-A5d: optout relido antes do envio cancela qualquer kind, sem mandar", async () => {
  const admin = adminClient();
  const { conv, serverUrl } = await seedTenant(admin, "t16-a5d");
  await seedDue(admin, conv, { kind: "auto_inactivity", textOverride: "auto oi" });
  await seedDue(admin, conv, { kind: "manual", textOverride: "oi de novo" });
  await admin.from("conversations").update({ optout: true }).eq("id", conv.id);

  const sent = [];
  const stop = installFetchStub([passthroughApi(), stubGroqModels(), stubUazapi(serverUrl, (b) => sent.push(b))]);
  try {
    const res = await post();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.processed, 0);
    assert.equal(sent.length, 0, "não deveria ter enviado nada: " + JSON.stringify(sent));
    const { data: fups } = await admin.from("followups").select("status, kind").eq("conversation_id", conv.id);
    assert.ok(fups.every((f) => f.status === "cancelled"), JSON.stringify(fups));
  } finally {
    stop();
  }
});

test("T16 AC-A17: modo novo usa runBrainTurn; Groq falhando mantém o fallback", async () => {
  const admin = adminClient();
  const { conv, serverUrl } = await seedTenant(admin, "t16-a17-fail", {
    businessContext: "Vendemos treinamento de vendas.",
  });
  await seedDue(admin, conv);

  const sent = [];
  let groqBodies = [];
  const stop = installFetchStub([
    passthroughApi(),
    stubGroqModels(),
    {
      match: (url) => url.includes("api.groq.com/openai/v1/chat/completions"),
      respond: (_url, init) => {
        groqBodies.push(JSON.parse(init.body));
        return new Response("upstream down", { status: 500 });
      },
    },
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    const res = await post();
    assert.equal(res.status, 200);
    assert.ok(groqBodies.length > 0, "modo novo deveria ter chamado a Groq via runBrainTurn");
    assert.ok("tools" in groqBodies[0], "runBrainTurn manda tools — se não mandou, caiu no legado");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, FALLBACK);
    const { data: fup } = await admin.from("followups").select("status").eq("conversation_id", conv.id).single();
    assert.equal(fup.status, "sent");
  } finally {
    stop();
  }
});

test("T16 AC-A17: modo novo envia só a 1ª bolha do runBrainTurn e não comita etapa", async () => {
  const admin = adminClient();
  const { conv, serverUrl } = await seedTenant(admin, "t16-a17-ok", {
    businessContext: "Vendemos treinamento de vendas.",
  });
  await admin.from("conversations").update({ ai_stage: "descobrir", qualification: { nome: "Ana" } }).eq("id", conv.id);
  await seedDue(admin, conv);

  const sent = [];
  const stop = installFetchStub([
    passthroughApi(),
    stubGroqModels(),
    {
      match: (url) => url.includes("api.groq.com/openai/v1/chat/completions"),
      respond: () => chatOk({ mensagens: ["ainda tá aí?", "segunda bolha não sai"], etapa: "descobrir" }),
    },
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    const res = await post();
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, "ainda tá aí?");
    const after = (await admin.from("conversations").select("ai_stage, qualification").eq("id", conv.id).single()).data;
    assert.equal(after.ai_stage, "descobrir", "reengajamento não comita estado");
    assert.equal(after.qualification?.nome, "Ana");
  } finally {
    stop();
  }
});

test("T16: legado (sem business_context) não manda tools e envia pro wa_phone", async () => {
  const admin = adminClient();
  const wa = phone();
  const { conv, serverUrl, contact } = await seedTenant(admin, "t16-legado", { businessContext: null, waPhone: wa });
  await seedDue(admin, conv, { kind: "auto_inactivity" });

  const sent = [];
  let captured = null;
  const stop = installFetchStub([
    passthroughApi(),
    stubGroqModels(),
    {
      match: (url) => url.includes("api.groq.com/openai/v1/chat/completions"),
      respond: (_url, init) => {
        captured = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: "sumiu?" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    const res = await post();
    assert.equal(res.status, 200);
    assert.ok(captured, "legado não chamou Groq");
    assert.ok(!("tools" in captured), "legado não manda tools");
    assert.ok(!("response_format" in captured));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].number, wa);
    assert.notEqual(sent[0].number, contact);
    assert.equal(sent[0].text, "sumiu?");
  } finally {
    stop();
  }
});
