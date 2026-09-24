// Substitui https://deno.land/std@.../http/server.ts nas edge functions sob teste.
// Em vez de subir um servidor HTTP de verdade, captura o handler pra o teste chamar direto
// com um `Request` (Node tem `Request`/`Response`/`fetch` nativos desde a v18).
export function serve(handler) {
  globalThis.__dcLastHandler = handler;
  return handler;
}
