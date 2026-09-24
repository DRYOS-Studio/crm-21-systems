// callGroq scriptado: globalThis.__script é uma função (callIndex, messages, opts) => GroqResult
export async function callGroq(apiKey, model, messages, opts) {
  globalThis.__calls = (globalThis.__calls || 0) + 1;
  return globalThis.__script(globalThis.__calls, messages, opts);
}
