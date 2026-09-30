import { createClient } from "npm:@supabase/supabase-js@2.49.1";

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  businessContext: string | null;
  ownerNotifyPhone: string | null;
  enabled: boolean;
}

export type AIProvider = "groq" | "openai" | "gemini" | "claude";

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";
export const GROQ_DEFAULT_MODEL = "auto";

/**
 * Ordem de preferência para atendimento de WhatsApp: mensagem curta,
 * resposta rápida, maior cota diária primeiro. O 8b tem 14.4k req/dia no
 * free tier contra 1k do 70b — ele aguenta muito mais conversa.
 */
export const MODEL_PREFERENCE = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-120b",
  "groq/compound-mini",
];

/** Áudio, TTS, classificadores e guardrails — não respondem chat. */
const NON_CHAT = /whisper|orpheus|prompt-guard|safeguard|allam|tts|guard/i;

/** Status que valem tentar o próximo modelo (o modelo é o problema, não a chave). */
const FAILOVER_STATUS = new Set([400, 404, 413, 422, 429, 500, 502, 503, 504]);

/** design.md §4.2: Groq 20s, listagem de modelos 10s. */
const GROQ_TIMEOUT_MS = 20_000;
const MODELS_TIMEOUT_MS = 10_000;

const modelCache = new Map<string, { ids: string[]; at: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getAgentConfig(userId: string): Promise<AIConfig | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  const admin = createClient(supabaseUrl, serviceKey);
  const { data } = await admin
    .from("agent_configs")
    .select("ai_provider, ai_api_key, ai_model, groq_api_key, groq_model, system_prompt, business_context, owner_notify_phone, enabled")
    .eq("user_id", userId)
    .maybeSingle();
  const provider = (data?.ai_provider || "groq") as AIProvider;
  const apiKey = provider === "groq"
    ? data?.groq_api_key || Deno.env.get("GROQ_API_KEY") || null
    : data?.ai_api_key || null;
  if (!apiKey) return null;
  return {
    provider,
    apiKey,
    model: provider === "groq" ? data?.groq_model || GROQ_DEFAULT_MODEL : data?.ai_model || "",
    systemPrompt:
      data?.system_prompt ||
      "Você é um assistente de atendimento simpático e objetivo. Quando receber [áudio], [imagem], [vídeo] ou [documento], diga que ainda não consegue ouvir ou ver o conteúdo e peça para o cliente resumir por texto.",
    businessContext: data?.business_context || null,
    ownerNotifyPhone: data?.owner_notify_phone || null,
    enabled: !!data?.enabled,
  };
}

/**
 * Modelos de chat realmente disponíveis para esta chave, segundo a própria Groq.
 * Cacheado por 10 min para não gastar uma chamada extra a cada mensagem.
 */
export async function listChatModels(apiKey: string): Promise<string[]> {
  const cacheKey = apiKey.slice(-6);
  const hit = modelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ids;

  try {
    const res = await fetch(GROQ_MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const ids: string[] = (data?.data ?? [])
      .filter((m: any) => m?.active !== false)
      .filter((m: any) => !NON_CHAT.test(String(m?.id ?? "")))
      .filter((m: any) => (m?.context_window ?? 0) >= 8000)
      .map((m: any) => String(m.id));
    if (ids.length) modelCache.set(cacheKey, { ids, at: Date.now() });
    return ids;
  } catch {
    return [];
  }
}

/**
 * Monta a fila de modelos a tentar. Respeita a escolha do usuário quando ela
 * existe e ainda está viva; "auto" (ou modelo decomissionado) cai direto na
 * ordem de preferência filtrada pelo que a Groq diz estar disponível.
 */
export async function resolveModelChain(apiKey: string, preferred?: string): Promise<string[]> {
  const available = await listChatModels(apiKey);
  const wanted = (preferred ?? "").trim();
  const isAuto = !wanted || wanted.toLowerCase() === "auto";

  // Sem lista da Groq (rede caiu, chave sem permissão): usa o palpite estático.
  if (!available.length) {
    return isAuto ? [...MODEL_PREFERENCE] : [wanted, ...MODEL_PREFERENCE.filter((m) => m !== wanted)];
  }

  const chain: string[] = [];
  if (!isAuto && available.includes(wanted)) chain.push(wanted);
  for (const m of MODEL_PREFERENCE) {
    if (available.includes(m) && !chain.includes(m)) chain.push(m);
  }
  // Nenhum preferido sobreviveu — aceita qualquer chat model que a conta tenha.
  for (const m of available) {
    if (!chain.includes(m)) chain.push(m);
  }
  return chain;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: string } };
};
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type ClaudeBlock = { type: string; id?: string; name?: string; input?: unknown; text?: string; tool_use_id?: string; content?: string };
type ClaudeMessage = { role: string; content: string | ClaudeBlock[] };

