import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { psql, psqlFile, adminClient } from "../_harness/db.mjs";

const MIGRATION = fileURLToPath(new URL("../../supabase/migrations/20260925020000_phone_canon.sql", import.meta.url));

function canonInput(raw) {
  const q = raw === null ? "null" : `'${String(raw).replace(/'/g, "''")}'`;
  return psql(`select coalesce(public.canon_phone_input(${q}), '<null>')`).trim();
}

function canon(raw) {
  const q = raw === null ? "null" : `'${String(raw).replace(/'/g, "''")}'`;
  return psql(`select coalesce(public.canon_phone(${q}), '<null>')`).trim();
}

// `ALTER TABLE ... DISABLE TRIGGER` é estado de schema persistente, não escopado à transação nem
// ao teste — se o insert entre disable/enable lançar, o trigger fica desligado pro resto da run
// inteira (achado do code-review desta task). try/finally garante que o enable sempre roda.
async function withTriggerDisabled(table, trigger, fn) {
  psql(`alter table ${table} disable trigger ${trigger}`);
  try {
    return await fn();
  } finally {
    psql(`alter table ${table} enable trigger ${trigger}`);
  }
}

async function makeUser(admin, prefix) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "senha-de-teste-123456", email_confirm: true });
  if (error) throw new Error(`createUser(${email}) falhou: ${error.message}`);
  return data.user.id;
}

// Tabela de casos da spec (AC-C3), rodada contra canon_phone_input (entrada humana/CSV).
const AC_C3_CASES = [
  ["11 99999-9999", "5511999999999"],
  ["+55 (11) 99999-9999", "5511999999999"],
  ["5511999999999", "5511999999999"],
  ["551199999999", "5511999999999"], // celular sem o 9º dígito
  ["551133334444", "551133334444"], // fixo — não recebe o 9
  ["+1 415 555 0100", "14155550100"], // DDI diferente de 55 — não recebe 55
  [null, "<null>"],
];

test("T7 AC-C1: migration aplica 2x seguidas sem erro", () => {
  psqlFile(MIGRATION);
  psqlFile(MIGRATION);
});

test("T7 AC-C3: canon_phone_input cobre a tabela de casos da spec", () => {
  for (const [input, expected] of AC_C3_CASES) {
    assert.equal(canonInput(input), expected, `input=${JSON.stringify(input)}`);
  }
});

// As mesmas chaves canônicas, agora via canon_phone (a função de trigger — já espera dígitos,
// sem "+"/espaços) contra as 2 formas de 12 dígitos que ela precisa diferenciar.
test("T7 AC-C3: canon_phone (uso de trigger) diferencia celular sem 9º de fixo, ambos com 12 dígitos", () => {
  assert.equal(canon("551199999999"), "5511999999999", "celular de 12 dígitos ganha o 9");
  assert.equal(canon("551133334444"), "551133334444", "fixo de 12 dígitos NÃO ganha o 9");
  assert.equal(canon("5511999999999"), "5511999999999", "já canônico (13 dígitos) fica igual — idempotente");
  assert.equal(canon(null), "<null>");
  assert.equal(canon(""), "<null>");
});

test("T7 mutação: inserir o 9 em TODO 12 dígitos (sem checar o dígito local) reprova no fixo", () => {
  const mutated = psql(`
    select case
      when length(regexp_replace('551133334444', '\\D', '', 'g')) = 12
      then left('551133334444', 4) || '9' || substring('551133334444' from 5)
      else '551133334444'
    end;
  `).trim();
  assert.notEqual(mutated, "551133334444", "a mutação (9 incondicional) muda o fixo — prova que a checagem do dígito local é quem protege");
});

test("T7 mutação: prefixar 55 mesmo com '+' quebra o número estrangeiro", () => {
  const digits = "14155550100";
  const mutatedResult = psql(`select public.canon_phone('55' || '${digits}')`).trim();
  assert.notEqual(mutatedResult, digits, "prefixar 55 incondicionalmente corromperia o DDI estrangeiro — o '+' tem que desviar dessa regra");
});

