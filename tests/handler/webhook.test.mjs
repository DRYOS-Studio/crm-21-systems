// T15: handle.ts (design.md §4.1). H — Postgres real, Groq/Uazapi stubados via fetch-stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "../_harness/edge-shim.mjs";
import { status, adminClient } from "../_harness/db.mjs";
import { installFetchStub } from "../_harness/fetch-stub.mjs";
import { createUser } from "../_harness/sessions.mjs";
import { handle } from "../../supabase/functions/whatsapp-webhook/handle.ts";
import { DESPEDIDA_OPTOUT } from "../../supabase/functions/_shared/turno.ts";

const s = status();
process.env.SUPABASE_URL = s.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = s.SERVICE_ROLE_KEY;
const realFetch = globalThis.fetch;

const SNAPSHOT_PATH = fileURLToPath(new URL("./__snapshots__/legacy-groq-body.json", import.meta.url));

let seq = 0;
function uniquePhone(base = "5511988") {
  seq++;
  return `${base}${(1_000_000 + (Date.now() % 1_000_000) + seq).toString().slice(-7)}`;
}

async function seedTenant(admin, prefix, opts = {}) {
  const user = await createUser(prefix);
  const serverUrl = `https://uazapi-${prefix}-${Date.now()}.example.test`;
  const instanceToken = `tok-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: inst, error: instErr } = await admin
    .from("whatsapp_instances")
    .insert({
      user_id: user.id,
      name: `${prefix}-inst`,
      instance_token: instanceToken,
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
    business_context: opts.businessContext === undefined ? null : opts.businessContext,
    owner_notify_phone: opts.ownerNotifyPhone ?? null,
    enabled: opts.enabled !== false,
  });
  if (agentErr) throw new Error(`seed agent falhou: ${agentErr.message}`);

  let secret = null;
  if (opts.withSecret) {
    const { data, error } = await admin.rpc("webhook_secret_for", { p_user: user.id, p_instance: inst.id });
    if (error) throw new Error(`webhook_secret_for falhou: ${error.message}`);
    secret = data;
  }
  return { user, inst, serverUrl, instanceToken, secret };
}

function inboundBody({ token, phone, text, fromMe = false, messageid, extraMessage = {} }) {
  return {
    EventType: "messages",
    token,
    message: {
      text,
      fromMe,
      chatid: `${phone}@s.whatsapp.net`,
      messageid,
      ...extraMessage,
    },
    chat: {},
  };
}

function post(body, url = "http://localhost/whatsapp-webhook") {
  return handle(
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
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
function stubGroqChat(onBody) {
  return {
    match: (url) => url.includes("api.groq.com/openai/v1/chat/completions"),
    respond: (_url, init) => {
      const parsed = JSON.parse(init.body);
      onBody?.(parsed);
      return new Response(JSON.stringify({ choices: [{ message: { content: "Resposta simulada" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
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

function trackWaitUntil() {
  const pending = [];
  const prev = globalThis.EdgeRuntime;
  globalThis.EdgeRuntime = {
    waitUntil(p) {
      pending.push(Promise.resolve(p).catch((e) => console.error("[test] waitUntil", e)));
    },
  };
  return {
    async flush() {
      await Promise.all(pending);
    },
    restore() {
      globalThis.EdgeRuntime = prev;
    },
  };
}

test("T15 AC-A12: payload legado (sem s, sem business_context) bate com o snapshot de T2", async () => {
  const admin = adminClient();
  const { instanceToken, serverUrl, user } = await seedTenant(admin, "t15-a12");
  const phone = "5511999990000";
  const { data: conv, error } = await admin
    .from("conversations")
    .insert({ user_id: user.id, contact_phone: phone, ai_enabled: true })
    .select()
    .single();
  if (error) throw new Error(`seed conv falhou: ${error.message}`);

  const base = Date.now() - 19 * 60_000;
  const history = Array.from({ length: 19 }, (_, i) => ({
    conversation_id: conv.id,
    user_id: conv.user_id,
    direction: i % 2 === 0 ? "inbound" : "outbound",
    sender: i % 2 === 0 ? "contact" : "ai",
    content: `mensagem de histórico #${i + 1}`,
    created_at: new Date(base + i * 60_000).toISOString(),
  }));
  const { error: histErr } = await admin.from("messages").insert(history);
  if (histErr) throw new Error(`seed histórico falhou: ${histErr.message}`);

  let captured = null;
  const stop = installFetchStub([
    passthroughApi(),
    stubGroqModels(),
    stubGroqChat((b) => {
      captured = b;
    }),
    stubUazapi(serverUrl),
  ]);
  try {
    const res = await post(inboundBody({ token: instanceToken, phone, text: "Mensagem de teste do cliente" }));
    assert.equal(res.status, 200);
    assert.ok(captured, "legado não chamou a Groq");
    assert.equal(captured.messages.length, 21);
    assert.ok(!("tools" in captured));
    assert.ok(!("response_format" in captured));
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
    assert.deepEqual(captured, snapshot);
  } finally {
    stop();
  }
});