export interface GroqCallOptions {
  tools?: ToolDef[];
  response_format?: { type: "json_object" };
  temperature?: number;
  max_tokens?: number;
  /** Corta a cadeia de failover em N modelos (ADR-02). */
  maxModels?: number;
  /** Tira da cadeia todo modelo cujo id comece por um destes prefixos (ADR-02: `["groq/compound"]`). */
  exclude?: string[];
}

export async function callAI(
  provider: AIProvider,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options: GroqCallOptions = {},
): Promise<GroqResult> {
  if (!["groq", "openai", "gemini", "claude"].includes(provider)) return { ok: false, error: "Provedor de IA inválido." };
  if (provider === "groq") return callGroq(apiKey, model, messages, options);
  if (!model.trim()) return { ok: false, error: "Informe o modelo do provedor." };
  try {
    if (provider === "openai") return await callOpenAICompatible("https://api.openai.com/v1/chat/completions", apiKey, model, messages, options);
    if (provider === "gemini") return await callGemini(apiKey, model, messages, options);
    if (provider === "claude") return await callClaude(apiKey, model, messages, options);
    return { ok: false, error: "Provedor de IA inválido." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Falha ao chamar IA" };
  }
}

async function callOpenAICompatible(endpoint: string, apiKey: string, model: string, messages: ChatMessage[], options: GroqCallOptions): Promise<GroqResult> {
  const body: Record<string, unknown> = { model, messages };
  if (options.tools) body.tools = options.tools;
  if (options.response_format) body.response_format = options.response_format;
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(GROQ_TIMEOUT_MS) });
  const raw = await response.text();
  if (!response.ok) return providerError(response.status, raw);
  const message = JSON.parse(raw).choices?.[0]?.message;
  if (!message) return { ok: false, model, error: "Resposta vazia da IA" };
  if (message.tool_calls?.length) return { ok: true, model, toolCalls: message.tool_calls, reply: message.content ?? undefined };
  return message.content?.trim() ? { ok: true, model, reply: message.content } : { ok: false, model, error: "Resposta vazia da IA" };
}

async function callGemini(apiKey: string, model: string, messages: ChatMessage[], options: GroqCallOptions): Promise<GroqResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const functionNames = new Map<string, string>();
  const contents: GeminiContent[] = [];
  for (const message of messages.filter((m) => m.role !== "system")) {
    if (message.role === "tool") {
      const name = functionNames.get(message.tool_call_id) || message.tool_call_id;
      const resultPart = { functionResponse: { name, response: { result: message.content } } };
      const previous = contents.at(-1);
      if (previous?.role === "user" && previous.parts.every((part) => part.functionResponse)) previous.parts.push(resultPart);
      else contents.push({ role: "user", parts: [resultPart] });
      continue;
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      contents.push({ role: "model", parts: message.tool_calls.map((tool) => {
        functionNames.set(tool.id, tool.function.name);
        let args: unknown = {};
        try { args = JSON.parse(tool.function.arguments || "{}"); } catch { /* provider will return a usable error */ }
        return { functionCall: { name: tool.function.name, args } };
      }) });
      continue;
    }
    contents.push({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content || "" }] });
  }
  const body: Record<string, unknown> = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const generationConfig: Record<string, unknown> = {};
  if (options.response_format) generationConfig.responseMimeType = "application/json";
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
  if (options.max_tokens !== undefined) generationConfig.maxOutputTokens = options.max_tokens;
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  if (options.tools) body.tools = [{ functionDeclarations: options.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters })) }];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(GROQ_TIMEOUT_MS) });
  const raw = await response.text();
  if (!response.ok) return providerError(response.status, raw);
  const data = JSON.parse(raw) as { candidates?: { content?: { parts?: GeminiPart[] } }[] };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const toolCalls = parts.filter((part) => part.functionCall).map((part) => ({ id: crypto.randomUUID(), type: "function" as const, function: { name: part.functionCall!.name, arguments: JSON.stringify(part.functionCall!.args ?? {}) } }));
  const reply = parts.map((part) => part.text).filter(Boolean).join("");
  return toolCalls.length ? { ok: true, model, toolCalls, reply: reply || undefined } : reply.trim() ? { ok: true, model, reply } : { ok: false, model, error: "Resposta vazia da IA" };
}

