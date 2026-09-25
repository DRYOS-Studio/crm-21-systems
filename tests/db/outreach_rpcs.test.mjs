import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { psql, psqlFile, adminClient } from "../_harness/db.mjs";
import { createUser, createAuthenticatedClient } from "../_harness/sessions.mjs";

const MIGRATION = fileURLToPath(
  new URL("../../supabase/migrations/20260925030000_outreach.sql", import.meta.url),
);
psqlFile(MIGRATION);
psql("notify pgrst, 'reload schema'");

const INTERVAL = "60 seconds";

async function setup(prefix, { instance = true, stages = true } = {}) {
  const admin = adminClient();
  const user = await createUser(prefix);
  if (stages) {
    const { error } = await admin.rpc("seed_pipeline_stages", { _user_id: user.id });
    if (error) throw new Error(error.message);
  }
  let inst = null;
  if (instance) {
    const { data, error } = await admin
      .from("whatsapp_instances")
      .insert({
        user_id: user.id,
        name: `${prefix}-inst`,
        instance_token: `tok-${prefix}-${Date.now()}`,
        status: "connected",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    inst = data;
  }
  const { error: cfgErr } = await admin.from("agent_configs").upsert({
    user_id: user.id,
    outreach_enabled: true,
    outreach_daily_cap: 40,
    outreach_instance_id: inst?.id ?? null,
  });
  if (cfgErr) throw new Error(cfgErr.message);
  return { admin, user, inst };
}

async function addProspect(admin, userId, phone, extra = {}) {
  const { data, error } = await admin
    .from("prospects")
    .insert({ user_id: userId, phone, name: extra.name ?? "P", ...extra })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

test("T27 AC-B3: duas reservas simultâneas ⇒ 1 envio por usuário", async () => {
  const { admin, user } = await setup("t27-b3");
  await addProspect(admin, user.id, "5511997000001");
  await addProspect(admin, user.id, "5511997000002");

  const [a, b] = await Promise.all([
    admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL }),
    admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL }),
  ]);
  assert.equal(a.error, null, a.error?.message);
  assert.equal(b.error, null, b.error?.message);
  const got = [...(a.data ?? []), ...(b.data ?? [])].filter((r) => r.send_id);
  assert.equal(got.length, 1, JSON.stringify({ a: a.data, b: b.data }));
});

test("T27 AC-B4: segundo reserve dentro do intervalo devolve vazio", async () => {
  const { admin, user } = await setup("t27-b4");
  await addProspect(admin, user.id, "5511997000003");
  await addProspect(admin, user.id, "5511997000004");

  const r1 = await admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  assert.equal(r1.data?.length, 1, r1.error?.message);
  await admin.rpc("outreach_mark_sent", {
    p_user: user.id,
    p_send: r1.data[0].send_id,
    p_proximo_toque: "2026-10-01",
    p_tentativas: 1,
  });

  const r2 = await admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  assert.equal(r2.error, null, r2.error?.message);
  assert.equal((r2.data ?? []).length, 0);
});

test("T27 AC-B2: conversa com mensagem ⇒ descartado; vazia ⇒ liga sem duplicar", async () => {
  const { admin, user } = await setup("t27-b2");
  const { data: dirty } = await admin
    .from("conversations")
    .insert({ user_id: user.id, contact_phone: "5511997000012", ai_enabled: true })
    .select()
    .single();
  await admin.from("messages").insert({
    conversation_id: dirty.id,
    user_id: user.id,
    direction: "inbound",
    sender: "contact",
    content: "já falei",
  });
  const pDirty = await addProspect(admin, user.id, "5511997000012");

  const { data: empty } = await admin
    .from("conversations")
    .insert({ user_id: user.id, contact_phone: "5511999999999", ai_enabled: true })
    .select()
    .single();
  const pEmpty = await addProspect(admin, user.id, "551199999999");

  const r = await admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data?.length, 1);
  assert.equal(r.data[0].prospect.id, pEmpty.id);
  assert.equal(r.data[0].conversation.id, empty.id);
  assert.equal(r.data[0].prospect.conversation_id, empty.id);

  const { data: dumped } = await admin.from("prospects").select("estado").eq("id", pDirty.id).single();
  assert.equal(dumped.estado, "descartado");
});

