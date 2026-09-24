import { test } from "node:test";
import assert from "node:assert/strict";
import { newTenant } from "./sessions.mjs";

test("T1: 2 sessões authenticated são tenants isolados por RLS (pipeline_stages semeado no signup)", async () => {
  const a = await newTenant("harness-a");
  const b = await newTenant("harness-b");

  const { data: stagesA, error: eA } = await a.client.from("pipeline_stages").select("id,user_id,name");
  assert.equal(eA, null, eA?.message);
  assert.equal(stagesA.length, 3, "handle_new_user devia semear 3 estágios pro tenant A");
  assert.ok(stagesA.every((s) => s.user_id === a.userId), "tenant A não pode ver stage de outro user_id");

  const { data: stagesB } = await b.client.from("pipeline_stages").select("id");
  assert.equal(stagesB.length, 3);

  // A não enxerga a linha de B por id direto (RLS, não só "não lista por padrão").
  const { data: cross, error: eCross } = await a.client.from("pipeline_stages").select("id").eq("id", stagesB[0].id);
  assert.equal(eCross, null);
  assert.equal(cross.length, 0, "tenant A conseguiu ler uma linha de B pelo id — RLS furada");
});
