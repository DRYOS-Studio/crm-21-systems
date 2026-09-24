// AC-A0 (Task 0): chamadas reais à Groq. Chave via env GROQ_KEY (nunca impressa).
// Uso: GROQ_KEY=... node a0-groq.mjs > a0-groq.out
const KEY = process.env.GROQ_KEY;
if (!KEY) throw new Error("GROQ_KEY ausente");
const URL = "https://api.groq.com/openai/v1/chat/completions";
const TOOLS = [{ type: "function", function: { name: "consultar_calendario", description: "Devolve os próximos dias (data YYYY-MM-DD e dia da semana). Chame antes de falar de qualquer data.", parameters: { type: "object", properties: {}, required: [] } } }];
const SYS = 'Você é um atendente. Responda SEMPRE em JSON: {"mensagens": ["..."], "etapa": "descobrir"}. Antes de falar de datas, chame a tool consultar_calendario.';
const CAL = JSON.stringify([{ data: "2026-09-24", dia_semana: "quinta-feira", rotulo: "hoje" }, { data: "2026-09-25", dia_semana: "sexta-feira", rotulo: "amanha" }]);

async function call(model, messages, opts) {
  const body = { model, messages, temperature: 0.2, max_tokens: 400, ...opts };
  const res = await fetch(URL, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: res.status, msg: j?.choices?.[0]?.message, finish: j?.choices?.[0]?.finish_reason, code: j?.error?.code ?? null, err: res.ok ? null : text.slice(0, 300) };
}

async function roteiro(model, comJson) {
  const extra = comJson ? { response_format: { type: "json_object" } } : {};
  const msgs = [{ role: "system", content: SYS }, { role: "user", content: "que dia é amanhã?" }];
  const r1 = await call(model, msgs, { tools: TOOLS, ...extra });
  const out = { model, forma: comJson ? "tools+json_object" : "tools sem response_format", r1_status: r1.status, r1_err: r1.err, r1_tool_call: !!r1.msg?.tool_calls?.length };
  if (r1.status !== 200) return out;
  let final = r1.msg;
  if (r1.msg?.tool_calls?.length) {
    msgs.push({ role: "assistant", content: r1.msg.content ?? null, tool_calls: r1.msg.tool_calls });
    for (const tc of r1.msg.tool_calls) msgs.push({ role: "tool", tool_call_id: tc.id, content: CAL });
    const r2 = await call(model, msgs, { tools: TOOLS, ...extra });
    out.r2_status = r2.status; out.r2_err = r2.err; out.r2_tool_call_de_novo = !!r2.msg?.tool_calls?.length;
    final = r2.msg;
  }
  const c = final?.content ?? "";
  let parsed = null; try { parsed = JSON.parse(String(c).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")); } catch {}
  out.final_json_valido = !!parsed; out.final_mensagens_array = Array.isArray(parsed?.mensagens);
  out.final_trecho = String(c).slice(0, 160);
  return out;
}

async function formatacao(model) {
  // ADR-01: chamada de formatação, json_object sem tools
  const r = await call(model, [{ role: "system", content: 'Reescreva o texto do usuário como JSON {"mensagens": ["..."]}. Só o JSON.' }, { role: "user", content: "Amanhã é sexta-feira, dia 25. Posso te ajudar com algo?" }], { response_format: { type: "json_object" } });
  let ok = false; try { ok = Array.isArray(JSON.parse(r.msg?.content || "").mensagens); } catch {}
  return { model, forma: "formatacao json_object sem tools", status: r.status, err: r.err, mensagens_array: ok };
}

// Loop real do brain (ADR-01): até 4 rodadas só com tools; tool_use_failed conta como rodada perdida.
async function loop(model) {
  const msgs = [{ role: "system", content: SYS }, { role: "user", content: "que dia é amanhã?" }];
  const rodadas = [];
  for (let i = 0; i < 4; i++) {
    const r = await call(model, msgs, { tools: TOOLS, max_tokens: 1500 });
    const tc = r.msg?.tool_calls?.map((t) => t.function.name) ?? [];
    rodadas.push({ status: r.status, code: r.code, finish: r.finish, tools: tc, conteudo: String(r.msg?.content ?? "").slice(0, 120) });
    if (r.status !== 200) continue;
    if (tc.length) {
      msgs.push({ role: "assistant", content: r.msg.content ?? null, tool_calls: r.msg.tool_calls });
      for (const t of r.msg.tool_calls) msgs.push({ role: "tool", tool_call_id: t.id, content: CAL });
      continue;
    }
    let ok = false; try { ok = Array.isArray(JSON.parse(String(r.msg?.content ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")).mensagens); } catch {}
    return { model, forma: "loop 4 rodadas so tools", rodadas, convergiu: true, mensagens_array: ok };
  }
  return { model, forma: "loop 4 rodadas so tools", rodadas, convergiu: false };
}

if (process.env.LOOP) {
  const out = [];
  for (const m of process.env.MODELS.split(",")) for (let k = 0; k < Number(process.env.REPS || 3); k++) out.push(await loop(m));
  console.log(JSON.stringify({ quando: new Date().toISOString(), out }, null, 1));
  process.exit(0);
}

const models = (process.env.MODELS || "llama-3.3-70b-versatile,llama-3.1-8b-instant,openai/gpt-oss-20b,groq/compound-mini").split(",");
const res = [];
for (const m of models) {
  res.push(await roteiro(m, true));
  res.push(await roteiro(m, false));
  res.push(await formatacao(m));
}
console.log(JSON.stringify({ quando: new Date().toISOString(), res }, null, 1));
