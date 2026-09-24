import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { psql, psqlFile, adminClient } from "../_harness/db.mjs";
import { createUser, createAuthenticatedClient } from "../_harness/sessions.mjs";

const MIGRATION = fileURLToPath(
  new URL("../../supabase/migrations/20260925030000_outreach.sql", import.meta.url),
);
psqlFile(MIGRATION);

function lastLine(out) {
  const lines = out.trim().split("\n");
  return lines[lines.length - 1];
}

function asUser(userId, sql) {
  return lastLine(
    psql(`set role authenticated; set request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}'; ${sql}`),
  );
}

test("T26 AC-C1: migration aplica 2x seguidas sem erro", () => {
  psqlFile(MIGRATION);
  psqlFile(MIGRATION);
});

test("T26 AC-B6: outreach_daily_cap < 1 é recusado", async () => {
  const admin = adminClient();
  const user = await createUser("t26-cap");
  const { error: ok } = await admin.from("agent_configs").upsert({
    user_id: user.id,
    outreach_daily_cap: 1,
  });
  assert.equal(ok, null, ok?.message);
  const { error } = await admin.from("agent_configs").update({ outreach_daily_cap: 0 }).eq("user_id", user.id);
  assert.ok(error, "cap 0 deveria falhar");
  assert.match(error.message, /outreach_daily_cap|check|violat/i);
});

test("T26 AC-B22: save_openers recusa <2, link, >120 e {empresa} sem company_name", async () => {
  const user = await createUser("t26-op");
  const { client } = await createAuthenticatedClient(user.email, user.password);
  const admin = adminClient();
  await admin.from("agent_configs").upsert({ user_id: user.id, company_name: null });

  const few = await client.rpc("save_openers", { p_texts: ["só uma"] });
  assert.ok(few.error);
  assert.match(few.error.message, /2 variações/i);

  const empresa = await client.rpc("save_openers", {
    p_texts: ["Oi da {empresa}", "Outra linha ok"],
  });
  assert.ok(empresa.error);
  assert.match(empresa.error.message, /company_name/i);

  await admin.from("agent_configs").update({ company_name: "Clínica X" }).eq("user_id", user.id);

  const link = await client.rpc("save_openers", {
    p_texts: ["veja https://spam.com agora", "segunda válida"],
  });
  assert.ok(link.error);

  const longa = "x".repeat(121);
  const big = await client.rpc("save_openers", { p_texts: [longa, "segunda válida"] });
  assert.ok(big.error);

  const ok = await client.rpc("save_openers", {
    p_texts: ["Oi {nome}, sou da {empresa}", "Segunda variação sem link"],
  });
  assert.equal(ok.error, null, ok.error?.message);
  const { data } = await admin.from("outreach_openers").select("text").eq("user_id", user.id);
  assert.equal(data.length, 2);
});

test("T26 AC-B13: optout na conversa para o prospect ligado", async () => {
  const admin = adminClient();
  const user = await createUser("t26-b13");
  const { data: conv, error: cErr } = await admin
    .from("conversations")
    .insert({ user_id: user.id, contact_phone: "5511999000013" })
    .select("id")
    .single();
  if (cErr) throw new Error(cErr.message);
  const { data: p, error: pErr } = await admin
    .from("prospects")
    .insert({ user_id: user.id, phone: "5511999000013", name: "B13", conversation_id: conv.id, proximo_toque: "2026-10-01" })
    .select("id, phone, estado")
    .single();
  if (pErr) throw new Error(pErr.message);
  assert.equal(p.phone, "5511999000013");

  const { error: uErr } = await admin.from("conversations").update({ optout: true }).eq("id", conv.id);
  assert.equal(uErr, null, uErr?.message);
  const { data: after } = await admin.from("prospects").select("estado, optout, proximo_toque").eq("id", p.id).single();
  assert.equal(after.estado, "optout");
  assert.equal(after.optout, true);
  assert.equal(after.proximo_toque, null);
});

test("T26 AC-B14: inbound vira respondeu, mas não sobrescreve optout", async () => {
  const admin = adminClient();
  const user = await createUser("t26-b14");
  const { data: conv } = await admin
    .from("conversations")
    .insert({ user_id: user.id, contact_phone: "5511999000014" })
    .select("id")
    .single();
  const { data: p } = await admin
    .from("prospects")
    .insert({
      user_id: user.id,
      phone: "5511999000014",
      conversation_id: conv.id,
      estado: "abordado",
      proximo_toque: "2026-10-02",
    })
    .select("id")
    .single();

  await admin.from("messages").insert({
    conversation_id: conv.id,
    user_id: user.id,
    direction: "inbound",
    sender: "contact",
    content: "oi",
  });
  const { data: mid } = await admin.from("prospects").select("estado, proximo_toque").eq("id", p.id).single();
  assert.equal(mid.estado, "respondeu");
  assert.equal(mid.proximo_toque, null);

  await admin.from("prospects").update({ estado: "optout", optout: true, proximo_toque: null }).eq("id", p.id);
  await admin.from("messages").insert({
    conversation_id: conv.id,
    user_id: user.id,
    direction: "inbound",
    sender: "contact",
    content: "pare",
  });
  const { data: end } = await admin.from("prospects").select("estado").eq("id", p.id).single();
  assert.equal(end.estado, "optout", "inbound não pode tirar de optout");
});

test("T26 AC-U3: CRUD cruzado e colunas protegidas", async () => {
  const admin = adminClient();
  const a = await createUser("t26-u3a");
  const b = await createUser("t26-u3b");
  const { client: ca } = await createAuthenticatedClient(a.email, a.password);
  const { client: cb } = await createAuthenticatedClient(b.email, b.password);

  const { data: pa, error: insA } = await ca
    .from("prospects")
    .insert({ user_id: a.id, phone: "11998887766", name: "A" })
    .select("id")
    .single();
  assert.equal(insA, null, insA?.message);

  const { data: cruzado } = await cb.from("prospects").select("id").eq("id", pa.id);
  assert.equal((cruzado ?? []).length, 0);

  const { error: updCruz } = await cb.from("prospects").update({ name: "hack" }).eq("id", pa.id);
  assert.ok(!updCruz || (await admin.from("prospects").select("name").eq("id", pa.id).single()).data.name === "A");

  const { error: opt } = await ca.from("prospects").update({ optout: false }).eq("id", pa.id);
  assert.ok(opt, "authenticated não atualiza optout");

  const { data: send } = await admin
    .from("outreach_sends")
    .insert({ user_id: a.id, prospect_id: pa.id, toque: 1, status: "reservado" })
    .select("id")
    .single();
  const { error: delSend } = await ca.from("outreach_sends").delete().eq("id", send.id);
  assert.ok(delSend, "authenticated não apaga outreach_sends");
  const { data: still } = await admin.from("outreach_sends").select("id").eq("id", send.id).single();
  assert.ok(still);

  const { data: kbCruz } = await cb.from("knowledge_base").select("id").eq("user_id", a.id);
  assert.equal((kbCruz ?? []).length, 0);

  let secretDenied = false;
  try {
    asUser(a.id, "select count(*) from private.instance_webhook_secrets;");
  } catch (e) {
    secretDenied = /permission denied/i.test(String(e.message));
  }
  assert.ok(secretDenied, "private.instance_webhook_secrets deveria ser inacessível");
});