test("T7: trigger usa canon_phone (idempotente) — reaplicar num telefone estrangeiro não corrompe", async () => {
  const admin = adminClient();
  const userId = await makeUser(admin, "t7-trigger-idem");
  const { data: conv, error } = await admin
    .from("conversations")
    .insert({ user_id: userId, contact_phone: "14155550100", ai_enabled: true })
    .select()
    .single();
  assert.equal(error, null, error?.message);
  assert.equal(conv.contact_phone, "14155550100", "canon_phone não deveria mexer nisso (não é padrão BR de 12 dígitos)");

  // update qualquer, dispara o BEFORE UPDATE de novo — 2ª passada tem que dar o MESMO valor.
  const { data: after, error: e2 } = await admin
    .from("conversations")
    .update({ contact_name: "Foo" })
    .eq("id", conv.id)
    .select()
    .single();
  assert.equal(e2, null, e2?.message);
  assert.equal(after.contact_phone, "14155550100", "trigger com canon_phone_input corromperia isso pra 55141... na 2ª passada");
});

test("T7 backfill: fixture com colisão aborta com raise, nada escrito", async () => {
  const admin = adminClient();
  const userId = await makeUser(admin, "t7-collision");

  const { convA, convB } = await withTriggerDisabled(
    "public.conversations",
    "conversations_canon_contact_phone",
    async () => {
      const { data: a } = await admin
        .from("conversations")
        .insert({ user_id: userId, contact_phone: "5511988887777", ai_enabled: true, wa_phone: null })
        .select()
        .single();
      const { data: b } = await admin
        .from("conversations")
        .insert({ user_id: userId, contact_phone: "551188887777", ai_enabled: true, wa_phone: null }) // canonicaliza pro mesmo de A
        .select()
        .single();
      return { convA: a, convB: b };
    },
  );

  psql("delete from private.q7_markers where key = 'phone_canon.backfill'");
  assert.throws(() => psqlFile(MIGRATION), /colidindo/i, "backfill deveria abortar com a colisão");

  const { data: after } = await admin
    .from("conversations")
    .select("id, contact_phone, wa_phone")
    .in("id", [convA.id, convB.id]);
  const a = after.find((c) => c.id === convA.id);
  const b = after.find((c) => c.id === convB.id);
  assert.equal(a.contact_phone, "5511988887777", "nada deveria ter sido escrito, nem o wa_phone (passo 1 do mesmo DO)");
  assert.equal(a.wa_phone, null);
  assert.equal(b.contact_phone, "551188887777");
  assert.equal(b.wa_phone, null);

  // limpa a colisão pra não vazar pro próximo teste (e deixa o marcador ausente de propósito).
  await admin.from("conversations").delete().in("id", [convA.id, convB.id]);
});

test("T7 backfill: sem colisão canonicaliza e preserva wa_phone já existente", async () => {
  const admin = adminClient();
  const userId = await makeUser(admin, "t7-ok");

  const { withWaPhone, withoutWaPhone } = await withTriggerDisabled(
    "public.conversations",
    "conversations_canon_contact_phone",
    async () => {
      const { data: a } = await admin
        .from("conversations")
        .insert({ user_id: userId, contact_phone: "551199998888", ai_enabled: true, wa_phone: "551199990000" })
        .select()
        .single();
      const { data: b } = await admin
        .from("conversations")
        .insert({ user_id: userId, contact_phone: "551133335555", ai_enabled: true, wa_phone: null })
        .select()
        .single();
      return { withWaPhone: a, withoutWaPhone: b };
    },
  );

  psql("delete from private.q7_markers where key = 'phone_canon.backfill'");
  psqlFile(MIGRATION);

  const { data: after } = await admin
    .from("conversations")
    .select("id, contact_phone, wa_phone")
    .in("id", [withWaPhone.id, withoutWaPhone.id]);
  const a = after.find((c) => c.id === withWaPhone.id);
  const b = after.find((c) => c.id === withoutWaPhone.id);

  assert.equal(a.contact_phone, "5511999998888", "celular de 12 dígitos deveria ganhar o 9 no backfill");
  assert.equal(a.wa_phone, "551199990000", "wa_phone já preenchido não pode ser sobrescrito (passo 1: só onde é nulo)");

  assert.equal(b.contact_phone, "551133335555", "fixo não muda");
  assert.equal(b.wa_phone, "551133335555", "wa_phone nulo é preenchido com o valor cru anterior");
});
