// T14: turno.ts (design.md §4.2). H — Postgres real, Groq/Uazapi stubados via fetch-stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import "../_harness/edge-shim.mjs";
import { status, adminClient } from "../_harness/db.mjs";
import { installFetchStub, restoreFetch } from "../_harness/fetch-stub.mjs";
import { createUser } from "../_harness/sessions.mjs";
import { responderTurno, DESPEDIDA_OPTOUT } from "../../supabase/functions/_shared/turno.ts";

const s = status();
process.env.SUPABASE_URL = s.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = s.SERVICE_ROLE_KEY;
const realFetch = globalThis.fetch;

let seq = 0;
function phone() {
  seq++;
  return `5511${(9_0000_0000 + Date.now() % 1_0000_0000 + seq).toString().slice(-9)}`;
}

async function seedTenant(admin, prefix, { ownerNotifyPhone = null, businessContext = "Vendemos treinamento de vendas para times comerciais." } = {}) {
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
    owner_notify_phone: ownerNotifyPhone,
    enabled: true,
  });
  if (agentErr) throw new Error(`seed agent falhou: ${agentErr.message}`);

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .insert({ user_id: user.id, instance_id: inst.id, contact_phone: phone(), ai_enabled: true, ai_stage: "descobrir" })
    .select()
    .single();
  if (convErr) throw new Error(`seed conversation falhou: ${convErr.message}`);

  return { user, inst, conv, serverUrl };
}

async function seedInbound(admin, conv, content) {
  const { data, error } = await admin
    .from("messages")
    .insert({ conversation_id: conv.id, user_id: conv.user_id, direction: "inbound", sender: "contact", content, processed_at: null })
    .select()
    .single();
  if (error) throw new Error(`seed inbound falhou: ${error.message}`);
  return data;
}

async function claim(admin, conv) {
  const { data, error } = await admin.rpc("brain_claim_inbound", { p_user: conv.user_id, p_conv: conv.id });
  if (error) throw new Error(`claim falhou: ${error.message}`);
  return data.map((m) => ({ id: m.id, content: m.content }));
}

async function readConv(admin, conv) {
  const { data } = await admin.from("conversations").select("*").eq("id", conv.id).single();
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
function stubGroqChat(scriptFn, opts = {}) {
  let call = 0;
  return {
    match: (url) => url.includes("api.groq.com/openai/v1/chat/completions"),
    delayMs: opts.delayMs,
    respond: async (_url, init) => {
      call++;
      const body = JSON.parse(init.body);
      return scriptFn(call, body);
    },
  };
}
function chatOk(o = {}) {
  const payload = {
    mensagens: ["ok"], etapa: "descobrir", qualificacao: {}, qualificado: false, resumo: null,
    optout: false, escalar: false, motivo_escalar: null, ...o,
  };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200, headers: { "Content-Type": "application/json" },
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

test("AC-A5c: optout decidido envia 1 despedida fixa, grava optout/ai_stage/ai_enabled, cancela TODOS os follow-ups pendentes", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "a5c");
  await admin.from("followups").insert([
    { user_id: user.id, conversation_id: conv.id, send_at: new Date().toISOString(), status: "pending", kind: "auto_inactivity" },
    { user_id: user.id, conversation_id: conv.id, send_at: new Date().toISOString(), status: "pending", kind: "manual", text_override: "oi de novo" },
  ]);
  const msg = await seedInbound(admin, conv, "pare de me mandar mensagem");
  const claimed = await claim(admin, conv);
  assert.equal(claimed.length, 1);

  const sent = [];
  const stop = installFetchStub([passthroughApi(), stubUazapi(serverUrl, (b) => sent.push(b))]);
  try {
    await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: claimed });

    const after = await readConv(admin, conv);
    assert.equal(after.optout, true);
    assert.ok(after.optout_motivo, "optout_motivo vazio");
    assert.equal(after.ai_stage, "descartar");
    assert.equal(after.ai_enabled, false);

    assert.equal(sent.length, 1, "esperava exatamente 1 envio (a despedida): " + JSON.stringify(sent));
    assert.equal(sent[0].text, DESPEDIDA_OPTOUT, "despedida não é o texto fixo — parece gerada pelo modelo");

    const { data: fups } = await admin.from("followups").select("status, kind").eq("conversation_id", conv.id);
    assert.ok(fups.every((f) => f.status === "cancelled"), "sobrou follow-up pending (inclusive manual): " + JSON.stringify(fups));

    const { data: outMsgs } = await admin.from("messages").select("content").eq("conversation_id", conv.id).eq("direction", "outbound");
    assert.equal(outMsgs.length, 1);
    assert.equal(outMsgs[0].content, DESPEDIDA_OPTOUT);
  } finally {
    stop();
  }
});

