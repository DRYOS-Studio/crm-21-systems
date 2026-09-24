import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { psql, psqlFile, adminClient } from "../_harness/db.mjs";
import { newTenant } from "../_harness/sessions.mjs";

const MIGRATION = fileURLToPath(new URL("../../supabase/migrations/20260925010000_ai_brain.sql", import.meta.url));

async function makeUser(admin, prefix) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "senha-de-teste-123456", email_confirm: true });
  if (error) throw new Error(`createUser(${email}) falhou: ${error.message}`);
  return data.user.id;
}

test("T4 AC-C1: migration aplica 2x seguidas sem erro", () => {
  psqlFile(MIGRATION);
  psqlFile(MIGRATION);
});

test("T4 AC-A18b: backfill de ai_stage por direção da 1ª mensagem; 2ª rodada não rebaixa estágio avançado", async () => {
  const admin = adminClient();
  const userId = await makeUser(admin, "t4-a18b");

  const rows = [
    { key: "inbound_first", contact_phone: "5511900000001" },
    { key: "outbound_first", contact_phone: "5511900000002" },
    { key: "empty", contact_phone: "5511900000003" },
    { key: "already_advanced", contact_phone: "5511900000004" },
  ];
  const convIds = {};
  for (const r of rows) {
    const { data, error } = await admin
      .from("conversations")
      .insert({ user_id: userId, contact_phone: r.contact_phone, ai_enabled: true })
      .select()
      .single();
    if (error) throw new Error(`seed conversation ${r.key} falhou: ${error.message}`);
    convIds[r.key] = data.id;
  }

  await admin.from("messages").insert({
    conversation_id: convIds.inbound_first,
    user_id: userId,
    direction: "inbound",
    sender: "contact",
    content: "oi",
  });
  await admin.from("messages").insert({
    conversation_id: convIds.outbound_first,
    user_id: userId,
    direction: "outbound",
    sender: "ai",
    content: "oi, tudo bem?",
  });
  // "already_advanced": simula uma conversa que o cérebro já processou antes da migration rodar
  // de novo — 1ª mensagem é inbound (backfill ingênuo tentaria 'descobrir'), mas o estágio real
  // já avançou pra 'qualificar'. A guarda `ai_stage = 'abordar'` do backfill não pode mexer aqui.
  await admin.from("messages").insert({
    conversation_id: convIds.already_advanced,
    user_id: userId,
    direction: "inbound",
    sender: "contact",
    content: "oi",
  });
  await admin.from("conversations").update({ ai_stage: "qualificar" }).eq("id", convIds.already_advanced);

  // Força o backfill a rodar de novo sobre este fixture (marcador removido).
  psql("delete from private.q7_markers where key = 'ai_brain.ai_stage'");
  psqlFile(MIGRATION);

  const { data: after1 } = await admin
    .from("conversations")
    .select("id, ai_stage")
    .in("id", Object.values(convIds));
  const stageOf = (key) => after1.find((c) => c.id === convIds[key]).ai_stage;

  assert.equal(stageOf("inbound_first"), "descobrir");
  assert.equal(stageOf("outbound_first"), "abordar");
  assert.equal(stageOf("empty"), "abordar");
  assert.equal(stageOf("already_advanced"), "qualificar", "backfill não pode rebaixar estágio já avançado");

  // 2ª rodada (marcador já presente desta vez) — nada muda, nem a que a guarda protegeu.
  psqlFile(MIGRATION);
  const { data: after2 } = await admin
    .from("conversations")
    .select("id, ai_stage")
    .in("id", Object.values(convIds));
  assert.deepEqual(
    after2.map((c) => c.ai_stage).sort(),
    after1.map((c) => c.ai_stage).sort(),
  );
});

test("T4: messages.processed_at das linhas antigas = created_at, não a hora do ALTER", async () => {
  const admin = adminClient();
  const userId = await makeUser(admin, "t4-processed-at");
  const { data: conv } = await admin
    .from("conversations")
    .insert({ user_id: userId, contact_phone: "5511900000099", ai_enabled: true })
    .select()
    .single();

  const oldCreatedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 dias atrás
  const { data: msg } = await admin
    .from("messages")
    .insert({
      conversation_id: conv.id,
      user_id: userId,
      direction: "inbound",
      sender: "contact",
      content: "mensagem antiga",
      created_at: oldCreatedAt,
      processed_at: null,
    })
    .select()
    .single();

  psql("delete from private.q7_markers where key = 'ai_brain.processed_at'");
  psqlFile(MIGRATION);

  const { data: after } = await admin.from("messages").select("processed_at, created_at").eq("id", msg.id).single();
  assert.equal(
    new Date(after.processed_at).getTime(),
    new Date(after.created_at).getTime(),
    "backfill deve copiar created_at, não gravar a hora do ALTER",
  );
  assert.equal(new Date(after.created_at).getTime(), new Date(oldCreatedAt).getTime());
});

test("T4 AC-U2: topic gravado normalizado (minúsculas, sem espaço nas pontas); duplicata dá 23505", async () => {
  const t = await newTenant("t4-kb");

  const { error: e1 } = await t.client
    .from("knowledge_base")
    .insert({ user_id: t.userId, topic: "  Preços  ", content: "R$ 100" });
  assert.equal(e1, null, e1?.message);

  const { data: rows } = await t.client.from("knowledge_base").select("topic");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topic, "preços");

  const { error: e2 } = await t.client
    .from("knowledge_base")
    .insert({ user_id: t.userId, topic: "PREÇOS", content: "outro" });
  assert.equal(e2?.code, "23505", `esperava 23505 de duplicata, veio: ${JSON.stringify(e2)}`);
});
