import { test } from "node:test";
import assert from "node:assert/strict";
import { adminClient } from "../_harness/db.mjs";
import { newTenant } from "../_harness/sessions.mjs";

async function makeUser(admin, prefix) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "senha-de-teste-123456", email_confirm: true });
  if (error) throw new Error(`createUser(${email}) falhou: ${error.message}`);
  return data.user.id;
}

async function makeConversation(admin, userId, overrides = {}) {
  const phone = `55119${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  const { data, error } = await admin
    .from("conversations")
    .insert({ user_id: userId, contact_phone: phone, ai_enabled: true, ...overrides })
    .select()
    .single();
  if (error) throw new Error(`seed conversation falhou: ${error.message}`);
  return data;
}

test("T5: brain_claim_inbound concorrente devolve conjuntos disjuntos, sem sobra", async () => {
  const admin = adminClient();
  const userId = await makeUser(admin, "t5-claim");
  const conv = await makeConversation(admin, userId);

  const N = 10;
  const seeded = [];
  for (let i = 0; i < N; i++) {
    const { data } = await admin
      .from("messages")
      .insert({ conversation_id: conv.id, user_id: userId, direction: "inbound", sender: "contact", content: `m${i}`, processed_at: null })
      .select()
      .single();
    seeded.push(data.id);
  }

  const [r1, r2] = await Promise.all([
    admin.rpc("brain_claim_inbound", { p_user: userId, p_conv: conv.id }),
    admin.rpc("brain_claim_inbound", { p_user: userId, p_conv: conv.id }),
  ]);
  assert.equal(r1.error, null, r1.error?.message);
  assert.equal(r2.error, null, r2.error?.message);

  const ids1 = r1.data.map((m) => m.id);
  const ids2 = r2.data.map((m) => m.id);
  const overlap = ids1.filter((id) => ids2.includes(id));
  assert.deepEqual(overlap, [], "as duas chamadas concorrentes reivindicaram a mesma mensagem");

  const union = new Set([...ids1, ...ids2]);
  assert.equal(union.size, N, "nem toda mensagem pendente foi reivindicada por alguma das duas chamadas");

  const { data: remaining } = await admin.from("messages").select("id").eq("conversation_id", conv.id).is("processed_at", null);
  assert.equal(remaining.length, 0, "sobrou mensagem inbound sem processed_at após as duas chamadas");
});

test("T5: brain_commit_turn — optout/ai_enabled monotônicos, flipped_* só na transição, ai_stage vira descartar", async () => {
  const admin = adminClient();
  const userId = await makeUser(admin, "t5-commit");
  const conv = await makeConversation(admin, userId, { ai_stage: "descobrir" });

  // 1ª chamada: p_optout=true, p_desligar=false — desliga a IA mesmo sem p_desligar (fool r4 B1).
  const r1 = await admin.rpc("brain_commit_turn", {
    p_user: userId,
    p_conv: conv.id,
    p_stage: null,
    p_qualification_delta: {},
    p_summary: null,
    p_desligar: false,
    p_optout: true,
    p_motivo: "pediu pra parar",
  });
  assert.equal(r1.error, null, r1.error?.message);
  const row1 = r1.data[0];
  assert.equal(row1.optout, true);
  assert.equal(row1.ai_enabled, false, "p_optout sem p_desligar deveria desligar a IA sozinho");
  assert.equal(row1.flipped_off, true);
  assert.equal(row1.flipped_optout, true);

  const { data: afterFirst } = await admin.from("conversations").select("ai_stage, optout_motivo").eq("id", conv.id).single();
  assert.equal(afterFirst.ai_stage, "descartar");
  assert.equal(afterFirst.optout_motivo, "pediu pra parar");

  // 2ª chamada: turno concorrente que já não tem mais optout=true no seu próprio julgamento
  // (p_optout=false) — optout continua true (monotônico) e flipped_* não repete.
  const r2 = await admin.rpc("brain_commit_turn", {
    p_user: userId,
    p_conv: conv.id,
    p_stage: "descobrir",
    p_qualification_delta: {},
    p_summary: null,
    p_desligar: false,
    p_optout: false,
    p_motivo: null,
  });
  assert.equal(r2.error, null, r2.error?.message);
  const row2 = r2.data[0];
  assert.equal(row2.optout, true, "optout é monotônico — 2ª chamada não pode reverter");
  assert.equal(row2.ai_enabled, false, "sem religar manualmente, ai_enabled continua false");
  assert.equal(row2.flipped_off, false, "já estava desligada — não é uma nova transição");
  assert.equal(row2.flipped_optout, false, "optout já era true — não é uma nova transição");

  const { data: afterSecond } = await admin.from("conversations").select("ai_stage, optout_motivo").eq("id", conv.id).single();
  assert.equal(afterSecond.ai_stage, "descartar", "ai_stage='descartar' com optout+IA desligada não sai daí (fool r3 W1)");
  assert.equal(afterSecond.optout_motivo, "pediu pra parar", "motivo da 1ª transição não é sobrescrito por chamada sem transição");
});

test("T5 AC-A19: religar a IA manualmente zera confirmacoes, tira de 'descartar', não mexe em optout", async () => {
  const admin = adminClient();
  const userId = await makeUser(admin, "t5-a19");
  const conv = await makeConversation(admin, userId, {
    ai_enabled: false,
    ai_stage: "descartar",
    confirmacoes: 5,
    optout: true,
    optout_motivo: "pediu pra parar",
  });

  const { error } = await admin.from("conversations").update({ ai_enabled: true }).eq("id", conv.id);
  assert.equal(error, null, error?.message);

  const { data: after } = await admin
    .from("conversations")
    .select("confirmacoes, ai_stage, optout, optout_motivo")
    .eq("id", conv.id)
    .single();
  assert.equal(after.confirmacoes, 0);
  assert.equal(after.ai_stage, "descobrir");
  assert.equal(after.optout, true, "optout só sai por ação humana explícita, religar a IA não é essa ação");
  assert.equal(after.optout_motivo, "pediu pra parar");
});

test("T5: RPCs do cérebro chamadas com JWT authenticated são negadas", async () => {
  const t = await newTenant("t5-negada");
  const admin = adminClient();
  const conv = await makeConversation(admin, t.userId);

  const r1 = await t.client.rpc("brain_claim_inbound", { p_user: t.userId, p_conv: conv.id });
  assert.ok(r1.error, "brain_claim_inbound não deveria ser chamável por authenticated");

  const r2 = await t.client.rpc("brain_commit_turn", {
    p_user: t.userId,
    p_conv: conv.id,
    p_stage: null,
    p_qualification_delta: {},
    p_summary: null,
    p_desligar: false,
    p_optout: false,
    p_motivo: null,
  });
  assert.ok(r2.error, "brain_commit_turn não deveria ser chamável por authenticated");

  const r3 = await t.client.rpc("brain_bump_confirmacoes", { p_user: t.userId, p_conv: conv.id, p_delta: 1 });
  assert.ok(r3.error, "brain_bump_confirmacoes não deveria ser chamável por authenticated");
});