test("AC-A13: após 2 turnos, ai_stage/qualification/ai_summary/confirmacoes refletem os turnos", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "a13");

  await seedInbound(admin, conv, "meu problema é perder lead no whatsapp");
  const c1 = await claim(admin, conv);
  const stop1 = installFetchStub([
    passthroughApi(), stubGroqModels(),
    stubGroqChat(() => chatOk({ etapa: "descobrir", qualificacao: { necessidade: "perde lead no whatsapp" } })),
    stubUazapi(serverUrl),
  ]);
  try {
    await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1 });
  } finally { stop1(); }

  const afterTurn1 = await readConv(admin, conv);
  assert.equal(afterTurn1.qualification.necessidade, "perde lead no whatsapp");

  await seedInbound(admin, conv, "eu decido sozinho, e é bem volume, uns 40 por dia");
  const c2 = await claim(admin, conv);
  const stop2 = installFetchStub([
    passthroughApi(), stubGroqModels(),
    stubGroqChat(() => chatOk({
      etapa: "qualificar", qualificacao: { autoridade: "eu decido", volume: "40/dia" },
      qualificado: true, resumo: "Perde lead no WhatsApp, decide sozinho, 40/dia.",
    })),
    stubUazapi(serverUrl),
  ]);
  try {
    await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c2 });
  } finally { stop2(); }

  const afterTurn2 = await readConv(admin, conv);
  assert.equal(afterTurn2.ai_stage, "qualificar");
  assert.equal(afterTurn2.qualification.necessidade, "perde lead no whatsapp", "merge perdeu campo do turno 1");
  assert.equal(afterTurn2.qualification.autoridade, "eu decido");
  assert.equal(afterTurn2.qualification.volume, "40/dia");
  assert.equal(afterTurn2.ai_summary, "Perde lead no WhatsApp, decide sozinho, 40/dia.");
});

test("AC-A3 (handler): 2 confirmações sequenciais escalam — confirmacoes vem do bump atômico, não do runBrainTurn isolado", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "a3h", { ownerNotifyPhone: "5511977776666" });

  await seedInbound(admin, conv, "qual o preço?");
  const c1 = await claim(admin, conv);
  const stop1 = installFetchStub([
    passthroughApi(), stubGroqModels(), stubGroqChat(() => chatOk({ mensagens: ["vou confirmar o valor com o time"] })), stubUazapi(serverUrl),
  ]);
  try { await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1 }); } finally { stop1(); }
  let after = await readConv(admin, conv);
  assert.equal(after.confirmacoes, 1);
  assert.equal(after.ai_enabled, true, "escalou com 1 promessa só");

  await seedInbound(admin, conv, "e aí, confirmou?");
  const c2 = await claim(admin, conv);
  const avisos = [];
  const stop2 = installFetchStub([
    passthroughApi(), stubGroqModels(), stubGroqChat(() => chatOk({ mensagens: ["vou confirmar de novo, um instante"] })),
    stubUazapi(serverUrl, (b) => avisos.push(b)),
  ]);
  try { await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c2 }); } finally { stop2(); }
  after = await readConv(admin, conv);
  assert.equal(after.confirmacoes, 2);
  assert.equal(after.ai_enabled, false, "2ª promessa deveria escalar");
  assert.equal(after.human_takeover_at !== null, true);
  assert.ok(avisos.some((b) => b.number === "5511977776666"), "aviso ao dono não saiu: " + JSON.stringify(avisos));
});

