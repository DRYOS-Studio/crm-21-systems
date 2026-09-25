import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import "../_harness/edge-shim.mjs";
import { status, adminClient, psql, psqlFile } from "../_harness/db.mjs";
import { installFetchStub } from "../_harness/fetch-stub.mjs";
import { createUser } from "../_harness/sessions.mjs";
import { handle, CRON_HEADER } from "../../supabase/functions/run-outreach/handle.ts";

const MIGRATION = fileURLToPath(
  new URL("../../supabase/migrations/20260925030000_outreach.sql", import.meta.url),
);
psqlFile(MIGRATION);
psql("notify pgrst, 'reload schema'");

const s = status();
process.env.SUPABASE_URL = s.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = s.SERVICE_ROLE_KEY;
const realFetch = globalThis.fetch;

const AGORA = new Date("2026-09-24T13:00:00.000Z"); // 10:00 SP, quinta
const RNG_GO = () => 0.99;

let seq = 0;
function phone() {
  seq++;
  return `55119${(8_0000_000 + (Date.now() % 1_0000_000) + seq).toString().slice(-8)}`;
}

function secret() {
  return psql("select value from public.app_settings where key = 'outreach_cron_secret'").trim();
}

function tick(opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (opts.secret !== null) headers[CRON_HEADER] = opts.secret ?? secret();
  return handle(new Request("http://localhost/run-outreach", { method: "POST", headers }), {
    agora: opts.agora ?? AGORA,
    rng: opts.rng ?? RNG_GO,
  });
}

function passthroughApi() {
  return { match: (url) => url.startsWith(s.API_URL), respond: (url, init) => realFetch(url, init) };
}

async function disableAllOutreach(admin) {
  const { error } = await admin.from("agent_configs").update({ outreach_enabled: false }).eq("outreach_enabled", true);
  if (error) throw new Error(error.message);
}

