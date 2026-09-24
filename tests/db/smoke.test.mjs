import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { psql, psqlFile } from "../_harness/db.mjs";

const INIT_SQL = fileURLToPath(new URL("../../supabase/migrations/20260101000000_q7_init.sql", import.meta.url));
const NOVE_TABELAS = [
  "profiles", "user_roles", "whatsapp_instances", "pipeline_stages",
  "conversations", "messages", "agent_configs", "followups", "app_settings",
];

test("T1 (S): q7_init.sql é idempotente e as 9 tabelas existem", () => {
  // AC-C1 vale desde a Fase 2 pro schema inicial; reaplicar aqui prova que o arnês consegue
  // rodar SQL contra o banco local sem quebrar um schema já populado.
  psqlFile(INIT_SQL);
  const out = psql(
    `select count(*) from information_schema.tables where table_schema='public' and table_name in (${NOVE_TABELAS.map((t) => `'${t}'`).join(",")})`
  ).trim();
  assert.equal(out, String(NOVE_TABELAS.length));
});
