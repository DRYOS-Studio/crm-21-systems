import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, listChatModels, resolveModelChain, type AIProvider } from "../_shared/get-ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "Não autorizado" }, 200);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ ok: false, error: "Usuário inválido" }, 200);

    const body = await req.json().catch(() => ({}));
    let { apiKey, model, provider } = body ?? {};

    // A UI limpa o campo da chave depois de salvar, então um teste posterior
    // manda o corpo vazio. Busca o que o usuário salvou antes de desistir.
    const { data: cfg } = await supabase
      .from("agent_configs")
      .select("ai_provider, ai_api_key, ai_model, groq_api_key, groq_model")
      .eq("user_id", user.id)
      .maybeSingle();
    provider = (provider || cfg?.ai_provider || "groq") as AIProvider;
    if (!["groq", "openai", "gemini", "claude"].includes(provider)) return json({ ok: false, error: "Provedor de IA inválido." }, 200);
    if (!model) model = provider === "groq" ? cfg?.groq_model ?? "auto" : cfg?.ai_model ?? "";
    if (!apiKey) apiKey = provider === "groq" ? cfg?.groq_api_key ?? undefined : cfg?.ai_api_key ?? undefined;
    if (!apiKey && provider === "groq") apiKey = Deno.env.get("GROQ_API_KEY");
    if (!apiKey) {
      return json({ ok: false, error: `Chave de ${provider} não configurada. Adicione em Configurações → Agente IA.` }, 200);
    }

    const result = await callAI(provider, apiKey, model, [
      { role: "system", content: "Responda apenas com a palavra: OK" },
      { role: "user", content: "Teste de conexão" },
    ]);

    if (!result.ok) {
      const tentados = result.tried?.length ? ` (tentados: ${result.tried.join(", ")})` : "";
      return json({ ok: false, error: `${result.error}${tentados}` }, 200);
    }

    // Devolve a lista viva para a UI poder oferecer as opções sem chutar.
    const available = provider === "groq" ? await listChatModels(apiKey) : [model];
    const chain = provider === "groq" ? await resolveModelChain(apiKey, model) : [model];

    return json({
      ok: true,
      data: {
        reply: String(result.reply).substring(0, 200),
        provider,
        model: result.model,
        auto: !model || String(model).toLowerCase() === "auto",
        fallbacks: chain.slice(0, 5),
        available,
      },
    }, 200);

  } catch (e: any) {
    return json({ ok: false, error: e.message || "Erro interno" }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