async function seedReady(prefix, extra = {}) {
  const admin = adminClient();
  if (!extra.keepOthers) await disableAllOutreach(admin);
  const user = await createUser(prefix);
  await admin.rpc("seed_pipeline_stages", { _user_id: user.id });
  const serverUrl = `https://uazapi-${prefix}-${Date.now()}-${seq}.example.test`;
  const { data: inst, error: instErr } = await admin
    .from("whatsapp_instances")
    .insert({
      user_id: user.id,
      name: `${prefix}-inst`,
      instance_token: `tok-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      server_url: serverUrl,
      status: extra.status ?? "connected",
    })
    .select()
    .single();
  if (instErr) throw new Error(instErr.message);
  await admin.rpc("webhook_secret_for", { p_user: user.id, p_instance: inst.id });
  if (extra.confirm !== false) await admin.rpc("webhook_confirm", { p_instance: inst.id });

  const { error: cfgErr } = await admin.from("agent_configs").upsert({
    user_id: user.id,
    groq_api_key: "test-groq-key",
    enabled: true,
    business_context: extra.businessContext ?? "Clínica de teste",
    company_name: extra.companyName ?? "Clínica X",
    owner_notify_phone: extra.ownerPhone ?? null,
    outreach_enabled: extra.enabled ?? true,
    outreach_paused_reason: extra.paused ?? null,
    outreach_instance_id: extra.noInstance ? null : inst.id,
    outreach_daily_cap: extra.cap ?? 40,
    outreach_ramp_start: extra.rampStart ?? null,
  });
  if (cfgErr) throw new Error(cfgErr.message);

  if (extra.openers !== false) {
    await admin.from("outreach_openers").insert([
      { user_id: user.id, text: "Oi {nome}, sou da {empresa}", active: true },
      { user_id: user.id, text: "Tudo bem? Aqui é a {empresa}", active: true },
    ]);
  }

  const pPhone = extra.phone ?? phone();
  const { data: prospect, error: pErr } = await admin
    .from("prospects")
    .insert({
      user_id: user.id,
      phone: pPhone,
      name: extra.name ?? "Ana",
      estado: extra.estado ?? "fila",
      tentativas: extra.tentativas ?? 0,
      proximo_toque: extra.proximo ?? null,
    })
    .select()
    .single();
  if (pErr) throw new Error(pErr.message);

  return { admin, user, inst, serverUrl, prospect, phone: prospect.phone };
}

describe("T29 run-outreach", { concurrency: 1 }, () => {
  test("T29 AC-B11: secret errado ⇒ 401; guardado vazio ⇒ 500", async () => {
    const bad = await tick({ secret: "nao-e-esse" });
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).enviados, 0);

    const prev = secret();
    psql("update public.app_settings set value = '' where key = 'outreach_cron_secret'");
    try {
      const empty = await tick({ secret: "qualquer" });
      assert.equal(empty.status, 500);
      assert.equal((await empty.json()).enviados, 0);
    } finally {
      psql(`update public.app_settings set value = '${prev.replace(/'/g, "''")}' where key = 'outreach_cron_secret'`);
    }
  });

  test("T29 AC-B1: outreach_enabled=false ⇒ 0 envios", async () => {
    const t = await seedReady("t29-b1", { enabled: false });
    let uaz = 0;
    const stop = installFetchStub([
      passthroughApi(),
      { match: (url) => url.startsWith(t.serverUrl), respond: () => { uaz++; return new Response("{}", { status: 200 }); } },
    ]);
    try {
      const res = await tick();
      assert.equal(res.status, 200);
      assert.equal((await res.json()).enviados, 0);
      assert.equal(uaz, 0);
    } finally {
      stop();
    }
  });

  test("T29 AC-B12: sem instância / desconectada / webhook não confirmado ⇒ 0", async () => {
    await seedReady("t29-b12a", { noInstance: true });
    await seedReady("t29-b12b", { status: "disconnected", keepOthers: true });
    await seedReady("t29-b12c", { confirm: false, keepOthers: true });
    let uaz = 0;
    const stop = installFetchStub([
      passthroughApi(),
      {
        match: (url) => url.includes("uazapi-t29-b12"),
        respond: () => {
          uaz++;
          return new Response("{}", { status: 200 });
        },
      },
    ]);
    try {
      const res = await tick();
      assert.equal((await res.json()).enviados, 0);
      assert.equal(uaz, 0);
    } finally {
      stop();
    }
  });

  test("T29 AC-B22: menos de 2 variações não dispara toque 1", async () => {
    const t = await seedReady("t29-b22", { openers: false });
    await t.admin.from("outreach_openers").insert({ user_id: t.user.id, text: "só uma", active: true });
    let uaz = 0;
    const stop = installFetchStub([
      passthroughApi(),
      { match: (url) => url.startsWith(t.serverUrl), respond: () => { uaz++; return new Response("{}", { status: 200 }); } },
    ]);
    try {
      const res = await tick();
      assert.equal((await res.json()).enviados, 0);
      assert.equal(uaz, 0);
      const { data: p } = await t.admin.from("prospects").select("tentativas").eq("id", t.prospect.id).single();
      assert.equal(p.tentativas, 0);
    } finally {
      stop();
    }
  });

  test("T29 AC-B8: optout na conversa ligada ⇒ release, 0 envio", async () => {
    const t = await seedReady("t29-b8");
    await t.admin.from("conversations").insert({
      user_id: t.user.id,
      instance_id: t.inst.id,
      contact_phone: t.phone,
      optout: true,
      ai_enabled: true,
      ai_stage: "abordar",
    });
    let uaz = 0;
    const stop = installFetchStub([
      passthroughApi(),
      { match: (url) => url.startsWith(t.serverUrl), respond: () => { uaz++; return new Response("{}", { status: 200 }); } },
    ]);
    try {
      const res = await tick();
      assert.equal((await res.json()).enviados, 0);
      assert.equal(uaz, 0);
    } finally {
      stop();
    }
  });

  test("T29 happy path + AC-B15: Uazapi 500 grava falha sem consumir toque", async () => {
    const ok = await seedReady("t29-ok");
    const fail = await seedReady("t29-b15", { keepOthers: true });
    const sent = [];
    const stop = installFetchStub([
      passthroughApi(),
      {
        match: (url) => url.startsWith(ok.serverUrl),
        respond: (_u, init) => {
          sent.push(JSON.parse(init.body));
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
      {
        match: (url) => url.startsWith(fail.serverUrl),
        respond: () => new Response("boom", { status: 500 }),
      },
    ]);
    try {
      const res = await tick();
      const body = await res.json();
      assert.equal(body.enviados, 1, JSON.stringify(body));
      assert.equal(sent.length, 1);
      assert.ok(sent[0].text);
      assert.match(sent[0].text, /Ana|Clínica X/);

      const { data: okP } = await ok.admin.from("prospects").select("tentativas, estado").eq("id", ok.prospect.id).single();
      assert.equal(okP.tentativas, 1);
      assert.equal(okP.estado, "abordado");

      const { data: failP } = await fail.admin.from("prospects").select("tentativas, ultima_falha_motivo").eq("id", fail.prospect.id).single();
      assert.equal(failP.tentativas, 0);
      assert.ok(failP.ultima_falha_motivo);
      const { data: sends } = await fail.admin.from("outreach_sends").select("id").eq("prospect_id", fail.prospect.id);
      assert.equal((sends ?? []).length, 0);
    } finally {
      stop();
    }
  });

  test("T29 AC-B19: IA falha no toque 2 ⇒ release sem consumir", async () => {
    const t = await seedReady("t29-b19", { estado: "abordado", tentativas: 1, proximo: "2026-09-24" });
    let groq = 0;
    const stop = installFetchStub([
      passthroughApi(),
      {
        match: (url) => url.includes("api.groq.com"),
        respond: () => {
          groq++;
          return new Response("fail", { status: 500 });
        },
      },
      { match: (url) => url.startsWith(t.serverUrl), respond: () => new Response("{}", { status: 200 }) },
    ]);
    try {
      const res = await tick();
      assert.equal((await res.json()).enviados, 0);
      const { data: p } = await t.admin.from("prospects").select("tentativas, ultima_falha_motivo").eq("id", t.prospect.id).single();
      assert.equal(p.tentativas, 1);
      assert.ok(p.ultima_falha_motivo);
      assert.ok(groq >= 1);
    } finally {
      stop();
    }
  });

  test("T29 AC-B20: freio desliga e avisa o dono", async () => {
    const t = await seedReady("t29-b20", {
      ownerPhone: "5511997000099",
      rampStart: "2026-08-01",
    });
    const sentAt = new Date(Date.now() - 90_000).toISOString();
    for (let i = 0; i < 29; i++) {
      await t.admin.from("outreach_sends").insert({
        user_id: t.user.id,
        prospect_id: t.prospect.id,
        toque: 1,
        status: "enviado",
        sent_at: sentAt,
      });
    }
    const dest = [];
    const stop = installFetchStub([
      passthroughApi(),
      {
        match: (url) => url.startsWith(t.serverUrl),
        respond: (_u, init) => {
          dest.push(JSON.parse(init.body).number);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
    ]);
    try {
      const res = await tick();
      assert.equal((await res.json()).enviados, 1);
      const { data: cfg } = await t.admin
        .from("agent_configs")
        .select("outreach_enabled, outreach_paused_reason")
        .eq("user_id", t.user.id)
        .single();
      assert.equal(cfg.outreach_enabled, false);
      assert.ok(cfg.outreach_paused_reason);
      assert.ok(dest.includes("5511997000099"));
    } finally {
      stop();
    }
  });

  test("T29 AC-C2: envio do tenant A não toca o prospect do B", async () => {
    const a = await seedReady("t29-c2a");
    const b = await seedReady("t29-c2b", { keepOthers: true });
    const stop = installFetchStub([
      passthroughApi(),
      {
        match: (url) => url.startsWith(a.serverUrl) || url.startsWith(b.serverUrl),
        respond: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      },
    ]);
    try {
      await tick();
      const { data: pa } = await a.admin.from("prospects").select("tentativas").eq("id", a.prospect.id).single();
      const { data: pb } = await b.admin.from("prospects").select("tentativas").eq("id", b.prospect.id).single();
      assert.equal(pa.tentativas, 1);
      assert.equal(pb.tentativas, 1);
      const { data: sendsB } = await b.admin.from("outreach_sends").select("user_id").eq("prospect_id", b.prospect.id);
      assert.ok((sendsB ?? []).every((row) => row.user_id === b.user.id));
      const { data: sendsA } = await a.admin.from("outreach_sends").select("user_id").eq("prospect_id", a.prospect.id);
      assert.ok((sendsA ?? []).every((row) => row.user_id === a.user.id));
    } finally {
      stop();
    }
  });
});
