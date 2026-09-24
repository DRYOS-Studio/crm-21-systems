// Stub de fetch pras chamadas externas (Groq, Uazapi) — fail-closed: request que não casa
// nenhuma entrada REJEITA (nunca sai pra rede de verdade e nunca fica pendurado esperando).
// Isolado por teste via AsyncLocalStorage: arquivos H em paralelo (node --test) não
// sobrescrevem o stub um do outro — achado ao ligar webhook.test.mjs (T15) junto com turno.test.mjs.
import { AsyncLocalStorage } from "node:async_hooks";

const realFetch = globalThis.fetch;
const als = new AsyncLocalStorage();
let patched = false;

function ensurePatched() {
  if (patched) return;
  patched = true;
  globalThis.fetch = async (input, init) => {
    const store = als.getStore();
    if (!store) return realFetch(input, init);
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const entry = store.entries.find((e) => (e.times === undefined || e.used < e.times) && e.match(url, init));
    if (!entry) {
      throw new Error(`[fetch-stub] request sem entrada casada, recusada (fail-closed): ${init?.method ?? "GET"} ${url}`);
    }
    entry.used++;
    if (entry.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs));
    return entry.respond(url, init);
  };
}

/**
 * @param {Array<{match: (url: string, init?: RequestInit) => boolean, respond: (url: string, init?: RequestInit) => Response|Promise<Response>, delayMs?: number, times?: number}>} list
 */
export function installFetchStub(list) {
  ensurePatched();
  const store = { entries: list.map((e) => ({ ...e, used: 0 })) };
  als.enterWith(store);
  return () => restoreFetch();
}

export function restoreFetch() {
  if (als.getStore()) als.enterWith(undefined);
}

/** Atalho: uma única resposta JSON pra qualquer request cuja URL contenha `urlSubstr`. */
export function jsonOnce(urlSubstr, body, init = {}) {
  return {
    match: (url) => url.includes(urlSubstr),
    respond: () => new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "Content-Type": "application/json" } }),
    times: init.times,
    delayMs: init.delayMs,
  };
}