test("AC-A14: modelo escala (com resposta) desliga IA e avisa o dono", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "a14a", { ownerNotifyPhone: "5511988885555" });
  await seedInbound(admin, conv, "isso é golpe, vou chamar o procon");
  const c1 = await claim(admin, conv);
  const sent = [];
  const stop = installFetchStub([
    passthroughApi(), stubGroqModels(),
    stubGroqChat(() => chatOk({ mensagens: ["Entendo, vou chamar alguém do time pra te atender"], escalar: true, motivo_escalar: "reclamação" })),
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1 });
    const after = await readConv(admin, conv);
    assert.equal(after.ai_enabled, false);
    assert.ok(after.human_takeover_at);
    const aviso = sent.find((b) => b.number === "5511988885555");
    assert.ok(aviso, "aviso ao dono não saiu: " + JSON.stringify(sent));
    assert.match(aviso.text, /reclama|motivo/i);
    assert.match(aviso.text, new RegExp(conv.contact_phone));
    const respostaAoLead = sent.find((b) => b.number === (conv.wa_phone || conv.contact_phone));
    assert.ok(respostaAoLead, "resposta ao lead não saiu");
  } finally { stop(); }
});

test("AC-A14: IA falha nas 2 tentativas escala em silêncio pro lead (sem resposta), mas avisa o dono", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "a14b", { ownerNotifyPhone: "5511911112222" });
  await seedInbound(admin, conv, "oi");
  const c1 = await claim(admin, conv);
  const sent = [];
  const stop = installFetchStub([
    passthroughApi(), stubGroqModels(),
    { match: (url) => url.includes("api.groq.com/openai/v1/chat/completions"), respond: () => new Response("upstream indisponível", { status: 500 }) },
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1 });
    const after = await readConv(admin, conv);
    assert.equal(after.ai_enabled, false);
    assert.equal(sent.length, 1, "só o aviso ao dono deveria sair, nada pro lead: " + JSON.stringify(sent));
    assert.equal(sent[0].number, "5511911112222");
  } finally { stop(); }
});

test("AC-A14: escalar sem owner_notify_phone não quebra e não tenta enviar aviso", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "a14c", { ownerNotifyPhone: null });
  await seedInbound(admin, conv, "quero falar com uma pessoa");
  const c1 = await claim(admin, conv);
  const sent = [];
  const stop = installFetchStub([
    passthroughApi(), stubGroqModels(), stubGroqChat(() => chatOk({ mensagens: ["Já chamo alguém pra te ajudar"] })),
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1 });
    const after = await readConv(admin, conv);
    assert.equal(after.ai_enabled, false, "pedido de humano na janela deveria escalar");
    assert.equal(sent.length, 1, "só a resposta ao lead, sem aviso (sem telefone do dono)");
  } finally { stop(); }
});

test("AC-A16: 2 bolhas saem na ordem, com intervalo, cada uma gravada", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "a16");
  await seedInbound(admin, conv, "me conta mais");
  const c1 = await claim(admin, conv);
  const sent = [];
  const stop = installFetchStub([
    passthroughApi(), stubGroqModels(), stubGroqChat(() => chatOk({ mensagens: ["primeira bolha", "segunda bolha"] })), stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  const t0 = Date.now();
  try {
    await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1, esperarEntreBolhasMs: [80, 100] });
  } finally { stop(); }
  const elapsed = Date.now() - t0;
  assert.deepEqual(sent.map((b) => b.text), ["primeira bolha", "segunda bolha"]);
  assert.ok(elapsed >= 75, `esperava >=75ms entre bolhas, levou ${elapsed}ms`);
  const { data: outMsgs } = await admin.from("messages").select("content").eq("conversation_id", conv.id).eq("direction", "outbound").order("created_at", { ascending: true });
  assert.deepEqual(outMsgs.map((m) => m.content), ["primeira bolha", "segunda bolha"]);
});