test("T27 AC-B16: toque 1 cria conversa abordar ligada", async () => {
  const { admin, user } = await setup("t27-b16");
  const p = await addProspect(admin, user.id, "5511997000016");
  const r = await admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  assert.equal(r.data?.length, 1, r.error?.message);
  const conv = r.data[0].conversation;
  assert.equal(conv.ai_stage, "abordar");
  assert.equal(conv.contact_phone, "5511997000016");
  assert.equal(conv.user_id, user.id);
  assert.equal(r.data[0].prospect.conversation_id, conv.id);
  assert.equal(r.data[0].prospect.id, p.id);
});

test("T27 AC-B18: conversa com IA desligada para a cadência e não reserva", async () => {
  const { admin, user } = await setup("t27-b18");
  const { data: conv } = await admin
    .from("conversations")
    .insert({ user_id: user.id, contact_phone: "5511997000018", ai_enabled: false })
    .select()
    .single();
  const p = await addProspect(admin, user.id, "5511997000018", { conversation_id: conv.id });
  const r = await admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  assert.equal((r.data ?? []).length, 0, r.error?.message);
  const { data: after } = await admin.from("prospects").select("estado, proximo_toque").eq("id", p.id).single();
  assert.equal(after.estado, "respondeu");
  assert.equal(after.proximo_toque, null);
});

test("T27: instância de outro tenant recusada", async () => {
  const a = await setup("t27-inst-a");
  const b = await setup("t27-inst-b");
  await addProspect(a.admin, a.user.id, "5511997000020");
  await a.admin
    .from("agent_configs")
    .update({ outreach_instance_id: b.inst.id })
    .eq("user_id", a.user.id);
  const r = await a.admin.rpc("outreach_reserve", {
    p_user: a.user.id,
    p_teto: 40,
    p_intervalo: INTERVAL,
  });
  assert.equal((r.data ?? []).length, 0, r.error?.message);
});

test("T27: reserva velha vira incerto e o prospect fica fora até a cadência", async () => {
  const { admin, user } = await setup("t27-stale");
  const p = await addProspect(admin, user.id, "5511997000021");
  const r1 = await admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  assert.equal(r1.data?.length, 1, r1.error?.message);
  psql(`update public.outreach_sends set reserved_at = now() - interval '6 minutes' where id = '${r1.data[0].send_id}'`);

  const r2 = await admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  assert.equal(r2.data?.length, 1, r2.error?.message);
  assert.equal(r2.data[0].send_id, r1.data[0].send_id);
  const { data: send } = await admin.from("outreach_sends").select("status, cadencia_aplicada").eq("id", r1.data[0].send_id).single();
  assert.equal(send.status, "incerto");
  assert.equal(send.cadencia_aplicada, false);

  const r3 = await admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  assert.equal((r3.data ?? []).length, 0, "prospect ainda sem cadência não pode ser pego de novo");

  await admin.rpc("outreach_mark_uncertain", {
    p_user: user.id,
    p_send: r1.data[0].send_id,
    p_proximo_toque: "2026-10-10",
    p_tentativas: 1,
  });
  const { data: after } = await admin
    .from("prospects")
    .select("tentativas, estado, proximo_toque")
    .eq("id", p.id)
    .single();
  assert.equal(after.tentativas, 1);
  assert.equal(after.estado, "abordado");
  assert.equal(after.proximo_toque, "2026-10-10");
});

test("T27 AC-B9: 3º toque descarta; day_stats conta enviado+incerto do dia SP", async () => {
  const { admin, user } = await setup("t27-stats");
  const p = await addProspect(admin, user.id, "5511997000022");
  const r = await admin.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  await admin.rpc("outreach_mark_sent", {
    p_user: user.id,
    p_send: r.data[0].send_id,
    p_proximo_toque: null,
    p_tentativas: 3,
  });
  const { data: done } = await admin.from("prospects").select("estado, proximo_toque").eq("id", p.id).single();
  assert.equal(done.estado, "descartado");
  assert.equal(done.proximo_toque, null);

  const stats = await admin.rpc("outreach_day_stats", { p_user: user.id });
  assert.equal(stats.error, null, stats.error?.message);
  assert.equal(stats.data[0].enviados, 1);
  assert.equal(stats.data[0].responderam, 0);
});

test("T27: authenticated não executa as RPCs de reserva", async () => {
  const { user } = await setup("t27-auth");
  const { client } = await createAuthenticatedClient(user.email, user.password);
  const r = await client.rpc("outreach_reserve", { p_user: user.id, p_teto: 40, p_intervalo: INTERVAL });
  assert.ok(r.error);
});
