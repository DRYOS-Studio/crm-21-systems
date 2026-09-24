import { test } from "node:test";
import assert from "node:assert/strict";
import "../_harness/edge-shim.mjs";

// Importa a edge function de produção sem Deno instalado (T1). O import dispara
// `serve(async (req) => {...})` no topo do módulo; o shim de _harness/deno-server-shim.mjs
// captura esse handler em vez de subir um servidor.
const webhookUrl = new URL("../../supabase/functions/whatsapp-webhook/index.ts", import.meta.url);
await import(webhookUrl.href);
const handler = globalThis.__dcLastHandler;

test("T1 (H): whatsapp-webhook importado sob Node responde ao evento 'test'", async () => {
  assert.ok(typeof handler === "function", "serve() não capturou o handler — hook de resolução quebrado?");
  const req = new Request("http://localhost/whatsapp-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "test" }),
  });
  const res = await handler(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true, message: "webhook ok" });
});