test('"pare" + "PARE!" em turnos sequenciais = 1 despedida só', async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "pare2x");
  await seedInbound(admin, conv, "pare");
  const c1 = await claim(admin, conv);
  const sent = [];
  const stop1 = installFetchStub([passthroughApi(), stubUazapi(serverUrl, (b) => sent.push(b))]);
  try { await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1 }); } finally { stop1(); }

  await seedInbound(admin, conv, "PARE!");
  const c2 = await claim(admin, conv);
  const stop2 = installFetchStub([passthroughApi(), stubUazapi(serverUrl, (b) => sent.push(b))]);
  try { await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c2 }); } finally { stop2(); }

  assert.equal(sent.length, 1, "mais de 1 despedida saiu: " + JSON.stringify(sent));
  const { data: outMsgs } = await admin.from("messages").select("content").eq("conversation_id", conv.id).eq("direction", "outbound");
  assert.equal(outMsgs.length, 1);
});

test('"pare" após escalada = optout + 1 despedida (mesmo sem novo flip de ai_enabled)', async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "pareescala", { ownerNotifyPhone: "5511933334444" });

  await seedInbound(admin, conv, "quero falar com um humano");
  const c1 = await claim(admin, conv);
  const stop1 = installFetchStub([
    passthroughApi(), stubGroqModels(), stubGroqChat(() => chatOk({ mensagens: ["ok, chamando alguém"] })), stubUazapi(serverUrl),
  ]);
  try { await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1 }); } finally { stop1(); }
  const afterEscalada = await readConv(admin, conv);
  assert.equal(afterEscalada.ai_enabled, false, "pré-condição: já deveria estar escalada");

  await seedInbound(admin, conv, "pare");
  const c2 = await claim(admin, conv);
  const sent = [];
  const stop2 = installFetchStub([passthroughApi(), stubUazapi(serverUrl, (b) => sent.push(b))]);
  try { await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c2 }); } finally { stop2(); }

  const after = await readConv(admin, conv);
  assert.equal(after.optout, true);
  assert.equal(sent.length, 1, "despedida do pare pós-escalada não saiu: " + JSON.stringify(sent));
  assert.equal(sent[0].text, DESPEDIDA_OPTOUT);
});

test("AC-A21: 'pare' concorrente com turno em andamento ainda vira optout, e o turno concorrente não envia a bolha", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "a21");
  await seedInbound(admin, conv, "oi, tudo bem?");
  const c1 = await claim(admin, conv);
  assert.equal(c1.length, 1);

  const sent = [];
  const stop = installFetchStub([
    passthroughApi(), stubGroqModels(),
    stubGroqChat(() => chatOk({ mensagens: ["oi! como posso ajudar?"] }), { delayMs: 250 }),
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    const turn1 = responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1 });
    await new Promise((r) => setTimeout(r, 40));
    await seedInbound(admin, conv, "pare");
    const c2 = await claim(admin, conv);
    assert.equal(c2.length, 1);
    const turn2 = responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c2 });
    await Promise.all([turn1, turn2]);

    const after = await readConv(admin, conv);
    assert.equal(after.optout, true, "pare concorrente não virou optout");
    assert.equal(after.ai_enabled, false);
    assert.equal(sent.length, 1, "a bolha do turno concorrente vazou apesar do optout já setado: " + JSON.stringify(sent));
    assert.equal(sent[0].text, DESPEDIDA_OPTOUT);
  } finally {
    stop();
  }
});

