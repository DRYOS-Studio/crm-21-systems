// Acesso ao Postgres/Supabase local do `supabase start`. Sem driver Postgres em node_modules:
// SQL roda via `docker exec` no container do Postgres (S). Chaves nunca hardcoded — lidas de
// `supabase status -o json` a cada chamada (o CLI as gera por projeto/máquina).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

let _status = null;
export function status() {
  if (_status) return _status;
  const raw = execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", cwd: repoRoot() });
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("supabase status -o json não devolveu JSON: " + raw.slice(0, 200));
  _status = JSON.parse(raw.slice(start));
  return _status;
}

function repoRoot() {
  // tests/_harness/db.mjs -> .../Q7_PIPELINE_WHITELABEL_v2
  return new URL("../../", import.meta.url).pathname;
}

let _container = null;
function dbContainer() {
  if (_container) return _container;
  const out = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
  const name = out.split("\n").find((n) => n.includes("supabase_db_"));
  if (!name) throw new Error("container supabase_db_* não encontrado — rode `supabase start`");
  _container = name.trim();
  return _container;
}

// `postgres` (a role exposta em DB_URL/status) NÃO é superuser no stack local
// (rolsuper=false; auth.users pertence a supabase_auth_admin) — reaplicar uma migration que
// mexe em trigger de auth.users como `postgres` dá "must be owner of relation users".
// `supabase_admin` (rolsuper=true) é o role que o próprio CLI usa pra aplicar migration;
// rodar DDL com ele reproduz o privilégio real do runner, não um acidente do arnês.
const DDL_ROLE = "supabase_admin";

/** Roda 1 statement SQL dentro do container do Postgres. Devolve stdout cru (psql -Atc). */
export function psql(sql, { role = DDL_ROLE } = {}) {
  return execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", role, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", sql], {
    encoding: "utf8",
  });
}

/** Aplica um arquivo .sql inteiro (idempotente por construção das próprias migrations, AC-C1). */
export function psqlFile(path, { role = DDL_ROLE } = {}) {
  const sql = readFileSync(path, "utf8");
  return execFileSync("docker", ["exec", "-i", dbContainer(), "psql", "-U", role, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: sql,
    encoding: "utf8",
  });
}

/** Client admin (service role) — bypassa RLS, como as edge functions. */
export function adminClient() {
  const s = status();
  return createClient(s.API_URL, s.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** URL/anon key pro client autenticado de `sessions.mjs`. */
export function apiUrlAndAnonKey() {
  const s = status();
  return { url: s.API_URL, anonKey: s.PUBLISHABLE_KEY || s.ANON_KEY };
}