async function callClaude(apiKey: string, model: string, messages: ChatMessage[], options: GroqCallOptions): Promise<GroqResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const converted: ClaudeMessage[] = [];
  for (const message of messages.filter((m) => m.role !== "system")) {
    if (message.role === "tool") {
      const resultBlock = { type: "tool_result", tool_use_id: message.tool_call_id, content: message.content };
      const previous = converted.at(-1);
      if (previous?.role === "user" && Array.isArray(previous.content) && previous.content.every((block) => block.type === "tool_result")) previous.content.push(resultBlock);
      else converted.push({ role: "user", content: [resultBlock] });
    } else if (message.role === "assistant" && message.tool_calls?.length) {
      const content: ClaudeBlock[] = message.tool_calls.map((tool) => {
        let input: unknown = {};
        try { input = JSON.parse(tool.function.arguments || "{}"); } catch { /* provider will return a usable error */ }
        return { type: "tool_use", id: tool.id, name: tool.function.name, input };
      });
      if (message.content) content.unshift({ type: "text", text: message.content });
      converted.push({ role: "assistant", content });
    } else {
      converted.push({ role: message.role, content: message.content || "" });
    }
  }
  const body: Record<string, unknown> = { model, messages: converted, max_tokens: options.max_tokens ?? 1024 };
  if (system) body.system = system;
  if (options.tools) body.tools = options.tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters }));
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.response_format) body.system = `${system}\n\nResponda apenas com um objeto JSON válido.`.trim();
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(GROQ_TIMEOUT_MS) });
  const raw = await response.text();
  if (!response.ok) return providerError(response.status, raw);
  const content = (JSON.parse(raw).content ?? []) as ClaudeBlock[];
  const toolCalls = content.filter((part) => part.type === "tool_use").map((part) => ({ id: part.id!, type: "function" as const, function: { name: part.name!, arguments: JSON.stringify(part.input ?? {}) } }));
  const reply = content.filter((part) => part.type === "text").map((part) => part.text).join("");
  return toolCalls.length ? { ok: true, model, toolCalls, reply: reply || undefined } : reply.trim() ? { ok: true, model, reply } : { ok: false, model, error: "Resposta vazia da IA" };
}

function providerError(status: number, raw: string): GroqResult {
  let code: string | undefined;
  let message = raw;
  try { const parsed = JSON.parse(raw); code = parsed?.error?.code ?? parsed?.error?.type; message = parsed?.error?.message ?? parsed?.message ?? raw; } catch { /* retain response text */ }
  return { ok: false, status, code, error: `Erro do provedor (${status}): ${String(message).slice(0, 500)}`, rawBody: raw.slice(0, 500) };
}

export interface GroqResult {
  ok: boolean;
  reply?: string;
  toolCalls?: ToolCall[];
  model?: string;
  error?: string;
  /** `error.code` do corpo da Groq (ex.: "tool_use_failed", ADR-02). Ausente se o corpo não for JSON de erro. */
  code?: string;
  /** Corpo cru truncado da RESPOSTA (nunca o request — nunca carrega o header de auth). */
  rawBody?: string;
  status?: number;
  tried?: string[];
}

