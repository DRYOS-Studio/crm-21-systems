// `import` isto ANTES de importar qualquer index.ts/handle.ts de supabase/functions/.
// Deno global: só o que as edge functions realmente chamam (Deno.env.get). Idempotente —
// pode ser importado várias vezes no mesmo processo de teste sem sobrescrever um Deno real.
if (!globalThis.Deno) {
  globalThis.Deno = {
    env: {
      get(key) {
        const v = process.env[key];
        return v === undefined ? undefined : v;
      },
    },
  };
}

// EdgeRuntime.waitUntil (ADR-05, design.md): roda a promise em background; erro não-tratado
// vira log, nunca derruba o processo de teste nem trava o handler síncrono.
if (!globalThis.EdgeRuntime) {
  globalThis.EdgeRuntime = {
    waitUntil(promise) {
      Promise.resolve(promise).catch((e) => {
        console.error("[edge-shim] EdgeRuntime.waitUntil rejeitou:", e);
      });
    },
  };
}