test("T15 AC-A15: inbound do owner_notify_phone no modo novo não cria conversa nem chama Groq", async () => {
  const admin = adminClient();
  const ownerPhone = uniquePhone();
  const { instanceToken, secret, serverUrl, user } = await seedTenant(admin, "t15-a15", {
    withSecret: true,
    businessContext: "Vendemos treinamento de vendas.",
    ownerNotifyPhone: ownerPhone,
  });
  const { data: agent } = await admin.from("agent_configs").select("owner_notify_phone").eq("user_id", user.id).single();
  const key = agent.owner_notify_phone;
  assert.ok(key, "owner_notify_phone não gravou");

  let groqCalls = 0;
  const stop = installFetchStub([passthroughApi(), stubGroqModels(), stubGroqChat(() => groqCalls++), stubUazapi(serverUrl)]);
  try {
    const res = await post(inboundBody({ token: instanceToken, phone: key, text: "sou o dono" }), `http://localhost/whatsapp-webhook?s=${secret}`);
    assert.equal(res.status, 200);
    assert.equal(groqCalls, 0);
    const { data: convs } = await admin.from("conversations").select("id").eq("user_id", user.id).eq("contact_phone", key);
    assert.equal(convs.length, 0, "não deveria criar conversa pro número do dono");
  } finally {
    stop();
  }
});

test("T15 AC-A18: conversa que nasce de inbound fica ai_stage=descobrir", async () => {
  const admin = adminClient();
  const { instanceToken, serverUrl, user } = await seedTenant(admin, "t15-a18");
  const phone = uniquePhone();
  const stop = installFetchStub([passthroughApi(), stubGroqModels(), stubGroqChat(), stubUazapi(serverUrl)]);
  try {
    const res = await post(inboundBody({ token: instanceToken, phone, text: "oi" }));
    assert.equal(res.status, 200);
    const { data: conv } = await admin.from("conversations").select("ai_stage").eq("user_id", user.id).eq("contact_phone", phone).maybeSingle();
    assert.ok(conv, "conversa não foi criada");
    assert.equal(conv.ai_stage, "descobrir");
  } finally {
    stop();
  }
});

test("T15 AC-A18c: conversa que nasce de fromMe fica ai_stage=abordar", async () => {
  const admin = adminClient();
  const { instanceToken, serverUrl, user } = await seedTenant(admin, "t15-a18c");
  const phone = uniquePhone();
  const stop = installFetchStub([passthroughApi(), stubGroqModels(), stubGroqChat(), stubUazapi(serverUrl)]);
  try {
    const res = await post(inboundBody({ token: instanceToken, phone, text: "to falando do meu celular", fromMe: true }));
    assert.equal(res.status, 200);
    const { data: conv } = await admin.from("conversations").select("ai_stage, ai_enabled").eq("user_id", user.id).eq("contact_phone", phone).maybeSingle();
    assert.ok(conv);
    assert.equal(conv.ai_stage, "abordar");
    assert.equal(conv.ai_enabled, false);
  } finally {
    stop();
  }
});

test("T15 AC-C3b: 2 inbound quase simultâneas (12 e 13 dígitos) viram 1 conversa", async () => {
  const admin = adminClient();
  const { instanceToken, serverUrl, user } = await seedTenant(admin, "t15-c3b");
  // celular 12 dígitos (55+DDD+8) ganha o 9 → mesma chave canônica de 13 dígitos
  const twelve = "5511999" + (10000 + (Date.now() % 80000) + seq++).toString().slice(-5);
  assert.equal(twelve.length, 12);
  const thirteen = twelve.slice(0, 4) + "9" + twelve.slice(4);
  const stop = installFetchStub([passthroughApi(), stubGroqModels(), stubGroqChat(), stubUazapi(serverUrl)]);
  try {
    const [a, b] = await Promise.all([
      post(inboundBody({ token: instanceToken, phone: twelve, text: "oi do 12", messageid: `c3b-a-${Date.now()}` })),
      post(inboundBody({ token: instanceToken, phone: thirteen, text: "oi do 13", messageid: `c3b-b-${Date.now()}` })),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const { data: convs } = await admin.from("conversations").select("id, contact_phone").eq("user_id", user.id).eq("contact_phone", thirteen);
    assert.equal(convs.length, 1, "esperava 1 conversa na chave canônica: " + JSON.stringify(convs));
  } finally {
    stop();
  }
});

test("T15: reenvio com o mesmo external_id (message.messageid) grava 1 mensagem", async () => {
  const admin = adminClient();
  const { instanceToken, serverUrl, user } = await seedTenant(admin, "t15-dedupe");
  const phone = uniquePhone();
  const messageid = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stop = installFetchStub([passthroughApi(), stubGroqModels(), stubGroqChat(), stubUazapi(serverUrl)]);
  try {
    const body = inboundBody({
      token: instanceToken,
      phone,
      text: "mesma mensagem",
      messageid,
      extraMessage: { content: { key: { ID: "ID-DO-ALVO-NAO-USAR" } } },
    });
    assert.equal((await post(body)).status, 200);
    assert.equal((await post(body)).status, 200);
    const { data: conv } = await admin.from("conversations").select("id").eq("user_id", user.id).eq("contact_phone", phone).single();
    const { data: msgs } = await admin.from("messages").select("id, external_id").eq("conversation_id", conv.id).eq("direction", "inbound");
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].external_id, messageid);
    assert.notEqual(msgs[0].external_id, "ID-DO-ALVO-NAO-USAR");
  } finally {
    stop();
  }
});