/** Uma tentativa, um modelo. Sem fallback. */
export async function callGroqOnce(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options: GroqCallOptions = {},
): Promise<GroqResult> {
  try {
    const body: Record<string, unknown> = { model, messages };
    if (options.tools) body.tools = options.tools;
    if (options.response_format) body.response_format = options.response_format;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;

    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      let code: string | undefined;
      try {
        const parsed = JSON.parse(text);
        code = parsed?.error?.code ?? parsed?.code;
      } catch {
        // corpo não é JSON — sem code
      }
      return {
        ok: false,
        model,
        status: res.status,
        error: translateAIError(text, res.status),
        code,
        rawBody: text.slice(0, 500),
      };
    }
    const data = JSON.parse(text);
    const msg = data.choices?.[0]?.message;
    if (!msg) {
      return { ok: false, model, error: "Resposta vazia da IA" };
    }
    if (msg.tool_calls?.length) {
      return { ok: true, model, toolCalls: msg.tool_calls, reply: msg.content ?? undefined };
    }
    const reply = msg.content;
    if (!reply || !String(reply).trim()) {
      const finish = data.choices?.[0]?.finish_reason;
      return { ok: false, model, error: `Resposta vazia da IA (finish_reason=${finish ?? "n/a"})` };
    }
    return { ok: true, model, reply: String(reply) };
  } catch (e: any) {
    return { ok: false, model, error: e.message || "Falha ao chamar IA" };
  }
}

/**
 * Chama a Groq com failover automático de modelo.
 *
 * Passa `model = "auto"` (ou vazio) para deixar o sistema escolher. Se o modelo
 * escolhido estiver sobrecarregado (503), estourou cota (429) ou foi
 * decomissionado (404), tenta o próximo da fila em vez de devolver erro ao
 * cliente. Chave inválida (401/403) NÃO faz failover — trocar de modelo não
 * conserta chave errada.
 */
export async function callGroq(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options: GroqCallOptions = {},
): Promise<GroqResult> {
  let chain = await resolveModelChain(apiKey, model);
  if (options.exclude?.length) {
    chain = chain.filter((m) => !options.exclude!.some((prefix) => m.startsWith(prefix)));
  }
  if (options.maxModels !== undefined) {
    chain = chain.slice(0, options.maxModels);
  }
  const tried: string[] = [];
  let last: GroqResult = { ok: false, error: "Nenhum modelo Groq disponível para esta chave." };

  for (const candidate of chain) {
    tried.push(candidate);
    const result = await callGroqOnce(apiKey, candidate, messages, options);
    if (result.ok) return { ...result, tried };
    last = result;

    // Chave inválida: nenhum outro modelo vai funcionar. Para agora.
    if (result.status === 401 || result.status === 403) break;
    // Erro que não é do modelo (rede, parse): também não adianta cascatear.
    if (result.status !== undefined && !FAILOVER_STATUS.has(result.status)) break;
    if (result.status === undefined) break;

    // Modelo sumiu da conta — invalida o cache para a próxima chamada.
    if (result.status === 404) modelCache.delete(apiKey.slice(-6));
  }

  return { ...last, tried };
}

export function translateAIError(text: string, status: number): string {
  const t = text.substring(0, 500);
  if (status === 503 || /overloaded|high demand|service unavailable/i.test(t)) {
    return "O modelo Groq está temporariamente sobrecarregado. Aguarde alguns segundos e tente novamente.";
  }
  if (status === 429 || /rate limit|too many requests/i.test(t)) {
    return "Limite de requisições da Groq atingido. Aguarde um momento.";
  }
  if (status === 401 || status === 403 || /invalid api key|invalid_api_key/i.test(t)) {
    return "Chave da Groq inválida. Verifique em Configurações → Integração.";
  }
  if (status === 404 || /model.*not found|does not exist|decommissioned/i.test(t)) {
    return "Modelo Groq não encontrado. Escolha outro em Configurações → Integração.";
  }
  if (status === 400 || /bad request|invalid request/i.test(t)) {
    return "Requisição inválida para a Groq. Verifique o modelo e a chave.";
  }
  return `A Groq retornou erro ${status}: ${t}`;
}
