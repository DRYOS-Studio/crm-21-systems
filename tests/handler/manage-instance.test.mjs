// T17: manage-instance set_webhook/get_webhooks (design.md §6, ADR-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import "../_harness/edge-shim.mjs";
import { status, adminClient } from "../_harness/db.mjs";
import { installFetchStub } from "../_harness/fetch-stub.mjs";
import { createUser, createAuthenticatedClient } from "../_harness/sessions.mjs";
import { handle } from "../../supabase/functions/manage-instance/index.ts";
import { montarWebhookUrl } from "../../supabase/functions/_shared/webhook-url.ts";

const s = status();
process.env.SUPABASE_URL = s.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = s.SERVICE_ROLE_KEY;
const realFetch = globalThis.fetch;

async function seedOwner(prefix) {
  const admin = adminClient();
  const user = await createUser(prefix);
  const auth = await createAuthenticatedClient(user.email, user.password);
  const serverUrl = `https://uazapi-${prefix}-${Date.now()}.example.test`;
  const instanceToken = `tok-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: inst, error } = await admin
    .from("whatsapp_instances")
    .insert({
      user_id: user.id,
      name: `${prefix}-inst`,
      instance_token: instanceToken,
      server_url: serverUrl,
      status: "connected",
    })
    .select()
    .single();
  if (error) throw new Error(`seed instance falhou: ${error.message}`);
  return { admin, user, jwt: auth.session.access_token, inst, instanceToken, serverUrl };
}

function post(body, jwt) {
  const headers = { "Content-Type": "application/json" };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  return handle(new Request("http://localhost/manage-instance", { method: "POST", headers, body: JSON.stringify(body) }));
}

function passthroughApi() {
  return { match: (url) => url.startsWith(s.API_URL), respond: (url, init) => realFetch(url, init) };
}

function captureLogs() {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => {
    lines.push(a.map(String).join(" "));
    origLog(...a);
  };
  console.error = (...a) => {
    lines.push(a.map(String).join(" "));
    origErr(...a);
  };
  return {
    lines,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

test("T17: sem JWT / instância de outro tenant / sem instance_token ⇒ erro e 0 chamadas à Uazapi", async () => {
  const { jwt, instanceToken, serverUrl, user } = await seedOwner("t17-auth");
  const other = await createUser("t17-intruso");
  const otherAuth = await createAuthenticatedClient(other.email, other.password);

  let uaz = 0;
  const stop = installFetchStub([
    passthroughApi(),
    { match: (url) => url.startsWith(serverUrl), respond: () => { uaz++; return new Response("{}", { status: 200 }); } },
  ]);
  try {
    const semJwt = await post({ action: "set_webhook", instance_token: instanceToken });
    assert.equal(semJwt.status, 401);
    assert.equal((await semJwt.json()).ok, false);

    const semToken = await post({ action: "set_webhook" }, jwt);
    assert.equal((await semToken.json()).ok, false);

    const alheia = await post({ action: "set_webhook", instance_token: instanceToken }, otherAuth.session.access_token);
    assert.equal((await alheia.json()).ok, false);

    const getSemJwt = await post({ action: "get_webhooks", instance_token: instanceToken });
    assert.equal(getSemJwt.status, 401);

    assert.equal(uaz, 0, "Uazapi não deveria ter sido chamada");
    assert.ok(user.id);
  } finally {
    stop();
  }
});

test("T17: Uazapi falhando no set_webhook (rotação) deixa o secret inalterado", async () => {
  const { admin, jwt, inst, instanceToken, serverUrl, user } = await seedOwner("t17-rotate");
  const { data: original, error } = await admin.rpc("webhook_secret_for", { p_user: user.id, p_instance: inst.id });
  if (error) throw new Error(error.message);
  assert.ok(original);

  let uaz = 0;
  const stop = installFetchStub([
    passthroughApi(),
    {
      match: (url) => url.startsWith(serverUrl),
      respond: () => {
        uaz++;
        return new Response("uazapi down", { status: 500 });
      },
    },
  ]);
  try {
    const res = await post({ action: "set_webhook", instance_token: instanceToken, rotate: true, webhook_url: "http://ignorada" }, jwt);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(uaz, 1);
    const { data: still } = await admin.rpc("webhook_secret_for", { p_user: user.id, p_instance: inst.id });
    assert.equal(still, original, "rotate_begin sem commit não pode trocar o secret");
  } finally {
    stop();
  }
});

test("T17: resposta e log não carregam o valor de s; body.webhook_url é ignorado", async () => {
  const { admin, jwt, inst, instanceToken, serverUrl, user } = await seedOwner("t17-redact");
  const { data: secret } = await admin.rpc("webhook_secret_for", { p_user: user.id, p_instance: inst.id });
  assert.ok(secret);
  const expectedUrl = montarWebhookUrl(s.API_URL, secret);

  let sentUrl = null;
  const logs = captureLogs();
  const stop = installFetchStub([
    passthroughApi(),
    {
      match: (url) => url.startsWith(serverUrl) && url.endsWith("/webhook"),
      respond: (_url, init) => {
        if (init?.method === "POST") sentUrl = JSON.parse(init.body).url;
        return new Response(JSON.stringify({ ok: true, url: expectedUrl }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  ]);
  try {
    const setRes = await post(
      { action: "set_webhook", instance_token: instanceToken, webhook_url: "https://evil.example/hook" },
      jwt,
    );
    const setBody = await setRes.json();
    assert.equal(setBody.ok, true);
    assert.equal(sentUrl, expectedUrl, "servidor deve montar a URL; webhook_url do body é ignorado");
    const dumped = JSON.stringify(setBody) + "\n" + logs.lines.join("\n");
    assert.equal(dumped.includes(secret), false, "secret vazou na resposta ou no log");
    assert.match(dumped, /\[redacted\]/);

    const getRes = await post({ action: "get_webhooks", instance_token: instanceToken }, jwt);
    const getBody = await getRes.json();
    assert.equal(getBody.ok, true);
    assert.equal(JSON.stringify(getBody).includes(secret), false);
  } finally {
    logs.restore();
    stop();
  }
});