test("releitura acontece antes de CADA bolha, não só no início do turno (2ª bolha vê optout que chegou durante a espera da 1ª)", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "releitura2bolhas");
  await seedInbound(admin, conv, "me conta mais sobre o produto");
  const c1 = await claim(admin, conv);

  const sent = [];
  const stop = installFetchStub([
    passthroughApi(), stubGroqModels(),
    stubGroqChat(() => chatOk({ mensagens: ["primeira bolha", "segunda bolha"] })),
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    const turn1 = responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1, esperarEntreBolhasMs: [150, 150] });
    // Durante a espera de 150ms entre a 1ª e a 2ª bolha, um "pare" concorrente é processado e
    // termina (0 chamadas à IA) — deve estar valendo quando o turno relê antes da 2ª bolha.
    await new Promise((r) => setTimeout(r, 50));
    await seedInbound(admin, conv, "pare");
    const c2 = await claim(admin, conv);
    await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c2 });
    await turn1;

    const bolhasAoLead = sent.filter((b) => b.text !== DESPEDIDA_OPTOUT);
    assert.deepEqual(bolhasAoLead.map((b) => b.text), ["primeira bolha"], "a 2a bolha vazou depois do optout concorrente: " + JSON.stringify(sent));
  } finally {
    stop();
  }
});

test("AC-A20: bump de confirmacoes é atômico sob concorrência (2 turnos promentem ao mesmo tempo, nenhum some)", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "a20", { ownerNotifyPhone: "5511955556666" });
  await seedInbound(admin, conv, "e o preço fica quanto?");
  const c1 = await claim(admin, conv);
  await seedInbound(admin, conv, "me fala mais sobre isso");
  const c2 = await claim(admin, conv);
  assert.equal(c1.length, 1);
  assert.equal(c2.length, 1);

  const sent = [];
  const stop = installFetchStub([
    passthroughApi(), stubGroqModels(),
    stubGroqChat(() => chatOk({ mensagens: ["vou confirmar e te aviso"] }), { delayMs: 60 }),
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    await Promise.all([
      responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1 }),
      responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c2 }),
    ]);
    const after = await readConv(admin, conv);
    assert.equal(after.confirmacoes, 2, "bump não-atômico perderia 1 incremento na corrida");
    assert.equal(after.ai_enabled, false, "2 promessas deveriam escalar");
    const avisos = sent.filter((b) => b.number === "5511955556666");
    assert.equal(avisos.length, 1, "aviso ao dono deveria sair no máximo 1x por escalada: " + JSON.stringify(avisos));
  } finally {
    stop();
  }
});

test("prazo do turno (design §5): IA que nunca responde a tempo escala como se tivesse falhado, não trava o turno", async () => {
  const admin = adminClient();
  const { user, conv, serverUrl } = await seedTenant(admin, "prazo", { ownerNotifyPhone: "5511900001111" });
  await seedInbound(admin, conv, "oi");
  const c1 = await claim(admin, conv);
  const sent = [];
  const stop = installFetchStub([
    passthroughApi(), stubGroqModels(),
    stubGroqChat(() => chatOk({ mensagens: ["oi!"] }), { delayMs: 300 }),
    stubUazapi(serverUrl, (b) => sent.push(b)),
  ]);
  try {
    const t0 = Date.now();
    await responderTurno({ admin, userId: user.id, conversationId: conv.id, claim: c1, prazoTurnoMs: 100 });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 4000, `prazo não cortou a espera, levou ${elapsed}ms`);
    const after = await readConv(admin, conv);
    assert.equal(after.ai_enabled, false, "prazo esgotado deveria escalar, não deixar a IA ligada esperando");
    const aviso = sent.find((b) => b.number === "5511900001111");
    assert.ok(aviso, "aviso ao dono não saiu quando o prazo estourou");
    assert.match(aviso.text, /prazo/i);
  } finally {
    stop();
  }
});
