import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getAgentConfig, callGroq, type AIConfig } from "../_shared/get-ai-config.ts";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";
import { runBrainTurn, type ConversaState } from "../_shared/brain.ts";

const BATCH = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FALLBACK_REENGAJE =
  "Oi! Só passando pra saber se ainda posso te ajudar com alguma coisa por aqui. 🙂";

const INSTRUCAO_REENGAJE =
  "O cliente não respondeu à última mensagem. Escreva UMA mensagem curta e natural de reengajamento (máx. 2 frases). Não se apresente de novo. Não peça desculpas. Não use emojis em excesso.";

function ok(body: any = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function modoCerebro(agent: AIConfig | null): boolean {
  return !!agent?.businessContext?.trim();
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: due, error } = await supabase
    .from("followups")
    .select("*")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(BATCH);

  if (error) return ok({ ok: false, error: error.message });
  if (!due?.length) return ok({ processed: 0 });

  const uaz = await getUazapiConfig();

  let processed = 0;
  for (const f of due) {
    try {
      const { data: conv } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", f.conversation_id)
        .maybeSingle();

      if (!conv) {
        await supabase.from("followups").update({ status: "cancelled", error: "conversation missing" }).eq("id", f.id);
        continue;
      }

      if (conv.ai_enabled === false && f.kind === "auto_inactivity") {
        await supabase
          .from("followups")
          .update({ status: "cancelled", error: "human took over" })
          .eq("id", f.id);
        continue;
      }

      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_token, server_url")
        .eq("id", conv.instance_id)
        .eq("user_id", conv.user_id)
        .maybeSingle();
      if (!inst?.instance_token) {
        await supabase.from("followups").update({ status: "failed", error: "no instance token" }).eq("id", f.id);
        continue;
      }

      let text = (f.text_override || "").trim();

      if (!text) {
        const agent = await getAgentConfig(conv.user_id);
        if (!agent) {
          await supabase.from("followups").update({ status: "failed", error: "agent config missing" }).eq("id", f.id);
          continue;
        }
        const { data: history } = await supabase
          .from("messages")
          .select("direction, content")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(20);

        const historyMessages = (history || []).reverse().map((m: any) => ({
          role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
          content: m.content,
        }));

        if (modoCerebro(agent)) {
          text = await reengajarNovo(supabase, conv, agent, historyMessages);
        } else {
          const chat = [
            { role: "system" as const, content: agent.systemPrompt + "\n\n" + INSTRUCAO_REENGAJE },
            ...historyMessages,
            {
              role: "user" as const,
              content: "[sistema] O cliente não respondeu. Escreva agora a mensagem de reengajamento, só ela.",
            },
          ];
          const groq = await callGroq(agent.apiKey, agent.model, chat);
          if (groq.ok && groq.reply && groq.reply.trim()) {
            text = groq.reply.trim();
          } else {
            console.warn("[run-followups] Groq vazio/erro, usando fallback:", groq.error);
            text = FALLBACK_REENGAJE;
          }
        }
      }

      const { data: fresh } = await supabase.from("conversations").select("optout").eq("id", conv.id).maybeSingle();
      if (fresh?.optout) {
        await supabase.from("followups").update({ status: "cancelled", error: "optout" }).eq("id", f.id);
        continue;
      }

      const token = inst.instance_token || uaz?.instanceToken;
      const serverUrl = (inst.server_url as string | null)?.replace(/\/$/, "") || uaz?.serverUrl;
      if (!token || !serverUrl) {
        await supabase.from("followups").update({ status: "failed", error: "no uazapi server/token" }).eq("id", f.id);
        continue;
      }
      const numero = conv.wa_phone || conv.contact_phone;
      const sendRes = await fetch(`${serverUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify({ number: numero, text }),
      });
      if (!sendRes.ok) {
        const errText = await sendRes.text();
        await supabase.from("followups").update({ status: "failed", error: `uazapi ${sendRes.status}: ${errText.slice(0, 300)}` }).eq("id", f.id);
        continue;
      }

      await supabase.from("messages").insert({
        conversation_id: conv.id,
        user_id: conv.user_id,
        direction: "outbound",
        sender: f.text_override ? "human" : "ai",
        content: text,
      });
      const newCount =
        f.kind === "auto_inactivity"
          ? (conv.auto_followup_count ?? 0) + 1
          : conv.auto_followup_count ?? 0;
      await supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          inactivity_followup_at: null,
          auto_followup_count: newCount,
        })
        .eq("id", conv.id);
      await supabase
        .from("followups")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", f.id);

      if (f.kind === "auto_inactivity") {
        const { data: agentCfg } = await supabase
          .from("agent_configs")
          .select("followup_inactivity_minutes, followup_max_per_conversation")
          .eq("user_id", conv.user_id)
          .maybeSingle();
        const minutes = agentCfg?.followup_inactivity_minutes ?? 0;
        const max = agentCfg?.followup_max_per_conversation ?? 1;
        if (minutes > 0 && newCount < max) {
          const nextAt = new Date(Date.now() + minutes * 60_000).toISOString();
          await supabase.from("followups").insert({
            user_id: conv.user_id,
            conversation_id: conv.id,
            send_at: nextAt,
            status: "pending",
            kind: "auto_inactivity",
          });
          await supabase
            .from("conversations")
            .update({ inactivity_followup_at: nextAt })
            .eq("id", conv.id);
        }
      }

      processed++;
    } catch (e: any) {
      console.error("[run-followups] error on followup", f.id, e);
      await supabase.from("followups").update({ status: "failed", error: e.message?.slice(0, 300) }).eq("id", f.id);
    }
  }

  return ok({ processed });
}

async function reengajarNovo(
  admin: ReturnType<typeof createClient>,
  conv: any,
  agent: AIConfig,
  historyMessages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const conversa: ConversaState = {
    etapa: conv.ai_stage,
    dados: conv.qualification || {},
    confirmacoes: conv.confirmacoes || 0,
  };
  try {
    const outcome = await runBrainTurn({
      admin,
      userId: conv.user_id,
      agent,
      conversa,
      historyMessages,
      janela: [],
      extraSistema: INSTRUCAO_REENGAJE,
    });
    const primeira = (outcome.mensagens[0] || "").trim();
    if (primeira) return primeira;
  } catch (e: any) {
    console.warn("[run-followups] runBrainTurn falhou, usando fallback:", e?.message);
  }
  return FALLBACK_REENGAJE;
}
