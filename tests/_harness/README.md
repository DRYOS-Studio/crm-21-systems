# Arnês de teste (T1, `.specs/features/ai-brain-outreach/tasks.md`)

Sem dependência nova: `node --test` (nativo, Node ≥18) + type-stripping nativo de `.ts` (Node ≥22.6,
testado aqui em v26.8.1) + o Postgres do `supabase start` local. Nenhum pacote novo em `package.json`.

## Pré-requisito

```bash
docker info >/dev/null && echo docker-ok
cd /Users/rafael/Documents/GitHub/Q7_PIPELINE_WHITELABEL_v2 && supabase start
```

## Rodar

```bash
cd /Users/rafael/Documents/GitHub/Q7_PIPELINE_WHITELABEL_v2
node --import ./tests/_harness/register.mjs --test tests/_harness/ tests/db/ tests/handler/ tests/unit/
```

`--import ./tests/_harness/register.mjs` é obrigatório nos testes que importam código de
`supabase/functions/` (H) — sem ele, `npm:@supabase/supabase-js@...` e a URL do Deno std não
resolvem. Testes puramente SQL (S) ou puros (U, `tests/unit/`) não precisam dele, mas incluí-lo
não quebra nada (é por isso que o comando acima cobre os quatro diretórios de uma vez).

## Peças

- `register.mjs` — `module.registerHooks` (síncrono, sem thread de hooks separada — sem o aviso
  de depreciação do `module.register` assíncrono que `battery/register.mjs` usa) reescrevendo os
  dois specifiers que as edge functions usam e que o Node não resolve sozinho: `npm:@supabase/
  supabase-js@X` → o pacote real do `node_modules` (a lib de verdade, sem stub); a URL do
  `deno.land/std/http/server.ts` → `deno-server-shim.mjs`.
  ⚠️ **Risco aceito, achado pelo code-review desta task**: "o pacote real" não é a **mesma versão**
  que as edge functions pinam na URL (`npm:@supabase/supabase-js@2.49.1`) — o `node_modules` tem a
  do `package.json` raiz (`2.110.8`), que a UI (`^2.104.0`) já diverge da URL pinada hoje, sem
  problema conhecido. Os testes H rodam contra 2.110.8; um comportamento que só muda entre 2.49 e
  2.110 (formato de erro, RLS, sessão) não seria pego aqui. Fechar de verdade exigiria vendorizar
  `@supabase/supabase-js@2.49.1` num path próprio do arnês — fora do escopo de T1 (nenhuma
  dependência nova); reabrir se um teste desconfiar de diferença de versão.
- `deno-server-shim.mjs` — `serve(handler)` captura o handler em `globalThis.__dcLastHandler` em
  vez de subir um servidor. Cada função exporta `index.ts` que chama `serve(async (req) => {...})`
  no import; o teste lê o handler capturado e chama com um `Request` de verdade (nativo do Node).
- `edge-shim.mjs` — `import` isto **antes** de importar qualquer `index.ts`/`handle.ts` de edge
  function. Define `globalThis.Deno.env.get` (lê `process.env`) e `globalThis.EdgeRuntime.waitUntil`
  (roda a promise e loga rejeição, sem bloquear) quando ainda não existem. Idempotente.
- `db.mjs` — `psql(sql)`/`psqlFile(path)` rodam contra o container `supabase_db_*` via
  `docker exec` (sem driver Postgres em `node_modules`), conectando como **`supabase_admin`**, não
  `postgres` — descoberta desta task: no stack local o role `postgres` não é superuser
  (`auth.users` pertence a `supabase_auth_admin`), então DDL que mexe no trigger de
  `on_auth_user_created` falha com "must be owner of relation users" se rodado como `postgres`.
  `supabase_admin` é o role que o próprio CLI usa pra aplicar migration, e reproduz o privilégio
  real do runner. `adminClient()` devolve um `@supabase/supabase-js` (service role) com a chave lida
  de `supabase status -o json` a cada chamada — nunca hardcoded.
- `fetch-stub.mjs` — `installFetchStub(entries)` troca `globalThis.fetch`; cada entrada é
  `{match: (url, init) => bool, respond: (url, init) => Response | Promise<Response>, delayMs?,
  times?}`. **Fail-closed**: request que não casa nenhuma entrada joga erro (nunca sai pra rede de
  verdade, nunca fica pendurado). `restoreFetch()` desfaz. `jsonOnce(urlSubstr, body)` é o atalho
  mais comum.
- `sessions.mjs` — `createUser(emailPrefix)` cria um usuário via admin (email já confirmado);
  `createAuthenticatedClient(email, password)` devolve um `@supabase/supabase-js` com o JWT desse
  usuário; `newTenant(emailPrefix)` faz as duas coisas de uma vez — é o que os testes de RLS/CRUD
  cruzado (AC-U3 e afins) usam pra montar 2 tenants.

## O que T1 prova (`tests/_harness/*.test.mjs`, `tests/db/smoke.test.mjs`, `tests/handler/smoke.test.mjs`)

- S: reaplicar `20260101000000_q7_init.sql` (idempotente, como `supabase_admin`) e ler as 9 tabelas
  originais por `information_schema.tables`.
- H: importar `whatsapp-webhook/index.ts` sem Deno instalado; `POST {"event":"test"}` ⇒ 200
  `{"ok":true,"message":"webhook ok"}`.
- Controle do `fetch-stub`: request que casa uma entrada ⇒ a resposta canned; request sem entrada
  que casa ⇒ lança (prova que ele é fail-closed, não deixa passagem silenciosa pra rede real).
- Controle das 2 sessões: usuário A não lê a linha semeada de B em `pipeline_stages` — nem por
  listagem, nem por `id` direto (RLS de verdade, não filtro de conveniência do client).

Rodado em 2026-09-24: `tests 5, pass 5, fail 0` (Docker 29.6.2, Supabase CLI 2.95.4, Node v26.8.1).