test("T15: instância confirmada sem s ⇒ 401; dry_run com s não confirma; s inválido ⇒ 401", async () => {
  const admin = adminClient();
  const { instanceToken, secret, inst, serverUrl } = await seedTenant(admin, "t15-auth", {
    withSecret: true,
    businessContext: "Contexto que liga o modo novo.",
  });
  const phone = uniquePhone();
  const stop = installFetchStub([
    passthroughApi(),
    stubGroqModels(),
    stubGroqChat(),
    stubUazapi(serverUrl),
  ]);
  const wait = trackWaitUntil();
  try {
    const bad = await post(inboundBody({ token: instanceToken, phone, text: "oi" }), "http://localhost/whatsapp-webhook?s=secret-que-nao-existe");
    assert.equal(bad.status, 401, "s inválido deveria ser 401");

    const dry = await post(
      { event: "dry_run", instance: { token: instanceToken } },
      `http://localhost/whatsapp-webhook?s=${secret}`,
    );
    assert.equal(dry.status, 200);
    const { data: afterDry } = await admin.rpc("webhook_is_confirmed", { p_instance: inst.id });
    assert.equal(afterDry, false, "dry_run com s não pode confirmar");

    const okMsg = await post(
      inboundBody({ token: instanceToken, phone, text: "primeira real" }),
      `http://localhost/whatsapp-webhook?s=${secret}`,
    );
    assert.equal(okMsg.status, 200);
    await wait.flush();
    const { data: afterMsg } = await admin.rpc("webhook_is_confirmed", { p_instance: inst.id });
    assert.equal(afterMsg, true, "messages real com s deveria confirmar");

    const semS = await post(inboundBody({ token: instanceToken, phone, text: "depois de confirmada" }));
    assert.equal(semS.status, 401, "instância confirmada sem s deveria ser 401");
  } finally {
    wait.restore();
    stop();
  }
});

test("T15: 'pare' com IA desligada na conversa ⇒ optout + IA off + 1 despedida", async () => {
  const admin = adminClient();
  const { instanceToken, secret, serverUrl, user, inst } = await seedTenant(admin, "t15-pare", {
    withSecret: true,
    businessContext: "Vendemos treinamento de vendas.",
  });
  const phone = uniquePhone();
  const { data: conv, error } = await admin
    .from("conversations")
    .insert({
      user_id: user.id,
      instance_id: inst.id,
      contact_phone: phone,
      ai_enabled: false,
      ai_stage: "descobrir",
    })
    .select()
    .single();
  if (error) throw new Error(`seed conv falhou: ${error.message}`);

  const sent = [];
  const stop = installFetchStub([passthroughApi(), stubGroqModels(), stubGroqChat(), stubUazapi(serverUrl, (b) => sent.push(b))]);
  try {
    const res = await post(
      inboundBody({ token: instanceToken, phone, text: "pare" }),
      `http://localhost/whatsapp-webhook?s=${secret}`,
    );
    assert.equal(res.status, 200);
    const after = (await admin.from("conversations").select("*").eq("id", conv.id).single()).data;
    assert.equal(after.optout, true);
    assert.equal(after.ai_enabled, false);
    assert.equal(after.ai_stage, "descartar");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, DESPEDIDA_OPTOUT);
  } finally {
    stop();
  }
});

test("T15: ReactionMessage não aciona a IA (mesmo com .text preenchido)", async () => {
  const admin = adminClient();
  const { instanceToken, secret, serverUrl, user } = await seedTenant(admin, "t15-react", {
    withSecret: true,
    businessContext: "Vendemos treinamento de vendas.",
  });
  const phone = uniquePhone();
  let groqCalls = 0;
  const wait = trackWaitUntil();
  const stop = installFetchStub([passthroughApi(), stubGroqModels(), stubGroqChat(() => groqCalls++), stubUazapi(serverUrl)]);
  try {
    const res = await post(
      {
        EventType: "messages",
        token: instanceToken,
        message: {
          text: "👍",
          fromMe: false,
          chatid: `${phone}@s.whatsapp.net`,
          messageType: "ReactionMessage",
          type: "reaction",
          messageid: `reac-${Date.now()}`,
          content: { key: { ID: "MSG-ALVO" }, text: "👍" },
        },
        chat: {},
      },
      `http://localhost/whatsapp-webhook?s=${secret}`,
    );
    assert.equal(res.status, 200);
    await wait.flush();
    assert.equal(groqCalls, 0, "reação não pode ir pra Groq");
    const { data: convs } = await admin.from("conversations").select("id").eq("user_id", user.id).eq("contact_phone", phone);
    assert.equal(convs.length, 0, "reação 1:1 não deveria abrir conversa");
  } finally {
    wait.restore();
    stop();
  }
});
