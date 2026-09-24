import { test } from "node:test";
import assert from "node:assert/strict";
import { psql, adminClient } from "../_harness/db.mjs";

async function makeUser(admin, prefix) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "senha-de-teste-123456", email_confirm: true });
  if (error) throw new Error(`createUser(${email}) falhou: ${error.message}`);
  return data.user.id;
}

// `-Atc` com várias sentenças separadas por `;` devolve a saída de CADA uma concatenada
// ("SET\nSET\n<resultado>") — só a última linha é o resultado do SELECT final.
function lastLine(psqlOutput) {
  const lines = psqlOutput.trim().split("\n");
  return lines[lines.length - 1];
}

async function makeInstance(admin, userId, name) {
  const { data, error } = await admin
    .from("whatsapp_instances")
    .insert({ user_id: userId, name, instance_token: `tok-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
    .select()
    .single();
  if (error) throw new Error(`seed instance falhou: ${error.message}`);
  return data;
}

test("T6: my_webhook_secret de instância de outro tenant devolve nulo", async () => {
  const admin = adminClient();
  const ownerA = await makeUser(admin, "t6-owner-a");
  const ownerB = await makeUser(admin, "t6-owner-b");
  const instA = await makeInstance(admin, ownerA, "inst-a");

  // gera o secret real (service role) pro dono de verdade
  const { data: realSecret, error: e0 } = await admin.rpc("webhook_secret_for", { p_user: ownerA, p_instance: instA.id });
  assert.equal(e0, null, e0?.message);
  assert.ok(realSecret);

  // simula uma sessão authenticated do tenant B tentando ler o secret da instância de A
  // (SET, não SET LOCAL: cada chamada a psql() é uma sessão nova de ponta a ponta — SET LOCAL
  // só vale dentro de uma transação explícita, e aqui não há BEGIN)
  const out = lastLine(
    psql(`set role authenticated; set request.jwt.claims = '{"sub":"${ownerB}"}';
        select coalesce(public.my_webhook_secret('${instA.id}'::uuid)::text, '<null>');`),
  );
  assert.equal(out, "<null>", "tenant B não pode ler o secret da instância de A");

  // controle positivo: o próprio dono lê o secret certo
  const own = lastLine(
    psql(`set role authenticated; set request.jwt.claims = '{"sub":"${ownerA}"}';
        select public.my_webhook_secret('${instA.id}'::uuid);`),
  );
  assert.equal(own, realSecret);
});

test("T6: rotate_begin sozinho não muda o secret; após rotate_commit, o antigo vale até prev_until", async () => {
  const admin = adminClient();
  const userId = await makeUser(admin, "t6-rotate");
  const inst = await makeInstance(admin, userId, "inst-rotate");

  const { data: original } = await admin.rpc("webhook_secret_for", { p_user: userId, p_instance: inst.id });
  assert.ok(original);

  const { data: candidate, error: eBegin } = await admin.rpc("webhook_rotate_begin", { p_user: userId, p_instance: inst.id });
  assert.equal(eBegin, null, eBegin?.message);
  assert.ok(candidate);
  assert.notEqual(candidate, original);

  // rotate_begin não grava nada — o secret_for ainda devolve o original
  const { data: stillOriginal } = await admin.rpc("webhook_secret_for", { p_user: userId, p_instance: inst.id });
  assert.equal(stillOriginal, original, "rotate_begin não deveria ter alterado o secret");

  const { error: eCommit } = await admin.rpc("webhook_rotate_commit", {
    p_user: userId,
    p_instance: inst.id,
    p_novo: candidate,
  });
  assert.equal(eCommit, null, eCommit?.message);

  const { data: nowSecret } = await admin.rpc("webhook_secret_for", { p_user: userId, p_instance: inst.id });
  assert.equal(nowSecret, candidate);

  // dentro da janela de prev_until, o secret ANTIGO ainda resolve a instância certa.
  const { data: resolvedOld, error: eResolveOld } = await admin.rpc("webhook_resolve", { p_secret: original });
  assert.equal(eResolveOld, null, eResolveOld?.message);
  assert.equal(resolvedOld.length, 1);
  assert.equal(resolvedOld[0].instance_id, inst.id);

  // o novo também resolve.
  const { data: resolvedNew } = await admin.rpc("webhook_resolve", { p_secret: candidate });
  assert.equal(resolvedNew.length, 1);
  assert.equal(resolvedNew[0].instance_id, inst.id);

  // commit sem secret existente ⇒ exception, nada muda (fool r4 W2).
  const inst2 = await makeInstance(admin, userId, "inst-sem-secret");
  const { error: eCommitSemSecret } = await admin.rpc("webhook_rotate_commit", {
    p_user: userId,
    p_instance: inst2.id,
    p_novo: "qualquer-coisa",
  });
  assert.ok(eCommitSemSecret, "rotate_commit sem secret prévio deveria falhar");
});

test("T6: private.instance_webhook_secrets é inacessível para anon e authenticated (grant direto na tabela)", () => {
  for (const role of ["anon", "authenticated"]) {
    assert.throws(
      () => psql(`set role ${role}; select 1 from private.instance_webhook_secrets limit 1;`),
      /permission denied/i,
      `role ${role} não deveria conseguir ler private.instance_webhook_secrets`,
    );
  }
});
