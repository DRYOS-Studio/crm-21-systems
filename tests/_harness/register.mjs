// `module.registerHooks` (síncrono, no mesmo processo — sem thread de hooks separada,
// sem o aviso de depreciação do `module.register` assíncrono usado em battery/register.mjs).
// Reescreve os dois specifiers que as edge functions usam e que o Node não resolve sozinho:
//   npm:@supabase/supabase-js@X        → o pacote real do node_modules (mesma lib, SEM stub —
//     mas não necessariamente a mesma versão: as edge functions pinam @2.49.1 na URL, o
//     node_modules instalado é o do package.json raiz (2.110.x). Risco aceito, ver README.md.)
//   https://deno.land/std@X/http/server.ts → shim local de `serve`
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("npm:@supabase/supabase-js")) {
      return nextResolve("@supabase/supabase-js", context);
    }
    if (/^https:\/\/(deno\.land\/std@[^/]+|esm\.sh)\/.*supabase-js/.test(specifier)) {
      return nextResolve("@supabase/supabase-js", context);
    }
    if (/^https:\/\/deno\.land\/std@[^/]+\/http\/server\.ts$/.test(specifier)) {
      return { url: new URL("./deno-server-shim.mjs", import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
